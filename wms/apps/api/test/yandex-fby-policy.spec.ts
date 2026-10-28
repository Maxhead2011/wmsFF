import { describe, expect, it } from 'vitest';
import { assertFbySupply, fbyCompositionHash, normalizeFbyLines, supplyReference } from '../src/modules/yandex-fby/yandex-fby-policy';

// TEST: keep marketplace identities and physical demand unambiguous.
describe('FBY input boundaries', () => {
  it('preserves cabinet numbers and extracts supported cabinet links', () => {
    expect(supplyReference(' 123-45 ')).toBe('123-45');
    expect(supplyReference('https://partner.market.yandex.ru/supplies/12345')).toBe('12345');
    expect(supplyReference('https://partner.market.yandex.ru/supplier/1?requestId=abc-2')).toBe('abc-2');
  });
  it.each(['https://evil.invalid/supplies/123', 'https://partner.market.yandex.ru.evil.invalid/supplies/123', 'https://a:b@partner.market.yandex.ru/supplies/123', 'https://partner.market.yandex.ru/supplier/1', ''])('rejects an unsafe or ambiguous reference %s', value => {
    expect(() => supplyReference(value)).toThrow();
  });
  it('aggregates duplicate barcodes while preserving leading zeros', () => {
    expect(normalizeFbyLines([{ barcode: '0012', quantity: 2 }, { barcode: '0012', quantity: 3 }])).toEqual([{ barcode: '0012', quantity: 5 }]);
  });
  it.each([0, -1, 1.2, NaN, Infinity, '2', 1000001])('rejects invalid quantities %s', quantity => {
    expect(() => normalizeFbyLines([{ barcode: '0012', quantity }])).toThrow();
  });
  it('rejects empty input and combined overflow', () => {
    expect(() => normalizeFbyLines([])).toThrow();
    expect(() => normalizeFbyLines([{ barcode: '1', quantity: 1000000 }, { barcode: '1', quantity: 1 }])).toThrow();
  });
  it('compares composition independently of row ordering and duplication', () => {
    expect(fbyCompositionHash([{ skuId: 'a', quantity: 3 }, { skuId: 'b', quantity: 1 }])).toBe(fbyCompositionHash([{ skuId: 'b', quantity: 1 }, { skuId: 'a', quantity: 1 }, { skuId: 'a', quantity: 2 }]));
    expect(fbyCompositionHash([{ skuId: 'a', quantity: 2 }])).not.toBe(fbyCompositionHash([{ skuId: 'a', quantity: 3 }]));
  });
  it('never accepts withdrawal or parent distribution as a physical supply', () => {
    expect(() => assertFbySupply({ type: 'WITHDRAW', subtype: 'DEFAULT', status: 'CREATED' })).toThrow();
    expect(() => assertFbySupply({ type: 'SUPPLY', subtype: 'VIRTUAL_DISTRIBUTION_CENTER', status: 'CREATED' })).toThrow();
    expect(() => assertFbySupply({ type: 'SUPPLY', subtype: 'DEFAULT', status: 'CANCELLED' })).toThrow();
    expect(() => assertFbySupply({ type: 'SUPPLY', subtype: 'DEFAULT', status: 'CREATED' })).not.toThrow();
  });
});
