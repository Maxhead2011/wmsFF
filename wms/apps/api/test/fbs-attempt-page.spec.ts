import { describe, expect, it } from 'vitest';
import { fbsAttemptPageWindow, mergeFbsAttemptPage } from '../src/common/shipment-history/fbs-attempt-page';

// TEST: archived attempts must retain their positions/counts in packed-item pages.
describe('live + historical physical attempts pagination', () => {
  it('matches a full union for every page, including tied timestamps and distant history', () => {
    for (let seed = 0; seed < 12; seed++) {
      const all = Array.from({ length: 137 }, (_, index) => ({ id: String(index).padStart(4, '0'),
        completedAt: new Date(10000 - Math.floor(index / 3)), updatedAt: new Date(10000 - Math.floor(index / 5)) }));
      const history = all.filter((_, i) => (i + seed) % 9 === 0);
      const current = mergeFbsAttemptPage(all.filter(row => !history.includes(row)), [], 0, all.length);
      const expected = mergeFbsAttemptPage(all, [], 0, all.length);
      for (let page = 1; page <= 16; page++) {
        const window = fbsAttemptPageWindow(page, 10, history.length);
        const fetched = current.slice(window.skip, window.skip + window.take);
        expect(mergeFbsAttemptPage(fetched, history, window.offset, 10).map(row => row.id))
          .toEqual(expected.slice((page - 1) * 10, page * 10).map(row => row.id));
      }
    }
  });
  it('does not increase the query window in installations without history', () => {
    expect(fbsAttemptPageWindow(200, 100, 0)).toEqual({ skip: 19900, take: 100, offset: 0 });
  });
});
