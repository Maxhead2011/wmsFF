// FIX: stores own marketplace connections, not copies of physical warehouse balances.
export type ClientStore = { id: string; name: string; connectionIds: string[] };
export type StoreBarcodeEvidence = { barcode: string; storeId: string };
export type StoreStockInput = { id: string; barcodes: readonly string[]; quantity: number; reserved: number };

export function validateStoreDirectory(value: unknown, allowedConnections: readonly string[]): ClientStore[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error('Нужен список магазинов клиента.');
  const ids = new Set<string>(), connections = new Set<string>(), names = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.id) || ['all','unassigned','shared'].includes(entry.id) || ids.has(entry.id)) {
      throw new Error('Неверный или повторный идентификатор магазина.');
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name || name.length > 120 || names.has(name.toLocaleLowerCase('ru-RU'))) throw new Error('Укажите уникальное название магазина.');
    if (!Array.isArray(entry.connectionIds) || !entry.connectionIds.length || entry.connectionIds.length > 50) throw new Error('Выберите подключения магазина.');
    const connectionIds = entry.connectionIds.map((id: unknown) => {
      if (typeof id !== 'string' || !allowedConnections.includes(id) || connections.has(id)) {
        throw new Error('Подключение чужого клиента или уже закреплено за другим магазином.');
      }
      connections.add(id); return id;
    });
    ids.add(entry.id); names.add(name.toLocaleLowerCase('ru-RU'));
    return { id: entry.id, name, connectionIds };
  });
}

export function storeForConnection(stores: readonly ClientStore[], connectionId: string): ClientStore | null {
  const matches = stores.filter((store) => store.connectionIds.includes(connectionId));
  if (matches.length > 1) throw new Error('Подключение связано с несколькими магазинами.');
  return matches[0] ?? null;
}

// FIX: this is a read-only classification proposal. It never creates inventory or assigns SKU ownership.
export function classifyStoreStock(
  skus: readonly StoreStockInput[], evidence: readonly StoreBarcodeEvidence[],
  stores: readonly ClientStore[], confirmedSharedSkuIds: readonly string[],
) {
  const storeIds = new Set(stores.map((s) => s.id));
  const byBarcode = new Map<string, Set<string>>();
  for (const item of evidence) {
    if (!storeIds.has(item.storeId) || typeof item.barcode !== 'string' || !item.barcode.trim()) throw new Error('Неверное соответствие ШК магазину.');
    const key = item.barcode.trim();
    const ids = byBarcode.get(key) ?? new Set<string>(); ids.add(item.storeId); byBarcode.set(key, ids);
  }
  const seen = new Set<string>(), shared = new Set(confirmedSharedSkuIds);
  const rows = skus.map((sku) => {
    if (!sku.id || seen.has(sku.id)) throw new Error('Повторная строка SKU: нельзя дважды считать один остаток.');
    if (![sku.quantity, sku.reserved].every(Number.isSafeInteger) || sku.quantity < 0 || sku.reserved < 0) {
      throw new Error('Остаток и резерв должны быть неотрицательными целыми числами.');
    }
    seen.add(sku.id);
    const ids = [...new Set(sku.barcodes.flatMap((barcode) => [...(byBarcode.get(barcode.trim()) ?? [])]))].sort();
    const kind = ids.length === 0 ? 'UNASSIGNED' : ids.length === 1 ? 'STORE' : shared.has(sku.id) ? 'SHARED' : 'REVIEW';
    return { skuId: sku.id, storeIds: ids, kind, quantity: sku.quantity, reserved: sku.reserved,
      available: Math.max(0, sku.quantity - sku.reserved), deficit: Math.max(0, sku.reserved - sku.quantity) };
  });
  const totals = rows.reduce((sum, row) => ({quantity:sum.quantity+row.quantity, reserved:sum.reserved+row.reserved,
    available:sum.available+row.available, unresolvedQuantity:sum.unresolvedQuantity+(['UNASSIGNED','REVIEW'].includes(row.kind)?row.quantity:0)}),
  {quantity:0,reserved:0,available:0,unresolvedQuantity:0});
  return {rows,totals};
}
