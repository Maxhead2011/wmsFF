import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { donePackingQuantity, reconcileDoneRequestPacking } from '../src/common/stock/done-request-packing';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: mixed-request packing must never be zeroed by SKU or by shipment count.
describe('done packing ledger', () => {
  it('subtracts whole-request debits and leaves other request stock alone', () => {
    expect(donePackingQuantity('done', 5, [
      { sourceDocument: 'done', quantity: 4 }, { sourceDocument: 'done', quantity: -2 },
      { sourceDocument: 'active', quantity: 3 },
    ])).toBe(2);
  });
  it('does not repeat a completed write-off', () => {
    expect(donePackingQuantity('done', 3, [{ sourceDocument: 'done', quantity: 1 },
      { sourceDocument: 'done', quantity: -1 }, { sourceDocument: 'active', quantity: 3 }])).toBe(0);
  });
  it.each([
    [{ sourceDocument: 'done', quantity: 2 }, { sourceDocument: 'other', quantity: -1 }],
    [{ sourceDocument: 'done', quantity: 2 }],
  ])('rejects an ambiguous or mismatching ledger', (...rows) => {
    expect(() => donePackingQuantity('done', 1, rows)).toThrow('Требуется сверка');
  });
});

const url = process.env.DONE_PACKING_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_tests@127.0.0.1:55481/done_packing_tests') throw new Error('Dedicated local database required');
describe.skipIf(!url).sequential('done packing PostgreSQL', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : {});
  let oldFlag: string | undefined;
  beforeEach(() => { oldFlag = process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED; process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED = 'true'; });
  afterEach(() => { if (oldFlag === undefined) delete process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED; else process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED = oldFlag; });
  afterAll(() => db.$disconnect());
  async function fixture(status: 'DONE' | 'IN_WORK' = 'DONE') {
    const clientId = randomUUID(), warehouseId = randomUUID(), skuId = randomUUID(), requestId = randomUUID(), taskId = randomUUID();
    await db.client.create({ data: { id: clientId, code: clientId, name: 'Packing test' } });
    await db.warehouse.create({ data: { id: warehouseId, code: warehouseId, name: 'Packing test' } });
    await db.sku.create({ data: { id: skuId, clientId, internalSku: skuId, name: 'Test product' } });
    await db.clientRequest.create({ data: { id: requestId, clientId, warehouseId, type: 'OUTBOUND', status, title: 'Packing test', items: { create: { skuId, quantity: 1 } } } });
    const item = await db.clientRequestItem.findFirstOrThrow({ where: { requestId } });
    await db.fbsTsdAssembly.create({ data: { id: taskId, clientId, connectionId: randomUUID(), orderId: randomUUID(), requestId,
      requestItemId: item.id, skuId, stockWarehouseId: warehouseId, status: 'COMPLETED', completedAt: new Date(),
      productName: 'Test', barcodes: [], storageBoxes: [], deviceCode: 'SOS-WB:TEST' } });
    const balance = await db.stockBalance.create({ data: { balanceKey: randomUUID(), clientId, warehouseId, skuId, status: 'PACKING', quantity: 2 } });
    await db.stockMovement.create({ data: { clientId, warehouseId, skuId, status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: requestId, idempotencyKey: `fbs-sticker-pick:${taskId}:in` } });
    await db.stockMovement.create({ data: { clientId, warehouseId, skuId, status: 'PACKING', type: 'PICK', quantity: 1, sourceDocument: 'active-other-request' } });
    const shipment = await db.wbOrderShipment.create({ data: { clientId, warehouseId, skuId, requestId, assemblyId: taskId,
      connectionId: randomUUID(), orderId: randomUUID(), quantity: 1, source: 'LEGACY_WMS_SHIPMENT', orderSnapshot: {}, assemblySnapshot: {} } });
    return { clientId, warehouseId, skuId, requestId, taskId, balance, shipment };
  }
  // TEST: reproduces the production bug: DONE + imported shipment still leaves PACKING.
  it('repairs an already DONE request through the real close entry point, preserving shipment and other stock', async () => {
    const f = await fixture();
    const service: any = Object.create(StockOperationsService.prototype);
    service.clientScopes = { requireClientAccess() {} };
    await db.$transaction(tx => service.loadOutboundRequest(tx, f.requestId, {}, 'Отгрузка'));
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(1);
    expect(await db.wbOrderShipment.findUnique({ where: { id: f.shipment.id } })).toEqual(f.shipment);
    await db.$transaction(tx => service.loadOutboundRequest(tx, f.requestId, {}, 'Отгрузка'));
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(1);
  });
  it('repairs legacy DONE packing during background reconciliation despite an existing shipment fact', async () => {
    const f = await fixture();
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    await service.applyLocalWbShipments(f.clientId, []);
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(1);
  });
  it('closes packing atomically with the DONE status event', async () => {
    const f = await fixture('IN_WORK');
    const user = await db.user.create({ data: { email: randomUUID() + '@test.invalid', name: 'Test', passwordHash: 'test' } });
    const service: any = Object.create(StockOperationsService.prototype);
    await db.$transaction(async tx => {
      await tx.clientRequest.update({ where: { id: f.requestId }, data: { status: 'DONE' } });
      await service.createRequestStatusEvent(tx, { request: { id: f.requestId, clientId: f.clientId, status: 'IN_WORK' }, statusTo: 'DONE', user, createdAt: new Date() });
    });
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(1);
  });
  it('serializes duplicate closures without consuming another order', async () => {
    const f = await fixture();
    expect((await Promise.all([1, 2].map(() => db.$transaction(tx => reconcileDoneRequestPacking(tx, f.requestId))))).sort()).toEqual([0, 1]);
  });
  // TEST: the operator preview is valid in a real read-only transaction.
  it('previews without changing stock or history', async () => {
    const f = await fixture();
    const qty = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return reconcileDoneRequestPacking(tx, f.requestId, true);
    });
    expect(qty).toBe(1);
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(2);
    expect(await db.stockMovement.count({ where: { clientId: f.clientId, type: 'SHIP' } })).toBe(0);
  });
  it('leaves active requests and flag-off installations unchanged', async () => {
    const f = await fixture('IN_WORK');
    expect(await db.$transaction(tx => reconcileDoneRequestPacking(tx, f.requestId))).toBe(0);
    await db.clientRequest.update({ where: { id: f.requestId }, data: { status: 'DONE' } });
    process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED = 'false';
    expect(await db.$transaction(tx => reconcileDoneRequestPacking(tx, f.requestId))).toBe(0);
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(2);
  });
  it('rejects stock moved to another request', async () => {
    const f = await fixture();
    await db.fbsTsdAssembly.update({ where: { id: f.taskId }, data: { requestId: 'new-active-request' } });
    await expect(db.$transaction(tx => reconcileDoneRequestPacking(tx, f.requestId))).rejects.toThrow('перенесён');
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(2);
  });
  it('rolls back closure if another request has unallocated debits', async () => {
    const f = await fixture();
    await db.stockMovement.create({ data: { clientId: f.clientId, warehouseId: f.warehouseId, skuId: f.skuId, status: 'PACKING', type: 'SHIP', quantity: -1, sourceDocument: 'unknown-old-request' } });
    await expect(db.$transaction(tx => reconcileDoneRequestPacking(tx, f.requestId))).rejects.toThrow('Требуется сверка');
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(2);
  });
});
