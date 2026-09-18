import { describe, expect, it } from 'vitest';
import { limitShareChange, stockDemandCoverage } from '../src/modules/marketplace-connections/wb-stock-demand-coverage';
const full = 0xffffff;
describe('stock availability exposure and recommendation bounds', () => {
  // TEST: missing history and confirmed zero inventory are different states.
  it('does not infer zero demand from unknown or always unavailable warehouses', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ skuId: 's', warehouseId: 'a', day: `2026-09-0${i + 1}`, observedMask: full, positiveMask: 0 }));
    const result = stockDemandCoverage('s', ['a'], days, new Map(), '2026-09-01', '2026-09-18');
    expect(result.stockoutDays).toBe(7); expect(result.sufficient).toBe(false);
    expect(stockDemandCoverage('s', ['a'], [], new Map(), '2026-09-01', '2026-09-18').stockoutDays).toBe(0);
  });
  it('normalizes demand by observed in-stock time, not calendar time', () => {
    const days = ['a', 'b'].flatMap(warehouseId => Array.from({ length: 7 }, (_, i) => ({ skuId: 's', warehouseId, day: `2026-09-0${i + 1}`, observedMask: full, positiveMask: warehouseId === 'a' ? full : 0xfff })));
    const orders = new Map(Array.from({ length: 7 }, (_, i) => [`2026-09-0${i + 1}`, new Map([['a', 2], ['b', 1]])]));
    const result = stockDemandCoverage('s', ['a', 'b'], days, orders, '2026-09-01', '2026-09-18');
    expect(result.sufficient).toBe(true); expect(result.rates.get('a')).toBe(result.rates.get('b'));
    expect(stockDemandCoverage('other', ['a'], days, orders, '2026-09-01', '2026-09-18').sufficient).toBe(false);
  });
  it('keeps the total at 100 and bounds every warehouse change', () => {
    const current = [{ warehouseId: 'a', percent: 60 }, { warehouseId: 'b', percent: 40 }, { warehouseId: 'c', percent: 0 }];
    const target = [{ warehouseId: 'a', percent: 0 }, { warehouseId: 'b', percent: 0 }, { warehouseId: 'c', percent: 100 }];
    const next = limitShareChange(current, target, 10);
    expect(next.reduce((n, r) => n + r.percent, 0)).toBe(100);
    next.forEach((r, i) => expect(Math.abs(r.percent - current[i].percent)).toBeLessThanOrEqual(10));
    expect(limitShareChange(current, target, 0)).toEqual(current);
  });
});
