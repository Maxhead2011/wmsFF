import { calculateSharedShopAvailability, SharedOrderDemand, SharedRequestDemand } from './multishop-stock-reservations';

export type StockOrderLine = Omit<SharedOrderDemand, 'remaining'> & { quantity: number };
export type StockRequestLine = Omit<SharedRequestDemand, 'remaining'> & { quantity: number };
export type StockPhysicalPick = { requestId: string; skuId: string; quantity: number };

function count(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Некорректное количество в снимке остатков.');
  return n;
}
function add(a: number, b: number) { return count(a + b); }
const key = (requestId: string, skuId: string) => JSON.stringify([requestId, skuId]);

// FIX: subtract net physical picks once per request/SKU from both representations
// of the same demand. Scans alone are not stock movements (notably Ozon packing).
export function normalizeSharedStockSnapshot(
  available: ReadonlyMap<string, number>, requestLines: StockRequestLine[],
  orderLines: StockOrderLine[], physicalPicks: StockPhysicalPick[],
) {
  const picked = new Map<string, number>();
  for (const row of physicalPicks) {
    const id = key(row.requestId, row.skuId);
    picked.set(id, add(picked.get(id) ?? 0, count(row.quantity)));
  }
  const requests = new Map<string, SharedRequestDemand>();
  for (const row of requestLines) {
    const id = key(row.requestId, row.skuId);
    const quantity = add(requests.get(id)?.remaining ?? 0, count(row.quantity));
    requests.set(id, { requestId: row.requestId, skuId: row.skuId, remaining: quantity });
  }
  for (const [id, row] of requests) row.remaining = Math.max(0, row.remaining - (picked.get(id) ?? 0));
  const seen = new Map<string, StockOrderLine>();
  for (const row of orderLines) {
    count(row.quantity);
    const id = JSON.stringify([row.marketplace, row.connectionId, row.orderId, row.skuId]);
    const prior = seen.get(id);
    if (prior && (prior.quantity !== row.quantity || prior.requestId !== row.requestId)) throw new Error('Противоречивые строки заказа.');
    seen.set(id, row);
  }
  const credit = new Map(picked);
  const orders: SharedOrderDemand[] = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => {
    const id = row.requestId === null ? null : key(row.requestId, row.skuId);
    const consumed = id === null ? 0 : Math.min(row.quantity, credit.get(id) ?? 0);
    if (id !== null) credit.set(id, (credit.get(id) ?? 0) - consumed);
    return { ...row, remaining: row.quantity - consumed };
  });
  return calculateSharedShopAvailability(available, [...requests.values()], orders);
}

export type ShopProductIdentity = { connectionId: string; skuId: string | null; marketplace: string; productId: string; offerId: string; status: string };

// FIX: parse every Ozon product; an unknown identity is never silently discarded.
// Completed/cancelled postings must be filtered by the authenticated reader before this call.
export function ozonReservationLines(connectionId: string, posting: Record<string, unknown>, links: ShopProductIdentity[], requestId: string | null): StockOrderLine[] {
  if (typeof posting.posting_number !== 'string' || !posting.posting_number || !Array.isArray(posting.products) || !posting.products.length) throw new Error('Ozon вернул неполный состав отправления.');
  const result: StockOrderLine[] = [];
  const seen = new Set<string>();
  for (const raw of posting.products) {
    if (!raw || typeof raw !== 'object') throw new Error('Некорректная строка Ozon.');
    const product = raw as Record<string, unknown>;
    if (typeof product.quantity !== 'number' || count(product.quantity) === 0 || typeof product.offer_id !== 'string' || !product.offer_id) throw new Error('Некорректная строка Ozon.');
    const productId = String(product.sku ?? '');
    if (!/^\d+$/.test(productId) || seen.has(productId)) throw new Error('Повтор или неверный идентификатор Ozon.');
    seen.add(productId);
    const candidates = links.filter(l => l.connectionId === connectionId && l.marketplace === 'OZON' && l.status === 'LINKED' && l.skuId && l.offerId === product.offer_id);
    if (candidates.length !== 1) throw new Error('Для строки Ozon не подтверждено однозначное соответствие товару WMS.');
    const skuId = candidates[0].skuId!;
    if (result.some(l => l.skuId === skuId)) throw new Error('Несколько карточек Ozon связаны с одним товаром WMS.');
    result.push({ marketplace: 'OZON', connectionId, orderId: posting.posting_number, skuId, requestId, quantity: product.quantity });
  }
  return result;
}
