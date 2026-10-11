export type ManualFbsInput = { clientId: string; connectionId: string; warehouseId: string; orderIds: string[] };
export type ManualFbsChoice = { orderId: string; boxId: string };
export type ManualFbsRow = { orderId: string; skuId: string | null; article: string; size: string; supplyId: string;
  supplierStatus: string; wbStatus: string; blockers: string[]; free: number;
  boxes: Array<{ boxId: string; boxCode: string; palletCode: string; free: number }> };
export type ManualFbsPreview = { rows: ManualFbsRow[]; canCreate: boolean; token: string | null; expiresAt: string };
export type ManualFbsOptions = { connections: Array<{ id: string; accountName: string | null; sellerId: string | null }>;
  warehouses: Array<{ id: string; name: string }> };
export type ManualFbsResult = { request: { id: string; number: number; status: string }; alreadyCreated: boolean };

export function parseManualFbsOrders(value: string) {
  const orderIds = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (!orderIds.length || orderIds.length > 100 || orderIds.some(id => !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))))
    throw new Error('Введите от 1 до 100 номеров заказов, разделяя пробелами, запятыми или новой строкой.');
  if (new Set(orderIds).size !== orderIds.length) throw new Error('Номера заказов повторяются. Удалите повторы.');
  return orderIds;
}
// FIX: distribute shared-box capacity once across the whole preview.
export function defaultManualFbsChoices(rows: ManualFbsRow[]): ManualFbsChoice[] {
  const used = new Map<string, number>();
  return rows.map(row => {
    const box = row.blockers.length ? undefined : row.boxes.find(b => b.free > (used.get(`${row.skuId}:${b.boxId}`) || 0));
    if (box) { const key = `${row.skuId}:${box.boxId}`; used.set(key, (used.get(key) || 0) + 1); }
    return { orderId: row.orderId, boxId: box?.boxId || '' };
  });
}
export function manualFbsChoicesReady(preview: ManualFbsPreview, choices: ManualFbsChoice[]) {
  if (!preview.canCreate || !preview.token || preview.rows.length !== choices.length) return false;
  const used = new Map<string, number>();
  return preview.rows.every(row => {
    const box = row.boxes.find(b => b.boxId === choices.find(c => c.orderId === row.orderId)?.boxId);
    if (!box || row.blockers.length) return false;
    const key = `${row.skuId}:${box.boxId}`, count = (used.get(key) || 0) + 1; used.set(key, count);
    return count <= box.free;
  });
}
