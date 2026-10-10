import { expect, it } from 'vitest';
import { barcodeCatalogReview as review } from '../src/modules/marketplace-connections/wb-barcode-identity';
const sku={id:'s',marketplaceProductId:'1164385938:1718971701',marketplaceOfferId:'2052400023910',article:'Мото_черный',size:'XS / 40'};
const product={productId:sku.marketplaceProductId,barcodes:['2052400023910'],article:'Мото_черный',size:'XS / 42'};
const legacy=(s:any,p:any)=>s.article===p.article&&s.size===p.size;
// TEST: the observed incident keeps linkage, emits a warning and preserves WMS size.
it('accepts a unique barcode despite a changed Russian size',()=>{
 const result=review([sku],[product],[sku],legacy);
 expect(result.excluded).toEqual([]);expect(result.warnings).toHaveLength(1);expect(sku.size).toBe('XS / 40');
});
it.each(['warehouse','marketplace'])('blocks ambiguous barcode in %s',where=>{
 const owners=where==='warehouse'?[sku,{...sku,id:'other'}]:[sku];
 const products=where==='marketplace'?[product,{...product,productId:'2:3'}]:[product];
 expect(review([sku],products,owners,legacy).excluded).toHaveLength(1);
});
it('does not use matching descriptions to override conflicting barcodes',()=>{
 expect(review([sku],[{...product,size:sku.size,barcodes:['other']}],[sku],legacy).excluded).toHaveLength(1);
});
it('keeps missing cards blocked and rejects incomplete catalogs',()=>{
 expect(review([sku],[{...product,productId:'2:3'}],[sku],legacy).excluded[0].reason).toBe('MISSING');
 expect(()=>review([sku],[],[sku],legacy)).toThrow();
});
// TEST: alternate WB barcodes must not bridge two different warehouse goods.
it('rejects a card whose second barcode belongs to another SKU',()=>{
 expect(review([sku],[{...product,barcodes:[...product.barcodes,'second']}],[sku,{...sku,id:'other',marketplaceOfferId:'second'}],legacy).excluded).toHaveLength(1);
});
it('accepts a secondary WMS barcode and preserves leading zeroes',()=>{
 const warehouse={...sku,marketplaceOfferId:'old',barcodes:[{value:'00123'}]};
 expect(review([warehouse],[{...product,barcodes:['00123']}],[warehouse],legacy).excluded).toHaveLength(0);
 expect(review([warehouse],[{...product,barcodes:['123']}],[warehouse],legacy).excluded).toHaveLength(1);
});
it('warns about descriptive changes even if the legacy comparison accepted them',()=>{
 expect(review([sku],[product],[sku],()=>true).warnings).toHaveLength(1);
});
