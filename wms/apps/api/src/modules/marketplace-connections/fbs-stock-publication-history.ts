import { randomUUID } from 'node:crypto';

export const fbsZeroStockHistoryEnabled = () => process.env.WMS_FBS_ZERO_STOCK_HISTORY_ENABLED === 'true';
type Stock = { chrtId: number; amount: number };
type IO<T> = {
  record: (phase: string, payload: Record<string, unknown>) => Promise<void>;
  read: () => Promise<Map<number, number>>;
  send: () => Promise<T>;
};

// FIX: append-only evidence; a PUT acknowledgement is not proof of the actual WB stock.
export async function publishFbsStocksWithHistory<T>(stocks: Stock[], io: IO<T>) {
  const operationId = randomUUID();
  const record = (phase: string, details: Record<string, unknown> = {}) =>
    io.record(phase, { operationId, at: new Date().toISOString(), stocks, ...details });
  const rows = (amounts: Map<number, number>) => stocks.map(s => ({ chrtId: s.chrtId, amount: amounts.get(s.chrtId) ?? null }));
  const valid = (amounts: Map<number, number>) => stocks.every(s => Number.isSafeInteger(amounts.get(s.chrtId)) && amounts.get(s.chrtId)! >= 0);
  if (new Set(stocks.map(s => s.chrtId)).size !== stocks.length || stocks.some(s => !Number.isSafeInteger(s.chrtId) || s.chrtId <= 0 || !Number.isSafeInteger(s.amount) || s.amount < 0)) {
    throw new Error('Некорректный план публикации остатков WB.');
  }
  await record('PLANNED'); // Failure to write the intent prevents the remote mutation.
  let before: Map<number, number>;
  try { before = await io.read(); }
  catch { await record('READ_FAILED'); throw new Error('Не удалось проверить остатки WB перед отправкой.'); }
  await record('BEFORE', { observed: rows(before) });
  if (!valid(before)) {
    await record('UNCONFIRMED');
    throw new Error('WB не вернул остаток одного из размеров. Отправка остановлена.');
  }
  await record('SENDING');
  let response: T;
  try { response = await io.send(); }
  catch {
    // FIX: timeout is uncertain, not a proven rejection; never resend blindly here.
    await record('SEND_UNCONFIRMED');
    throw new Error('Отправка остатков WB не подтверждена. Требуется сверка перед повторной отправкой.');
  }
  await record('ACKNOWLEDGED', { response: response ?? null });
  let after: Map<number, number>;
  try { after = await io.read(); }
  catch { await record('VERIFY_FAILED'); throw new Error('WB принял запрос, но проверка остатка не завершена.'); }
  const confirmed = valid(after) && stocks.every(s => after.get(s.chrtId) === s.amount);
  await record(confirmed ? 'CONFIRMED' : 'MISMATCH', { observed: rows(after) });
  if (!confirmed) throw new Error('Остаток WB после отправки отличается от расчёта. Требуется новая сверка.');
  return response;
}
