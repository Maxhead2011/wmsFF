import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { receiptAllows, receiptApprovalState, receiptApprovalEnabled, receiptApprovalScopeKey, receiptApprovalKey, receiptDocuments, receiptRules, pendingReceiptBoxIds, changeReceiptApproval, receiptPublicationPolicy } from '../src/modules/warehouse/receipt-channel-policy';
import { ReceiptChannelsController } from '../src/modules/warehouse/receipt-channels.controller';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';

afterEach(()=>vi.unstubAllEnvs());
// TEST: a new receipt is unavailable until confirmed; rollout preserves previous receipts.
it('requires approval for new receipts and preserves grandfathered receipts',()=>{
  expect(receiptApprovalState('new',{grandfatheredReceiptIds:['old']},null).available).toBe(false);
  expect(receiptApprovalState('old',{grandfatheredReceiptIds:['old']},null).available).toBe(true);
  expect(receiptApprovalState('new',null,null).available).toBe(true);
  expect(receiptApprovalState('old',{grandfatheredReceiptIds:['old']},{available:false,revision:2}).available).toBe(false);
});

function fixture(){
 vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');
 const settings=new Map<string,any>([[receiptApprovalScopeKey('c','w'),{clientId:'c',warehouseId:'w',grandfatheredReceiptIds:[]}]]);
 const db:any={systemSetting:{findMany:vi.fn(async(a:any)=>[...settings].filter(([k])=>k.startsWith(a.where.key.startsWith)).map(([key,value])=>({key,value}))),findUnique:vi.fn(async(a:any)=>settings.has(a.where.key)?{key:a.where.key,value:settings.get(a.where.key)}:null),upsert:vi.fn(async(a:any)=>settings.set(a.where.key,a.update.value)),update:vi.fn(async(a:any)=>settings.set(a.where.key,a.data.value))},
  stockMovement:{findMany:vi.fn(async(a:any)=>a.where.status==='PACKING'?[]:[{boxId:'b',createdAt:new Date('2026-10-07T10:00:00Z'),quantity:5,sourceDocument:'RECEIPT-7'}])},
  tsdOperation:{findMany:vi.fn(async()=>[])},box:{findMany:vi.fn(async()=>[{id:'b',code:'FFL_LKB0710_001',status:'active'}])},
  stockBalance:{findMany:vi.fn(async()=>[{boxId:'b',skuId:'sku',quantity:5}]),update:vi.fn(),delete:vi.fn()},
  clientRequest:{findMany:vi.fn(async()=>[])},clientRequestBoxSelection:{findMany:vi.fn(async()=>[])},fbsTsdAssembly:{findMany:vi.fn(async()=>[])},fboAssemblyUnit:{findMany:vi.fn(async()=>[])},auditLog:{create:vi.fn()},$queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>0)};
 return {db,settings};
}
const owner={id:'owner',name:'Владелец',roleCodes:['OWNER']},client={id:'client-user',name:'Представитель Лукина',roleCodes:['CLIENT']};
// TEST: physical quantity is untouched while the same stock is excluded from display and WB publication.
it('hides an unapproved receipt and excludes all of it from publication without changing storage',async()=>{
 const {db}=fixture();expect(await pendingReceiptBoxIds(db,['c'],'w')).toEqual(['b']);
 expect((await receiptRules(db,'c','w')).get('b')?.stockAvailable).toBe(false);
 expect((await receiptPublicationPolicy(db,'c','w')).blocked).toEqual(['b']);
 expect(db.stockBalance.update).not.toHaveBeenCalled();expect(db.stockBalance.delete).not.toHaveBeenCalled();
});
// TEST: both preview and client approval use server-side identity and preserve stock quantities.
it('lets a scoped client confirm and records who and when, while preview does not write',async()=>{
 const {db,settings}=fixture(),doc=(await receiptDocuments(db,'c','w'))[0],input={clientId:'c',warehouseId:'w',id:doc.id,available:true,revision:0};
 await changeReceiptApproval(db,input,client,false);expect(db.systemSetting.upsert).not.toHaveBeenCalled();
 await changeReceiptApproval(db,input,client,true);
 const saved=settings.get(receiptApprovalKey('c','w',doc.id));expect(saved).toMatchObject({available:true,changedByUserId:'client-user',changedByName:'Представитель Лукина',revision:1});expect(Number.isFinite(Date.parse(saved.changedAt))).toBe(true);
 expect(await pendingReceiptBoxIds(db,['c'],'w')).toEqual([]);expect(db.auditLog.create).toHaveBeenCalledOnce();expect(db.stockBalance.update).not.toHaveBeenCalled();
 await expect(changeReceiptApproval(db,input,owner,true)).rejects.toThrow('уже изменена');
});
it('blocks client revocation and administrator revocation of reserved goods',async()=>{
 const {db}=fixture(),doc=(await receiptDocuments(db,'c','w'))[0],input={clientId:'c',warehouseId:'w',id:doc.id,available:false,revision:0};
 await expect(changeReceiptApproval(db,input,client,true)).rejects.toThrow('администратор');
 db.clientRequestBoxSelection.findMany.mockResolvedValue([{requestItem:{requestId:'request'}}]);db.clientRequest.findMany.mockResolvedValue([{number:1805}]);
 await expect(changeReceiptApproval(db,input,owner,true)).rejects.toThrow('1805');expect(db.systemSetting.upsert).not.toHaveBeenCalled();
});
it('does not expose another client through list, history, file or confirmation',async()=>{
 const {db}=fixture(),controller=new ReceiptChannelsController(db,new ClientScopeService(),{} as any),user:any={...client,permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:['own'],activeWarehouseId:'w'};
 await expect(controller.list(user,'other')).rejects.toThrow('Нет доступа');await expect(controller.history(user,'other','w','id')).rejects.toThrow('Нет доступа');
 await expect(controller.file(user,'other','w','id',{} as any)).rejects.toThrow('Нет доступа');
 await expect(controller.approval(user,{clientId:'other',warehouseId:'w',id:'a'.repeat(32),available:true,revision:0,save:true})).rejects.toThrow('Нет доступа');
 expect(db.stockMovement.findMany).not.toHaveBeenCalled();
});
it('never queries approval records on a sold installation',async()=>{const {db}=fixture();vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','false');expect(await pendingReceiptBoxIds(db,['c'],'w')).toEqual([]);expect(db.systemSetting.findMany).not.toHaveBeenCalled();});
// TEST: existing FBS protection cannot bypass client approval, and neither can FBO.
it('blocks both channels including a previously protected order',()=>{
  const rule:any={fbs:true,fbo:true,stockAvailable:false,protectedOrders:['WILDBERRIES:c:old']};
  expect(receiptAllows(rule,'fbs',{marketplace:'WILDBERRIES',connectionId:'c',orderId:'old'})).toBe(false);
  expect(receiptAllows(rule,'fbo')).toBe(false);
  expect(receiptAllows({...rule,stockAvailable:true},'fbo')).toBe(true);
});
// TEST: sold WMS does not activate the new behavior.
it('requires the separate installation flag',()=>{
 vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','false');expect(receiptApprovalEnabled()).toBe(false);
 vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');expect(receiptApprovalEnabled()).toBe(true);
});
// TEST: authenticated own-client access includes the menu and cannot forge the confirmation author.
it('lists and confirms the own client receipt through the controller',async()=>{
 const {db,settings}=fixture();db.$transaction=vi.fn(async(fn:any)=>fn(db));
 const user:any={...client,permissionCodes:['stock:read'],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c'],activeWarehouseId:'w'};
 const controller=new ReceiptChannelsController(db,new ClientScopeService(),{get:()=>({refreshReceiptChannelStocks:async()=>{}})} as any);
 const data=await controller.list(user,'c','2026-01-01','2026-12-31');expect(data.rows).toHaveLength(1);expect(data.rows[0].approval.available).toBe(false);
 await controller.approval(user,{clientId:'c',warehouseId:'w',id:data.rows[0].id,available:true,revision:0,save:true,changedByName:'Forged'});
 expect(settings.get(receiptApprovalKey('c','w',data.rows[0].id)).changedByName).toBe(client.name);
 await expect(controller.approval(user,{clientId:'c',warehouseId:'other',id:data.rows[0].id,available:true,revision:1,save:true})).rejects.toThrow('Нет доступа');
});
