import 'reflect-metadata';
import {afterEach,expect,it,vi} from 'vitest';
import {assertReceiptFbsBox,assertReceiptStockAvailable,receiptDocuments,receiptApprovalScopeKey,receiptApprovalKey} from '../src/modules/warehouse/receipt-channel-policy';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');
 const settings=new Map<string,any>([[receiptApprovalScopeKey('c','w'),{clientId:'c',warehouseId:'w',grandfatheredReceiptIds:[]}]]);
 const db:any={systemSetting:{findMany:vi.fn(async(a:any)=>[...settings].filter(([key])=>key.startsWith(a.where.key.startsWith)&&(!a.where.key.in||a.where.key.in.includes(key))).map(([key,value])=>({key,value})))},
 box:{findMany:vi.fn(async()=>[{id:'b',code:'FFL_LKB0710_001',status:'active'}])},
 stockMovement:{findMany:vi.fn(async()=>[{boxId:'b',createdAt:new Date('2026-10-07T10:00:00Z'),quantity:1,sourceDocument:'RECEIPT'}])},
 tsdOperation:{findMany:vi.fn(async()=>[])},$queryRaw:vi.fn(async()=>[])};
 return {db,settings};
}
// TEST: a single scan must never enumerate the client's entire receipt history.
it.each(['fbs','fbo'])('bounds %s receipt checks while retaining approval locks and denial',async(channel)=>{
 const {db}=fixture();
 const check=()=>channel==='fbs'?assertReceiptFbsBox(db,{clientId:'c',connectionId:'cab',orderId:'o'},'b'):assertReceiptStockAvailable(db,'c',['b'],'w');
 await expect(check()).rejects.toThrow('согласовании');
 expect(db.$queryRaw).toHaveBeenCalledOnce();
 expect(db.stockMovement.findMany.mock.calls.every(([a]:any)=>a.where.boxId?.in?.join()==='b')).toBe(true);
 expect(db.box.findMany.mock.calls.every(([a]:any)=>a.where.id?.in?.join()==='b')).toBe(true);
 const openings=db.tsdOperation.findMany.mock.calls[0][0];
 expect(JSON.stringify(openings.where)).toContain('FFL_LKB0710_001');
});
// TEST: use current approval on every check; no cross-operation cache can permit revoked goods.
it('observes approval and subsequent revocation without changing receipt identity',async()=>{
 const {db,settings}=fixture();const doc=(await receiptDocuments(db,'c','w'))[0];
 settings.set(receiptApprovalKey('c','w',doc.id),{available:true,revision:1});
 await expect(assertReceiptStockAvailable(db,'c',['b'],'w')).resolves.toBeUndefined();
 settings.set(receiptApprovalKey('c','w',doc.id),{available:false,revision:2});
 await expect(assertReceiptStockAvailable(db,'c',['b'],'w')).rejects.toThrow('согласовании');
});
