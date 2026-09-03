import { describe, expect, it } from 'vitest';
import {
  assertSkuCollectionPick,
  assertSkuCollectionReceipt,
  skuCollectionRequestRowTone,
} from './sku-collection-policy';

describe('sku collection policy', () => {
  it('requires both product barcode and KIZ during picking', () => {
    // TEST: the dedicated flow never accepts a quantity-only scan.
    expect(() => assertSkuCollectionPick({ barcode: '', kiz: '010-test', sourceBoxCode: 'BOX-1' }))
      .toThrow('Сканируйте ШК товара');
    expect(() => assertSkuCollectionPick({ barcode: '460000000001', kiz: '', sourceBoxCode: 'BOX-1' }))
      .toThrow('Сканируйте КИЗ');
  });

  it('accepts an existing KIZ only when it was picked by the same request', () => {
    // TEST: normal duplicate acceptance must not leak into ordinary receipt.
    expect(() => assertSkuCollectionReceipt({
      barcode: '460000000001',
      kiz: '010-test',
      targetBoxCode: 'BOX-2',
      pickedByThisRequest: false,
    })).toThrow('КИЗ не был отобран этой заявкой');

    expect(assertSkuCollectionReceipt({
      barcode: '460000000001',
      kiz: '010-test',
      targetBoxCode: 'BOX-2',
      pickedByThisRequest: true,
    })).toEqual({ barcode: '460000000001', kiz: '010-test', targetBoxCode: 'BOX-2' });
  });

  it('uses the orange visual tone only for SKU collection requests', () => {
    // TEST: existing request statuses keep their original colors.
    expect(skuCollectionRequestRowTone('SKU_COLLECTION')).toBe('sku-collection');
    expect(skuCollectionRequestRowTone('OUTBOUND')).toBeNull();
  });
});
