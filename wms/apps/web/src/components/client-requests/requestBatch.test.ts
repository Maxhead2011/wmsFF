import {describe,it,expect} from 'vitest';
import {batchDonePayload, canBatchComplete, compareRequestStatus, compareRequestClient, missingSourceOnly, batchStockSources, runRequestBatch} from './requestBatch';
// TEST: never erase a known box, even if its balance is zero or insufficient.
describe('request batch safety',()=>{
 it('selects noBox only without any known source',()=>{
  const items=[{requestItemId:'missing',requestedQuantity:2,boxes:[],fbsOrders:[]},{requestItemId:'emptyBox',requestedQuantity:2,boxes:[{availableQuantity:0}],fbsOrders:[]},{requestItemId:'fbs',requestedQuantity:2,boxes:[],fbsOrders:[{boxCode:'BOX1'}]}];
  expect(missingSourceOnly(items as any)).toEqual([{requestItemId:'missing',quantity:2,noBox:true}]);
 });
 it('orders stages and excludes finished/cancelled/rejected',()=>{
  expect(compareRequestStatus({status:'IN_WORK',number:10} as any,{status:'PACKED',number:1} as any)).toBeLessThan(0);
  for(const status of ['DONE','CANCELLED','REJECTED'])expect(canBatchComplete({status} as any)).toBe(false);
 });
 it('retains independent successes when one request fails',async()=>{
  const calls:string[]=[];const result=await runRequestBatch([{id:'1'},{id:'2'},{id:'3'}],async x=>{calls.push(x.id);if(x.id==='2')throw Error('КИЗ не подтверждён');});
  expect(calls).toEqual(['1','2','3']);expect(result.map(x=>x.ok)).toEqual([true,false,true]);expect(result[1].error).toContain('КИЗ');
 });
 // TEST: do not replace recorded pallet/box counts and packed quantities with bulk defaults.
 it('preserves recorded packaging and enforces normal weight checks',()=>{
  const request={type:'OUTBOUND',status:'PACKED',items:[{quantity:20}],packages:[{packageType:'PALLET',items:[{quantity:5}]},{packageType:'BOX',items:[{quantity:3}]}]};
  expect(batchDonePayload(request as any,9,{items:[]} as any)).toMatchObject({boxes:1,pallets:1,packedUnits:8,allowOverweightPackages:false});
  expect(batchDonePayload({...request,status:'IN_WORK',packages:[]} as any,2,{items:[]} as any)).toMatchObject({boxes:2,pallets:0,packedUnits:20});
 });
});

// TEST: production tasks use a sentinel for no box; it is not a physical source.
it('recognizes the no-box sentinel without discarding a real source',()=>{
 const item={requestItemId:'i',requestedQuantity:2,selectedQuantity:0,boxes:[],fbsOrders:[{boxCode:'БЕЗ КОРОБА'}]};
 expect(missingSourceOnly([item] as any)).toEqual([{requestItemId:'i',quantity:2,noBox:true}]);
 expect(missingSourceOnly([{...item,boxes:[{boxCode:'REAL',availableQuantity:0}]}] as any)).toEqual([]);
});
// TEST: only a sole sufficient known source may be selected automatically.
it('uses the sole source, preserving shortages and ambiguous choices',()=>{
 const item={requestItemId:'i',requestedQuantity:2,selectedQuantity:0,boxes:[{boxCode:'MANUAL-STOCK',availableQuantity:5}],fbsOrders:[]};
 expect(batchStockSources([item] as any)).toEqual([{requestItemId:'i',boxCode:'MANUAL-STOCK',quantity:2,requireAvailableStock:true}]);
 expect(()=>batchStockSources([{...item,boxes:[{boxCode:'REAL',availableQuantity:1}]}] as any)).toThrow();
 expect(()=>batchStockSources([{...item,boxes:[...item.boxes,{boxCode:'SECOND',availableQuantity:5}]}] as any)).toThrow();
 expect(batchStockSources([{...item,selectedQuantity:2}] as any)).toEqual([]);
});

// TEST: order by the visible client name in Russian and keep ties deterministic.
it('sorts clients alphabetically, with numeric suffixes and stable request numbers', () => {
  const rows = [['Яков', 2], ['Анна 10', 3], ['Анна 2', 5], ['анна 2', 1]]
    .map(([name, number]) => ({client: {name}, number}));
  expect([...rows].sort(compareRequestClient as any).map(row => row.number)).toEqual([1, 5, 3, 2]);
});
