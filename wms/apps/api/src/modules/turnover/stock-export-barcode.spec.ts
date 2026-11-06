import {describe,it,expect} from 'vitest';
import {stockExportBarcode} from './stock-export-barcode';
const lukin='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
// TEST: exported SKU labels must not be replaced with the marking GTIN.
describe('stock export barcode',()=>{
 const codes=[{value:'04630702901389',isPrimary:true},{value:'2056223748500',isPrimary:false}];
 it('uses the single product label instead of the GTIN',()=>expect(stockExportBarcode(lukin,codes)).toBe('2056223748500'));
 it('preserves other clients',()=>expect(stockExportBarcode('other',codes)).toBe('04630702901389'));
 it('does not guess ambiguous labels',()=>expect(stockExportBarcode(lukin,[...codes,{value:'2056223801182',isPrimary:false}])).toBeNull());
 it('does not present a lone GTIN as a label',()=>expect(stockExportBarcode(lukin,[codes[0]])).toBeNull());
 it('keeps a primary product barcode',()=>expect(stockExportBarcode(lukin,[{...codes[1],isPrimary:true},codes[0]])).toBe('2056223748500'));
});
