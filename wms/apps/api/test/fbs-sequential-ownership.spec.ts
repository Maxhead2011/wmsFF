import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: real queue code must use this picker/device's completed order, not another picker's last scan.
it.each(['true', 'false'])('scopes the previous physical location when enabled=%s', async enabled => {
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', enabled);
  const findFirst = vi.fn().mockResolvedValue(null);
  const service = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = { fbsTsdAssembly: { findFirst }, clientRequest: { findUnique: vi.fn().mockResolvedValue(null) } };
  await expect(service.getNextFbsTsdAssemblyUnlocked('device-A', { id: 'picker-A' }, 'request-A'))
    .rejects.toThrow('FBS-заявка не найдена');
  const call = findFirst.mock.calls.find(([arg]) => arg.where.status === 'COMPLETED');
  expect(call?.[0].where).toEqual(enabled === 'true'
    ? { status: 'COMPLETED', requestId: 'request-A', deviceCode: 'device-A', workerUserId: 'picker-A' }
    : { status: 'COMPLETED', requestId: 'request-A' });
});
it('restores the completed quantity with client, request, box and picker scope', async () => {
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'true');
  const aggregate = vi.fn().mockResolvedValue({ _sum: { itemCount: 3 } });
  const service = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = { fbsTsdAssembly: { aggregate }, stockBalance: { findMany: vi.fn().mockResolvedValue([]) } };
  const usage = await service.fbsTsdSourceBoxUsage({ boxId: 'box', boxCode: 'A', clientId: 'client',
    requestId: 'request', workerUserId: 'picker' });
  expect(usage).toMatchObject({ pickedUnits: 3, units: 0 });
  expect(aggregate).toHaveBeenCalledWith({ where: { boxId: 'box', clientId: 'client', requestId: 'request',
    workerUserId: 'picker', status: 'COMPLETED' }, _sum: { itemCount: true } });
});
