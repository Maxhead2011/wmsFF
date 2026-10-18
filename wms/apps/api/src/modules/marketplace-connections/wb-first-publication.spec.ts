import { describe, it, expect, vi } from 'vitest';
import { initializeFirstPublication, verifyFirstPublication } from './wb-first-publication';
const target = [{ chrtId: 12, amount: 8 }];
const identity = [{ skuId: 'physical', productId: '99:12', barcodes: ['123'] }];
const cards = [{ productId: '99:12', barcodes: ['123'] }];
function setup(after = new Map([[12, 0]])) {
  return { read: vi.fn().mockResolvedValueOnce(new Map()).mockResolvedValue(after),
    verify: vi.fn().mockResolvedValue(identity), record: vi.fn(), sendZeros: vi.fn() };
}
describe('explicit first WB publication', () => {
  // TEST: missing before is not zero; an actual zero must be confirmed before the positive plan.
  it('initializes missing records without sending the positive target', async () => {
    const io = setup(); await initializeFirstPublication(target, io);
    expect(io.sendZeros).toHaveBeenCalledTimes(1); expect(io.sendZeros).toHaveBeenCalledWith([{ chrtId: 12, amount: 0 }], [12]);
    expect(io.record).toHaveBeenLastCalledWith('INITIALIZATION_CONFIRMED', { ids: [12] });
  });
  it.each([new Map(), new Map([[12, 2]])])('blocks an unconfirmed zero', async after => {
    await expect(initializeFirstPublication(target, setup(after))).rejects.toThrow('не подтвердил');
  });
  it('never retries uncertain writes', async () => {
    const io = setup(); io.sendZeros.mockRejectedValue(Error('timeout'));
    await expect(initializeFirstPublication(target, io)).rejects.toThrow('timeout');
    expect(io.sendZeros).toHaveBeenCalledTimes(1); expect(io.read).toHaveBeenCalledTimes(1);
  });
  it('does not initialize known stock', async () => {
    const io = setup(); io.read.mockReset().mockResolvedValue(new Map([[12, 3]]));
    await initializeFirstPublication(target, io); expect(io.sendZeros).not.toHaveBeenCalled();
  });
  it('blocks failed reads, catalog checks and audit writes', async () => {
    for (const key of ['read', 'verify', 'record'] as const) {
      const io = setup(); io[key].mockReset().mockRejectedValue(Error(key));
      await expect(initializeFirstPublication(target, io)).rejects.toThrow(key);
      expect(io.sendZeros).not.toHaveBeenCalled();
    }
  });
  it('validates fresh exact identity, including Ozon-origin physical SKU', () => {
    expect(verifyFirstPublication([12], identity, cards)[0].skuId).toBe('physical');
    expect(() => verifyFirstPublication([12], identity, [])).toThrow();
    expect(() => verifyFirstPublication([12], identity, [{ ...cards[0], barcodes: ['other'] }])).toThrow();
    expect(() => verifyFirstPublication([12], [...identity, ...identity], cards)).toThrow();
    expect(() => verifyFirstPublication([12], identity, [...cards, { productId: '99:13', barcodes: ['123'] }])).toThrow();
  });
  it.each([NaN, -1, 0.5])('rejects invalid observations', async amount => {
    const io = setup(); io.read.mockReset().mockResolvedValue(new Map([[12, amount]]));
    await expect(initializeFirstPublication(target, io)).rejects.toThrow();
    expect(io.sendZeros).not.toHaveBeenCalled();
  });
});
