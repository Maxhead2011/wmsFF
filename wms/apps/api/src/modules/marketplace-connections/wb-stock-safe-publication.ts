import { deferUnconfirmedWbStock } from './wb-stock-sync-queue';

export type WbStockTarget = { warehouseId: string; skuId?: string; chrtId: number; amount: number };
export type WbStockProof = WbStockTarget & { phase: string; status: string; sentAmount?: number; observedAmount?: number; error?: string };
type IO = {
  read: (warehouseId: string, ids: number[]) => Promise<Map<number, number>>;
  send: (warehouseId: string, rows: Array<{ chrtId: number; amount: number }>) => Promise<unknown>;
  record: (row: WbStockProof) => Promise<void>;
};

// FIX: quarantine an unknown size across all warehouses, preserving its existing stock everywhere.
export async function selectKnownWbStockTargets<T extends WbStockTarget>(targets: T[], read: IO['read'], record: IO['record']) {
  const missing = new Set<number>();
  for (const warehouse of new Set(targets.map(t => t.warehouseId))) {
    const rows = targets.filter(t => t.warehouseId === warehouse);
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      const amounts = await read(warehouse, batch.map(t => t.chrtId));
      for (const row of batch) {
        const amount = amounts.get(row.chrtId);
        if (amount === undefined) missing.add(row.chrtId);
        else if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('WB вернул некорректный остаток.');
      }
    }
  }
  const unknown = targets.filter(t => missing.has(t.chrtId));
  // FIX: retain unknown targets in the durable urgent queue, not just in the UI warning.
  deferUnconfirmedWbStock(unknown);
  for (const row of unknown) await record({ ...row, phase: 'STOP', status: 'UNCONFIRMED', error: 'WB не вернул остаток размера на одном из складов. Товар пропущен на всех складах; нужна проверка привязки карточки WB.' });
  return { known: targets.filter(t => !missing.has(t.chrtId)), unknown };
}

// FIX: all decreases, including stale warehouses, must be verified before ANY increase.
export async function publishWbStockPlan(targets: WbStockTarget[], io: IO) {
  const keys = new Set<string>();
  for (const row of targets) {
    const key = `${row.warehouseId}:${row.chrtId}`;
    if (keys.has(key) || !Number.isSafeInteger(row.amount) || row.amount < 0) throw new Error('Неоднозначный план остатков WB.');
    keys.add(key);
  }
  const before = new Map<string, number>();
  const completed = new Set<string>();
  const key = (row: WbStockTarget) => `${row.warehouseId}:${row.chrtId}`;
  async function read(rows: WbStockTarget[]) {
    const result = new Map<string, number>();
    for (const warehouseId of new Set(rows.map(r => r.warehouseId))) {
      const selected = rows.filter(r => r.warehouseId === warehouseId);
      for (let i = 0; i < selected.length; i += 1000) {
        const batch = selected.slice(i, i + 1000);
        const amounts = await io.read(warehouseId, batch.map(r => r.chrtId));
        for (const row of batch) {
          const amount = amounts.get(row.chrtId);
          if (amount == null || !Number.isSafeInteger(amount) || amount < 0) throw new Error(`WB не вернул достоверный остаток ${row.chrtId} на складе ${warehouseId}.`);
          result.set(key(row), amount);
        }
      }
    }
    return result;
  }
  try {
    for (const row of targets) await io.record({ ...row, phase: 'PLAN', status: 'PLANNED' });
    for (const [id, amount] of await read(targets)) before.set(id, amount);
    const decreases = targets.filter(r => r.amount < before.get(key(r))!);
    const increases = targets.filter(r => r.amount > before.get(key(r))!);
    const unchanged = targets.filter(r => r.amount === before.get(key(r))!);
    for (const row of unchanged) {
      await io.record({ ...row, phase: 'CHECK', status: 'CONFIRMED', observedAmount: row.amount });
      completed.add(key(row));
    }
    for (const [phase, rows] of [['DECREASE', decreases], ['INCREASE', increases]] as const) {
      for (const warehouseId of new Set(rows.map(r => r.warehouseId))) {
        const selected = rows.filter(r => r.warehouseId === warehouseId);
        for (let i = 0; i < selected.length; i += 1000) {
          const batch = selected.slice(i, i + 1000);
          for (const row of batch) await io.record({ ...row, phase, status: 'SENDING', sentAmount: row.amount });
          await io.send(warehouseId, batch.map(r => ({ chrtId: r.chrtId, amount: r.amount })));
          for (const row of batch) await io.record({ ...row, phase, status: 'SENT', sentAmount: row.amount });
          // A cached response or missing row must never be treated as acknowledgement.
          const actual = await read(batch);
          let mismatch = false;
          for (const row of batch) {
            const observedAmount = actual.get(key(row))!;
            const status = observedAmount === row.amount ? 'CONFIRMED' : 'MISMATCH';
            await io.record({ ...row, phase, status, sentAmount: row.amount, observedAmount });
            completed.add(key(row));
            mismatch ||= status === 'MISMATCH';
          }
          if (mismatch) throw new Error('WB пока не подтвердил рассчитанные остатки. Увеличения остановлены; обновите проверку перед повторной синхронизацией.');
        }
      }
      if (phase === 'DECREASE' && increases.length) {
        // Recheck the complete budget after decreases; sales/external edits require a new plan.
        const current = await read(targets);
        if (targets.some(r => current.get(key(r)) !== (r.amount <= before.get(key(r))! ? r.amount : before.get(key(r))))) throw new Error('Остатки WB изменились во время распределения. Требуется новый расчёт.');
      }
    }
    return { verified: targets.length, publishedAmount: targets.reduce((n, r) => n + r.amount, 0) };
  } catch (error) {
    for (const row of targets) if (!completed.has(key(row))) await io.record({ ...row, phase: 'STOP', status: 'UNCONFIRMED', error: (error instanceof Error ? error.message : 'Ошибка проверки WB').slice(0, 500) });
    throw error;
  }
}
