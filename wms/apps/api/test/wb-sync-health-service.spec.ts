import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WbSyncHealthService } from '../src/modules/marketplace-connections/wb-sync-health.service';

function setup() {
  const settings = new Map<string, any>();
  const db: any = {
    $executeRaw: vi.fn(),
    systemSetting: { findUnique: vi.fn(async ({ where }: any) => settings.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => { const row = { ...(settings.get(where.key) ?? create), ...update }; settings.set(where.key, structuredClone(row)); return row; }) },
    clientMarketplaceConnection: { count: vi.fn(async () => 1), findMany: vi.fn(async () => [{ id: 'connection', clientId: 'client', fbsExecutionWarehouseId: 'branch' }]) },
    wbStockPublicationCheck: { findMany: vi.fn(async () => []) },
    client: { findUnique: vi.fn(async () => ({ name: 'Client', isDemo: false })), findMany: vi.fn(async () => [{ id: 'client', name: 'Client' }]) },
    adminNotification: { upsert: vi.fn() },
  };
  db.$transaction = vi.fn((fn: any) => fn(db));
  const scopes: any = { resolveClientFilter: vi.fn(() => ({ in: ['client'] })) };
  const control: any = { isEnabled: vi.fn(async () => true) };
  return { service: new WbSyncHealthService(db, scopes, control), db, settings, control };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('durable WB health observer', () => {
  // TEST: sold VM with disabled feature gets no writes or background reads.
  it('does nothing with the feature off', async () => {
    vi.stubEnv('WMS_WB_SYNC_HEALTH_ENABLED', 'false');
    const { service, db } = setup();
    expect(await service.begin('client')).toBeUndefined();
    await service.tick();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
  });
  // TEST: swallowed stock failure cannot be presented as successful order refresh.
  it('persists failed evidence and updates the same incident', async () => {
    vi.stubEnv('WMS_WB_SYNC_HEALTH_ENABLED', 'true');
    const { service, db, settings } = setup();
    for (let i = 0; i < 2; i++) {
      const cycle = (await service.begin('client'))!;
      cycle.orders = cycle.billing = 'Завершено';
      await service.finish('client', cycle);
    }
    const state = settings.get('monitor.wbSync.client').value;
    expect(state.cycles).toHaveLength(2);
    expect(state.failures).toBe(2);
    expect(state.lastSuccessAt).toBeNull();
    expect(db.adminNotification.upsert.mock.calls[0][0].where).toEqual(db.adminNotification.upsert.mock.calls[1][0].where);
  });
  // TEST: observer database outage never aborts the production refresh.
  it('isolates observer failures', async () => {
    vi.stubEnv('WMS_WB_SYNC_HEALTH_ENABLED', 'true');
    const { service, db } = setup();
    db.$transaction.mockRejectedValue(new Error('db unavailable'));
    await expect(service.begin('client')).resolves.toBeUndefined();
  });
  // TEST: a restart and no completion becomes an incident after the hourly deadline.
  it('detects missing completion without counting every timer tick as another cycle', async () => {
    vi.stubEnv('WMS_WB_SYNC_HEALTH_ENABLED', 'true');
    vi.useFakeTimers();
    const { service, settings } = setup();
    await service.begin('client');
    vi.advanceTimersByTime(3_600_001);
    await service.tick();
    expect(settings.get('monitor.wbSync.client').value.failures).toBe(1);
    vi.advanceTimersByTime(120_000);
    await service.tick();
    expect(settings.get('monitor.wbSync.client').value.failures).toBe(1);
  });
  // TEST: customer role cannot read internal cycle or billing diagnostics.
  it('rejects customer access', async () => {
    const { service } = setup();
    await expect(service.list({ roleCodes: ['CLIENT'], permissionCodes: [] } as any)).rejects.toThrow('Только для администратора');
  });
  // TEST: a fresh fully confirmed cycle closes the incident and restores hourly checks.
  it('recovers only on fresh matching proofs and completed billing', async () => {
    vi.stubEnv('WMS_WB_SYNC_HEALTH_ENABLED', 'true');
    const { service, db, settings } = setup();
    await service.finish('client', await service.begin('client'));
    const cycle = (await service.begin('client'))!;
    cycle.orders = cycle.billing = 'Завершено';
    db.wbStockPublicationCheck.findMany.mockResolvedValue([{ runId: 'new', status: 'CONFIRMED', phase: 'CHECK', calculatedAmount: 5, observedAmount: 5, updatedAt: new Date() }]);
    await service.finish('client', cycle);
    expect(settings.get('monitor.wbSync.client').value).toMatchObject({ incidentAt: null, failures: 0, lastSuccessAt: cycle.finishedAt });
  });
});
