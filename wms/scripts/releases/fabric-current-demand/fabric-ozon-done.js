'use strict';
// FIX: enroll a newly handed-over request atomically. Past physical stocktakes
// already include earlier handovers; do not replay untracked historical Ozon sales.
async function enrollOzon(tx, clientId, requestId) {
  const r = await tx.clientRequest.findFirst({
    where: { id: requestId, clientId, status: 'DONE', fbsOrderLinks: { some: { marketplace: 'OZON' }, every: { marketplace: 'OZON' } } },
    select: { id: true },
  });
  if (!r) return;
  const id = 'fabric-ozon-done-' + r.id;
  await tx.auditLog.upsert({ where: { id }, update: {}, create: {
    id, action: 'FABRIC_OZON_DONE', entity: 'FabricRolls', entityId: clientId, payload: { requestId },
  } });
}
async function ozonShipments(tx, clientId, skus) {
  const marks = await tx.auditLog.findMany({ where: { entityId: clientId, action: 'FABRIC_OZON_DONE' }, select: { createdAt: true, payload: true } });
  if (!marks.length) return [];
  const times = new Map(marks.map(x => [x.payload.requestId, x.createdAt]));
  const rows = await tx.clientRequest.findMany({ where: { clientId, id: { in: [...times.keys()] }, status: 'DONE' },
    select: { id: true, warehouseId: true, items: { select: { id: true, skuId: true, quantity: true } } } });
  const events = [];
  for (const r of rows) for (const item of r.items) {
    const fabric = skus.get(item.skuId);
    if (fabric && item.quantity > 0) events.push({ key: 'ozon:' + r.id + ':' + item.id, requestId: r.id,
      marketplace: 'OZON', warehouseId: r.warehouseId, skuId: item.skuId, at: times.get(r.id),
      material: fabric.material, color: fabric.color, mm: item.quantity * fabric.mm });
  }
  return events;
}
function matchesOzonCut(c, e) {
  return e.marketplace === 'OZON' && c.marketplace === 'OZON' && !!e.requestId &&
    e.requestId === c.requestId && e.warehouseId === c.warehouseId && e.skuId === c.skuId;
}
module.exports = { enrollOzon, ozonShipments, matchesOzonCut };
