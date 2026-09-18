import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceStockControlService } from '../src/modules/marketplace-connections/marketplace-stock-control.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
const admin: any = { id: 'a', name: 'Admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const settings = new Map<string, any>();
  const db: any = { systemSetting: {
    findUnique: vi.fn(async ({ where }) => settings.get(where.key) ?? null),
    upsert: vi.fn(async ({ where, update }) => { const row = { value: update.value, updatedAt: new Date() }; settings.set(where.key, row); return row; }),
  }, client: { findUnique: vi.fn(async () => ({ id: 'c' })) }, auditLog: { create: vi.fn(async () => ({})) }, $executeRaw: vi.fn(async () => 1) };
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
