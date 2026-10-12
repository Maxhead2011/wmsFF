import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';

export const manualAssemblyEnabled = () => process.env.WMS_FBS_MANUAL_ASSEMBLY_ENABLED === 'true';
export const manualAssemblyAllowed = (user: AuthUser) => !user.isDemo && user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER');
export function requireManualAssembly(user: AuthUser) {
  if (!manualAssemblyEnabled() || !manualAssemblyAllowed(user)) throw new ForbiddenException('Сборка ФБС по номерам доступна администраторам и собственнику только при включённой функции.');
}
export function manualOrderIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id =>
    typeof id !== 'string' || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new BadRequestException('Введите от 1 до 100 номеров заказов WB, только цифры.');
  }
  if (new Set(value).size !== value.length) throw new BadRequestException('Номера заказов повторяются.');
  return [...value].sort();
}
export function untouchedManualTask(task: Record<string, unknown> | null | undefined) {
  return !task || (String(task.requestId).startsWith('AUTO:') &&
    ['WAITING_STOCK', 'RESERVED', 'RELEASED'].includes(String(task.status)) && task.itemCount === 1 &&
    !['boxId', 'boxCode', 'barcode', 'sourceBarcode', 'kiz', 'workerUserId', 'startedAt', 'completedAt',
      'sourceSkuId', 'relabelRequired', 'relabelConfirmedAt', 'cargoPackingId', 'marketplaceSubmittedAt'].some(k => task[k]) &&
    !Number(task.scannedItemCount || 0));
}
export const manualHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// FIX: WB's nanosecond paging cursor exceeds Number.MAX_SAFE_INTEGER. Keep its JSON source digits.
export function manualOrderPage(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw, ((key: string, value: unknown, context?: { source?: string }) => {
      if (key !== 'next' || typeof value !== 'number') return value;
      if (context?.source) return context.source;
      if (Number.isSafeInteger(value)) return String(value);
      throw new Error('JSON parser cannot preserve this WB cursor');
    }) as Parameters<typeof JSON.parse>[1]);
  } catch { throw new BadRequestException('Не удалось точно прочитать страницу WB. Повторите проверку.'); }
}
export type ManualBox = { boxId: string; boxCode: string; palletCode: string; free: number };
export type ManualRow = { orderId: string; skuId: string | null; article: string; size: string; supplyId: string;
  supplierStatus: string; wbStatus: string; blockers: string[]; boxes: ManualBox[]; free: number };
export type ManualChoice = { orderId: string; boxId: string };

// FIX: a box shared by multiple orders is a single stock pool, not one pool per row.
export function validateManualChoices(rows: ManualRow[], choices: ManualChoice[]) {
  if (!Array.isArray(choices) || choices.length !== rows.length || new Set(choices.map(c => c.orderId)).size !== rows.length)
    throw new BadRequestException('Выберите ровно один короб для каждого заказа.');
  const byBox = new Map<string, number>(), bySku = new Map<string, number>();
  for (const choice of choices) {
    const row = rows.find(r => r.orderId === choice.orderId);
    const box = row?.boxes.find(b => b.boxId === choice.boxId);
    if (!row || row.blockers.length || !row.skuId || !box) throw new ConflictException('Выбранный заказ или короб недоступен. Повторите проверку.');
    const key = `${row.skuId}:${box.boxId}`;
    byBox.set(key, (byBox.get(key) || 0) + 1); bySku.set(row.skuId, (bySku.get(row.skuId) || 0) + 1);
    if (byBox.get(key)! > box.free || bySku.get(row.skuId)! > row.free)
      throw new ConflictException('На все выбранные заказы не хватает свободного товара. Выберите другой короб или повторите проверку.');
  }
}
