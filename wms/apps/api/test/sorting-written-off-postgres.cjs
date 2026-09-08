// TEST: end-to-end service flow on a strictly isolated synthetic PostgreSQL database.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'invalid:');
assert.equal(process.env.NODE_ENV,'test');assert.equal(url.hostname,'sorting-pr63-postgres-20260907');assert.equal(url.pathname,'/sorting_written_off_test');
process.env.WMS_PALLET_SORTING_ENABLED='true';
const {PrismaClient}=require('@prisma/client');
const {PalletSortingService}=require('../dist/modules/inventory/pallet-sorting.service');
const {StockOperationsService}=require('../dist/modules/stock/stock-operations.service');
const {StockBalancesService}=require('../dist/modules/stock/stock-balances.service');
const {ClientScopeService}=require('../dist/modules/auth/client-scope.service');
const {BoxCodePolicyService,DEFAULT_BOX_CODE_POLICY}=require('../dist/common/boxes/box-code-policy.service');
const {ArchivedEmptyBoxPalletDetachService}=require('../dist/common/boxes/archived-empty-box-pallet-detach.service');
const p=new PrismaClient(),scopes=new ClientScopeService(),policy=new BoxCodePolicyService({get:async()=>DEFAULT_BOX_CODE_POLICY});
const stock=new StockOperationsService(p,scopes,new StockBalancesService(p,scopes),undefined,undefined,undefined,policy);
// TEST: use the candidate's real adapter, including ADMIN and client-scope checks.
assert.equal(typeof stock.restoreWrittenOffSortingUnit,'function');
const make=db=>new PalletSortingService(db,scopes,policy,stock,new ArchivedEmptyBoxPalletDetachService(p,policy),{});
async function main(){
 assert.equal(await p.client.count(),0);
 const client=await p.client.create({data:{code:'QA_RESTORE',name:'Synthetic restoration'}});
 const wh=await p.warehouse.create({data:{code:'QA_RESTORE',name:'Synthetic'}});
 const actor=await p.user.create({data:{email:'restore@example.invalid',passwordHash:'NOT_A_PASSWORD',name:'Test admin'}});
 const user={id:actor.id,roleCodes:['ADMIN'],permissionCodes:['system:admin'],activeWarehouseId:wh.id};
 const sku=await p.sku.create({data:{clientId:client.id,internalSku:'QA',name:'Test',barcodes:{create:{value:'4600000000001'}}}});
 const pallet=await p.storagePallet.create({data:{clientId:client.id,warehouseId:wh.id,code:'PAL_RESTORE'}});
 await p.storagePalletBox.create({data:{palletId:pallet.id,boxCode:'FFL_QA_MISSING'}});
 const old=await p.box.create({data:{clientId:client.id,warehouseId:wh.id,code:'FFL_QA_OLD',status:'archived'}});
 const written=new Date('2026-08-27T17:17:56.945Z');
 await p.stockMovement.create({data:{clientId:client.id,warehouseId:wh.id,skuId:sku.id,boxId:old.id,type:'INVENTORY_ADJUSTMENT',status:'AVAILABLE',quantity:-5,sourceDocument:'admin-unpalleted-writeoff',createdAt:written}});
 const canonical=s=>`010460000000000121${s}`;
 async function mark(s){return p.productMark.create({data:{clientId:client.id,skuId:sku.id,value:canonical(s),status:'BLOCKED',sourceDocument:'admin-unpalleted-writeoff',updatedAt:new Date(written.getTime()+3)}});}
 const first=await mark('FIRST00000001');const second=await mark('SECOND0000001');const third=await mark('THIRD00000001');
 const s=make(p);let state=await s.start({id:randomUUID(),code:pallet.code},user);
 const act=async(action,extra={})=>state=await s.action(state.id,{operationId:randomUUID(),version:state.version,action,...extra},user);
 await act('SCAN_SOURCE',{code:'FFL_QA_MISSING'});await act('BEGIN_FORMING');await act('OPEN_TARGET',{code:'FFL_QA_NEW',palletCode:pallet.code});
 const target=state.activeTargetId;
 async function confirmation(value){
  const scan={operationId:randomUUID(),version:state.version,action:'MOVE',barcode:'4600000000001',kiz:value};
  try{await s.action(state.id,scan,user);assert.fail('Confirmation required');}catch(e){assert.equal(e.getResponse().code,'SORTING_WRITEOFF_CONFIRM_REQUIRED');return {...scan,operationId:randomUUID(),confirmRestore:true,restoreFingerprint:e.getResponse().fingerprint};}
 }
 const cmd=await confirmation(first.value);
 assert.equal(await p.stockBalance.count(),0);assert.equal((await p.productMark.findUnique({where:{id:first.id}})).status,'BLOCKED');
 state=await s.action(state.id,cmd,user);state=await s.action(state.id,cmd,user);
 assert.equal(state.moves.length,1);assert.equal(state.targets[0].quantity,1);assert.equal(await p.productMark.count(),3);
 assert.equal((await p.stockBalance.aggregate({_sum:{quantity:true}}))._sum.quantity,1);
 assert.equal((await p.productMark.findUnique({where:{id:first.id}})).boxId,target);
 const rollback=await confirmation(second.value);
 const faulty=new Proxy(p,{get(t,k){if(k==='$transaction')return(fn,opts)=>p.$transaction(tx=>fn(new Proxy(tx,{get(t2,k2){if(k2==='auditLog')return new Proxy(tx.auditLog,{get(a,m){if(m==='create')return arg=>arg.data.action==='PALLET_SORTING_COMMAND'?Promise.reject(Error('TEST_ROLLBACK')):a.create(arg);return Reflect.get(a,m);}});return Reflect.get(t2,k2);}})),opts);return Reflect.get(t,k);}});
 await assert.rejects(make(faulty).action(state.id,rollback,user),/TEST_ROLLBACK/);
 assert.equal((await p.productMark.findUnique({where:{id:second.id}})).status,'BLOCKED');assert.equal((await s.get(state.id,user)).moves.length,1);
 assert.equal((await p.stockBalance.aggregate({_sum:{quantity:true}}))._sum.quantity,1);
 const concurrent=await confirmation(third.value);
 const results=await Promise.allSettled([s.action(state.id,concurrent,user),s.action(state.id,concurrent,user)]);assert.ok(results.some(r=>r.status==='fulfilled'));
 state=await s.action(state.id,concurrent,user);assert.equal(state.moves.length,2);
 assert.equal((await p.stockBalance.aggregate({_sum:{quantity:true}}))._sum.quantity,2);
 assert.equal(await p.stockMovement.count({where:{quantity:1}}),2);
 assert.equal(await p.auditLog.count({where:{action:'PALLET_SORTING_WRITTEN_OFF_KIZ_RESTORED'}}),2);
 // TEST: shipping evidence inserted after preview invalidates the attempted approval.
 const blocked=await confirmation(second.value);
 await p.fbsWebKizStickerPrint.create({data:{id:randomUUID(),kiz:second.value,orderId:'QA_ORDER',assemblyId:'QA_TASK',clientId:client.id,requestId:'QA_REQUEST',printedById:user.id,printedBy:'Test admin'}});
 await assert.rejects(s.action(state.id,blocked,user),/заказ/);assert.equal((await p.stockBalance.aggregate({_sum:{quantity:true}}))._sum.quantity,2);
 console.log(JSON.stringify({result:'PASS',confirmation:true,sameMark:true,receiptQuantity:2,retry:true,concurrency:true,rollback:true,lateShipmentBlocked:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>p.$disconnect());
