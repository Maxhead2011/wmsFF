import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReturnsService } from './returns.service';
import { StorageOverviewService } from '../stock/storage-overview.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

const url = process.env.RETURNS_TEST_DATABASE_URL;
// TEST: dedicated disposable database only; never fall back to DATABASE_URL.
describe.skipIf(!url)('returns PostgreSQL concurrency', () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused@127.0.0.1:1/unused' } } });
  const clientId = randomUUID(), warehouseId = randomUUID(), userId = randomUUID(), skuId = randomUUID(), boxId = randomUUID();
  const batchId = randomUUID(), code = `RETURN-${randomUUID()}`;
  const actor = { id: userId, name: 'Return test', roleCodes: ['WORKER'], permissionCodes: ['stock:read', 'stock:write'], activeWarehouseId: warehouseId,
    warehouseIds: [warehouseId], writableWarehouseIds: [warehouseId], clientScopeMode: 'LIMITED', clientIds: [clientId], writableClientIds: [clientId] } as AuthUser;
  const service = new ReturnsService(db as never, new ClientScopeService());
  beforeAll(async () => {
    if (!url?.includes('127.0.0.1:55462/')) throw new Error('Use isolated returns test PostgreSQL on port 55462');
    vi.stubEnv('WMS_RETURNS_PROCESSING_ENABLED', 'true');
    await db.warehouse.create({ data: { id: warehouseId, code, name: 'Test' } });
    await db.client.create({ data: { id: clientId, code, name: 'Return test' } });
    await db.user.create({ data: { id: userId, email: `${userId}@test.invalid`, name: 'Return test', passwordHash: 'not-a-login' } });
    await db.sku.create({ data: { id: skuId, clientId, internalSku: code, name: 'Suit XL', needsChestnyZnak: true, volumeLiters: 2, barcodes: { create: { value: code } } } });
    await db.box.create({ data: { id: boxId, clientId, warehouseId, code } });
    await service.create({ id: batchId, clientId }, actor);
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  it('accepts one scan once and one completion under concurrent requests', async () => {
    const scan = { id: randomUUID(), marketplace: 'WILDBERRIES', returnCode: 'wb-' + code, barcode: code, boxCode: code, condition: 'NORMAL' };
    await Promise.all([service.scan(batchId, scan, actor), service.scan(batchId, scan, actor)]);
    expect(await db.returnUnit.count({ where: { batchId } })).toBe(1);
    await Promise.all([service.finish(batchId, actor), service.finish(batchId, actor), service.finish(batchId, actor)]);
    const balances = await db.stockBalance.findMany({ where: { clientId } });
    expect(balances).toHaveLength(1); expect(balances[0]).toMatchObject({ status: 'QUARANTINE', quantity: 1 });
    expect(await db.stockBalance.count({ where: { clientId, status: 'AVAILABLE', quantity: { gt: 0 } } })).toBe(0);
    expect(await db.stockMovement.count({ where: { clientId, type: 'RETURN' } })).toBe(1);
    expect(await db.billingCharge.count({ where: { clientId } })).toBe(1);
    expect(await db.productMark.count({ where: { clientId } })).toBe(0);
    const charge = await db.billingCharge.findFirstOrThrow({ where: { clientId } });
    expect(charge.metadata).toMatchObject({ pricingStatus: 'PRICE_REVIEW' });
  });
  it('shows quarantined units in storage without exposing available stock', async () => {
    await db.client.update({ where: { id: clientId }, data: { storageAccountingEnabled: true, storagePriceRubPerLiterDay: 1 } });
    const overview = new StorageOverviewService(db as never, new ClientScopeService());
    const result = await overview.getOverview({ clientId }, actor);
    expect(result.totals.quantity).toBe(1);
    expect(result.rows[0].boxCodes).toContain(code);
  });
  it('exports actual box and barcode as strings', async () => {
    const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(await service.export(batchId, actor) as never);
    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe(code);
    expect(workbook.worksheets[0].getRow(2).getCell(2).value).toBe(code);
  });
});
