// TEST: actual candidate Nest/runtime policy; all transactions are mocked and network is disabled.
require('reflect-metadata');const assert=require('node:assert/strict');
const {BillingPeriodService}=require('./dist/modules/billing/billing-period.service');
const {BillingController}=require('./dist/modules/billing/billing.controller');
const {ClientScopeService}=require('./dist/modules/auth/client-scope.service');
const {buildDoneRequestsPlan}=require('./dist/modules/billing/billing-done-requests.policy');
const user={id:'u',roleCodes:['ADMIN'],permissionCodes:['billing:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',writableWarehouseIds:['w']};
const client={id:'c',code:'C',name:'Fixture'};
const input={periodFrom:'2026-10-01',periodTo:'2026-10-02',doneRequests:true,categories:['FBS','PROCESSING','PRR','STORAGE'],excludeLukin:false};
const request={id:'r',number:1244,clientId:'c',client,warehouseId:'w',status:'DONE',updatedAt:new Date('2026-10-10'),events:[{id:'event',createdAt:new Date('2026-09-30T21:00:00Z')}]};
const charge={id:'ch',clientId:'c',client,requestId:'r',status:'APPROVED',quantity:'2',unitPriceRub:'50',totalRub:'100',description:'Packing',unit:'PIECE',serviceDate:new Date('2026-09-25'),updatedAt:new Date('2026-09-25'),invoiceItems:[]};
(async()=>{
 assert.equal(Reflect.getMetadata('path',BillingController.prototype.doneRequestsCapabilities),'invoices/done-requests/capabilities');
 let writes=0,readsOnly=0;let charges=[charge],invoices=[],requests=[request];
 const tx={$queryRaw:async()=>[], $executeRaw:async()=>{readsOnly++},clientRequest:{findMany:async()=>requests},billingCharge:{findMany:async()=>charges},billingInvoice:{findMany:async()=>invoices},auditLog:{findFirst:async()=>null,create:async()=>({})}};
 const db={...tx,$transaction:async fn=>fn(tx)},billing={writePeriodDraft:async(_,data)=>{assert.deepEqual(data.invoices,[]);writes++;return{id:'new',number:'NEW'}}};
 const service=new BillingPeriodService(db,new ClientScopeService(),billing);
 delete process.env.WMS_BILLING_DONE_REQUESTS_ENABLED;await assert.rejects(()=>service.previewPeriod(input,user));assert.equal(writes,0);
 process.env.WMS_BILLING_DONE_REQUESTS_ENABLED='true';await assert.rejects(()=>service.previewPeriod(input,{...user,permissionCodes:[]}));
 const preview=await service.previewPeriod(input,user);assert.equal(preview.groups.length,1);assert.equal(preview.groups[0].totalRub,100);assert.equal(readsOnly,1);assert.equal(writes,0);
 charges=[{...charge,totalRub:'101'}];await assert.rejects(()=>service.generatePeriod({...input,previewHash:preview.previewHash},user));assert.equal(writes,0);
 charges=[charge];await service.generatePeriod({...input,previewHash:preview.previewHash},user);assert.equal(writes,1);
 for(const status of ['DRAFT','ISSUED','PAID']){
  const invoice={id:'i',number:'INV-EXISTING',clientId:'c',client,requestId:null,warehouseId:'w',status,paidRub:0,payments:[],totalRub:100,items:[],periodFrom:new Date('2026-10-01'),periodTo:new Date('2026-10-31'),updatedAt:new Date()};
  const before=JSON.stringify(invoice);const p=buildDoneRequestsPlan(input,[request],[charge],[invoice],'w');assert.equal(p.groups.length,0);assert.equal(p.alreadyBilledCount,1);assert.equal(JSON.stringify(invoice),before);
 }
 console.log('PASS candidate: route, flag, scope, readonly preview, draft creation, stale hash and immutable DRAFT/ISSUED/PAID periods');
})().catch(e=>{console.error(e);process.exitCode=1});
