import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { MarketplaceConnectionsController } from '../src/modules/marketplace-connections/marketplace-connections.controller';
// TEST: the HTTP adapter never changes operational calls to asynchronous snapshots implicitly.
it('opts in to display semantics without altering old URLs or user context', async () => {
  const service: any = { listFbsOrders: vi.fn(async () => ({ source: 'live' })),
    listFbsOrdersForDisplay: vi.fn(async () => ({ source: 'display' })), listFbsActiveClients: vi.fn() };
  const controller = new MarketplaceConnectionsController(service, {} as any, {} as any, {} as any, {} as any, {} as any);
  const user: any = { id: 'qa' };
  expect(await controller.listFbsOrders(user, 'client', '1')).toMatchObject({ source: 'live' });
  expect(service.listFbsOrders).toHaveBeenCalledWith('client', user, true);
  expect(await controller.listFbsOrders(user, 'client', '1', 'snapshot')).toMatchObject({ source: 'display' });
  expect(service.listFbsOrdersForDisplay).toHaveBeenCalledWith('client', user, true);
  controller.listFbsActiveClients(user, 'WILDBERRIES', 'snapshot');
  expect(service.listFbsActiveClients).toHaveBeenCalledWith(user, 'WILDBERRIES', true);
  expect(Reflect.getMetadata('path', MarketplaceConnectionsController.prototype.listFbsOrders)).toBe('fbs/orders');
  expect(Reflect.getMetadata('requiredPermissions', MarketplaceConnectionsController)).toEqual(['clients:read']);
});
