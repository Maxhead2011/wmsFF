import { BadRequestException } from '@nestjs/common';
// FIX: archive display survives an empty process cache; never writes stock or billing.
const key = (row: any) => JSON.stringify([row.marketplace, row.connectionId, row.orderId ?? row.id]);
const iso = (value: any) => value ? new Date(value).toISOString() : null;
// FIX: calendar days in Moscow, including today; bounds applied by the database.
export function archiveRange(from?: string, to?: string, now = new Date()) {
  const today = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const end = to || today;
  const start = from || new Date(Date.parse(today + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
  for (const value of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)
      throw new BadRequestException('Укажите корректные даты архива.');
  }
  if (start > end) throw new BadRequestException('Начало периода позже окончания.');
  return { from: start, to: end, gte: new Date(start + 'T00:00:00+03:00'), lt: new Date(Date.parse(end + 'T00:00:00+03:00') + 86400000) };
}
export async function restoreSavedFbsArchive(db: any, clientId: string, response: any, from?: string, to?: string) {
  if (process.env.WMS_FBS_SAVED_ARCHIVE_ENABLED !== 'true') return response;
  if (!clientId || response.client?.id !== clientId) throw new Error('Несовпадение клиента архива FBS.');
  const range = archiveRange(from, to);
  const inRange = (value: any) => value && new Date(value) >= range.gte && new Date(value) < range.lt;
  const connectionIds = (response.connections ?? []).map((c: any) => c.id);
  if (!connectionIds.length) return response;
  const connections = await db.clientMarketplaceConnection.findMany({ where: { clientId, id: { in: connectionIds }, isActive: true }, select: { id: true, marketplace: true, accountName: true } });
  if (!connections.length) return response;
  const links = await db.fbsOrderRequestLink.findMany({
    where: { clientId, connectionId: { in: connections.map((c: any) => c.id) }, syncStatus: 'ACTIVE', lastCategory: { in: ['shipped', 'archive'] }, OR: [{ handedOverAt: { gte: range.gte, lt: range.lt } }, { handedOverAt: null, orderPlacedAt: { gte: range.gte, lt: range.lt } }] },
    include: { request: { select: { id: true, number: true, title: true, status: true, warehouseId: true } } },
    orderBy: [{ handedOverAt: 'desc' }, { createdAt: 'desc' }],
  });
  const skus = links.length ? await db.sku.findMany({ where: { clientId, id: { in: [...new Set(links.map((l: any) => l.lastSkuId).filter(Boolean))] } }, select: { id: true, name: true, internalSku: true, clientSku: true, article: true, size: true, needsChestnyZnak: true, isUnmarked: true, barcodes: { select: { value: true } } } }) : [];
  const plans = links.length ? await db.fbsSupplyPlan.findMany({ where: { clientId, connectionId: { in: connections.map((c: any) => c.id) }, supplyId: { in: [...new Set(links.map((l: any) => l.lastSupplyId).filter(Boolean))] } } }) : [];
  const skuById = new Map(skus.map((s: any) => [s.id, s]));
  const planById = new Map(plans.map((p: any) => [JSON.stringify([p.marketplace, p.connectionId, p.supplyId]), p]));
  const orders = new Map((response.orders ?? []).map((o: any) => [key(o), o]));
  for (const link of links) {
    const connection = connections.find((c: any) => c.id === link.connectionId && c.marketplace === link.marketplace);
    if (!connection || link.clientId !== clientId || link.syncStatus !== 'ACTIVE' || !['shipped', 'archive'].includes(link.lastCategory)) continue;
    if (!inRange(link.handedOverAt ?? link.orderPlacedAt)) continue;
    const old: any = orders.get(key(link));
    // A current marketplace response wins; saved rows only fill missing archive history.
    if (old) continue;
    const sku: any = skuById.get(link.lastSkuId);
    const plan: any = planById.get(JSON.stringify([link.marketplace, link.connectionId, link.lastSupplyId]));
    orders.set(key(link), {
      id: link.orderId, orderUid: null, connectionId: link.connectionId, accountName: connection.accountName, marketplace: link.marketplace,
      category: link.lastCategory, supplierStatus: link.lastSupplierStatus || '', wbStatus: link.lastWbStatus || '',
      statusLabel: link.lastCategory === 'archive' ? 'Получен покупателем' : 'Передан в доставку',
      article: sku?.article ?? null, nmId: null, chrtId: null, barcodes: sku?.barcodes.map((b: any) => b.value) ?? [],
      itemCount: Math.max(1, link.lastItemCount ?? 1), product: sku ? { ...sku, barcodes: undefined } : null,
      storageBoxes: [], relabeling: null, createdAt: iso(link.orderPlacedAt), sellerDate: null, deliveryDate: null,
      sourceTiming: { placedAt: iso(link.orderPlacedAt), handedOverAt: iso(link.handedOverAt), warehouseId: link.sellerWarehouseId, warehouseName: link.sellerWarehouseName },
      supplyId: link.lastSupplyId, warehouseId: link.sellerWarehouseId, warehouseName: link.sellerWarehouseName, officeId: null, cargoType: null, crossBorderType: null,
      pickupPointShipmentAllowed: false, requiresReshipment: false, requiredMeta: [], optionalMeta: [],
      shipmentPlan: plan ? { destination: plan.deliveryDestination, itemsPerCargoPlace: plan.itemsPerCargoPlace, requiresCargoPlaces: plan.deliveryDestination === 'PICKUP_POINT', cargoPlaceCount: plan.cargoPlaceCount, cargoPlaceIds: plan.cargoPlaceIds, sentToWbAt: iso(plan.sentToWbAt), sentToWbBy: plan.sentToWbByName ? { id: plan.sentToWbByUserId, name: plan.sentToWbByName } : null } : null,
      comment: 'Сохранённый статус WMS; обновляется при синхронизации с маркетплейсом.', request: link.request, billing: null,
      archiveDate: iso(link.handedOverAt ?? link.orderPlacedAt), archiveDateBasis: link.handedOverAt ? 'shipment' : 'order',
      savedStatusAt: iso(link.lastSeenAt),
    });
  }
  const rows: any[] = [...orders.values()].filter((o: any) => !['shipped', 'archive'].includes(o.category) || inRange(o.archiveDate ?? o.sourceTiming?.handedOverAt ?? o.sourceTiming?.placedAt ?? o.createdAt));
  return { ...response, archivePeriod: { from: range.from, to: range.to }, orders: rows, counts: { active: rows.filter(o => o.category === 'active').length, shipped: rows.filter(o => o.category === 'shipped').length, archive: rows.filter(o => o.category === 'archive').length, cancelled: rows.filter(o => o.category === 'cancelled').length, all: rows.length } };
}
