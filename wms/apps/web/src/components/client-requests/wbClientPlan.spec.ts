import { describe, expect, it } from 'vitest';
import { canUseWbClientPlan } from './wbClientPlan';
// TEST: zero stock is not a malformed client plan.
describe('WB client plan eligibility', () => {
  it('retains requested quantities without depending on availability', () => {
    expect(canUseWbClientPlan({ skuId: 's', requestedQuantity: 170 })).toBe(true);
    expect(canUseWbClientPlan({ skuId: 's', requestedQuantity: 85 })).toBe(true);
  });
  it.each([0, -1, 1.5, NaN])('rejects quantity %s', requestedQuantity => {
    expect(canUseWbClientPlan({ skuId: 's', requestedQuantity })).toBe(false);
  });
  it('rejects unknown goods and incomplete relabeling', () => {
    expect(canUseWbClientPlan({ requestedQuantity: 1 })).toBe(false);
    expect(canUseWbClientPlan({ skuId: 's', requestedQuantity: 1, needsRelabel: true })).toBe(false);
  });
});
