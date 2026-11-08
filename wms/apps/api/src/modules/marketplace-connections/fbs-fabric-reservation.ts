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
