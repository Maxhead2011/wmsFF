import { ConflictException } from '@nestjs/common';
import { clientKizIdentity } from './kiz-client-registry';
import { readOzonPickState } from '../modules/marketplace-connections/ozon-fbs-pick-lines';

// FIX: enabled only on our installation; legacy/sold readers keep their previous path.
export const ozonUnitMarksEnabled = () => process.env.WMS_OZON_UNIT_MARKS_ENABLED === 'true';

export type OzonMarkedUnit<T> = Omit<T, 'kiz'> & { kiz: string; taskId?: string; skuId?: string | null; boxId?: string | null };

// FIX: materialize every marked unit, never substitute the first product for the whole posting.
export function ozonMarkedUnits<T extends { id: string; kiz?: string | null }>(task: T, state: any, options: { requireComplete?: boolean } = {}): OzonMarkedUnit<T>[] {
  if (state?.unitMarksVersion !== 1) return task.kiz ? [{ ...task, kiz: task.kiz }] : [];
  const fail = () => { throw new ConflictException('Поштучный состав КИЗ Ozon неполон или повреждён. Нужна проверка администратора.'); };
  if ((task as any).marketplace !== 'OZON' || !Array.isArray(state.lines) || !state.lines.length) return fail();
  const identities = new Set<string>(), products = new Set<number>();
  // FIX: in-progress claims are visible to competing scanners; completed evidence stays strict.
  const partial = !options.requireComplete && state.submission === 'PICKING' && !state.recovery;
  // FIX: a pending product scan is not shipment evidence.
  if (options.requireComplete && state.pendingBarcode) return fail();
  const result = state.lines.flatMap((line: any) => {
    if (!Number.isSafeInteger(line.productId) || products.has(line.productId) || !line.skuId || !line.requestItemId ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !Array.isArray(line.picks) ||
        line.picks.length > line.quantity || (!partial && line.picks.length !== line.quantity)) return fail();
    products.add(line.productId);
    return line.picks.flatMap((pick: any, index: number) => {
      if (line.requiresKiz === false && !pick.kiz) return [];
      const identity = clientKizIdentity(pick.kiz);
      if (!identity || identities.has(identity)) return fail();
      identities.add(identity);
      return [{ ...task, id: `${task.id}:ozon:${line.productId}:${index}`, taskId: task.id,
        skuId: line.skuId, requestItemId: line.requestItemId, kiz: pick.kiz,
        boxId: pick.boxId ?? null, boxCode: pick.boxCode ?? null }];
    });
  });
  if (state.lines.reduce((n: number, l: any) => n + l.quantity, 0) !== (task as any).itemCount) return fail();
  return result;
}

export async function expandOzonMarkedTasks<T extends { id: string; kiz?: string | null; marketplace?: string }>(db: any, tasks: T[], options: { requireComplete?: boolean } = {}): Promise<OzonMarkedUnit<T>[]> {
  const rows: OzonMarkedUnit<T>[] = [];
  for (const task of tasks) {
    // Existing scalar tasks incur no extra reads. Per-unit tasks deliberately have no scalar KIZ.
    const state = ozonUnitMarksEnabled() && task.marketplace === 'OZON' && !task.kiz ? await readOzonPickState(db, task.id) : null;
    rows.push(...ozonMarkedUnits(task, state, options));
  }
  return rows;
}
