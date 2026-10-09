import { afterEach, describe, expect, it } from 'vitest';
import { receiptBarcodeRisk, requireReceiptReviewer } from '../src/modules/tsd/receipt-barcode-policy';
// TEST: valid EAN-8 is still unusual for an unknown clothing SKU; do not silently create it.
describe('receipt barcode review', () => {
  it.each(['18', '7459', '08123282', 'abc', '2053244418659'])('holds suspicious unknown %s', code => {
    expect(receiptBarcodeRisk(code, false)).not.toBeNull();
  });
  it('preserves known internal codes and normal EAN', () => {
    expect(receiptBarcodeRisk('18', true)).toBeNull();
    expect(receiptBarcodeRisk('4006381333931', false)).toBeNull();
  });
  it.each(['ADMIN', 'OWNER'])('allows %s', role => {
    expect(() => requireReceiptReviewer({ roleCodes: [role], isDemo: false } as any)).not.toThrow();
  });
  it.each([{roleCodes:['WORKER']}, {roleCodes:['CLIENT']}, {roleCodes:['ADMIN'],isDemo:true}])('denies other callers', user => {
    expect(() => requireReceiptReviewer(user as any)).toThrow();
  });
});
