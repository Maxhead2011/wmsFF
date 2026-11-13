import { describe, expect, it } from 'vitest';
import { planOzonMarkedRecovery } from '../src/modules/marketplace-connections/ozon-fbs-marked-recovery';
const units = [
 {productId:1,skuId:'small',barcode:'4610460840526',kiz:'0104610460840526215OdGM-'},
 {productId:2,skuId:'large',barcode:'4610460840540',kiz:'0104610460840540215K.W,b'},
];
const posting = {posting_number:'order',status:'awaiting_deliver',products:[
 {sku:1,offer_id:'offer-small',quantity:1},{sku:2,offer_id:'offer-large',quantity:1},
]};
const skus=units.map((u,i)=>({id:u.skuId,clientId:'client',name:u.skuId,barcodes:[{value:u.barcode},{value:posting.products[i].offer_id}]}));
const input=()=>({clientId:'client',orderId:'order',units:structuredClone(units),posting:structuredClone(posting),skus:structuredClone(skus)});
// TEST: recovery requires an exact per-product, client-scoped, GTIN-verified composition.
describe('Ozon packed recovery plan',()=>{
 it('uses two physical SKUs instead of two units of the scalar first SKU',()=>{
  expect(planOzonMarkedRecovery(input()).map(l=>[l.skuId,l.quantity])).toEqual([['small',1],['large',1]]);
 });
 it('rejects codes exchanged between two products even with the same total',()=>{
  const i=input();[i.units[0].kiz,i.units[1].kiz]=[i.units[1].kiz,i.units[0].kiz];
  expect(()=>planOzonMarkedRecovery(i)).toThrow();
 });
 it('rejects a different posting, handed-over posting, unknown SKU and duplicate mark',()=>{
  for(const change of [(i:any)=>i.posting.posting_number='other',(i:any)=>i.posting.status='delivered',
   (i:any)=>i.skus[0].clientId='other',(i:any)=>i.units[1].kiz=i.units[0].kiz,
   (i:any)=>i.units.pop(),(i:any)=>i.posting.products[0].quantity=2]){
   const i=input();change(i);expect(()=>planOzonMarkedRecovery(i)).toThrow();
  }
 });
 it('rejects a physical SKU that is not linked to the remote offer',()=>{
  const i=input();i.skus[0].barcodes.pop();expect(()=>planOzonMarkedRecovery(i)).toThrow();
 });
});
