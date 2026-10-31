import { afterEach, expect, it, vi } from 'vitest';
import { ClientKizPolicyService } from '../src/modules/clients/client-kiz-policy.service';
afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const db = { client: { findFirst: vi.fn().mockResolvedValue({ id: 'c' }) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    sku: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) }, auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(db)) };
  const scopes = { requireClientAccess: vi.fn() };
  return { db, scopes, service: new ClientKizPolicyService(db as any, scopes as any), user: { id: 'u' } as any };
}
it('saves one client rule and updates only its card marking flags with an audit', async () => {
  // TEST: client setting must not modify shared stock or another client.
  const { db, scopes, service, user } = setup();
  expect(await service.save('c', true, user)).toEqual({ clientId: 'c', required: true });
  expect(scopes.requireClientAccess).toHaveBeenCalledWith(user, 'c', 'write');
  expect(db.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'client.receipt-kiz-required.v1:c' } }));
  expect(db.sku.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'c' }), data: { needsChestnyZnak: true, isUnmarked: false } }));
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'u', payload: expect.objectContaining({ stockChanged: false }) }) }));
});
it('disabling does not silently unmark previously marked goods', async () => {
  // TEST: disabling returns to per-SKU requirements.
  const { db, service, user } = setup();
  await service.save('c', false, user);
  expect(db.sku.updateMany).not.toHaveBeenCalled();
});
it('rejects missing permissions, invalid values and disabled installations before writing', async () => {
  const { db, service, scopes, user } = setup();
  await expect(service.save('c', 'false', user)).rejects.toThrow();
  scopes.requireClientAccess.mockImplementation(() => { throw Error('forbidden'); });
  await expect(service.save('other', true, user)).rejects.toThrow('forbidden');
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'false');
  await expect(service.save('c', true, user)).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
