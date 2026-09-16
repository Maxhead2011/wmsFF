import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { finalizeWbOrderShipment, wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { StockBalancesService } from '../src/modules/stock/stock-balances.service';
import * as completedBilling from '../src/modules/billing/completed-fbs-billing';
import { enqueueFbsPrintBilling, FbsPrintBillingWorker } from '../src/modules/marketplace-connections/fbs-print-billing-outbox';

const url = process.env.WB_LIFECYCLE_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_tests@127.0.0.1:55469/wb_lifecycle_tests') throw Error('Dedicated local database required');
describe.skipIf(!url).sequential('WB stock lifecycle SQL integration', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : {});
  let previousFlag: string | undefined;
  beforeAll(() => { previousFlag = process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED; process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'true'; });
  afterAll(async () => { await db.$disconnect(); if (previousFlag === undefined) delete process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED; else process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = previousFlag; });
  async function fixture(picked = true) {
    const clientId = randomUUID(), warehouseId = randomUUID(), skuId = randomUUID(), boxId = randomUUID(), requestId = randomUUID(), taskId = randomUUID();
    await db.client.create({ data: { id: clientId, code: clientId, name: 'Lifecycle test' } });
    await db.warehouse.create({ data: { id: warehouseId, code: warehouseId, name: 'Test branch' } });
    await db.sku.create({ data: { id: skuId, clientId, internalSku: skuId, name: 'Test suit' } });
    await db.box.create({ data: { id: boxId, clientId, warehouseId, code: boxId } });
    await db.clientRequest.create({ data: { id: requestId, clientId, warehouseId, type: 'OUTBOUND', title: 'Test request', items: { create: { skuId, quantity: 1 } } } });
    const item = await db.clientRequestItem.findFirstOrThrow({ where: { requestId } });
    const task = await db.fbsTsdAssembly.create({ data: { id: taskId, clientId, connectionId: randomUUID(), orderId: randomUUID(),
      requestId, requestItemId: item.id, skuId, stockWarehouseId: warehouseId, productName: 'Test suit', barcodes: [], storageBoxes: [],
      status: picked ? 'COMPLETED' : 'RESERVED', deviceCode: 'SOS-WB:TEST', itemCount: 1, boxId, boxCode: boxId,
      ...(picked ? { completedAt: new Date(), kiz: randomUUID() } : {}),
    } });
    await db.stockBalance.create({ data: { balanceKey: randomUUID(), clientId, warehouseId, skuId, boxId: picked ? null : boxId, status: picked ? 'PACKING' : 'AVAILABLE', quantity: picked ? 1 : 5 } });
    if (picked) {
      await db.productMark.create({ data: { clientId, skuId, value: task.kiz!, status: 'PACKING' } });
      await db.stockMovement.create({ data: { clientId, warehouseId, skuId, status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: requestId, idempotencyKey: `fbs-sticker-pick:${taskId}:in` } });
      await db.stockMovement.create({ data: { clientId, warehouseId, skuId, boxId, status: 'AVAILABLE', type: 'PICK', quantity: -1, sourceDocument: requestId, idempotencyKey: `fbs-sticker-pick:${taskId}:out` } });
    }
    return { task, clientId, warehouseId, skuId, boxId, requestId, taskId };
  }
  // TEST: this is the real Svetlana regression: the request still exists but its item is already picked.
  it('removes double reservation after pick; disabled rollout retains the old calculation', async () => {
    const f = await fixture();
    const service: any = new ClientRequestsService(db as never, {} as never, {} as never);
    process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'false';
    const before = await service.activeReservationBySkuId(f.clientId, [f.skuId], [], undefined, f.warehouseId);
    expect(before.get(f.skuId).quantity).toBe(1);
    process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'true';
    const after = await service.activeReservationBySkuId(f.clientId, [f.skuId], [], undefined, f.warehouseId);
    expect(after.get(f.skuId).quantity).toBe(0);
  });
  it('reserves a WB order without a request, deduplicates attachment, and releases cancellation', async () => {
    const f = await fixture(false);
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
    await db.clientRequest.update({ where: { id: f.requestId }, data: { status: 'DONE' } });
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { requestId: 'AUTO:test' } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], randomUUID())).get(f.skuId)).toBe(0);
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { status: 'RELEASED' } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(0);
  });
  // TEST: linking an AUTO order to a request happens before the next background task refresh.
  it('deduplicates the new request link while the task still has AUTO requestId', async () => {
    const f = await fixture(false);
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { requestId: 'AUTO:test' } });
    await db.fbsOrderRequestLink.create({ data: { clientId: f.clientId, marketplace: 'WILDBERRIES',
      connectionId: f.task.connectionId, orderId: f.task.orderId, requestId: f.requestId } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId, f.requestId)).get(f.skuId)).toBe(0);
  });
  // TEST: old unstarted tasks must not keep reserving stock after WB shipment or cancellation.
  it('ignores terminal WB demand while an explicit emergency repeat still reserves', async () => {
    const f = await fixture(false);
    await db.fbsOrderRequestLink.create({ data: { clientId: f.clientId, marketplace: 'WILDBERRIES',
      connectionId: f.task.connectionId, orderId: f.task.orderId, requestId: f.requestId, lastCategory: 'shipped' } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(0);
    await db.clientRequest.update({ where: { id: f.requestId }, data: { fbsEmergencyAssemblyAt: new Date() } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
  });
  // TEST: use real PostgreSQL parameter binding with a client whose history exceeds 32767 tasks.
  it('reconciles a large client in bounded SQL batches', async () => {
    const clientId = randomUUID();
    const thinTasks = Array.from({ length: 40000 }, (_, i) => ({ id: `old-task-${i}`, requestId: `old-request-${i}`,
      connectionId: 'old-connection', orderId: `old-order-${i}`, completedAt: null }));
    const largeHistory = new Proxy(db, { get(target, property) {
      if (property === 'fbsTsdAssembly') return { findMany: async () => thinTasks };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service: any = new MarketplaceConnectionsService(largeHistory as never, {} as never);
    await expect(service.applyLocalWbShipments(clientId, [])).resolves.toEqual([]);
  });
  // TEST: stock exports must also bind order links and immutable shipments in bounded batches.
  it('calculates free stock for a client with more than 32767 historical orders', async () => {
    const f = await fixture(false);
    const tasks = Array.from({ length: 33000 }, (_, i) => ({ ...f.task, id: `large-task-${i}`,
      requestId: `AUTO:large-${i}`, orderId: `large-order-${i}` }));
    const largeHistory = new Proxy(db, { get(target, property) {
      if (property === 'fbsTsdAssembly') return { findMany: async () => tasks };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    expect((await wbReservationQuantities(largeHistory, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(33001);
  });
  // TEST: execute the release migration itself, including warehouse backfill, in an isolated schema.
  it('applies the additive migration and backfills request/box reservation warehouses', async () => {
    const schema = 'lifecycle_' + randomUUID().replaceAll('-', '');
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE "FbsTsdAssembly" (id TEXT, "requestId" TEXT, "boxId" TEXT, "reservedBoxId" TEXT)');
      await tx.$executeRawUnsafe('CREATE TABLE "ClientRequest" (id TEXT, "warehouseId" TEXT)');
      await tx.$executeRawUnsafe('CREATE TABLE "Box" (id TEXT, "warehouseId" TEXT)');
      await tx.$executeRawUnsafe(`INSERT INTO "ClientRequest" VALUES ('r','branch1')`);
      await tx.$executeRawUnsafe(`INSERT INTO "Box" VALUES ('b','branch2')`);
      await tx.$executeRawUnsafe(`INSERT INTO "FbsTsdAssembly" VALUES ('a','r',NULL,NULL), ('b','AUTO',NULL,'b')`);
      const sql = readFileSync('prisma/migrations/20260916010000_wb_order_stock_lifecycle/migration.sql', 'utf8');
      for (const statement of sql.split(';').filter(statement => statement.trim())) await tx.$executeRawUnsafe(statement);
      expect(await tx.$queryRawUnsafe('SELECT id, "stockWarehouseId" FROM "FbsTsdAssembly" ORDER BY id')).toEqual([
        { id: 'a', stockWarehouseId: 'branch1' }, { id: 'b', stockWarehouseId: 'branch2' },
      ]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  });
  // TEST: actual WB ingestion must reserve supplierStatus=new, before any local assembly request.
  it('ingests a new WB order as branch-scoped demand and releases it on the next cancellation snapshot', async () => {
    const f = await fixture(false);
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    service.resolveFbsWarehouseFromWildberries = vi.fn(async () => f.warehouseId);
    const order = { ...await service.localShipmentOrder(f.task), category: 'active', supplierStatus: 'new', request: null };
    await db.fbsTsdAssembly.delete({ where: { id: f.taskId } });
    await db.clientRequest.update({ where: { id: f.requestId }, data: { status: 'DONE' } });
    await service.syncFbsPalletSortReservations(f.clientId, [order]);
    expect(await db.fbsTsdAssembly.findFirst({ where: { clientId: f.clientId } })).toMatchObject({ stockWarehouseId: f.warehouseId, orderId: order.id });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
    await service.syncFbsPalletSortReservations(f.clientId, [{ ...order, category: 'cancelled', supplierStatus: 'cancel' }]);
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(0);
  });
  it('commits exactly one stock write-off under concurrent print/WB acknowledgements', async () => {
    const f = await fixture();
    const results = await Promise.all(['PRINT_CONFIRMED', 'WB_SHIPMENT_CONFIRMED'].map(source => db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, source, { id: f.task.orderId, connectionId: f.task.connectionId, marketplace: 'WILDBERRIES', supplyId: 'original' }))));
    expect(results[0]!.id).toBe(results[1]!.id);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
    expect((await db.stockBalance.aggregate({ where: { clientId: f.clientId }, _sum: { quantity: true } }))._sum.quantity).toBe(0);
    expect(await db.productMark.findFirst({ where: { clientId: f.clientId } })).toMatchObject({ status: 'SHIPPING', boxId: null });
    expect(await db.shippedKizHistory.count({ where: { clientId: f.clientId } })).toBe(1);
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    const orders = await service.applyLocalWbShipments(f.clientId, [{ id: f.task.orderId, connectionId: f.task.connectionId, marketplace: 'WILDBERRIES', category: 'cancelled', supplyId: 'changed' }]);
    expect(orders[0]).toMatchObject({ category: 'shipped', supplyId: 'original' });
    await db.$transaction(tx => service.returnCompletedWildberriesStockReservation(tx, f.task));
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'RETURN' } })).toBe(0);
  });
  it('does not ship an unpicked order or consume another order packing', async () => {
    const f = await fixture(false);
    await expect(db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'WB_SHIPMENT_CONFIRMED', {}))).rejects.toThrow('физическое списание');
    expect(await db.wbOrderShipment.count({ where: { clientId: f.clientId } })).toBe(0);
    expect((await db.stockBalance.findFirst({ where: { clientId: f.clientId } }))!.quantity).toBe(5);
  });
  it('whole-request close cannot consume stock for an already shipped order', async () => {
    const f = await fixture();
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', {}));
    const service: any = Object.create(StockOperationsService.prototype);
    service.clientScopes = { requireClientAccess() {} };
    const result = await db.$transaction(tx => service.loadOutboundRequest(tx, f.requestId, {}, 'Отгрузка'));
    expect(result.status).toBe('DONE');
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
  });
  // TEST: pressing Print/queueing/failure never ships; only a successful SOS agent result does.
  it('ships once after SOS print success and queues billing, never on print failure', async () => {
    const f = await fixture();
    const station = await db.fbsPrintStation.create({ data: { name: randomUUID(), agentKey: randomUUID(), printerName: 'test', printerModel: 'test' } });
    const user = await db.user.create({ data: { email: randomUUID() + '@test.invalid', name: 'test', passwordHash: 'not-a-password' } });
    const job = await db.fbsPrintJob.create({ data: { stationId: station.id, historyId: randomUUID(), assemblyId: f.taskId,
      requestId: f.requestId, orderId: f.task.orderId, kiz: f.task.kiz!, warehouseName: 'test', stickerBase64: 'test',
      requestedById: user.id, requestedBy: user.name, deviceCode: 'SOS-WB:test' } });
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    service.ensureFbsProcessingCharges = vi.fn(async () => new Map());
    await service.finishFbsPrintJob(job.id, false, 'printer offline', user);
    expect(await db.wbOrderShipment.count({ where: { clientId: f.clientId } })).toBe(0);
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
    await service.finishFbsPrintJob(job.id, true, null, user);
    const first = await db.wbOrderShipment.findFirstOrThrow({ where: { clientId: f.clientId } });
    await service.finishFbsPrintJob(job.id, false, 'late failure', user);
    expect(await db.fbsPrintJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'PRINTED', printedAt: first.shippedAt });
    await service.finishFbsPrintJob(job.id, true, null, user);
    expect(await db.wbOrderShipment.findFirst({ where: { clientId: f.clientId } })).toEqual(first);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
    // TEST: shipment remains synchronous; billing survives independently in the outbox.
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
    expect(await db.fbsPrintBillingOutbox.findUnique({ where: { clientId: f.clientId } })).toMatchObject({ revision: 2 });
  });
  // TEST: remaining request work must not resurrect already shipped packing or consume AVAILABLE twice.
  it.each(['lifecycle', 'legacy-WB'])('closes a partially printed %s request without double shipment credits', async (mode) => {
    const f = await fixture();
    const secondId = randomUUID();
    await db.clientRequestItem.update({ where: { id: f.task.requestItemId }, data: { quantity: 2 } });
    await db.clientRequest.update({ where: { id: f.requestId }, data: { status: 'IN_WORK' } });
    await db.fbsTsdAssembly.create({ data: { ...f.task, id: secondId, orderId: randomUUID(), kiz: null } });
    await db.stockBalance.updateMany({ where: { clientId: f.clientId }, data: { quantity: 2 } });
    for (const status of ['AVAILABLE', 'PACKING'] as const) await db.stockMovement.create({ data: {
      clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId, status, type: 'PICK',
      boxId: status === 'AVAILABLE' ? f.boxId : null, quantity: status === 'AVAILABLE' ? -1 : 1,
      sourceDocument: f.requestId, idempotencyKey: `fbs-sticker-pick:${secondId}:${status}`,
    } });
    await db.clientRequestBoxSelection.create({ data: { requestItemId: f.task.requestItemId, skuId: f.skuId, boxId: f.boxId, quantity: 2 } });
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', {}));
    // TEST: the old WB shipment and its migrated fact represent one physical unit.
    if (mode === 'legacy-WB') {
      await db.stockMovement.updateMany({ where: { clientId: f.clientId, type: 'SHIP' }, data: { idempotencyKey: `fbs-wb-shipment:${f.taskId}` } });
      await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { status: 'WB_ACCOUNTED', barcode: 'legacy-test' } });
      await db.shippedKizHistory.updateMany({ where: { assemblyId: f.taskId }, data: { barcode: 'legacy-test' } });
    }
    const user = await db.user.create({ data: { email: randomUUID() + '@test.invalid', name: 'test', passwordHash: 'test' } });
    const service: any = Object.create(StockOperationsService.prototype);
    service.prisma = db;
    service.clientScopes = { requireClientAccess() {} };
    service.resolveWritableWarehouseId = () => f.warehouseId;
    service.ensureRequestLogisticsBilling = async () => undefined;
    service.ensureRequestExpenseConsumption = async () => undefined;
    const result = await service.shipClientRequestFromCurrentStock({ requestId: f.requestId, boxes: 1, pallets: 0, packedUnits: 2, comment: 'Test shipment' }, user);
    expect(result.status).toBe('APPLIED');
    expect((await db.stockBalance.aggregate({ where: { clientId: f.clientId }, _sum: { quantity: true } }))._sum.quantity ?? 0).toBe(0);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'INVENTORY_ADJUSTMENT' } })).toBe(0);
    expect((await db.stockMovement.aggregate({ where: { clientId: f.clientId, type: 'SHIP' }, _sum: { quantity: true } }))._sum.quantity).toBe(-2);
    const marketplace: any = new MarketplaceConnectionsService(db as never, {} as never);
    await marketplace.applyLocalWbShipments(f.clientId, []);
    expect(await db.wbOrderShipment.count({ where: { clientId: f.clientId } })).toBe(2);
    expect((await db.stockMovement.aggregate({ where: { clientId: f.clientId, type: 'SHIP' }, _sum: { quantity: true } }))._sum.quantity).toBe(-2);
  });
  // TEST: a rehearsed historical fact can be promoted only while both shipment proof and task stay unchanged.
  it('imports reviewed legacy proof idempotently and refuses changed task or history', async () => {
    const f = await fixture();
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'LEGACY_WMS_SHIPMENT', {}));
    const payload: any[] = await db.$queryRawUnsafe(`SELECT jsonb_build_object('fact',to_jsonb(f),'history',to_jsonb(h)) payload FROM "WbOrderShipment" f JOIN "ShippedKizHistory" h ON h."assemblyId"=f."assemblyId" WHERE f."assemblyId"=$1`, f.taskId);
    const sql = readFileSync('../../infra/releases/wb-order-stock-lifecycle/import-legacy.sql', 'utf8');
    await db.wbOrderShipment.deleteMany({ where: { assemblyId: f.taskId } });
    expect(await db.$executeRawUnsafe(sql, JSON.stringify(payload.map(row => row.payload)))).toBe(1);
    expect(await db.$executeRawUnsafe(sql, JSON.stringify(payload.map(row => row.payload)))).toBe(0);
    await db.wbOrderShipment.deleteMany({ where: { assemblyId: f.taskId } });
    const changed = JSON.parse(JSON.stringify(payload[0].payload)); changed.history.kiz = 'other-mark';
    expect(await db.$executeRawUnsafe(sql, JSON.stringify([changed]))).toBe(0);
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { workerName: 'changed after rehearsal' } });
    expect(await db.$executeRawUnsafe(sql, JSON.stringify(payload.map(row => row.payload)))).toBe(0);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
  });
  // TEST: immutable billing evidence must not duplicate large catalogue responses or suggested stock lists.
  it('keeps shipment evidence compact without raw marketplace payloads', async () => {
    const f = await fixture();
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { storageBoxes: [{ code: 'not-physical-evidence', data: 'x'.repeat(200000) }] } });
    await db.clientRequest.update({ where: { id: f.requestId }, data: { comment: 'x'.repeat(200000) } });
    const fact = await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', {
      product: { id: f.skuId, name: 'Test suit', marketplacePayload: { raw: 'x'.repeat(200000) } }, storageBoxes: [{ raw: 'x'.repeat(200000) }],
    }));
    expect(JSON.stringify(fact).length).toBeLessThan(16000);
    expect((fact!.orderSnapshot as any).product).toEqual({ id: f.skuId, name: 'Test suit' });
    expect((fact!.assemblySnapshot as any).kiz).toBe(f.task.kiz);
    expect((fact!.assemblySnapshot as any).storageBoxes).toBeUndefined();
  });
  it('recognizes packing moved to SHIPPING before the print acknowledgement', async () => {
    const f = await fixture();
    await db.stockBalance.updateMany({ where: { clientId: f.clientId }, data: { status: 'SHIPPING' } });
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', {}));
    expect(await db.stockMovement.findFirst({ where: { clientId: f.clientId, type: 'SHIP' } })).toMatchObject({ status: 'SHIPPING', quantity: -1 });
  });
  // TEST: accumulated shipment JSON must be decoded in bounded batches without losing a page.
  it('reads every historical shipment in bounded pages for display and billing', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    const fact = (await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot)))!;
    await db.wbOrderShipment.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ ...fact,
      id: randomUUID(), assemblyId: randomUUID(), orderId: `history-${i}`,
      assemblySnapshot: fact.assemblySnapshot!, orderSnapshot: { ...snapshot, id: `history-${i}` },
    })) });
    const find = db.wbOrderShipment.findMany.bind(db.wbOrderShipment);
    const read = (args: any) => {
      if (!args.select || args.select.orderSnapshot) expect(args.take).toBeLessThanOrEqual(1000);
      return find(args) as any;
    };
    service.prisma = new Proxy(db, { get(target, property) {
      if (property === 'wbOrderShipment') return { findMany: read };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const bill = vi.spyOn(service, 'ensureFbsProcessingChargesLocked').mockResolvedValue(new Map());
    try {
      expect(await service.applyLocalWbShipments(f.clientId, [])).toHaveLength(1001);
      await service.ensureFbsProcessingCharges(f.clientId, []);
      expect(bill.mock.calls[0][1]).toHaveLength(1001);
    } finally { bill.mockRestore(); }
  });
  it('records an explicit repeat attempt without overwriting the first shipment', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: 37.1, pickupPointBasePriceRub: 0, vnukovoBasePriceRub: 0 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    const first = await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const firstInvoice = await db.billingInvoice.findFirstOrThrow({ where: { clientId: f.clientId } });
    const firstCharge = await db.billingCharge.findFirstOrThrow({ where: { clientId: f.clientId } });
    const repeatId = randomUUID();
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { id: repeatId, kiz: randomUUID() } });
    // TEST: a new physical attempt stays active despite the immutable first shipment.
    const activeRepeat = { ...snapshot, category: 'active', supplierStatus: 'confirm' };
    const refreshed = await service.applyLocalWbShipments(f.clientId, [activeRepeat]);
    expect(refreshed.find((order: any) => order.id === f.task.orderId)?.category).toBe('active');
    await db.stockBalance.updateMany({ where: { clientId: f.clientId }, data: { quantity: 1 } });
    await db.stockMovement.create({ data: { clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId,
      status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: f.requestId, idempotencyKey: `fbs-sticker-pick:${repeatId}:in` } });
    await db.$transaction(tx => finalizeWbOrderShipment(tx, repeatId, 'PRINT_CONFIRMED', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    await service.ensureFbsProcessingCharges(f.clientId, []);
    expect(await db.billingInvoice.count({ where: { clientId: f.clientId } })).toBe(2);
    expect(await db.billingCharge.count({ where: { clientId: f.clientId } })).toBe(2);
    expect(await db.billingInvoice.findUnique({ where: { id: firstInvoice.id } })).toEqual(firstInvoice);
    expect(await db.billingCharge.findUnique({ where: { id: firstCharge.id } })).toEqual(firstCharge);
    expect(await db.wbOrderShipment.count({ where: { clientId: f.clientId } })).toBe(2);
    expect(await db.wbOrderShipment.findUnique({ where: { id: first!.id } })).toEqual(first);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(2);
  });
  // TEST: migration must not rewrite an old unattached charge when another supply already covered its order.
  it('preserves an existing orphan charge while crediting historical processing', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, turnkeyEnabled: true, turnkeyUnitPriceRub: 75 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const first = await db.billingCharge.findFirstOrThrow({ where: { clientId: f.clientId } });
    await db.billingInvoiceItem.deleteMany({ where: { chargeId: first.id } });
    await db.billingCharge.create({ data: { ...first, id: randomUUID(), sourceKey: first.sourceKey + ':older', metadata: first.metadata! } });
    await service.ensureFbsProcessingCharges(f.clientId, []);
    expect(await db.billingCharge.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  });
  // TEST: importing old shipped facts cannot create charges at today's tariff.
  it('does not invoice imported legacy shipment history', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, turnkeyEnabled: true, turnkeyUnitPriceRub: 99 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'LEGACY_WMS_SHIPMENT', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    expect(await db.billingInvoice.count({ where: { clientId: f.clientId } })).toBe(0);
    expect(await db.billingCharge.count({ where: { clientId: f.clientId } })).toBe(0);
  });
  // TEST: retaining legacy bills must also retain their already charged daily logistics trip.
  it('credits the logistics trip already invoiced with a legacy shipment', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: 37.1 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    const fact = (await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot)))!;
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const first = await db.billingCharge.findFirstOrThrow({ where: { clientId: f.clientId } });
    expect((first.metadata as any).logisticsTrip.logisticsRub).toBeGreaterThan(0);
    await db.wbOrderShipment.update({ where: { id: fact.id }, data: { source: 'LEGACY_WMS_SHIPMENT' } });
    const second = await db.fbsTsdAssembly.create({ data: { ...f.task, id: randomUUID(), orderId: randomUUID(), kiz: null } });
    await db.stockBalance.updateMany({ where: { clientId: f.clientId }, data: { quantity: 1 } });
    await db.stockMovement.create({ data: { clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId,
      status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: f.requestId, idempotencyKey: `fbs-sticker-pick:${second.id}:in` } });
    await db.$transaction(tx => finalizeWbOrderShipment(tx, second.id, 'PRINT_CONFIRMED', { ...snapshot, id: second.orderId }));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const added = await db.billingCharge.findFirstOrThrow({ where: { clientId: f.clientId, id: { not: first.id } } });
    expect(Number(added.totalRub)).toBe(37.1);
    expect(await db.billingCharge.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  });
  // TEST: later work preserves both issued invoices and the original price of an existing draft.
  it('credits turnkey processing already billed under an earlier supply identity', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, turnkeyEnabled: true, turnkeyUnitPriceRub: 75 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const first = await db.billingCharge.findFirstOrThrow({ where: { clientId: f.clientId } });
    await db.billingCharge.update({ where: { id: first.id }, data: { sourceKey: first.sourceKey + ':earlier-supply' } });
    const invoice = await db.billingInvoice.findFirstOrThrow({ where: { clientId: f.clientId } });
    await db.billingInvoice.update({ where: { id: invoice.id }, data: { sourceKey: invoice.sourceKey + ':earlier-supply' } });
    await db.billingCharge.create({ data: { ...first, id: randomUUID(), sourceKey: first.sourceKey + ':cancelled', status: 'CANCELLED', metadata: first.metadata! } });
    // TEST: large histories must index each charge once instead of rescanning the full list per batch.
    const creditIndex = vi.spyOn(completedBilling, 'otherProcessingOrderKeys');
    try {
      await service.ensureFbsProcessingCharges(f.clientId, []);
      await service.ensureFbsProcessingCharges(f.clientId, []);
      expect(creditIndex.mock.calls.every(([charges]) => charges.length === 1)).toBe(true);
    } finally { creditIndex.mockRestore(); }
    expect(await db.billingInvoice.count({ where: { clientId: f.clientId } })).toBe(1);
    expect(await db.billingCharge.count({ where: { clientId: f.clientId, status: { not: 'CANCELLED' } } })).toBe(1);
    expect(Number((await db.billingCharge.findUniqueOrThrow({ where: { id: first.id } })).totalRub)).toBe(75);
  });
  it.each([false, true])('bills later printed orders separately after the first supply invoice is issued (work credit: %s)', async (workCredit) => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: 37.1, pickupPointBasePriceRub: 0, vnukovoBasePriceRub: 0 } });
    const snapshot = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', snapshot));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const first = await db.billingInvoice.findFirstOrThrow({ where: { clientId: f.clientId } });
    await db.billingInvoice.update({ where: { id: first.id }, data: { status: workCredit ? 'ISSUED' : 'DRAFT' } });
    await db.clientFbsBillingSettings.update({ where: { clientId: f.clientId }, data: { fixedPlusLogisticsUnitPriceRub: 50 } });
    const frozen = await db.billingInvoice.findUniqueOrThrow({ where: { id: first.id } });
    const second = await db.fbsTsdAssembly.create({ data: { ...f.task, id: randomUUID(), orderId: randomUUID(), kiz: null } });
    await db.stockBalance.updateMany({ where: { clientId: f.clientId }, data: { quantity: 1 } });
    await db.stockMovement.create({ data: { clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId,
      status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: f.requestId, idempotencyKey: `fbs-sticker-pick:${second.id}:in` } });
    await db.$transaction(tx => finalizeWbOrderShipment(tx, second.id, 'PRINT_CONFIRMED', { ...snapshot, id: second.orderId }));
    // TEST: the production completed-work policy must credit its earlier processing invoice.
    const policy = workCredit ? vi.spyOn(completedBilling, 'completedWorkBillingEnabled').mockReturnValue(true) : null;
    const credit = workCredit ? vi.spyOn(completedBilling, 'loadWorkCharges').mockResolvedValue([{
      id: randomUUID(), sourceKey: 'fbs-work:previous-processing', status: 'DRAFT', serviceId: null,
      quantity: 1, totalRub: 37.1, invoiceItems: [{ invoice: { status: 'ISSUED' } }],
      metadata: { kind: 'FBS', marketplace: 'WILDBERRIES', connectionId: second.connectionId, orderIds: [second.orderId] },
    }]) : null;
    try {
      await service.ensureFbsProcessingCharges(f.clientId, []);
      await service.ensureFbsProcessingCharges(f.clientId, []);
      expect(await db.billingInvoice.count({ where: { clientId: f.clientId } })).toBe(workCredit ? 1 : 2);
      const charges = await db.billingCharge.findMany({ where: { clientId: f.clientId, status: { not: 'CANCELLED' } } });
      expect(charges.reduce((sum, charge) => sum + Number((charge.metadata as any).quote.processingTotalRub), 0)).toBe(workCredit ? 37.1 : 87.1);
      expect(await db.billingInvoice.findUniqueOrThrow({ where: { id: first.id } })).toEqual(frozen);
    } finally { credit?.mockRestore(); policy?.mockRestore(); }
  });
  it('rolls back all changes when packing is insufficient after a partial deduction', async () => {
    const f = await fixture();
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { itemCount: 2 } });
    await db.stockMovement.updateMany({ where: { clientId: f.clientId, status: 'PACKING' }, data: { quantity: 2 } });
    await expect(db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', {}))).rejects.toThrow('Недостаточно товара');
    expect((await db.stockBalance.findFirstOrThrow({ where: { clientId: f.clientId } })).quantity).toBe(1);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(0);
    expect(await db.wbOrderShipment.count({ where: { clientId: f.clientId } })).toBe(0);
  });
  it('moves reservation from source SKU to target after relabel confirmation without doubling the request', async () => {
    const f = await fixture(false);
    const source = await db.sku.create({ data: { clientId: f.clientId, internalSku: randomUUID(), name: 'Source SKU' } });
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { sourceSkuId: source.id, relabelRequired: true } });
    expect(Object.fromEntries(await wbReservationQuantities(db, f.clientId, [source.id, f.skuId], f.warehouseId))).toEqual({ [source.id]: 1, [f.skuId]: 0 });
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { relabelConfirmedAt: new Date() } });
    expect(Object.fromEntries(await wbReservationQuantities(db, f.clientId, [source.id, f.skuId], f.warehouseId))).toEqual({ [source.id]: 0, [f.skuId]: 1 });
  });
  it('does not reserve an ordinary WMS unit again after physical picking', async () => {
    const f = await fixture(false);
    await db.fbsTsdAssembly.delete({ where: { id: f.taskId } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(1);
    await db.stockMovement.create({ data: { clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId,
      boxId: f.boxId, status: 'AVAILABLE', type: 'PICK', quantity: -1, sourceDocument: f.requestId, idempotencyKey: randomUUID() } });
    expect((await wbReservationQuantities(db, f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(0);
  });
  it('uses identical physical/free quantities in stock list and Excel preview, excluding archived boxes', async () => {
    const f = await fixture(false);
    await db.client.update({ where: { id: f.clientId }, data: { stockBalanceMode: 'BOXES' } });
    const archived = await db.box.create({ data: { code: randomUUID(), clientId: f.clientId, warehouseId: f.warehouseId, status: 'archived' } });
    await db.stockBalance.create({ data: { balanceKey: randomUUID(), clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId, boxId: archived.id, quantity: 50, status: 'AVAILABLE' } });
    const requests: any = new ClientRequestsService(db as never, {} as never, {} as never);
    expect((await requests.stockQuantityBySkuId(f.clientId, [f.skuId], f.warehouseId)).get(f.skuId)).toBe(5);
    const stocks = new StockBalancesService(db as never, { resolveClientFilter: () => f.clientId } as never);
    const rows = await stocks.list({}, { activeWarehouseId: f.warehouseId, roleCodes: ['ADMIN'], permissionCodes: [] } as never);
    expect(rows.reduce((sum, row) => sum + ('freeQuantity' in row ? Number(row.freeQuantity) : row.quantity), 0)).toBe(4);
  });
  // TEST: real billing writer, invoices and stock must survive remote cancellation without repricing or duplicates.
  it('retries billing after a committed invoice without creating duplicate charges', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: 37.1, pickupPointBasePriceRub: 0, vnukovoBasePriceRub: 0 } });
    const order = JSON.parse(JSON.stringify(await service.localShipmentOrder(f.task)));
    await db.$transaction(async tx => {
      await finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', order);
      await enqueueFbsPrintBilling(tx, f.clientId);
    });
    const scoped = Object.create(db);
    Object.defineProperty(scoped, 'fbsPrintBillingOutbox', { value: new Proxy(db.fbsPrintBillingOutbox, {
      get(target, key) {
        if (key === 'findFirst') return (args: any) => target.findFirst({ ...args, where: { ...args.where, clientId: f.clientId } });
        return Reflect.get(target, key);
      },
    }) });
    const report = vi.fn();
    const failedAck = new FbsPrintBillingWorker(scoped, async id => {
      await service.ensureFbsProcessingCharges(id, []);
      throw Error('lost worker acknowledgement after billing commit');
    }, report);
    await failedAck.processNext();
    expect(report).toHaveBeenCalledOnce();
    const invoices = await db.billingInvoice.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } });
    const charges = await db.billingCharge.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } });
    expect(invoices.length).toBeGreaterThan(0);
    expect(charges.length).toBeGreaterThan(0);
    await db.fbsPrintBillingOutbox.update({ where: { clientId: f.clientId }, data: { nextAttemptAt: new Date(0) } });
    await new FbsPrintBillingWorker(scoped, id => service.ensureFbsProcessingCharges(id, []), report).processNext();
    expect(await db.fbsPrintBillingOutbox.findUnique({ where: { clientId: f.clientId } })).toBeNull();
    expect(await db.billingInvoice.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } })).toEqual(invoices);
    expect(await db.billingCharge.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } })).toEqual(charges);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
  });

  // TEST: real billing writer, invoices and stock must survive remote cancellation without repricing or duplicates.
  it('bills only local shipment and preserves the invoice after WB cancellation or disappearance', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await db.clientFbsBillingSettings.create({ data: { clientId: f.clientId, fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: 37.1, pickupPointBasePriceRub: 0, vnukovoBasePriceRub: 0 } });
    const order = { ...await service.localShipmentOrder(f.task), supplyId: 'WB-GI-TEST-' + randomUUID(),
      shipmentPlan: { destination: 'VNUKOVO_SORTING_CENTER', itemsPerCargoPlace: 100, requiresCargoPlaces: false,
        cargoPlaceCount: 0, cargoPlaceIds: [], sentToWbAt: null, sentToWbBy: null } };
    await service.ensureFbsProcessingCharges(f.clientId, [{ ...order, category: 'shipped' }]);
    expect(await db.billingCharge.count({ where: { clientId: f.clientId } })).toBe(0);
    await db.$transaction(tx => finalizeWbOrderShipment(tx, f.taskId, 'PRINT_CONFIRMED', JSON.parse(JSON.stringify(order))));
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const charges = await db.billingCharge.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } });
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.reduce((sum, row) => sum + Number(row.totalRub), 0)).toBeGreaterThanOrEqual(37.1);
    for (const category of ['cancelled', 'archive', 'active']) {
      await service.ensureFbsProcessingCharges(f.clientId, [{ ...order, category, supplyId: 'changed', itemCount: 99 }]);
    }
    await service.ensureFbsProcessingCharges(f.clientId, []);
    const after = await db.billingCharge.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } });
    expect(after.map(row => [row.id, row.totalRub.toString(), row.quantity.toString(), row.serviceDate, row.metadata]))
      .toEqual(charges.map(row => [row.id, row.totalRub.toString(), row.quantity.toString(), row.serviceDate, row.metadata]));
    expect(await db.billingInvoice.count({ where: { clientId: f.clientId } })).toBeGreaterThan(0);
    // TEST: rollout may have fewer migrated facts than an old invoice; never shrink historical work.
    const historical = await db.billingCharge.update({ where: { id: charges[0].id }, data: {
      quantity: 2, totalRub: 74.2, metadata: { ...(charges[0].metadata as object), orderIds: [f.task.orderId, 'legacy-order'] },
    } });
    await service.ensureFbsProcessingCharges(f.clientId, []);
    expect(await db.billingCharge.findUnique({ where: { id: historical.id } })).toEqual(historical);
  });
});
