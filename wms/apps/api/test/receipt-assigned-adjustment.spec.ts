import 'reflect-metadata';
import {afterEach,expect,it,vi} from 'vitest';
import {receiptDocuments} from '../src/modules/warehouse/receipt-channel-policy';
afterEach(()=>vi.unstubAllEnvs());
// TEST: recovered receipt, signed corrections, earlier lifecycle and repeated reads.
it('counts explicitly assigned checked units without duplicating receipts',async()=>{
 vi.stubEnv('WMS_RECEIPT_CHECKED_QUANTITY_ENABLED','true');vi.stubEnv('WMS_MENU_READS_ENABLED','false');
 const at=new Date('2026-10-31T11:39:00Z');
 const adjustments=[5,22,5,-2].map(quantity=>({boxId:'b',createdAt:new Date(at.getTime()+1000),quantity}));
 adjustments.push({boxId:'b',createdAt:new Date(at.getTime()-1000),quantity:99});
 let received:any[]=[];
 const db:any={stockMovement:{findMany:vi.fn(async(q:any)=>q.where.type==='RECEIPT'?received:adjustments)},
 box:{findMany:async()=>[{id:'b',code:'FFL_KEV3110_007',status:'active'}]},
 tsdOperation:{findMany:async()=>[{createdAt:at,payload:{boxCode:'FFL_KEV3110_007',sourceDocument:'receipt'}}]},
 systemSetting:{findMany:async()=>[{value:{clientId:'c',warehouseId:'w',boxId:'b',series:'SERIES:2026:FFL_KEV3110'}}]}};
 vi.stubEnv('WMS_RECEIPT_CHECKED_QUANTITY_ENABLED','false');
 expect((await receiptDocuments(db,'c','w'))[0].received).toBe(0);
 vi.stubEnv('WMS_RECEIPT_CHECKED_QUANTITY_ENABLED','true');
 for(let i=0;i<2;i++)expect((await receiptDocuments(db,'c','w'))[0].received).toBe(30);
 received=[{boxId:'b',createdAt:at,quantity:32,sourceDocument:'receipt'}];
 expect((await receiptDocuments(db,'c','w'))[0].received).toBe(32);
 received=[];db.systemSetting.findMany=async()=>[];
 expect((await receiptDocuments(db,'c','w'))[0].received).toBe(0);
});
