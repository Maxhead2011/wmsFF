import 'reflect-metadata';
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {indexedReceiptState,readIndexedReceiptState,type ReceiptStockIdentity} from '../src/modules/warehouse/receipt-stock-index';
import {pendingReceiptBoxIds,receiptRules,receiptAllows,assertReceiptStockAvailable} from '../src/modules/warehouse/receipt-channel-policy';
afterEach(()=>vi.unstubAllEnvs());
const id=(series:string)=>createHash('sha256').update(JSON.stringify(['c','w',series])).digest('hex').slice(0,32);
const source='SERIES:2026:FFL_RECEIPT';
const box:ReceiptStockIdentity={id:'b',clientId:'c',warehouseId:'w',code:'FFL_RECEIPT_001',status:'active',indexed:true,receiptAt:new Date('2026-10-08'),movementAt:new Date('2026-10-08')};
const scope={key:'receipt.approval.scope.v1:c:w',value:{clientId:'c',warehouseId:'w',grandfatheredReceiptIds:[]}};
function fixture(){
  vi.stubEnv('WMS_RECEIPT_STOCK_INDEX_ENABLED','true');vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');
  const settings:any[]=[];
  const db:any={$queryRaw:vi.fn(async(q:any)=>q.text.includes('"SystemSetting"')?[scope]:[box]),systemSetting:{findMany:vi.fn(async()=>settings)},stockMovement:{findMany:vi.fn(()=>{throw Error('History must not be read');})},tsdOperation:{findMany:vi.fn(()=>{throw Error('History must not be read');})}};
  return {db,settings};
}
// TEST: shared operational paths must no longer reconstruct receipt history on each request.
it('serves FBS/FBO rules and pending balances without reading movements or scans',async()=>{
  const {db}=fixture();expect(await pendingReceiptBoxIds(db,['c'],'w')).toEqual(['b']);
  expect((await receiptRules(db,'c','w')).get('b')?.stockAvailable).toBe(false);
  expect(db.stockMovement.findMany).not.toHaveBeenCalled();expect(db.tsdOperation.findMany).not.toHaveBeenCalled();
});
it('observes approval and revocation immediately, retaining transaction scope locks',async()=>{
  const {db,settings}=fixture();const saved={key:'receipt.approval.v1:c:w:'+id(source),value:{available:true}};settings.push(saved);
  await expect(assertReceiptStockAvailable(db,'c',['b'],'w')).resolves.toBeUndefined();
  saved.value.available=false;await expect(assertReceiptStockAvailable(db,'c',['b'],'w')).rejects.toThrow('согласовании');
  expect(db.$queryRaw.mock.calls.filter(([q]:any)=>q.text.includes('FOR SHARE')).length).toBe(2);
});
it('keeps directions and protected existing FBS orders, but approval denial wins',()=>{
  const rule={id:'r',clientId:'c',warehouseId:'w',sourceDocument:source,fbs:false,fbo:true,protectedOrders:['WILDBERRIES:conn:old'],revision:1,changedAt:''};
  const settings=[{key:'receipt.channels.v1:c:r',value:rule}];
  const allowed=indexedReceiptState([box],settings,[],true).rules.get('b');
  expect(receiptAllows(allowed,'fbs')).toBe(false);expect(receiptAllows(allowed,'fbo')).toBe(true);
  expect(receiptAllows(allowed,'fbs',{connectionId:'conn',orderId:'old'})).toBe(true);
  const blocked=indexedReceiptState([box],settings,[scope],true).rules.get('b');
  expect(receiptAllows(blocked,'fbs',{connectionId:'conn',orderId:'old'})).toBe(false);
});
it('membership changes immediately select the new approval',()=>{
  const settings=[{key:'receipt.approval.v1:c:w:'+id('SERIES:2026:OTHER'),value:{available:true}},{key:'receipt.membership.v1:c:b',value:{clientId:'c',warehouseId:'w',boxId:'b',series:'SERIES:2026:OTHER'}}];
  expect(indexedReceiptState([box],settings,[scope],true).pending).toEqual([]);
  settings.pop();expect(indexedReceiptState([box],settings,[scope],true).pending).toEqual(['b']);
});
it('preserves grandfathered receipts and distinguishes a reused series in another year',()=>{
  const grandfathered={...scope,value:{...scope.value,grandfatheredReceiptIds:[id(source)]}};
  expect(indexedReceiptState([box],[],[grandfathered],false).pending).toEqual([]);
  expect(indexedReceiptState([{...box,receiptAt:new Date('2027-01-01')}],[],[grandfathered],false).pending).toEqual(['b']);
});
it('fails closed for missing evidence index rows instead of silently allowing stock',()=>{
  expect(()=>indexedReceiptState([{...box,indexed:false}],[],[scope],true)).toThrow('Индекс');
  expect(indexedReceiptState([{...box,receiptAt:null}],[],[scope],true).pending).toEqual([]);
});
it('bounds data reads to client, warehouse and selected boxes without leaking another scope',async()=>{
  const {db}=fixture();await readIndexedReceiptState(db,'c','w',['b']);
  const q=db.$queryRaw.mock.calls[1][0];expect(q.values).toEqual(['c','w','b']);
  expect(indexedReceiptState([{...box,warehouseId:'other'}],[],[scope],false).pending).toEqual([]);
  expect((await readIndexedReceiptState(db,'c','w',[])).pending).toEqual([]);
});
it('keeps the sold/default path disabled and preserves disabled approval',async()=>{
  const {db}=fixture();vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','false');
  expect(await pendingReceiptBoxIds(db,['c'],'w')).toEqual([]);expect(db.$queryRaw).not.toHaveBeenCalled();
});
it('does not enumerate stock for clients outside the approval scope',async()=>{
  const {db}=fixture();db.$queryRaw.mockResolvedValue([]);
  expect((await readIndexedReceiptState(db,'other','w',undefined,false)).pending).toEqual([]);
  expect(db.$queryRaw).toHaveBeenCalledOnce();expect(db.systemSetting.findMany).not.toHaveBeenCalled();
});
