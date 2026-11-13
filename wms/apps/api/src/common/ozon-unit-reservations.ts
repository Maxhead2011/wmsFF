import { ConflictException } from '@nestjs/common';
import { readOzonPickState } from '../modules/marketplace-connections/ozon-fbs-pick-lines';
import { ozonUnitMarksEnabled } from './ozon-unit-marks';

export const ozonUnitReservationsEnabled = () => ozonUnitMarksEnabled() && process.env.WMS_OZON_TSD_UNIT_MARKS_ENABLED === 'true';

// FIX: replace the scalar header, never add its quantity to the per-product demand.
export function ozonUnitReservationRows<T extends { id: string; marketplace?: string; itemCount: number }>(task: T, state: any) {
  if (task.marketplace !== 'OZON' || state?.unitMarksVersion !== 1) return null;
  const fail = () => { throw new ConflictException('Повреждён поштучный резерв Ozon. Нужна проверка администратора.'); };
  if (!Array.isArray(state.lines) || !state.lines.length) return fail();
  let total = 0;
  const result: Array<T & { skuId: string; sourceSkuId: null; relabelConfirmedAt: null; boxId: string | null; reservedBoxId: null; itemCount: number }> = [];
  for (const line of state.lines) {
    if (!line.skuId || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !Array.isArray(line.picks) || line.picks.length > line.quantity) return fail();
    total += line.quantity;
    const boxes = new Map<string | null, number>();
    for (const pick of line.picks) boxes.set(pick.boxId ?? null, (boxes.get(pick.boxId ?? null) ?? 0) + 1);
    if (line.quantity > line.picks.length) boxes.set(null, (boxes.get(null) ?? 0) + line.quantity - line.picks.length);
    for (const [boxId, itemCount] of boxes) result.push({ ...task, skuId: line.skuId, sourceSkuId: null, relabelConfirmedAt: null, boxId, reservedBoxId: null, itemCount });
  }
  if (total !== task.itemCount) return fail();
  return result;
}

export async function loadOzonUnitReservations<T extends { id: string; marketplace?: string; itemCount: number }>(db: any, tasks: T[]) {
  const result = new Map<string, NonNullable<ReturnType<typeof ozonUnitReservationRows<T>>>>();
  if (!ozonUnitReservationsEnabled()) return result;
  for (const task of tasks) {
    if (task.marketplace !== 'OZON') continue;
    const rows = ozonUnitReservationRows(task, await readOzonPickState(db, task.id));
    if (rows) result.set(task.id, rows);
  }
  return result;
}
