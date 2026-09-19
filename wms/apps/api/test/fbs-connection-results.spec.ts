import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectFbsConnectionOrders, fbsConnectionIsolationEnabled } from '../src/modules/marketplace-connections/fbs-connection-results';

const connections = [
  { id: 'good', marketplace: 'OZON', accountName: 'Рабочий кабинет' },
  { id: 'bad', marketplace: 'OZON', accountName: null },
];
const order = { id: 'posting-1', connectionId: 'good' };
const failure = new Error('400 Client-Id header value should be positive integer');
const load = async (connection: typeof connections[number]) => {
  if (connection.id === 'bad') throw failure;
  return [order];
};
afterEach(() => vi.unstubAllEnvs());

describe('isolated FBS connection reads', () => {
  // TEST: one invalid Ozon connection must not hide a healthy cabinet's orders.
  it('preserves successful orders and identifies the failed connection', async () => {
    const result = await collectFbsConnectionOrders(connections, load, true);
    expect(result.groups).toEqual([[order], []]);
    expect(result.errors).toEqual([expect.objectContaining({ connectionId: 'bad', marketplace: 'OZON' })]);
    expect(result.errors[0].message).toContain('OZON');
    expect(JSON.stringify(result)).not.toContain(failure.message);
  });
  // TEST: mutation validation and sold deployments retain strict failure semantics.
  it('rejects incomplete operational results with the original error', async () => {
    await expect(collectFbsConnectionOrders(connections, load, false)).rejects.toBe(failure);
  });
  it('does not replace a last good snapshot with an empty result when every cabinet fails', async () => {
    await expect(collectFbsConnectionOrders(connections, async () => { throw failure; }, true)).rejects.toThrow('подключения');
  });
  it('does not invent an error when a healthy cabinet has no orders', async () => {
    expect(await collectFbsConnectionOrders(connections, async () => [], true)).toEqual({ groups: [[], []], errors: [] });
    expect(await collectFbsConnectionOrders([], async () => [], true)).toEqual({ groups: [], errors: [] });
  });
  it('also isolates synchronous loader failures', async () => {
    const result = await collectFbsConnectionOrders(connections, c => {
      if (c.id === 'bad') throw failure;
      return Promise.resolve([order]);
    }, true);
    expect(result.groups.flat()).toEqual([order]);
  });
  it('requires both a read-only request and our explicit feature flag', () => {
    vi.stubEnv('WMS_FBS_CONNECTION_ISOLATION', 'false');
    expect(fbsConnectionIsolationEnabled(true, 'true')).toBe(true);
    expect(fbsConnectionIsolationEnabled(false, 'true')).toBe(false);
    expect(fbsConnectionIsolationEnabled(true, undefined)).toBe(false);
    expect(fbsConnectionIsolationEnabled(true, 'false')).toBe(false);
  });
});
