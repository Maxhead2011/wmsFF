import { afterEach, expect, it, vi } from 'vitest';
import { ClientsService } from '../src/modules/clients/clients.service';
afterEach(() => vi.unstubAllEnvs());

// TEST: list view must be independent of working branch and keep client access scopes.
it('filters clients by the display branch and removes the branch filter for global show-all', async () => {
  vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new ClientsService({ client: { findMany } } as never, { resolveClientFilter: () => ({ in: ['client'] }) } as never);
  const user = { activeWarehouseId: 'msk', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'] } as never;
  await service.list(user, false, { displayWarehouseId: 'ng' });
  expect(findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['client'] }, warehouseLinks: { some: { warehouseId: 'ng', status: 'ACTIVE' } } });
  await service.list(user, false, { allBranches: true });
  expect(findMany.mock.calls[1][0].where).not.toHaveProperty('warehouseLinks');
  expect(findMany.mock.calls[1][0].where.id).toEqual({ in: ['client'] });
  expect(user).toHaveProperty('activeWarehouseId', 'msk');
});

it('rejects an inaccessible display branch and scopes show-all for a manager', async () => {
  vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new ClientsService({ client: { findMany } } as never, { resolveClientFilter: () => undefined } as never);
  const user = { activeWarehouseId: 'msk', roleCodes: ['MANAGER'], permissionCodes: [], warehouseIds: ['msk'] } as never;
  expect(() => service.list(user, false, { displayWarehouseId: 'ng' })).toThrow();
  expect(findMany).not.toHaveBeenCalled();
  await service.list(user, false, { allBranches: true });
  expect(findMany.mock.calls[0][0].where.warehouseLinks.some.warehouseId).toEqual({ in: ['msk'] });
});

it('preserves ordinary client listing when no display view is provided or the flag is off', async () => {
  vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'false');
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new ClientsService({ client: { findMany } } as never, { resolveClientFilter: () => undefined } as never);
  await service.list({ activeWarehouseId: 'msk', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'] } as never, false, { displayWarehouseId: 'ng' });
  expect(findMany.mock.calls[0][0].where.warehouseLinks.some.warehouseId).toBe('msk');
});
