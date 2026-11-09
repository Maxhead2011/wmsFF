import { identifyFabricSku } from '../warehouse/fabric-fbs-availability';

// FIX: this is a fulfilment mode, not proof of reserved metres or finished stock.
export function untouchedFabricReservation(task: any): boolean {
  return !task || (task.status === 'WAITING_STOCK' &&
    !['reservedBoxId', 'reservedBoxCode', 'boxId', 'boxCode', 'barcode', 'sourceBarcode',
      'kiz', 'relabelConfirmedAt', 'completedAt', 'marketplaceSubmittedAt'].some(k => task[k]));
}

export async function fabricReservationOrders(db: any, clientId: string, orders: any[], tasks: Map<string, any>): Promise<Set<string>> {
  const result = new Set<string>();
  if (process.env.WMS_FBS_FABRIC_CUT_ENABLED !== 'true') return result;
  const candidates = orders.filter(o => o.marketplace === 'WILDBERRIES' && o.category === 'active' &&
    ['new', 'confirm'].includes(o.supplierStatus) && o.product?.id && !o.relabeling &&
    ![...(o.requiredMeta ?? []), ...(o.optionalMeta ?? [])].some((m: string) => m.toLowerCase() === 'sgtin') &&
    !tasks.get(`${o.connectionId.trim()}:${o.id.trim()}`)?.requiresKiz &&
    untouchedFabricReservation(tasks.get(`${o.connectionId.trim()}:${o.id.trim()}`)));
  if (!candidates.length) return result;
  const enabled = await Promise.all(['fabric.fbs.enabled.v1:', 'fabric.rolls.enabled.v1:'].map(prefix =>
    db.systemSetting.findUnique({ where: { key: prefix + clientId } })));
  if (!enabled.every(s => s?.value?.enabled === true)) return result;
  const skus = await db.sku.findMany({ where: { clientId, id: { in: [...new Set(candidates.map(o => o.product.id))] } },
    select: { id: true, clientId: true, name: true, internalSku: true, needsChestnyZnak: true, isUnmarked: true, needsRelabel: true } });
  const eligible = new Set(skus.filter((s: any) => s.clientId === clientId && identifyFabricSku(s) &&
    !(s.needsChestnyZnak && !s.isUnmarked) && !s.needsRelabel).map((s: any) => s.id));
  for (const o of candidates) if (eligible.has(o.product.id)) result.add(`${o.connectionId.trim()}:${o.id.trim()}`);
  return result;
}

// FIX: saved/cold/merged screen rows bypass the live reservation loader. Decorate the
// already scoped response from fresh task evidence, without changing the cached object.
export async function decorateFabricReservationResponse(db: any, clientId: string, response: any) {
  if (process.env.WMS_FBS_FABRIC_CUT_ENABLED !== 'true' || !response?.orders?.length) return response;
  const candidates = response.orders.filter((o: any) => o.marketplace === 'WILDBERRIES' &&
    o.category === 'active' && ['new', 'confirm'].includes(o.supplierStatus) && o.product?.id);
  if (!candidates.length) return response;
  const tasks: any[] = [];
  for (let start = 0; start < candidates.length; start += 500) {
    const batch = candidates.slice(start, start + 500);
    tasks.push(...await db.fbsTsdAssembly.findMany({ where: { clientId, marketplace: 'WILDBERRIES',
      connectionId: { in: [...new Set(batch.map((o: any) => o.connectionId))] },
      orderId: { in: batch.map((o: any) => o.id) } }, select: {
      connectionId: true, orderId: true, status: true, reservedBoxId: true, reservedBoxCode: true,
      boxId: true, boxCode: true, barcode: true, sourceBarcode: true, kiz: true,
      relabelConfirmedAt: true, completedAt: true, marketplaceSubmittedAt: true, requiresKiz: true,
    } }));
  }
  const byKey = new Map(tasks.map(t => [`${t.connectionId}:${t.orderId}`, t]));
  const eligible = await fabricReservationOrders(db, clientId, candidates, byKey);
  return { ...response, orders: response.orders.map((order: any) => {
    const key = `${order.connectionId}:${order.id}`;
    if (eligible.has(key)) return { ...order, reservation: { status: 'FABRIC_ON_DEMAND', withoutBox: true,
      boxCode: null, palletCode: null, warehouseId: null, reservedAt: null, problem: null } };
    // A cached display flag must not conceal a later physical action or disabled setting.
    return order.reservation?.status === 'FABRIC_ON_DEMAND' ? { ...order, reservation: null } : order;
  }) };
}
// FIX: only a fresh, verified fabric display marker with no task can bypass the reservation guard.
// Existing tasks continue through the original physical-work eligibility check.
export function canIgnoreFabricDisplayReservation(order: any, task: any, verified: Set<string>): boolean {
  return !task && order.reservation?.status === 'FABRIC_ON_DEMAND' &&
    verified.has(`${order.connectionId.trim()}:${order.id.trim()}`);
}
