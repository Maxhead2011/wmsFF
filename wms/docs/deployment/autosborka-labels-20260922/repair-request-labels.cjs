// FIX: repair presentation fields only, deriving automatic ownership from persisted run history.
// Default is read-only. APPLY_REQUEST_LABELS=true applies the inspected plan with CAS and audit.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const authorId = '59432a17-6c71-4e51-a349-7466d4cf0158';
(async () => {
  const runs = await db.systemSetting.findMany({ where: { key: { startsWith: 'fbs.autoAssembly.run.' } }, select: { key: true, value: true } });
  const auto = new Map();
  for (const run of runs) {
    const connectionId = run.key.slice('fbs.autoAssembly.run.'.length).split('.')[0];
    for (const group of run.value?.groups || []) if (Number.isInteger(group.requestNumber)) auto.set(group.requestNumber, connectionId);
  }
  const requests = await db.clientRequest.findMany({ where: { OR: [
    { number: { in: [...auto.keys()] } },
    { status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] }, destinationCity: { contains: 'WB №' }, fbsOrderLinks: { some: {} } },
  ] }, select: { id: true, number: true, title: true, destinationCity: true, comment: true, createdByUserId: true, updatedAt: true,
    fbsOrderLinks: { select: { connectionId: true, sellerWarehouseId: true, sellerWarehouseName: true } } } });
  const rules = await db.fbsWarehouseRoutingRule.findMany({ select: { connectionId: true, marketplaceWarehouseId: true, marketplaceWarehouseName: true } });
  const names = new Map(rules.filter(r => r.marketplaceWarehouseName?.trim()).map(r => [`${r.connectionId}:${r.marketplaceWarehouseId}`, r.marketplaceWarehouseName.trim()]));
  const plan = [];
  for (const request of requests) {
    const patch = {};
    const scopes = new Set(request.fbsOrderLinks.map(l => `${l.connectionId}:${l.sellerWarehouseId}`));
    if (scopes.size === 1) {
      const link = request.fbsOrderLinks[0];
      const name = names.get([...scopes][0]) || link.sellerWarehouseName?.trim();
      const token = `WB №${link.sellerWarehouseId}`;
      if (name && name !== token && !/^\d+$/.test(name)) for (const field of ['title', 'destinationCity', 'comment']) {
        if (request[field]?.includes(token)) patch[field] = request[field].split(token).join(name);
      }
    }
    const automatic = auto.has(request.number) && request.fbsOrderLinks.length > 0 && request.fbsOrderLinks.every(l => l.connectionId === auto.get(request.number));
    if (automatic && request.createdByUserId !== authorId) patch.createdByUserId = authorId;
    if (Object.keys(patch).length) plan.push({ request, patch, automatic });
  }
  if (process.env.APPLY_REQUEST_LABELS !== 'true') { console.log(JSON.stringify({ apply: false, plan })); return; }
  await db.$transaction(async tx => {
    if (plan.some(p => p.patch.createdByUserId === authorId)) {
      const { ensureWmsAutoAssemblyAuthor } = require('./dist/modules/marketplace-connections/fbs-request-identity');
      await ensureWmsAutoAssemblyAuthor(tx);
    }
    for (const { request, patch, automatic } of plan) {
      const changed = await tx.clientRequest.updateMany({ where: { id: request.id, updatedAt: request.updatedAt }, data: patch });
      if (changed.count !== 1) throw new Error(`Заявка ${request.number} изменилась; повторите предпросмотр.`);
      // Preserve the human actor of the original creation event.
      if (automatic) await tx.clientRequestEvent.updateMany({ where: { requestId: request.id, eventType: 'CREATED', title: 'Заявка создана из FBS-заказов' }, data: { title: 'Заявка создана автосборкой WMS' } });
      await tx.auditLog.create({ data: { userId: null, action: 'FBS_REQUEST_LABEL_REPAIR', entity: 'ClientRequest', entityId: request.id,
        payload: { release: 'autosborka-labels-20260922', number: request.number, before: Object.fromEntries(Object.keys(patch).map(k => [k, request[k]])), after: patch } } });
    }
  });
  console.log(JSON.stringify({ apply: true, changed: plan.length, automatic: plan.filter(p => p.automatic).map(p => p.request.number), requests: plan.map(p => ({ number: p.request.number, patch: p.patch })) }));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
