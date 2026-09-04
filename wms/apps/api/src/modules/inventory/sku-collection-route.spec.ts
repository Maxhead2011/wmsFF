import { describe, expect, it, vi } from 'vitest';
import { SkuCollectionService } from './sku-collection.service';
import type { AuthUser } from '../auth/auth.types';

const user = { activeWarehouseId: 'moscow', permissionCodes: [], warehouseIds: ['moscow'] } as unknown as AuthUser;
const source = (box: string, pickedQuantity = 0) => ({
  id: box, sourceBoxId: box, sourceBoxCode: box, clientId: 'client', warehouseId: 'moscow',
  plannedQuantity: 3, pickedQuantity, receivedQuantity: 0,
});
const placement = (box: string, room: string, palletCode: string, warehouseId = 'moscow') => ({
  boxId: box, boxCode: box, palletId: palletCode,
  pallet: { id: palletCode, code: palletCode, clientId: 'client', warehouseId,
    zoneId: room, zone: { code: room, name: room } },
});
function fixture() {
  const request = { id: 'request', clientId: 'client', warehouseId: 'moscow',
    skuCollectionSources: [source('BOX-10'), source('BOX-2'), source('BOX-1', 3)] };
  const prisma = {
    clientRequest: { findFirst: vi.fn().mockResolvedValue(request), findMany: vi.fn().mockResolvedValue([request]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(request) },
    storagePalletBox: { findMany: vi.fn().mockResolvedValue([
      placement('BOX-10', 'Помещение 2', 'PALET_SORT_10'),
      placement('BOX-2', 'Помещение 1', 'PALET_SORT_2'),
    ]) },
  };
  const scopes = { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() };
  const service = new SkuCollectionService(prisma as never, scopes as never, {} as never);
  return { service, prisma, request };
}

describe('SKU collection current picking route', () => {
  it('returns room → pallet-sort → box, sorted geographically without changing pick counters', async () => {
    // TEST: previously only sourceBoxCode was returned, leaving the picker without an address.
    const { service, request } = fixture();
    const result = await service.get('request', user);
    expect(result.skuCollectionSources.map((item) => item.sourceBoxCode)).toEqual(['BOX-2', 'BOX-10', 'BOX-1']);
    expect(result.skuCollectionSources[0]).toMatchObject({ plannedQuantity: 3, pickedQuantity: 0,
      storageLocation: { zoneName: 'Помещение 1', palletCode: 'PALET_SORT_2' } });
    expect(result.skuCollectionSources[2]).toMatchObject({ pickedQuantity: 3, storageLocation: null });
    expect(request.skuCollectionSources[0].sourceBoxCode).toBe('BOX-10');
  });

  it('reads moved boxes again on the next response rather than caching the original pallet', async () => {
    // TEST: a moved box must not keep directing employees to its old pallet-sort.
    const { service, prisma } = fixture();
    await service.get('request', user);
    prisma.storagePalletBox.findMany.mockResolvedValue([placement('BOX-2', 'Помещение 3', 'PALET_SORT_38')]);
    const result = await service.get('request', user);
    expect(result.skuCollectionSources.find((item) => item.sourceBoxCode === 'BOX-2'))
      .toMatchObject({ storageLocation: { zoneName: 'Помещение 3', palletCode: 'PALET_SORT_38' } });
    expect(prisma.storagePalletBox.findMany).toHaveBeenCalledTimes(2);
  });

  it('scopes placements to the request client and warehouse, including legacy box-code links', async () => {
    // TEST: neither another branch nor a stale legacy pallet may supply the route.
    const { service, prisma } = fixture();
    prisma.storagePalletBox.findMany.mockResolvedValue([
      placement('BOX-2', 'Wrong room', 'WRONG', 'noginsk'),
      { ...placement('BOX-10', 'Помещение 4', 'PALET_SORT_40'), boxId: null } as never,
    ]);
    const result = await service.list(user);
    expect(result[0].skuCollectionSources.find((item) => item.sourceBoxCode === 'BOX-2')?.storageLocation).toBeNull();
    expect(result[0].skuCollectionSources.find((item) => item.sourceBoxCode === 'BOX-10')?.storageLocation?.palletCode).toBe('PALET_SORT_40');
    expect(prisma.storagePalletBox.findMany.mock.calls[0][0].where.OR[0].pallet)
      .toEqual({ warehouseId: 'moscow', clientId: 'client' });
  });

  it('hydrates the response after a scan using the same transaction', async () => {
    // TEST: subsequent picks must continue to show a route, not revert to box-only rows.
    const { service, prisma } = fixture();
    const result = await (service as any).summary(prisma, 'request');
    expect(result.skuCollectionSources[0].storageLocation.palletCode).toBe('PALET_SORT_2');
  });

  it('groups the same room and pallet with natural box-number ordering', async () => {
    // TEST: BOX-2 precedes BOX-10 and a room change starts a new route group.
    const { service, prisma } = fixture();
    prisma.storagePalletBox.findMany.mockResolvedValue([
      placement('BOX-10', 'Помещение 1', 'PALET_SORT_2'),
      placement('BOX-2', 'Помещение 1', 'PALET_SORT_2'),
      placement('BOX-1', 'Помещение 2', 'PALET_SORT_1'),
    ]);
    const result = await service.list(user);
    expect(result[0].skuCollectionSources.map((item) => item.sourceBoxCode)).toEqual(['BOX-2', 'BOX-10', 'BOX-1']);
    expect(prisma.storagePalletBox.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not use a box-code match explicitly linked to another box', async () => {
    // TEST: a reused old code cannot invent a location for a renamed source box.
    const { service, prisma } = fixture();
    prisma.storagePalletBox.findMany.mockResolvedValue([
      { ...placement('BOX-2', 'Wrong room', 'WRONG'), boxId: 'another-box' },
    ]);
    const result = await service.get('request', user);
    expect(result.skuCollectionSources.find((item) => item.sourceBoxCode === 'BOX-2')?.storageLocation).toBeNull();
  });

  it('does not query placements when no requests exist', async () => {
    // TEST: never turn an empty filter into an unrestricted warehouse query.
    const { service, prisma } = fixture();
    prisma.clientRequest.findMany.mockResolvedValue([]);
    expect(await service.list(user)).toEqual([]);
    expect(prisma.storagePalletBox.findMany).not.toHaveBeenCalled();
  });
});
