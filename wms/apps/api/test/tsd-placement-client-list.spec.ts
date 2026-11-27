import { describe, expect, it, vi } from 'vitest';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';

// TEST: both the client and its membership in the selected warehouse must be active.
describe('pallet placement clients', () => {
  function fixture() {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = Object.assign(Object.create(TsdDeviceService.prototype), {
      prisma: { client: { findMany } }, touchActiveDevice: vi.fn(),
      clientScopes: { resolveClientFilter: () => ({ in: ['allowed'] }) },
    });
    return { service, findMany };
  }
  it('intersects account scope with an active membership and an ACTIVE client', async () => {
    const { service, findMany } = fixture();
    await service.listClientsForDevice({ activeWarehouseId: 'selected' }, true);
    expect(findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['allowed'] }, status: 'ACTIVE', isDemo: false,
      warehouseLinks: { some: { warehouseId: 'selected', status: 'ACTIVE' } },
    });
  });
  it('returns an empty placement list when no warehouse is selected', async () => {
    const { service, findMany } = fixture();
    expect(await service.listClientsForDevice({}, true)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
