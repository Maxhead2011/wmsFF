import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reconcileFbsRequestStatus, FBS_AUTO_STATUS_TITLE } from '../src/common/stock/fbs-request-auto-status';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
const url = process.env.FBS_AUTO_STATUS_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/fbs_auto_status_tests$/.test(url)) throw Error('Dedicated test database only');

describe.skipIf(!url).sequential('FBS automatic request statuses', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  let clientId: string, warehouseId: string, requestId: string, userId: string, stationId: string, boxId: string;
  let tasks: Awaited<ReturnType<typeof db.fbsTsdAssembly.findMany>>;
  const apply = (stage: 'START' | 'PICK' | 'SOS_PRINT', occurredAt = new Date()) =>
    db.$transaction(tx => reconcileFbsRequestStatus(tx, requestId, { stage, occurredAt, actorId: userId }));
  const status = async () => (await db.clientRequest.findUniqueOrThrow({ where: { id: requestId } })).status;
  const pick = async () => db.fbsTsdAssembly.updateMany({ where: { requestId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  async function print(index: number, printed = true, source = 'SOS-WB:TEST', shipped = true) {
    const task = tasks[index];
    await db.fbsPrintJob.create({ data: { stationId, historyId: randomUUID(), assemblyId: task.id, requestId,
      orderId: task.orderId, kiz: randomUUID(), warehouseName: 'MSK', stickerBase64: 'test',
      requestedById: userId, requestedBy: 'Picker', deviceCode: source,
      status: printed ? 'PRINTED' : 'FAILED', printedAt: printed ? new Date() : null } });
    if (shipped) await db.wbOrderShipment.upsert({ where: { assemblyId: task.id }, update: {}, create: {
      clientId, connectionId: task.connectionId, orderId: task.orderId, assemblyId: task.id, requestId,
      warehouseId, skuId: task.skuId, quantity: task.itemCount, source: 'PRINT_CONFIRMED', orderSnapshot: {} } });
  }
  beforeEach(async () => {
    vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED', 'true');
    [clientId, warehouseId, requestId, userId, stationId, boxId] = Array.from({ length: 6 }, () => randomUUID());
    await db.client.create({ data: { id: clientId, code: clientId, name: 'Auto status test' } });
    await db.warehouse.create({ data: { id: warehouseId, code: warehouseId, name: 'Test' } });
    await db.user.create({ data: { id: userId, email: userId+'@invalid', name: 'Picker', passwordHash: 'test' } });
    await db.fbsPrintStation.create({ data: { id: stationId, name: stationId, printerName: 'test', printerModel: 'GENERIC', agentKey: stationId } });
    await db.box.create({ data: { id: boxId, code: boxId, clientId, warehouseId } });
    await db.clientRequest.create({ data: { id: requestId, clientId, warehouseId, type: 'OUTBOUND', status: 'SUBMITTED', title: 'FBS test' } });
    tasks = [];
    for (let i=0;i<2;i++) {
      const sku = await db.sku.create({ data: { clientId, internalSku: randomUUID(), name: 'Test' } });
      const item = await db.clientRequestItem.create({ data: { requestId, skuId: sku.id, quantity: 1 } });
      const connectionId = randomUUID(), orderId = randomUUID();
      await db.fbsOrderRequestLink.create({ data: { clientId, requestId, marketplace: 'WILDBERRIES', connectionId, orderId } });
      tasks.push(await db.fbsTsdAssembly.create({ data: { clientId, requestId, requestItemId: item.id, skuId: sku.id,
        stockWarehouseId: warehouseId, marketplace: 'WILDBERRIES', connectionId, orderId, productName: 'Test',
        barcodes: [], storageBoxes: [], workerUserId: userId, deviceCode: 'TSD:TEST', startedAt: new Date(),
        status: 'IN_PROGRESS', boxId, barcode: 'test' } }));
    }
  });
  afterEach(async () => {
    await db.auditLog.deleteMany({ where: { userId } });
    await db.fbsPrintBillingOutbox.deleteMany({ where: { clientId } });
    await db.fbsPrintJob.deleteMany({ where: { requestId } });
    await db.wbOrderShipment.deleteMany({ where: { clientId } });
    await db.fbsTsdAssembly.deleteMany({ where: { clientId } });
    await db.clientRequest.deleteMany({ where: { clientId } });
    await db.sku.deleteMany({ where: { clientId } });
    await db.box.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
    await db.warehouse.delete({ where: { id: warehouseId } });
    await db.user.delete({ where: { id: userId } });
    await db.fbsPrintStation.delete({ where: { id: stationId } });
    vi.unstubAllEnvs();
  });
  afterAll(() => db.$disconnect());
  // TEST: real order and line evidence drives all three transitions without duplicate history.
  it('advances on start, complete pick and final successful SOS print', async () => {
    await apply('START'); expect(await status()).toBe('IN_WORK');
    await db.fbsTsdAssembly.update({ where: { id: tasks[0].id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await apply('PICK'); expect(await status()).toBe('IN_WORK');
    await pick(); await apply('PICK'); expect(await status()).toBe('PACKED');
    await print(0); await apply('SOS_PRINT'); expect(await status()).toBe('PACKED');
    await print(1); await Promise.all([apply('SOS_PRINT'), apply('SOS_PRINT')]); expect(await status()).toBe('DONE');
    const events = await db.clientRequestEvent.findMany({ where: { requestId, title: FBS_AUTO_STATUS_TITLE }, orderBy: { createdAt: 'asc' } });
    expect(events.map(e=>e.statusTo)).toEqual(['IN_WORK','PACKED','DONE']);
  });
  it('does not count automatic reservations as a person starting work', async () => {
    await db.fbsTsdAssembly.updateMany({ where: { requestId }, data: { status: 'RESERVED', deviceCode: 'AUTO:FBS:PALLET_SORT' } });
    await apply('START'); expect(await status()).toBe('SUBMITTED');
  });
  it('does not close a request with missing tasks or an unpicked line', async () => {
    await pick(); await db.fbsTsdAssembly.delete({ where: { id: tasks[1].id } });
    await db.fbsTsdAssembly.update({ where: { id: tasks[0].id }, data: { itemCount: 2 } });
    await apply('PICK'); expect(await status()).toBe('IN_WORK');
  });
  it.each(['MOVING','RETURN_REQUIRED'])('does not complete unresolved order links: %s', async syncStatus => {
    await pick(); await db.fbsOrderRequestLink.updateMany({ where: { requestId, orderId: tasks[1].orderId }, data: { syncStatus } });
    await apply('PICK'); expect(await status()).toBe('IN_WORK');
  });
  it.each(['failed','ordinary','missing-shipment'])('requires durable SOS proof: %s', async kind => {
    await pick(); await print(0); await print(1, kind!=='failed', kind==='ordinary'?'TSD:TEST':'SOS-WB:TEST', kind!=='missing-shipment');
    await apply('SOS_PRINT'); expect(await status()).toBe('PACKED');
  });
  it('handles print acknowledgements arriving before the final completion event', async () => {
    await print(0); await print(1); await pick(); await apply('PICK'); expect(await status()).toBe('DONE');
  });
  it('preserves a later manual status on replay and allows a new work event', async () => {
    await pick(); const old = new Date('2026-01-01');
    await db.clientRequestEvent.create({ data: { clientId, requestId, eventType: 'STATUS_CHANGED', title: 'Статус заявки изменен', statusTo: 'SUBMITTED', createdByUserId: userId } });
    await apply('PICK', old); expect(await status()).toBe('SUBMITTED');
    await apply('PICK', new Date(Date.now()+1000)); expect(await status()).toBe('PACKED');
  });
  it.each(['DONE','CANCELLED','REJECTED'] as const)('never reopens %s', async value => {
    await db.clientRequest.update({ where: { id: requestId }, data: { status: value } });
    await apply('START'); expect(await status()).toBe(value);
  });
  it('keeps Ozon at PACKED until a separate shipping workflow', async () => {
    await db.fbsTsdAssembly.updateMany({ where: { requestId }, data: { marketplace: 'OZON' } });
    await db.fbsOrderRequestLink.updateMany({ where: { requestId }, data: { marketplace: 'OZON' } });
    await pick(); await print(0); await print(1); await apply('SOS_PRINT'); expect(await status()).toBe('PACKED');
  });
  it('does not change FBO requests or sold installations with the flag off', async () => {
    vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED','false'); await apply('START'); expect(await status()).toBe('SUBMITTED');
    vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED','true'); await db.fbsOrderRequestLink.deleteMany({ where: { requestId } });
    await apply('START'); expect(await status()).toBe('SUBMITTED');
  });
  it('rolls back the status when the enclosing stock transaction fails', async () => {
    await expect(db.$transaction(async tx => { await reconcileFbsRequestStatus(tx, requestId, { stage: 'START', occurredAt: new Date() }); throw Error('stock failed'); })).rejects.toThrow('stock failed');
    expect(await status()).toBe('SUBMITTED'); expect(await db.clientRequestEvent.count({ where: { requestId } })).toBe(0);
  });
  // TEST: regression through the real completion entry point, not only the policy helper.
  it('sets PACKED in the same transaction as the final TSD completion', async () => {
    await db.fbsTsdAssembly.update({ where: { id: tasks[0].id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const notifyClient = vi.fn(async () => { expect(await status()).toBe('PACKED'); return { sent: true }; });
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma: db, fbsOrdersCache: new Map(),
      telegram: { notifyClient },
      loadOwnedFbsTsdAssembly: async () => tasks[1], requireFbsOrderStillCollectable: async () => {},
      reserveCompletedWildberriesStock: async () => {}, formatFbsTsdAssembly: async (task: unknown) => task });
    await svc.completeFbsTsdAssembly(tasks[1].id, { id: userId });
    expect(await status()).toBe('PACKED');
    expect(notifyClient).toHaveBeenCalledOnce(); expect(notifyClient).toHaveBeenCalledWith(clientId, expect.stringContaining('Упаковано'), 'FBS');
  });
  it('records starting the assigned task and refreshes the cached request', async () => {
    const cache = new Map([[clientId, {}]]);
    const notifyClient = vi.fn(async () => { expect(await status()).toBe('IN_WORK'); return { sent: true }; });
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma: db, fbsOrdersCache: cache, telegram: { notifyClient } });
    await svc.reconcileFbsTaskRequestStatus(tasks[0]);
    expect(await status()).toBe('IN_WORK'); expect(cache.has(clientId)).toBe(false);
    await svc.reconcileFbsTaskRequestStatus(tasks[0]);
    expect(notifyClient).toHaveBeenCalledOnce(); expect(notifyClient).toHaveBeenCalledWith(clientId, expect.stringContaining('В работе'), 'FBS');
  });
  // TEST: the real SOS acknowledgement closes once; failed ACKs and old retries cannot overwrite manual control.
  it('closes on the last SOS print ACK without overwriting a later manual status', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    await pick(); await apply('PICK'); await print(0); await print(1, false);
    const job = await db.fbsPrintJob.findFirstOrThrow({ where: { assemblyId: tasks[1].id } });
    const notifyClient = vi.fn(async () => { expect(await status()).toBe('DONE'); return { sent: true }; });
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma: db, fbsOrdersCache: new Map(),
      telegram: { notifyClient },
      localShipmentOrder: async () => ({ id: tasks[1].orderId }) });
    await svc.finishFbsPrintJob(job.id, false, 'printer offline', { id: userId });
    expect(await status()).toBe('PACKED');
    expect(notifyClient).not.toHaveBeenCalled();
    await svc.finishFbsPrintJob(job.id, true, null, { id: userId });
    expect(await status()).toBe('DONE');
    await db.clientRequest.update({ where: { id: requestId }, data: { status: 'PACKED' } });
    await db.clientRequestEvent.create({ data: { clientId, requestId, eventType: 'STATUS_CHANGED', title: 'Статус заявки изменен', statusTo: 'PACKED', createdByUserId: userId } });
    await svc.finishFbsPrintJob(job.id, true, null, { id: userId });
    expect(await status()).toBe('PACKED');
    expect(await db.clientRequestEvent.count({ where: { requestId, title: FBS_AUTO_STATUS_TITLE, statusTo: 'DONE' } })).toBe(1);
    expect(notifyClient).toHaveBeenCalledOnce(); expect(notifyClient).toHaveBeenCalledWith(clientId, expect.stringContaining('Сдано'), 'FBS');
  });
  // TEST: rollback after the helper has collected a notification must never send it.
  it('does not send Telegram when the transaction rolls back after changing status', async () => {
    const notifyClient = vi.fn();
    const prisma = { $transaction: (work: (tx: unknown) => Promise<unknown>) => db.$transaction(async tx => { await work(tx); throw Error('commit failed'); }) };
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma, fbsOrdersCache: new Map(), telegram: { notifyClient } });
    await expect(svc.reconcileFbsTaskRequestStatus(tasks[0])).rejects.toThrow('commit failed');
    expect(await status()).toBe('SUBMITTED'); expect(notifyClient).not.toHaveBeenCalled();
  });
  // TEST: Telegram availability must not roll back a successful warehouse operation.
  it('keeps the committed status when Telegram throws', async () => {
    const notifyClient = vi.fn().mockRejectedValue(Error('offline')), warn = vi.fn();
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma: db, fbsOrdersCache: new Map(), telegram: { notifyClient }, logger: { warn } });
    await svc.reconcileFbsTaskRequestStatus(tasks[0]);
    expect(await status()).toBe('IN_WORK'); expect(warn).toHaveBeenCalledOnce();
  });
  // TEST: installations with automatic statuses disabled remain unchanged.
  it('does not notify when automatic status changes are disabled', async () => {
    vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED', 'false');
    const notifyClient = vi.fn();
    const svc = Object.assign(Object.create(MarketplaceConnectionsService.prototype), { prisma: db, fbsOrdersCache: new Map(), telegram: { notifyClient } });
    await svc.reconcileFbsTaskRequestStatus(tasks[0]);
    expect(await status()).toBe('SUBMITTED'); expect(notifyClient).not.toHaveBeenCalled();
  });
});
