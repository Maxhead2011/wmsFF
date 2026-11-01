import { expect, it, vi } from 'vitest';
import { fboPickingCapacity } from '../src/modules/tsd/fbo-picking-capacity';
import { loadFboFbsAvailability } from '../src/modules/tsd/fbo-fbs-reservations';
vi.mock('../src/modules/tsd/fbo-fbs-reservations',()=>({loadFboFbsAvailability:vi.fn()}));
it('counts 13 routable units out of 14 when one unit is reserved, and skips boxes under recount', async()=>{
  // TEST: the customer sees pickable quantities without physical locations.
  const query={findMany:async()=>[]};
  const box=(id:string,quantity:number)=>({id,storagePlacement:{id:'placed'},productMarks:[],
    balances:[{skuId:'sku',quantity,sku:{needsChestnyZnak:false,isUnmarked:true}}]});
  const db={client:{findUniqueOrThrow:async()=>({storesWithoutBoxes:false,stockBalanceMode:'PALLET_SORT'})},
    box:{findMany:async()=>[box('ready',14),box('recount',5)]},
    inventoryAuditBox:{findMany:async()=>[{boxId:'recount'}]},fbsTsdAssembly:query,clientRequestBoxSelection:query,fboAssemblyBox:query};
  vi.mocked(loadFboFbsAvailability).mockResolvedValue({free:()=>13,take:()=>{}} as never);
  expect(await fboPickingCapacity(db as never,'client','warehouse',['sku'])).toEqual(new Map([['sku',13]]));
});
