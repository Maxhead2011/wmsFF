import { describe, it, expect, afterEach } from 'vitest';
import { productLinkCandidate, productLinksEnabled } from '../src/modules/marketplace-connections/marketplace-product-links';
const product={barcodes:['123'],size:'42',color:'black'};
const sku={id:'one',size:'42',color:'black',barcodes:[{value:'123'}]};
// TEST: one physical SKU is shared, but ambiguous or incompatible variants never auto-merge.
describe('marketplace product links',()=>{
 afterEach(()=>{delete process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED;delete process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS;});
 it('requires an explicit flag and client allowlist',()=>{
  expect(productLinksEnabled('c')).toBe(false);process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';
  expect(productLinksEnabled('c')).toBe(false);process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS='c';
  expect(productLinksEnabled('c')).toBe(true);expect(productLinksEnabled('other')).toBe(false);
 });
 it('matches one barcode and compatible variant',()=>expect(productLinkCandidate(product,[sku])).toEqual({skuId:'one',reason:null}));
 it('does not guess between existing duplicates',()=>expect(productLinkCandidate(product,[sku,{...sku,id:'two'}]).skuId).toBeNull());
 it('rejects a conflicting size or color',()=>{
  expect(productLinkCandidate(product,[{...sku,size:'44'}]).skuId).toBeNull();
  expect(productLinkCandidate(product,[{...sku,color:'white'}]).skuId).toBeNull();
 });
 it('does not match by article alone',()=>expect(productLinkCandidate(product,[{...sku,barcodes:[{value:'456'}]}]).skuId).toBeNull());
});
