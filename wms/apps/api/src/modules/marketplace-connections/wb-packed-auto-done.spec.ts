import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWbPackedRequest } from './wb-packed-auto-done';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

const setup = () => {
  vi.stubEnv('WMS_WB_PACKED_AUTO_DONE_ENABLED', 'true');
  const tx: any = { client: { findUnique: vi.fn().mockResolvedValue({ isDemo: false }) },
    clientRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    clientRequestEvent: { create: vi.fn().mockResolvedValue({}) } };
  const request: any = { id: 'r', clientId: 'c', type: 'OUTBOUND', status: 'PACKED', updatedAt: new Date(),
    fbsEmergencyAssemblyAt: null, fbsOrderLinks: [{ marketplace: 'WILDBERRIES', connectionId: 'conn', orderId: '1', syncStatus: 'ACTIVE' }] };
  const orders = [{ id: '1', connectionId: 'conn', marketplace: 'WILDBERRIES', supplierStatus: 'complete', wbStatus: 'sorted' }];
  return { tx, request, orders };
};
afterEach(() => vi.unstubAllEnvs());
describe('packed WB acceptance', () => {
  // TEST: the real synchronizer exits before task/stock reconciliation and locks first.
  it('integrates with the existing sync transaction without invoking physical reconciliation', async () => {
    const { tx, request, orders } = setup();
    tx.$queryRaw = vi.fn().mockResolvedValue([]);
    tx.clientRequest.findUnique = vi.fn().mockResolvedValue(request);
    tx.fbsRepeatAssemblyRun = { findUnique: vi.fn().mockResolvedValue(null) };
    tx.fbsReshipmentRun = { findUnique: vi.fn().mockResolvedValue(null) };
    const service: any = Object.create(MarketplaceConnectionsService.prototype);
    service.prisma = { $transaction: (fn: any) => fn(tx) };
    const result = await service.syncOneFbsRequest('c', 'r', new Map([['conn:1', orders[0]]]), []);
    expect(result.changed).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.clientRequestEvent.create).toHaveBeenCalledTimes(1);
  });
  // TEST: no stock/task APIs exist on this transaction; closure must be status-only.
  it.each(['sorted', 'ready_for_pickup', 'sold'])('closes %s without stock writes', async status => {
    const { tx, request, orders } = setup(); orders[0].wbStatus = status;
    expect(await closeWbPackedRequest(tx, request, orders, false)).toBe(true);
    expect(tx.clientRequest.updateMany).toHaveBeenCalledWith({ where: {
      id: 'r', clientId: 'c', status: 'PACKED', updatedAt: request.updatedAt, fbsEmergencyAssemblyAt: null }, data: { status: 'DONE' } });
    expect(tx.clientRequestEvent.create).toHaveBeenCalledTimes(1);
  });
  it.each(['waiting', 'canceled', 'canceled_by_client', 'defect', 'unknown'])('does not close %s', async status => {
    const { tx, request, orders } = setup(); orders[0].wbStatus = status;
    expect(await closeWbPackedRequest(tx, request, orders, false)).toBe(false);
    expect(tx.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it.each(['flag', 'repeat', 'emergency', 'new', 'missing', 'mixed', 'moving', 'demo', 'duplicate', 'supplier'])('guards %s', async reason => {
    const { tx, request, orders } = setup();
    if (reason === 'flag') vi.stubEnv('WMS_WB_PACKED_AUTO_DONE_ENABLED', 'false');
    if (reason === 'emergency') request.fbsEmergencyAssemblyAt = new Date();
    if (reason === 'new') request.status = 'SUBMITTED';
    if (reason === 'missing') orders.splice(0);
    if (reason === 'mixed') request.fbsOrderLinks.push({ ...request.fbsOrderLinks[0], marketplace: 'OZON' });
    if (reason === 'moving') request.fbsOrderLinks[0].syncStatus = 'MOVING';
    if (reason === 'demo') tx.client.findUnique.mockResolvedValue({ isDemo: true });
    if (reason === 'duplicate') orders.push({ ...orders[0] });
    if (reason === 'supplier') orders[0].supplierStatus = 'confirm';
    expect(await closeWbPackedRequest(tx, request, orders, reason === 'repeat')).toBe(false);
    expect(tx.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not emit a duplicate event when the request changed concurrently', async () => {
    const { tx, request, orders } = setup(); tx.clientRequest.updateMany.mockResolvedValue({ count: 0 });
    expect(await closeWbPackedRequest(tx, request, orders, false)).toBe(false);
    expect(tx.clientRequestEvent.create).not.toHaveBeenCalled();
  });
});
