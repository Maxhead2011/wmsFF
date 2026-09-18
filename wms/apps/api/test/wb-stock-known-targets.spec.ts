import { expect, it, vi } from 'vitest';
import { selectKnownWbStockTargets } from '../src/modules/marketplace-connections/wb-stock-safe-publication';

// TEST: a missing response on one warehouse excludes that size on every warehouse, never as zero.
it('isolates unknown sizes while preserving unrelated publication targets', async () => {
  const targets = ['a', 'b'].flatMap(warehouseId => [1, 2].map(chrtId => ({ warehouseId, chrtId, amount: 3 })));
  const read = vi.fn(async (warehouseId: string) => new Map(warehouseId === 'a' ? [[1, 0], [2, 1]] : [[2, 0]]));
  const record = vi.fn();
  const result = await selectKnownWbStockTargets(targets, read, record);
  expect(result.known).toEqual(targets.filter(t => t.chrtId === 2));
  expect(result.unknown).toEqual(targets.filter(t => t.chrtId === 1));
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls.every(([r]) => r.status === 'UNCONFIRMED' && r.observedAmount === undefined)).toBe(true);
});
it('does not turn network errors into partial success', async () => {
  await expect(selectKnownWbStockTargets([{ warehouseId: 'a', chrtId: 1, amount: 2 }], async () => { throw new Error('429'); }, vi.fn())).rejects.toThrow('429');
});
