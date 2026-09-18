import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceStockControlService } from '../src/modules/marketplace-connections/marketplace-stock-control.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
const admin: any = { id: 'a', name: 'Admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const settings = new Map<string, any>();
  const db: any = { systemSetting: {
    findMany: vi.fn(async ({ where }) => [...settings].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, row]) => ({ key, ...row }))),
    findUnique: vi.fn(async ({ where }) => settings.get(where.key) ?? null),
    upsert: vi.fn(async ({ where, update }) => { const row = { value: update.value, updatedAt: new Date() }; settings.set(where.key, row); return row; }),
  }, sku: { findFirst: vi.fn(async ({ where }) => where.clientId === 'c' && where.id === 's' ? { id: 's' } : null) }, client: { findUnique: vi.fn(async () => ({ id: 'c' })) }, auditLog: { create: vi.fn(async () => ({})) }, $executeRaw: vi.fn(async () => 1) };
  db.$transaction = async (f: any) => f(db);
  return { service: new MarketplaceStockControlService(db, new ClientScopeService()), db, settings };
}
// TEST: sold/default installation must never load or apply the new reserve.
it('preserves the legacy default and fails closed for malformed enabled settings', async () => {
  const { service, db, settings } = setup();
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'false');
  expect(await service.reserve('c')).toEqual({ mode: 'NONE', value: 0 });
  expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  settings.set('marketplace.wbReserve.client.c', { value: { mode: 'PERCENT', value: 101 } });
  await expect(service.reserve('c')).rejects.toThrow();
});
it('audits a reserve without enabling publication and rejects stale tabs', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  const { service, settings, db } = setup();
  settings.set('marketplace.stockControl.client.c', { value: false });
  await service.updateReserve('c', { reserve: { mode: 'UNITS', value: 3 }, expectedUpdatedAt: null }, admin);
  expect(await service.reserve('c')).toEqual({ mode: 'UNITS', value: 3 });
  expect(await service.isEnabled('c')).toBe(false);
  expect(await service.reserve('other')).toEqual({ mode: 'NONE', value: 0 });
  expect(db.auditLog.create).toHaveBeenCalledOnce();
  await expect(service.updateReserve('c', { reserve: { mode: 'NONE', value: 0 }, expectedUpdatedAt: null }, admin)).rejects.toThrow('уже изменён');
});
it('rejects client, demo, missing version and out-of-scope writes', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  const { service, db } = setup();
  const body = { reserve: { mode: 'UNITS', value: 3 }, expectedUpdatedAt: null };
  for (const user of [{ ...admin, roleCodes: ['CLIENT'] }, { ...admin, isDemo: true }, { ...admin, hiddenClientIds: ['c'] }]) await expect(service.updateReserve('c', body, user)).rejects.toThrow();
  await expect(service.updateReserve('c', { reserve: body.reserve }, admin)).rejects.toThrow('версию');
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
});
// TEST: per-product rules are scoped, audited and versioned, without changing the gate.
it('saves product exclusions and recommendation limits with optimistic concurrency', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  const { service, settings, db } = setup();
  settings.set('marketplace.stockControl.client.c', { value: false });
  const body = { reserve: { mode: 'PERCENT', value: 25 }, blocked: true, expectedUpdatedAt: null };
  await service.updateFineRule('c', 's', body, admin);
  expect((await service.skuRules('c')).get('s')).toMatchObject({ reserve: body.reserve, blocked: true });
  expect((await service.skuRules('other')).size).toBe(0);
  await expect(service.updateFineRule('c', 's', body, admin)).rejects.toThrow('уже изменена');
  await service.updateFineRule('c', null, { maxShareChange: 7, expectedUpdatedAt: null }, admin);
  expect(await service.analysisSettings('c')).toMatchObject({ maxShareChange: 7 });
  expect(await service.isEnabled('c')).toBe(false);
  expect(db.auditLog.create).toHaveBeenCalledTimes(2);
});
it('rejects foreign SKU, invalid step, client and demo fine-settings writes', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  const { service, db } = setup();
  const body = { reserve: null, blocked: false, expectedUpdatedAt: null };
  await expect(service.updateFineRule('other', 's', body, admin)).rejects.toThrow('не найден');
  for (const step of [-1, 101, 1.5, '10']) await expect(service.updateFineRule('c', null, { maxShareChange: step, expectedUpdatedAt: null }, admin)).rejects.toThrow('Шаг');
  for (const user of [{ ...admin, roleCodes: ['CLIENT'] }, { ...admin, isDemo: true }]) await expect(service.updateFineRule('c', 's', body, user)).rejects.toThrow();
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
});
