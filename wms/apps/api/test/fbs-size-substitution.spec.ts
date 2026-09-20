import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canSubstituteSize, preferredReplacements, replacementDistance, sizeRank, sizeSubstitutionEnabled } from '../src/modules/marketplace-connections/fbs-size-substitution';
import { approvedSizeRoutes } from '../src/modules/marketplace-connections/fbs-size-substitution-route';
import { FbsSizeSubstitutionService } from '../src/modules/marketplace-connections/fbs-size-substitution.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: nearest available sizes, explicit article mappings and access boundaries.
describe('size replacement policy', () => {
  afterEach(() => vi.unstubAllEnvs());
  const target = { id: 'target', article: 'Корея', clientSku: null, color: 'голубой', size: 'S / 42' };
  it('uses neighbour first and distant only when neighbours are unavailable', () => {
    expect(preferredReplacements([{ distance: 1, available: 1 }, { distance: 3, available: 8 }])).toEqual([{ distance: 1, available: 1 }]);
    expect(preferredReplacements([{ distance: 1, available: 0 }, { distance: 3, available: 8 }])).toEqual([{ distance: 3, available: 8 }]);
  });
  it('matches model and colour, supports approved relabel article but never an arbitrary article', () => {
    expect(replacementDistance(target, { ...target, id: 'source', size: 'XS / 40' })).toBe(1);
    expect(replacementDistance(target, { ...target, id: 'source', color: 'серый', size: 'XS / 40' })).toBeNull();
    const source = { ...target, id: 'source', article: 'Корея старая', size: 'XS / 40' };
    expect(replacementDistance(target, source)).toBeNull();
    expect(replacementDistance(target, source, [{ sourceArticle: source.article, targetArticle: target.article }])).toBe(1);
  });
  it('does not guess ranges and normalises alphabetic sizes', () => {
    expect(sizeRank('M-L')).toBeNull(); expect(sizeRank('XXL / 52')).toBe(sizeRank('2XL'));
    expect(sizeRank('40')).toBe(sizeRank('XS / 40'));
  });
  it('defaults off; neither manager nor demo administrator can create replacements', () => {
    vi.stubEnv('WMS_FBS_SIZE_SUBSTITUTION_ENABLED', ''); expect(sizeSubstitutionEnabled()).toBe(false);
    expect(canSubstituteSize({ roleCodes: ['MANAGER'] } as never)).toBe(false);
    expect(canSubstituteSize({ roleCodes: ['ADMIN'], isDemo: true } as never)).toBe(false);
    expect(canSubstituteSize({ roleCodes: ['OWNER'] } as never)).toBe(true);
  });
});

const url = process.env.SIZE_SUBSTITUTION_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_tests@127.0.0.1:55481/done_packing_tests') throw new Error('Dedicated local database required');
describe.skipIf(!url).sequential('size replacement PostgreSQL', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : {});
  beforeEach(() => vi.stubEnv('WMS_FBS_SIZE_SUBSTITUTION_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());
  async function fixture() {
    const clientId = randomUUID(), warehouseId = randomUUID(), orderId = String(Date.now()) + String(Math.floor(Math.random() * 10000));
    const user = await db.user.create({ data: { email: randomUUID() + '@test.invalid', name: 'Owner', passwordHash: 'test' } });
    await db.client.create({ data: { id: clientId, code: clientId, name: 'Size test' } });
    await db.warehouse.create({ data: { id: warehouseId, code: warehouseId, name: 'Size test' } });
    const product = (size: string) => db.sku.create({ data: { clientId, internalSku: randomUUID(), name: 'Корея', article: 'Корея', color: 'голубой', size,
      barcodes: { create: { value: randomUUID() } } } });
    const target = await product('S / 42'), source = await product('XS / 40');
    const box = await db.box.create({ data: { clientId, warehouseId, code: randomUUID() } });
    await db.storagePallet.create({ data: { clientId, warehouseId, code: randomUUID(), boxes: { create: { boxId: box.id, boxCode: box.code } } } });
    const balance = await db.stockBalance.create({ data: { clientId, warehouseId, skuId: source.id, boxId: box.id, status: 'AVAILABLE', quantity: 1, balanceKey: randomUUID() } });
    const request = await db.clientRequest.create({ data: { clientId, warehouseId, type: 'OUTBOUND', status: 'IN_WORK', title: 'Original', items: { create: { skuId: target.id, quantity: 1 } } }, include: { items: true } });
    const task = await db.fbsTsdAssembly.create({ data: { clientId, connectionId: randomUUID(), orderId, requestId: request.id, requestItemId: request.items[0].id,
      skuId: target.id, productName: target.name, barcodes: [], storageBoxes: [], stockWarehouseId: warehouseId, status: 'WAITING_STOCK', deviceCode: 'AUTO' } });
    await db.fbsOrderRequestLink.create({ data: { clientId, connectionId: task.connectionId, orderId, requestId: request.id, marketplace: 'WILDBERRIES' } });
    const connections = new MarketplaceConnectionsService(db as never, {} as never);
    const wb = vi.spyOn(connections, 'readRepeatAssemblyWbStatuses').mockResolvedValue(new Map([[orderId, { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    vi.spyOn(connections, 'invalidateRepeatAssemblyCache').mockImplementation(() => {});
    const service = new FbsSizeSubstitutionService(db as never, { requireClientAccess() {} } as never, connections);
    const actor = { ...user, roleCodes: ['OWNER'], activeWarehouseId: warehouseId, writableWarehouseIds: [warehouseId] } as never;
    const dto = { clientId, orderId };
    const preview = await service.preview(dto, actor);
    const create = { ...dto, taskId: task.id, sourceSkuId: source.id, previewToken: 'previewToken' in preview ? preview.previewToken! : '', confirmRelabel: true };
    return { db, service, actor, dto, create, source, target, task, request, balance, wb, connections, preview };
  }
  it('creates a single request without consuming stock, preserves approved source on TSD, and retries idempotently', async () => {
    const f = await fixture();
    const result = await f.service.create(f.create, f.actor);
    expect(await f.service.create(f.create, f.actor)).toEqual(result);
    const task = await db.fbsTsdAssembly.findUniqueOrThrow({ where: { id: f.task.id } });
    expect(task.sourceSkuId).toBe(f.source.id); expect(task.skuId).toBe(f.target.id); expect(task.relabelRequired).toBe(true);
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(1);
    expect(await db.stockMovement.count({ where: { clientId: f.dto.clientId } })).toBe(0);
    expect((await approvedSizeRoutes(db, [task])).has(task.id)).toBe(true);
    const source = await (f.connections as any).resolveDovoz1049TsdStockSource(task);
    expect(source.sourceSkuId).toBe(f.source.id); expect(source.storageBoxes[0].quantity).toBe(1);
    expect((await db.clientRequestItem.findUniqueOrThrow({ where: { id: f.task.requestItemId } })).quantity).toBe(0);
  });
  it('rejects stock lost since preview without creating a request', async () => {
    const f = await fixture();
    await db.stockBalance.update({ where: { id: f.balance.id }, data: { quantity: 0 } });
    await expect(f.service.create(f.create, f.actor)).rejects.toThrow('изменились');
    expect(await db.clientRequest.count({ where: { clientId: f.dto.clientId } })).toBe(1);
  });
  it('reserves the last unit for only one of two concurrent orders', async () => {
    const f = await fixture();
    const secondId = f.dto.orderId + '1';
    const second = await db.fbsTsdAssembly.create({ data: { ...f.task, id: randomUUID(), orderId: secondId } });
    await db.clientRequestItem.update({ where: { id: f.task.requestItemId }, data: { quantity: 2 } });
    await db.fbsOrderRequestLink.create({ data: { clientId: f.dto.clientId, connectionId: second.connectionId, orderId: secondId, requestId: f.request.id, marketplace: 'WILDBERRIES' } });
    f.wb.mockResolvedValue(new Map([f.dto.orderId, secondId].map(id => [id, { supplierStatus: 'confirm', wbStatus: 'waiting' }])));
    const next = await f.service.preview({ ...f.dto, orderId: secondId }, f.actor);
    const results = await Promise.allSettled([f.service.create(f.create, f.actor), f.service.create({ ...f.create, orderId: secondId, taskId: second.id,
      previewToken: 'previewToken' in next ? next.previewToken! : '' }, f.actor)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(await db.clientRequest.count({ where: { clientId: f.dto.clientId } })).toBe(2);
    expect((await db.stockBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).quantity).toBe(1);
  });
  it('enforces role and warehouse again on create, not just the screen', async () => {
    const f = await fixture();
    await expect(f.service.create(f.create, { ...(f.actor as any), roleCodes: ['MANAGER'] })).rejects.toThrow('администратору');
    await expect(f.service.create(f.create, { ...(f.actor as any), activeWarehouseId: randomUUID() })).rejects.toThrow('филиал');
    await expect(f.service.create({ ...f.create, confirmRelabel: false }, f.actor)).rejects.toThrow('Подтвердите');
  });
  it('rejects cancellation and a newly started physical pick', async () => {
    const f = await fixture();
    f.wb.mockResolvedValue(new Map([[f.dto.orderId, { supplierStatus: 'cancel', wbStatus: 'canceled' }]]));
    await expect(f.service.create(f.create, f.actor)).rejects.toThrow('WB');
    f.wb.mockResolvedValue(new Map([[f.dto.orderId, { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    await db.fbsTsdAssembly.update({ where: { id: f.task.id }, data: { status: 'IN_PROGRESS' } });
    await expect(f.service.create(f.create, f.actor)).rejects.toThrow('начали');
  });
  it('supports an unpicked delivery order like the original exceptions but blocks historical physical debit', async () => {
    const f = await fixture();
    f.wb.mockResolvedValue(new Map([[f.dto.orderId, { supplierStatus: 'complete', wbStatus: 'waiting' }]]));
    const preview = await f.service.preview(f.dto, f.actor);
    expect('warning' in preview && preview.warning).toContain('в доставке');
    await f.service.create(f.create, f.actor);
    const other = await fixture();
    await db.stockMovement.create({ data: { clientId: other.dto.clientId, warehouseId: other.task.stockWarehouseId!, skuId: other.target.id,
      status: 'AVAILABLE', type: 'PICK', quantity: -1, idempotencyKey: `fbs-sticker-pick:${other.task.id}:out`, sourceDocument: other.request.id } });
    await expect(other.service.create(other.create, other.actor)).rejects.toThrow('списание');
    expect(await db.clientRequest.count({ where: { clientId: other.dto.clientId } })).toBe(1);
  });
  it('does not retain approval after source/request changes or for a flag-off deployment', async () => {
    const f = await fixture(); await f.service.create(f.create, f.actor);
    const task = await db.fbsTsdAssembly.findUniqueOrThrow({ where: { id: f.task.id } });
    expect((await approvedSizeRoutes(db, [{ ...task, requestId: f.request.id }])).size).toBe(0);
    expect((await approvedSizeRoutes(db, [{ ...task, sourceSkuId: f.target.id }])).size).toBe(0);
    vi.stubEnv('WMS_FBS_SIZE_SUBSTITUTION_ENABLED', 'false');
    expect((await approvedSizeRoutes(db, [task])).size).toBe(0);
    await expect(f.service.create(f.create, f.actor)).rejects.toThrow('администратору');
  });
});
