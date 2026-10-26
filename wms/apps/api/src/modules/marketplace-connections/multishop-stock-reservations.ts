export type SharedRequestDemand = { requestId: string; skuId: string; remaining: number };
export type SharedOrderDemand = {
  marketplace: 'WILDBERRIES' | 'OZON'; connectionId: string; orderId: string;
  skuId: string; requestId: string | null; remaining: number;
};

function quantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Некорректное количество в общем резерве.');
  return value;
}
function nonempty(value: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Не определено соответствие товара или заказа.');
}

// FIX: a marketplace order and its warehouse request are one demand. Physical picks
// must already be removed from both AVAILABLE stock and remaining demand by the reader.
// Input is client/warehouse scoped; no mutation of warehouse stock occurs on an order event.
export function calculateSharedShopAvailability(
  available: ReadonlyMap<string, number>,
  requests: SharedRequestDemand[],
  orders: SharedOrderDemand[],
) {
  const requestTotals = new Map<string, { skuId: string; remaining: bigint }>();
  const unlinked = new Map<string, bigint>();
  const linked = new Map<string, { skuId: string; remaining: bigint }>();
  const seenOrders = new Map<string, SharedOrderDemand>();
  for (const [skuId, amount] of available) { nonempty(skuId); quantity(amount); }
  for (const request of requests) {
    nonempty(request.requestId); nonempty(request.skuId); quantity(request.remaining);
    const key = JSON.stringify([request.requestId, request.skuId]);
    if (requestTotals.has(key)) throw new Error('Повтор резерва заявки: сначала объедините строки одного товара.');
    requestTotals.set(key, { skuId: request.skuId, remaining: BigInt(request.remaining) });
  }
  for (const order of orders) {
    if (!['WILDBERRIES', 'OZON'].includes(order.marketplace)) throw new Error('Неизвестный маркетплейс заказа.');
    nonempty(order.connectionId); nonempty(order.orderId); nonempty(order.skuId); quantity(order.remaining);
    if (order.requestId !== null) nonempty(order.requestId);
    // Same number in two accounts is two different orders; retry in one account is one order.
    const key = JSON.stringify([order.marketplace, order.connectionId, order.orderId, order.skuId]);
    const previous = seenOrders.get(key);
    if (previous) {
      if (previous.remaining !== order.remaining || previous.requestId !== order.requestId) throw new Error('Противоречивые версии заказа: обновите снимок.');
      continue;
    }
    seenOrders.set(key, order);
    if (order.requestId === null) unlinked.set(order.skuId, (unlinked.get(order.skuId) ?? 0n) + BigInt(order.remaining));
    else {
      const requestKey = JSON.stringify([order.requestId, order.skuId]);
      const existing = linked.get(requestKey);
      linked.set(requestKey, { skuId: order.skuId, remaining: (existing?.remaining ?? 0n) + BigInt(order.remaining) });
    }
  }
  const reserved = new Map(unlinked);
  for (const key of new Set([...requestTotals.keys(), ...linked.keys()])) {
    const request = requestTotals.get(key), order = linked.get(key);
    const skuId = (request ?? order)!.skuId;
    const demand = (request?.remaining ?? 0n) > (order?.remaining ?? 0n) ? request!.remaining : order?.remaining ?? 0n;
    reserved.set(skuId, (reserved.get(skuId) ?? 0n) + demand);
  }
  return new Map([...new Set([...available.keys(), ...reserved.keys()])].map(skuId => {
    const stock = available.get(skuId) ?? 0, demand = reserved.get(skuId) ?? 0n;
    if (demand > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Общий резерв превышает допустимое количество.');
    return [skuId, { available: stock, reserved: Number(demand), free: Number(BigInt(stock) > demand ? BigInt(stock) - demand : 0n) }] as const;
  }));
}
