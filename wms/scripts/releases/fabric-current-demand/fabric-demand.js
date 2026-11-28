async function addFabricDemand(db, clientId, byId, groups) {
  for (const group of groups.values()) {
    group.required = { fbs: { pieces: 0, meters: 0 }, fbo: { pieces: 0, meters: 0 } };
  }
  const fabricItems = { skuId: { in: [...byId.keys()] }, quantity: { gt: 0 } };
  const requests = await db.clientRequest.findMany({
    where: { clientId, type: 'OUTBOUND', status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] }, items: { some: fabricItems } },
    select: {
      title: true, comment: true, _count: { select: { fbsOrderLinks: true } },
      items: { where: fabricItems, select: { skuId: true, quantity: true } },
    },
  });
  // FIX: count each request item once, regardless of how many orders belong to the request.
  for (const request of requests) {
    const fbs = request._count.fbsOrderLinks > 0 || /^(FBS|DBS)/i.test(request.title.trim()) ||
      request.comment?.toLowerCase().includes('создано из fbs-заказов:');
    for (const item of request.items) {
      const sku = byId.get(item.skuId);
      const total = groups.get(sku.key).required[fbs ? 'fbs' : 'fbo'];
      total.pieces += item.quantity;
      total.meters += item.quantity * sku.meters;
    }
  }
}
module.exports = { addFabricDemand };
