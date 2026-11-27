import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveWbPublicationChoices } from '../src/modules/marketplace-connections/wb-disable-verification';

afterEach(() => vi.unstubAllEnvs());
describe('WB publication OFF', () => {
  // TEST: even a repeated OFF creates durable work in the very same transaction.
  it.each([false, true])('queues verification with the settings before the remote call (bulk %s)', async bulk => {
    vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
    const ids = bulk ? ['size1', 'size2'] : ['size1'];
    const writes = ids.map(id => ({ id, enabled: false }));
    const event = Symbol('event');
    const db = {
      $executeRaw: vi.fn(() => event),
      $transaction: vi.fn(async (ops: unknown[]) => {
        expect(ops).toEqual([...writes, event]);
        return [...writes, 1];
      }),
    };
    expect(await saveWbPublicationChoices(db as never, writes as never, 'client', ids, false, bulk)).toEqual(writes);
    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual(['client', ids]);
  });

  it('propagates a failed event commit rather than reporting the switch saved', async () => {
    vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
    const db = { $executeRaw: () => 1, $transaction: async () => { throw Error('rollback'); } };
    await expect(saveWbPublicationChoices(db as never, [] as never, 'client', ['sku'], false, true)).rejects.toThrow('rollback');
  });
});
