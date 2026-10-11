import 'reflect-metadata';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { FbsManualAssemblyService as SourceManualService } from '../src/modules/marketplace-connections/fbs-manual-assembly.service';
import { MarketplaceConnectionsService as SourceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { ClientScopeService as SourceScopeService } from '../src/modules/auth/client-scope.service';

// TEST: the same database scenarios can exercise the materialized production candidate.
const runtime = process.env.FBS_MANUAL_RUNTIME_DIR;
const requireRuntime = createRequire(import.meta.url);
const FbsManualAssemblyService: typeof SourceManualService = runtime ? requireRuntime(join(runtime, 'modules/marketplace-connections/fbs-manual-assembly.service.js')).FbsManualAssemblyService : SourceManualService;
const MarketplaceConnectionsService: typeof SourceConnectionsService = runtime ? requireRuntime(join(runtime, 'modules/marketplace-connections/marketplace-connections.service.js')).MarketplaceConnectionsService : SourceConnectionsService;
const ClientScopeService: typeof SourceScopeService = runtime ? requireRuntime(join(runtime, 'modules/auth/client-scope.service.js')).ClientScopeService : SourceScopeService;

// TEST: explicitly opt into a disposable local database; never use DATABASE_URL.
const url = process.env.FBS_MANUAL_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/fbs_manual_test')
    throw new Error('Manual FBS integration tests require localhost/fbs_manual_test');
}
const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
afterAll(async () => { await db?.$disconnect(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function fixture(quantity = 2) {
  vi.stubEnv('WMS_FBS_MANUAL_ASSEMBLY_ENABLED', 'true');
  vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED', 'true');
  vi.stubEnv('WMS_RECEIPT_STOCK_INDEX_ENABLED', 'false');
  const prisma = db!;
  const tag = randomUUID();
  const actor = await prisma.user.create({ data: { email: tag + '@test.invalid', name: 'TEST', passwordHash: 'not-a-password' } });
  const client = await prisma.client.create({ data: { code: tag, name: 'TEST manual FBS' } });
  const warehouse = await prisma.warehouse.create({ data: { code: tag, name: 'TEST Moscow' } });
  const connection = await prisma.clientMarketplaceConnection.create({ data: { clientId: client.id, marketplace: 'WILDBERRIES', apiKey: 'test-unused' } });
  const sku = await prisma.sku.create({ data: { clientId: client.id, internalSku: tag, name: 'TEST coat', article: 'coat', size: 'M', barcodes: { create: { value: tag, isPrimary: true } } } });
  const box = await prisma.box.create({ data: { clientId: client.id, warehouseId: warehouse.id, code: tag + '_001' } });
  const pallet = await prisma.storagePallet.create({ data: { clientId: client.id, warehouseId: warehouse.id, code: tag, boxes: { create: { boxId: box.id, boxCode: box.code } } } });
  const balance = await prisma.stockBalance.create({ data: { balanceKey: tag, clientId: client.id, warehouseId: warehouse.id, skuId: sku.id, boxId: box.id, status: 'AVAILABLE', quantity } });
  const user: any = { id: actor.id, name: actor.name, roleCodes: ['OWNER'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], writableWarehouseIds: [warehouse.id], activeWarehouseId: warehouse.id };
  const scopes = new ClientScopeService();
  const connections = new MarketplaceConnectionsService(prisma as any, scopes);
  const service = new FbsManualAssemblyService(prisma as any, scopes, connections);
  // Stable WB snapshots are essential: createdAt is a source fact, not the check time.
  const createdAt = new Date().toISOString();
  vi.spyOn(service, 'readOrders').mockImplementation(async (_key, orderIds) => orderIds.map(id => ({ id, supplyId: 'WB-' + id, barcodes: [tag], article: 'coat', warehouseId: 'external', createdAt, supplierStatus: 'confirm', wbStatus: 'waiting', supplyOpen: true, member: true })));
  const input = { clientId: client.id, connectionId: connection.id, warehouseId: warehouse.id, orderIds: ['11', '12'] };
  const choices = input.orderIds.map(orderId => ({ orderId, boxId: box.id }));
  return { prisma, service, connections, client, warehouse, sku, box, pallet, balance, user, input, choices, tag };
}

describe.skipIf(!url)('manual FBS real PostgreSQL transaction', () => {
  it('creates ordinary reserved tasks from two supplies without moving physical stock', async () => {
    const f = await fixture();
    await f.prisma.fbsTsdAssembly.createMany({ data: f.input.orderIds.map(orderId => ({
      clientId: f.client.id, connectionId: f.input.connectionId, marketplace: 'WILDBERRIES' as const, orderId,
      requestId: 'AUTO:' + orderId, requestItemId: 'AUTO:' + orderId, skuId: f.sku.id, productName: 'coat',
      barcodes: [f.tag], storageBoxes: [], deviceCode: 'AUTO:FBS', status: 'WAITING_STOCK', stockWarehouseId: 'different-branch',
    })) });
    const p = await f.service.preview(f.input, f.user);
    expect(p.rows.map(r => r.blockers)).toEqual([[], []]);
    const result = await f.service.create({ token: p.token!, choices: f.choices }, f.user);
    const request = await f.prisma.clientRequest.findUniqueOrThrow({ where: { id: result.request.id }, include: { items: true } });
    expect(request.items).toHaveLength(1);
    expect(request.items[0].quantity).toBe(2);
    expect(request.fbsEmergencyAssemblyAt).toBeNull();
    const tasks = await f.prisma.fbsTsdAssembly.findMany({ where: { requestId: request.id }, orderBy: { orderId: 'asc' } });
    expect(tasks.map(t => [t.status, t.reservedBoxId, t.supplyId])).toEqual([['RESERVED', f.box.id, 'WB-11'], ['RESERVED', f.box.id, 'WB-12']]);
    expect((await f.prisma.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(2);
    expect(await f.prisma.stockMovement.count({ where: { clientId: f.client.id } })).toBe(0);
    expect(await f.prisma.auditLog.count({ where: { entityId: request.id, action: 'FBS_MANUAL_ASSEMBLY_CREATED' } })).toBe(1);
    const route = await f.connections.getFbsRequestRoute(request.id, f.user);
    expect(JSON.stringify(route)).toContain(f.box.code);
    expect(JSON.stringify(route)).toContain(f.pallet.code);
  }, 30000);

  it('serializes double clicks and returns the committed request on retry', async () => {
    const f = await fixture(), p = await f.service.preview(f.input, f.user);
    const dto = { token: p.token!, choices: f.choices };
    const attempts = await Promise.allSettled([f.service.create(dto, f.user), f.service.create(dto, f.user)]);
    expect(attempts.some(a => a.status === 'fulfilled')).toBe(true);
    const retry = await f.service.create(dto, f.user);
    expect(retry.alreadyCreated).toBe(true);
    expect(await f.prisma.clientRequest.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await f.prisma.fbsOrderRequestLink.count({ where: { clientId: f.client.id } })).toBe(2);
  }, 30000);

  it('does not reserve the last units twice for competing order sets', async () => {
    const f = await fixture();
    const second = { ...f.input, orderIds: ['21', '22'] };
    const a = await f.service.preview(f.input, f.user), b = await f.service.preview(second, f.user);
    const outcomes = await Promise.allSettled([
      f.service.create({ token: a.token!, choices: f.choices }, f.user),
      f.service.create({ token: b.token!, choices: second.orderIds.map(orderId => ({ orderId, boxId: f.box.id })) }, f.user),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(await f.prisma.clientRequest.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await f.prisma.fbsTsdAssembly.count({ where: { clientId: f.client.id, status: 'RESERVED' } })).toBe(2);
  }, 30000);

  it('rechecks receipt restrictions inside the transaction', async () => {
    const f = await fixture(), p = await f.service.preview(f.input, f.user);
    await f.prisma.systemSetting.create({ data: { key: 'receipt.channels.v1:' + f.client.id + ':test', value: { id: 'test', clientId: f.client.id, warehouseId: f.warehouse.id, sourceDocument: `SERIES:${new Date().getUTCFullYear()}:${f.tag}`, fbs: false, fbo: true, protectedOrders: [], revision: 1, changedAt: new Date().toISOString() } } });
    await expect(f.service.create({ token: p.token!, choices: f.choices }, f.user)).rejects.toThrow('изменились');
    expect(await f.prisma.clientRequest.count({ where: { clientId: f.client.id } })).toBe(0);
  }, 30000);

  it('rolls back real writes if audit fails, and the same token remains usable', async () => {
    const f = await fixture(), p = await f.service.preview(f.input, f.user);
    const transact = f.prisma.$transaction.bind(f.prisma);
    const failingTransaction = (fn: any, options: any) => transact(async tx => {
      const wrapped = new Proxy(tx, { get(target, prop) {
        if (prop === 'auditLog') return { create: async () => { throw new Error('TEST audit unavailable'); } };
        return Reflect.get(target, prop);
      } });
      return fn(wrapped);
    }, options);
    const failingDb = new Proxy(f.prisma, { get(target, prop) {
      return prop === '$transaction' ? failingTransaction : Reflect.get(target, prop);
    } });
    const failingService = new FbsManualAssemblyService(failingDb as any, new ClientScopeService(), f.connections);
    vi.spyOn(failingService, 'readOrders').mockImplementation(f.service.readOrders);
    const dto = { token: p.token!, choices: f.choices };
    await expect(failingService.create(dto, f.user)).rejects.toThrow('TEST audit unavailable');
    expect(await f.prisma.clientRequest.count({ where: { clientId: f.client.id } })).toBe(0);
    expect(await f.prisma.fbsTsdAssembly.count({ where: { clientId: f.client.id } })).toBe(0);
    expect(await f.prisma.fbsOrderRequestLink.count({ where: { clientId: f.client.id } })).toBe(0);
    expect((await f.service.create(dto, f.user)).alreadyCreated).toBe(false);
  }, 30000);
});
