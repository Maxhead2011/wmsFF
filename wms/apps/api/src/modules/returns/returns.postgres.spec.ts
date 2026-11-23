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
  const kizCode = '010461046084052621' + randomUUID().replace(/-/g, '').slice(0, 13) + '\u001d91ABCD\u001d92testcrypto';
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
  // TEST: invalid/foreign scans leave the physically received return quarantined.
  it('rejects missing crypto, wrong box/product, damaged condition and foreign warehouse', async () => {
    const unit = await db.returnUnit.findFirstOrThrow({ where: { batchId } });
    const dto = { unitId: unit.id, boxCode: code, barcode: code, kiz: kizCode };
    await expect(service.mark(batchId, { ...dto, kiz: dto.kiz.split('\u001d')[0] }, actor)).rejects.toThrow('полный');
    await expect(service.mark(batchId, { ...dto, boxCode: 'other' }, actor)).rejects.toThrow('не совпадает');
    await expect(service.mark(batchId, { ...dto, barcode: 'other' }, actor)).rejects.toThrow('не совпадает');
    await expect(service.mark(batchId, dto, { ...actor, activeWarehouseId: 'other' })).rejects.toThrow();
    await db.returnUnit.update({ where: { id: unit.id }, data: { condition: 'DAMAGED' } });
    await expect(service.mark(batchId, dto, actor)).rejects.toThrow('нормальном состоянии');
    await db.returnUnit.update({ where: { id: unit.id }, data: { condition: 'NORMAL' } });
    expect(await db.stockBalance.count({ where: { clientId, status: 'AVAILABLE', quantity: { gt: 0 } } })).toBe(0);
  });
  // TEST: failure after the balance/mark writes rolls the complete release back.
  it('rolls back stock, mark and registry if the audit write fails', async () => {
    const unit = await db.returnUnit.findFirstOrThrow({ where: { batchId } });
    const faulty = new ReturnsService({ $transaction: (fn: any) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) { return key === 'auditLog' ? { create() { throw new Error('test audit failure'); } } : Reflect.get(target, key); } }))) } as never, new ClientScopeService());
    await expect(faulty.mark(batchId, { unitId: unit.id, boxCode: code, barcode: code, kiz: kizCode }, actor)).rejects.toThrow('test audit failure');
    expect(await db.productMark.count({ where: { clientId } })).toBe(0);
    expect(await db.stockMovement.count({ where: { clientId, type: 'MOVE' } })).toBe(0);
    expect(await db.kizClientRegistry.count({ where: { clientId } })).toBe(0);
    expect((await db.stockBalance.findFirstOrThrow({ where: { clientId } })).quantity).toBe(1);
  });
  it('releases one unit once under concurrency without another receipt, charge or storage start', async () => {
    const unit = await db.returnUnit.findFirstOrThrow({ where: { batchId } });
    const dto = { unitId: unit.id, boxCode: code, barcode: code, kiz: kizCode };
    await Promise.all([service.mark(batchId, dto, actor), service.mark(batchId, dto, actor)]);
    await service.mark(batchId, dto, actor);
    expect(await db.stockBalance.count({ where: { clientId, status: 'AVAILABLE', quantity: { gt: 0 } } })).toBe(0);
    expect(await db.productMark.count({ where: { clientId, status: 'QUARANTINE' } })).toBe(1);
    await Promise.all([service.closeBox(batchId, code, actor), service.closeBox(batchId, code, actor)]);
    await service.closeBox(batchId, code, actor);
    await service.finish(batchId, actor);
    expect(await db.stockMovement.count({ where: { clientId, type: 'RETURN' } })).toBe(1);
    expect(await db.stockMovement.count({ where: { clientId, type: 'MOVE' } })).toBe(1);
    expect(await db.billingCharge.count({ where: { clientId } })).toBe(1);
    expect(await db.productMark.count({ where: { clientId, status: 'AVAILABLE' } })).toBe(1);
    const balances = await db.stockBalance.findMany({ where: { clientId } });
    expect(balances.reduce((n, b) => n + b.quantity, 0)).toBe(1);
    expect(balances.find(b => b.status === 'QUARANTINE')?.quantity).toBe(0);
    expect(balances.find(b => b.status === 'AVAILABLE')?.quantity).toBe(1);
    const after = await db.returnUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(after.receivedAt).toEqual(unit.receivedAt); expect(after.releasedAt).not.toBeNull();
    expect((await db.kizClientRegistry.findFirstOrThrow({ where: { clientId } })).firstReceivedAt).toEqual(unit.receivedAt);
    await expect(service.mark(batchId, { ...dto, kiz: dto.kiz.replace(dto.kiz.slice(18, 31), 'BBBBBBBBBBBBB') }, actor)).rejects.toThrow('другим КИЗ');
    expect((await new StorageOverviewService(db as never, new ClientScopeService()).getOverview({ clientId }, actor)).totals.quantity).toBe(1);
  });
  it('does not reuse a KIZ on another return or accept a known other-size GTIN', async () => {
    const secondBatch = randomUUID(), secondBox = 'SECOND-' + randomUUID(), secondUnit = randomUUID();
    await db.box.create({ data: { code: secondBox, clientId, warehouseId } });
    await service.create({ id: secondBatch, clientId }, actor);
    await service.scan(secondBatch, { id: secondUnit, marketplace: 'OZON', returnCode: randomUUID(), barcode: code, boxCode: secondBox, condition: 'NORMAL' }, actor);
    await service.finish(secondBatch, actor);
    const dto = { unitId: secondUnit, boxCode: secondBox, barcode: code, kiz: kizCode };
    await expect(service.mark(secondBatch, dto, actor)).rejects.toThrow('уже использовался');
    const wrongSku = await db.sku.create({ data: { clientId, internalSku: 'WRONG-' + code, name: 'Other size' } });
    await db.productMark.create({ data: { clientId, skuId: wrongSku.id, value: '010461046084053321CCCCCCCCCCCCC\u001d91ABCD\u001d92testcrypto' } });
    await expect(service.mark(secondBatch, { ...dto, kiz: '010461046084053321DDDDDDDDDDDDD\u001d91ABCD\u001d92testcrypto' }, actor)).rejects.toThrow('другим товаром');
    expect((await db.returnUnit.findUniqueOrThrow({ where: { id: secondUnit } })).releasedAt).toBeNull();
  });
  // TEST: incomplete boxes cannot release; failure on closing rolls back the entire box.
  it('keeps partial marking quarantined and closes all units atomically', async () => {
    const id = randomUUID(), boxCode = 'PAIR-' + randomUUID(), ids = [randomUUID(), randomUUID()];
    const box = await db.box.create({ data: { code: boxCode, clientId, warehouseId } });
    await service.create({ id, clientId }, actor);
    for (const unitId of ids) await service.scan(id, { id: unitId, marketplace: 'OZON', returnCode: randomUUID(), barcode: code, boxCode, condition: 'NORMAL' }, actor);
    await service.finish(id, actor);
    const mark = (unitId: string) => service.mark(id, { unitId, boxCode, barcode: code, kiz: '010461046084052621' + randomUUID().replace(/-/g, '').slice(0, 13) + '\u001d91ABCD\u001d92testcrypto' }, actor);
    await mark(ids[0]);
    await expect(service.closeBox(id, boxCode, actor)).rejects.toThrow('всех единиц');
    expect(await db.stockBalance.count({ where: { boxId: box.id, status: 'AVAILABLE', quantity: { gt: 0 } } })).toBe(0);
    await mark(ids[1]);
    const faulty = new ReturnsService({ $transaction: (fn: any) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) { return key === 'auditLog' ? { create() { throw new Error('close failure'); } } : Reflect.get(target, key); } }))) } as never, new ClientScopeService());
    await expect(faulty.closeBox(id, boxCode, actor)).rejects.toThrow('close failure');
    expect(await db.returnUnit.count({ where: { batchId: id, releasedAt: { not: null } } })).toBe(0);
    expect(await db.productMark.count({ where: { boxId: box.id, status: 'QUARANTINE' } })).toBe(2);
    const chargesBefore = await db.billingCharge.count({ where: { clientId } });
    await Promise.all([service.closeBox(id, boxCode, actor), service.closeBox(id, boxCode, actor)]);
    expect((await db.stockBalance.findFirstOrThrow({ where: { boxId: box.id, status: 'AVAILABLE' } })).quantity).toBe(2);
    expect(await db.stockMovement.count({ where: { boxId: box.id, type: 'RETURN' } })).toBe(2);
    expect(await db.stockMovement.count({ where: { boxId: box.id, type: 'MOVE' } })).toBe(2);
    expect(await db.billingCharge.count({ where: { clientId } })).toBe(chargesBefore);
    expect((await service.findBox(clientId, boxCode, actor)).units.every(u => u.releasedAt)).toBe(true);
  });

  // TEST: a first return scan creates one client/warehouse box, retry creates no receipt/charge.
  it('creates a new box atomically with its first return scan and reuses it', async () => {
    const id = randomUUID(), boxCode = 'NEW-' + randomUUID(), unitId = randomUUID();
    await service.create({ id, clientId }, actor);
    const dto = { id: unitId, marketplace: 'OZON', returnCode: randomUUID(), barcode: code, boxCode, condition: 'NORMAL' };
    const charges = await db.billingCharge.count({ where: { clientId } });
    await Promise.all([service.scan(id, dto, actor), service.scan(id, dto, actor)]);
    const box = await db.box.findUniqueOrThrow({ where: { code: boxCode } });
    expect(box).toMatchObject({ clientId, warehouseId, status: 'active', palletId: null });
    expect(await db.box.count({ where: { code: boxCode } })).toBe(1);
    expect(await db.returnUnit.count({ where: { batchId: id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { boxId: box.id } })).toBe(0);
    expect(await db.billingCharge.count({ where: { clientId } })).toBe(charges);
    await service.scan(id, { ...dto, id: randomUUID(), returnCode: randomUUID() }, actor);
    await Promise.all([service.finish(id, actor), service.finish(id, actor)]);
    expect(await db.stockMovement.count({ where: { boxId: box.id, type: 'RETURN' } })).toBe(2);
    expect(await db.billingCharge.count({ where: { clientId } })).toBe(charges + 1);
  });
  // TEST: creation rolls back if saving the return fails; existing boxes keep their ownership.
  it('rolls back a new box on scan failure and rejects foreign or inactive boxes', async () => {
    const id = randomUUID(), boxCode = 'ROLLBACK-' + randomUUID();
    await service.create({ id, clientId }, actor);
    const dto = { id: randomUUID(), marketplace: 'OZON', returnCode: randomUUID(), barcode: code, boxCode, condition: 'NORMAL' };
    const faulty = new ReturnsService({ $transaction: (fn: any) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) { return key === 'returnUnit' ? new Proxy(target.returnUnit, { get(delegate, method) { return method === 'create' ? () => { throw new Error('scan failure'); } : Reflect.get(delegate, method); } }) : Reflect.get(target, key); } }))) } as never, new ClientScopeService());
    await expect(faulty.scan(id, dto, actor)).rejects.toThrow('scan failure');
    expect(await db.box.count({ where: { code: boxCode } })).toBe(0);
    const foreign = await db.client.create({ data: { code: randomUUID(), name: 'Foreign' } });
    for (const data of [{clientId: foreign.id, warehouseId}, {clientId, warehouseId: null}, {clientId, warehouseId, status: 'closed'}]) {
      const box = await db.box.create({ data: { ...data, code: randomUUID() } });
      await expect(service.scan(id, { ...dto, boxCode: box.code }, actor)).rejects.toThrow('действующий короб');
      expect(await db.box.findUnique({ where: { id: box.id } })).toEqual(box);
    }
  });

  // TEST: two employees cannot claim the same new box for different batches.
  it('serializes concurrent creation of the same box across batches', async () => {
    const ids = [randomUUID(), randomUUID()], boxCode = 'RACE-' + randomUUID();
    for (const id of ids) await service.create({ id, clientId }, actor);
    const result = await Promise.allSettled(ids.map(id => service.scan(id, { id: randomUUID(), marketplace: 'OZON', returnCode: randomUUID(), barcode: code, boxCode, condition: 'NORMAL' }, actor)));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await db.box.count({ where: { code: boxCode } })).toBe(1);
    expect(await db.returnUnit.count({ where: { boxCode } })).toBe(1);
  });

});
