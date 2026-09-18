import { expect, it, vi } from 'vitest';
import { WbStockObservations } from '../src/modules/marketplace-connections/wb-stock-observations';

// TEST: an occupied cross-process lock must stop before the first publication callback.
it('rejects an occupied account and keeps nested calls within the same lock', async () => {
  const tx = { $queryRaw: vi.fn(async () => [{ acquired: false }]) };
  const db: any = { $transaction: vi.fn(async (f: any) => f(tx)) };
  const obs = new WbStockObservations(db), action = vi.fn();
  await expect(obs.locked('c', true, action)).rejects.toThrow('уже выполняется');
  expect(action).not.toHaveBeenCalled();
  tx.$queryRaw.mockResolvedValue([{ acquired: true }]);
  await obs.locked('c', true, async () => {
    expect(obs.inRebalance('c')).toBe(true);
    await obs.locked('c', false, action);
  });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(action).toHaveBeenCalledOnce();
  expect(obs.inRebalance('c')).toBe(false);
});
// TEST: when a transaction expires, a queued write must not proceed using the expired lock.
it('propagates a lost database lock before executing a nested action', async () => {
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([{ acquired: true }]).mockRejectedValue(new Error('transaction expired')) };
  const obs = new WbStockObservations({ $transaction: (f: any) => f(tx) } as any);
  const send = vi.fn();
  await expect(obs.locked('c', true, () => obs.locked('c', false, send))).rejects.toThrow('expired');
  expect(send).not.toHaveBeenCalled();
});
// TEST: planning a later run clears stale evidence but preserves one row per SKU/warehouse.
it('resets previous proof on a new run and records sent and observed amounts separately', async () => {
  const db: any = { wbStockPublicationCheck: { upsert: vi.fn(async () => ({ id: 'p' })), update: vi.fn() } };
  const record = new WbStockObservations(db).recorder('client', 'connection', 'run');
  const row = { warehouseId: 'warehouse', chrtId: 1, skuId: 's', amount: 4 };
  await record({ ...row, phase: 'PLAN', status: 'PLANNED' });
  await record({ ...row, phase: 'DECREASE', status: 'SENDING', sentAmount: 4 });
  await record({ ...row, phase: 'DECREASE', status: 'MISMATCH', observedAmount: 5 });
  expect(db.wbStockPublicationCheck.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId_warehouseId_chrtId: { connectionId: 'connection', warehouseId: 'warehouse', chrtId: 1 } }, update: expect.objectContaining({ sentAmount: null, observedAmount: null, error: null, runId: 'run' }) }));
  expect(db.wbStockPublicationCheck.update.mock.calls[0][0].data).toMatchObject({ sentAmount: 4, status: 'SENDING' });
  expect(db.wbStockPublicationCheck.update.mock.calls[1][0].data).toMatchObject({ observedAmount: 5, status: 'MISMATCH' });
  expect(db.wbStockPublicationCheck.update.mock.calls[1][0].data).not.toHaveProperty('sentAmount');
});
