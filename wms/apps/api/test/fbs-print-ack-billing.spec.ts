import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { finalizeWbOrderShipment } from '../src/common/stock/wb-order-stock-lifecycle';

vi.mock('../src/common/stock/wb-order-stock-lifecycle', async (original) => ({
  ...await original<object>(), finalizeWbOrderShipment: vi.fn(async () => ({ id: 'shipment' })),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });

function fixture() {
  const job = { id: 'job', assemblyId: 'task', status: 'PRINTED', printedAt: new Date(), deviceCode: 'SOS-WB:1609' };
  const tx = { fbsPrintBillingOutbox: { upsert: vi.fn(async () => ({})) } };
  const db: any = {
    fbsPrintJob: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(async () => job), update: vi.fn(async () => job) },
    auditLog: { create: vi.fn() },
    fbsTsdAssembly: { findUniqueOrThrow: vi.fn(async () => ({ id: 'task', marketplace: 'WILDBERRIES', clientId: 'client' })) },
    $transaction: vi.fn(async (cb) => cb(tx)),
  };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  service.localShipmentOrder = vi.fn(async () => ({ id: 'order' }));
  service.ensureFbsProcessingCharges = vi.fn(async () => new Map());
  return { db, tx, job, service };
}

describe('print ACK billing isolation', () => {
  // TEST: the old path waits for whole-client billing before letting the agent claim another label.
  it('commits shipment and durable billing request without running billing in the ACK', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const { service, tx, job } = fixture();
    expect(await service.finishFbsPrintJob('job', true, null, { id: 'user' })).toBe(job);
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
    expect(finalizeWbOrderShipment).toHaveBeenCalledWith(tx, 'task', 'PRINT_CONFIRMED', { id: 'order' }, job.printedAt);
    expect(tx.fbsPrintBillingOutbox.upsert).toHaveBeenCalled();
  });
  it('fails ACK if the durable enqueue fails rather than losing billing work', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const { service, tx } = fixture();
    tx.fbsPrintBillingOutbox.upsert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.finishFbsPrintJob('job', true, null, { id: 'user' })).rejects.toThrow('database unavailable');
  });
  it.each([['false', true], ['true', false]])('does not enqueue for rollout=%s success=%s', async (flag, success) => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', flag as string);
    const { service, tx, db } = fixture();
    await service.finishFbsPrintJob('job', success, null, { id: 'user' });
    expect(tx.fbsPrintBillingOutbox.upsert).not.toHaveBeenCalled();
    expect(finalizeWbOrderShipment).not.toHaveBeenCalled();
    if (flag === 'false') expect(db.fbsPrintJob.update).toHaveBeenCalled();
  });
  // TEST: legacy/sold startup must not require the new table or poll it.
  it.each(['false', 'true'])('starts and stops queue polling only for enabled rollout=%s', async flag => {
    vi.useFakeTimers();
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', flag);
    const { service, db } = fixture();
    db.fbsPrintBillingOutbox = { findFirst: vi.fn(async () => null) };
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.fbsPrintBillingOutbox.findFirst).toHaveBeenCalledTimes(flag === 'true' ? 1 : 0);
    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.fbsPrintBillingOutbox.findFirst).toHaveBeenCalledTimes(flag === 'true' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
