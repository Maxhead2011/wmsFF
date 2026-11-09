import 'reflect-metadata';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FabricCatalogController } from './fabric-catalog.controller';
import type { AuthUser } from '../auth/auth.types';

// TEST: public endpoints retain client/branch permissions and never reinterpret existing fabric stock.
describe('fabric catalog endpoints', () => {
  const user = { id: 'admin', isDemo: false, activeWarehouseId: 'moscow', roleCodes: ['ADMIN'], permissionCodes: ['stock:read', 'stock:write'] } as AuthUser;
  let db: any, service: FabricCatalogController, sku: any;
  beforeEach(() => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true');
    sku = { id: 'sku', clientId: 'client', name: 'Ткань пудровая 5м', internalSku: 'offer', marketplaceOfferId: 'offer', marketplacePayload: { offer: 1 } };
    db = { warehouseClient: { findFirst: vi.fn().mockResolvedValue({}) }, systemSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() }, sku: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.id === 'sku' && where.clientId === 'client' ? sku : null)), update: vi.fn() }, stockBalance: { findFirst: vi.fn().mockResolvedValue(null) }, marketplaceProductLink: { findFirst: vi.fn().mockResolvedValue(null) }, auditLog: { create: vi.fn() }, $executeRawUnsafe: vi.fn(), $transaction: (fn: any) => fn(db) };
    service = new FabricCatalogController(db, { requireClientAccess: vi.fn() } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('creates a color before a marketplace card exists', async () => {
    const result = await service.save('client', { action: 'CREATE_COLOR', material: 'SATIN', name: 'Пудровый', version: null }, user);
    expect(result.result).toMatchObject({ color: { material: 'SATIN', name: 'Пудровый' } });
    expect(db.sku.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });
  it('rejects stale catalog versions before any writes', async () => {
    db.systemSetting.findUnique.mockResolvedValue({ updatedAt: new Date('2026-11-09'), value: {} });
    await expect(service.save('client', { action: 'CREATE_COLOR', material: 'SATIN', name: 'Пудровый', version: null }, user)).rejects.toThrow('Каталог изменился');
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('binds a marketplace card with exact cut length, preserving marketplace fields', async () => {
    await service.save('client', { action: 'BIND_SKU', material: 'SATIN', colorId: 'black', skuId: 'sku', lengthMm: 5000, version: null }, user);
    expect(db.sku.update).toHaveBeenCalledWith(expect.objectContaining({ data: { marketplacePayload: { offer: 1, fabricRollBinding: expect.objectContaining({ lengthMm: 5000, color: 'black' }) } } }));
  });
  it('rejects another client SKU and existing physical stock', async () => {
    await expect(service.save('other', { action: 'BIND_SKU', material: 'SATIN', colorId: 'black', skuId: 'sku', lengthMm: 5000, version: null }, user)).rejects.toThrow('не найден');
    db.stockBalance.findFirst.mockResolvedValue({ quantity: 1 });
    await expect(service.save('client', { action: 'BIND_SKU', material: 'SATIN', colorId: 'black', skuId: 'sku', lengthMm: 5000, version: null }, user)).rejects.toThrow('уже есть складской остаток');
    expect(db.sku.update).not.toHaveBeenCalled();
  });
  it('does not change material or metres for an already bound SKU', async () => {
    sku.internalSku = 'black_5';
    await expect(service.save('client', { action: 'BIND_SKU', material: 'SATIN', colorId: 'white', skuId: 'sku', lengthMm: 10000, version: null }, user)).rejects.toThrow('привязку ткани менять нельзя');
    expect(db.sku.update).not.toHaveBeenCalled();
  });
  it('rejects writes by clients, missing branch membership, and disabled installations', async () => {
    const body = { action: 'CREATE_COLOR', material: 'SATIN', name: 'Пудровый', version: null };
    await expect(service.save('client', body, { ...user, roleCodes: ['CLIENT'] })).rejects.toThrow();
    db.warehouseClient.findFirst.mockResolvedValue(null);
    await expect(service.save('client', body, user)).rejects.toThrow('не подключён');
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false');
    await expect(service.get('client', user)).rejects.toThrow();
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
