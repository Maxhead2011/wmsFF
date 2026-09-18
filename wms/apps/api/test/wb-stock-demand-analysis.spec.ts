import { describe, expect, it } from 'vitest';
import { analyzeWbStockDemand } from '../src/modules/marketplace-connections/wb-stock-demand-analysis';
const now = Date.UTC(2026, 8, 18);
const shares = [{ warehouseId: 'a', percent: 60, isPrimary: true }, { warehouseId: 'b', percent: 40 }];
const stocks = [{ skuId: 's', name: 'S', barcode: '123', available: 20 }];
const order = (id: number, extra = {}) => ({ id: String(id), connectionId: 'c', marketplace: 'WILDBERRIES', category: 'active', createdAt: new Date(now - (id + 1) * 86400000).toISOString(), warehouseId: 'b', itemCount: 2, product: { id: 's' }, ...extra });
describe('WB demand analysis', () => {
  // TEST: no evidence must not erase a manager's warehouse distribution.
  it('keeps manual shares for sparse history and deducts reserve once', () => {
    const result = analyzeWbStockDemand([], 'c', stocks, shares, { mode: 'UNITS', value: 3 }, now);
    expect(result.hasEvidence).toBe(false);
    expect(result.recommendedShares).toEqual(shares.map(({ warehouseId, percent }) => ({ warehouseId, percent })));
    expect(result.rows[0].publishable).toBe(17);
    expect(result.rows[0].allocation.reduce((n, r) => n + r.amount, 0)).toBe(17);
  });
  it('isolates account, dates, cancellation, warehouse and duplicate order IDs', () => {
    const orders = Array.from({ length: 10 }, (_, i) => order(i));
    const result = analyzeWbStockDemand([...orders, orders[0], order(20, { category: 'cancelled' }), order(21, { connectionId: 'other' }), order(22, { createdAt: null }), order(23, { warehouseId: 'excluded' }), order(24, { createdAt: new Date(now + 1000).toISOString() })], 'c', stocks, shares, { mode: 'NONE', value: 0 }, now);
    expect(result.orderedUnits).toBe(20);
    expect(result.rows[0].abc).toBe('A');
    expect(result.rows[0].xyz).toBe('Z');
    expect(result.rows[0].sufficient).toBe(true);
    expect(result.recommendedShares.reduce((n, r) => n + r.percent, 0)).toBe(100);
  });
  it('respects disabled products, caps and the primary low-stock rule', () => {
    const result = analyzeWbStockDemand([], 'c', [{ ...stocks[0], saleLimit: 5 }, { ...stocks[0], skuId: 'disabled', enabled: false }], shares, { mode: 'UNITS', value: 3 }, now);
    expect(result.rows[0].allocation).toEqual([{ warehouseId: 'a', amount: 5 }, { warehouseId: 'b', amount: 0 }]);
    expect(result.rows[1].publishable).toBe(0);
  });
});
