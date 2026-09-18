import { expect, it } from 'vitest';
import { parseWbStockReserve, reserveForSku, wbStockAfterReserve } from '../src/modules/marketplace-connections/wb-stock-reserve';

// TEST: strict threshold replaces (not adds to) the main reserve, including percentages.
it('replaces the main reserve strictly below the threshold', () => {
  const rule = { mode: 'UNITS', value: 3, lowStock: { threshold: 5, reserveUnits: 1 } } as const;
  expect(parseWbStockReserve(rule)).toEqual(rule);
  expect([0, 1, 4, 5, 6].map(n => wbStockAfterReserve(n, rule))).toEqual([0, 0, 3, 2, 3]);
  expect(wbStockAfterReserve(4, { ...rule, mode: 'PERCENT', value: 50 })).toBe(3);
  expect(wbStockAfterReserve(5, { ...rule, mode: 'PERCENT', value: 50 })).toBe(2);
  expect(wbStockAfterReserve(4, { ...rule, lowStock: { threshold: 5, reserveUnits: 0 } })).toBe(4);
  expect(wbStockAfterReserve(4, { ...rule, lowStock: { threshold: 5, reserveUnits: 8 } })).toBe(0);
});

// TEST: corrupt nested settings cannot silently remove the buffer on publication.
it.each([null, [], {}, { threshold: 0, reserveUnits: 1 }, { threshold: 5.5, reserveUnits: 1 }, { threshold: '5', reserveUnits: 1 }, { threshold: 5, reserveUnits: -1 }, { threshold: 5, reserveUnits: 1.5 }, { threshold: 5, reserveUnits: '1' }, { threshold: 1000001, reserveUnits: 1 }, { threshold: 5, reserveUnits: 1000001 }])('rejects invalid low-stock rule %j', lowStock => {
  expect(() => parseWbStockReserve({ mode: 'UNITS', value: 3, lowStock })).toThrow();
});

// TEST: product override replaces the entire client rule; a block always wins.
it('inherits the rule but preserves product overrides and publication blocks', () => {
  const reserve = { mode: 'UNITS', value: 3, lowStock: { threshold: 5, reserveUnits: 1 } } as const;
  const plan = { reserve, skuRules: new Map([
    ['inherit', { reserve: null, blocked: false }],
    ['own', { reserve: { mode: 'UNITS', value: 2 } as const, blocked: false }],
    ['blocked', { reserve, blocked: true }],
  ]) };
  expect(wbStockAfterReserve(4, reserveForSku(plan, 'inherit'))).toBe(3);
  expect(wbStockAfterReserve(4, reserveForSku(plan, 'own'))).toBe(2);
  expect(wbStockAfterReserve(4, reserveForSku(plan, 'blocked'))).toBe(0);
});
