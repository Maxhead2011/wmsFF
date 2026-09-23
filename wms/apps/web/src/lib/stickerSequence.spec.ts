import { describe, expect, it } from 'vitest';
import { stickerSequence, type StickerSequence } from './stickerSequence';
const base: StickerSequence = { prefix: 'FFL_LKBBOX_', start: '385', count: '3', step: '1', repeat: '1', digits: '3', direction: 'up' };
// TEST: NiceLabel counter settings must affect the actual print sequence.
describe('stickerSequence', () => {
  it('matches the demonstrated NiceLabel sequence', () => expect(stickerSequence(base)).toEqual(['FFL_LKBBOX_385', 'FFL_LKBBOX_386', 'FFL_LKBBOX_387']));
  it('applies step and repeats each number', () => expect(stickerSequence({ ...base, step: '2', repeat: '2', count: '2' })).toEqual(['FFL_LKBBOX_385', 'FFL_LKBBOX_385', 'FFL_LKBBOX_387', 'FFL_LKBBOX_387']));
  it('pads receipt box numbers', () => expect(stickerSequence({ ...base, start: '9', count: '2' })).toEqual(['FFL_LKBBOX_009', 'FFL_LKBBOX_010']));
  it('decrements', () => expect(stickerSequence({ ...base, direction: 'down', count: '2' })).toEqual(['FFL_LKBBOX_385', 'FFL_LKBBOX_384']));
  it('reprints exact manual text without adding a number', () => expect(stickerSequence({ ...base, direction: 'fixed', prefix: 'FFL_LKBBOX_385', count: '2', start: '' })).toEqual(['FFL_LKBBOX_385', 'FFL_LKBBOX_385']));
  it('does not print anonymous box numbers', () => expect(() => stickerSequence({ ...base, prefix: '' })).toThrow('префикс'));
  it.each([{ count: '501' }, { count: '300', repeat: '2' }, { start: '' }, { step: '1.5' }, { start: '0', direction: 'down' }, { start: '9007199254740991' }])('rejects invalid batches %j', (change) => expect(() => stickerSequence({ ...base, ...change } as StickerSequence)).toThrow());
});
