// FIX: explicit user-confirmed physical zero, scoped to two boxes and one untouched FBS reservation.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const {collect}=require('./archive-reviewed-empty-boxes.cjs');
const IDS={user:'b045e060-dfd7-48af-bb88-12c191ee8eae',client:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',warehouse:'afb244a1-50ae-4ae6-9111-afe85949fa58',
 task:'76a2b37c-4006-458c-97b5-45cf5586a372',order:'5685495786',request:'be625110-2b96-4d25-bfcc-456587aa46b2',skuS:'b4fd8923-89cd-4416-9de3-20d3396fee3a',
 boxes:[{id:'4a781d3a-4cc6-41a7-a266-e99a0c238c48',code:'FFL_LKB1807_384',pallet:'PALET_SORT_67',total:14,lines:[{sku:'b4fd8923-89cd-4416-9de3-20d3396fee3a',quantity:9},{sku:'d227336f-4ce6-4714-80fe-a061b09c7b0d',quantity:5}]},
 {id:'16bdc3f8-851d-4312-973a-7dfa06858ee2',code:'FFL_LKB1807_215',pallet:'PALET_SORT_57',total:5,lines:[{sku:'b4fd8923-89cd-4416-9de3-20d3396fee3a',quantity:5}]}]};
const RUN='confirmed-empty-1807-384-215-20260907';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validate(s){
 assert.equal(s.states.length,2);assert.deepEqual(s.conflicts,[]);
 for(const spec of IDS.boxes){const row=s.states.find(r=>r.code===spec.code),b=row?.box;assert(b);
  assert.equal(row.permanent,false);assert(row.references.every(r=>r==='FBS:'+IDS.task),'Unresolved dependencies: '+row.references.join(','));
  assert.equal(b.id,spec.id);assert.equal(b.clientId,IDS.client);assert.equal(b.warehouseId,IDS.warehouse);assert.equal(b.status,'active');
  assert.equal(b.storagePlacement?.pallet.code,spec.pallet);assert.equal(b.storagePlacement.pallet.warehouseId,IDS.warehouse);
  assert(b.balances.every(v=>v.clientId===IDS.client&&v.warehouseId===IDS.warehouse&&v.quantity>=0&&(v.status==='AVAILABLE'||v.quantity===0)));
  assert.equal(b.balances.reduce((n,v)=>n+v.quantity,0),spec.total);
  for(const l of spec.lines){assert.equal(b.balances.filter(v=>v.skuId===l.sku).reduce((n,v)=>n+v.quantity,0),l.quantity);assert.equal(b.productMarks.filter(m=>m.skuId===l.sku).length,l.quantity);}
  assert.equal(b.productMarks.length,spec.total);assert(b.productMarks.every(m=>m.boxId===b.id&&m.clientId===IDS.client&&m.status==='AVAILABLE'));
 }
 const t=s.task;assert(t);assert.equal(t.id,IDS.task);assert.equal(t.orderId,IDS.order);assert.equal(t.requestId,IDS.request);assert.equal(t.clientId,IDS.client);assert.equal(t.skuId,IDS.skuS);
 assert.equal(t.status,'IN_PROGRESS');assert.equal(t.reservedBoxId,IDS.boxes[1].id);
 for(const field of ['boxId','boxCode','barcode','sourceBarcode','kiz','completedAt','relabelConfirmedAt','stickerBarcode','stickerPartA','stickerPartB','cargoPackingId','cargoPackedAt','marketplaceSubmittedAt'])assert(!t[field],'Task already scanned: '+field);
 assert.equal(s.request.number,725);assert.equal(s.request.clientId,IDS.client);assert.equal(s.request.warehouseId,IDS.warehouse);assert(!['DONE','CANCELLED','REJECTED'].includes(s.request.status));
}
async function load(tx,policy,parse){
 const states=await collect(tx,{warehouseId:IDS.warehouse,rows:IDS.boxes.map(b=>({code:b.code,pallet:b.pallet}))},policy);
 const marks=await tx.productMark.findMany({where:{boxId:{in:IDS.boxes.map(b=>b.id)}},orderBy:{id:'asc'}});
 for(const row of states)if(row.box)row.box.productMarks=marks.filter(m=>m.boxId===row.box.id);
 const prefixes=marks.flatMap(m=>{const i=parse(m.value);if(!i)throw Error('Invalid stored KIZ');return [`01${i.gtin}21${i.serial}`,`]d201${i.gtin}21${i.serial}`,`(01)${i.gtin}(21)${i.serial}`,`01${i.gtin}\u001d21${i.serial}`,`01${i.gtin}<GS>21${i.serial}`];});
 if(!prefixes.length)throw Error('Stored marks changed');
 const kw={OR:prefixes.map(p=>({kiz:{startsWith:p}}))};
 const peers=await tx.productMark.findMany({where:{OR:prefixes.map(p=>({value:{startsWith:p}}))},orderBy:{id:'asc'}});
 const conflicts=[];if(hash(peers)!==hash(marks))conflicts.push('KIZ_DUPLICATE_OR_OTHER_LOCATION');
 for(const [name,model,where] of [['ASSEMBLY',tx.fbsTsdAssembly,kw],['SHIPPED',tx.shippedKizHistory,kw],['ATTEMPT',tx.fbsAssemblyAttemptHistory,kw],
   ['WEB_PRINT',tx.fbsWebKizStickerPrint,kw],['TSD_PRINT',tx.fbsPrintJob,kw],['CIRCULATION',tx.kizCirculationItem,{OR:prefixes.map(p=>({kizRaw:{startsWith:p}}))}]]){
   if(await model.findFirst({where,select:{id:true}}))conflicts.push(name);
 }
 const task=await tx.fbsTsdAssembly.findUnique({where:{id:IDS.task}});
 const request=await tx.clientRequest.findUnique({where:{id:IDS.request},select:{number:true,status:true,warehouseId:true,clientId:true}});
 return {states,conflicts,task,request};
}
async function applyData(tx,approved,reread,detach){
 if(await tx.auditLog.findUnique({where:{id:RUN}}))return 'ALREADY_APPLIED';
 const s=await reread();validate(s);assert.equal(hash(s),hash(approved),'Snapshot changed; no correction applied');
 for(const row of s.states){const b=row.box;
  for(const balance of b.balances.filter(v=>v.quantity>0)){
   const changed=await tx.stockBalance.updateMany({where:{id:balance.id,quantity:balance.quantity,updatedAt:balance.updatedAt},data:{quantity:0}});assert.equal(changed.count,1);
   await tx.stockMovement.create({data:{clientId:IDS.client,warehouseId:IDS.warehouse,skuId:balance.skuId,boxId:b.id,palletId:balance.palletId||null,
    type:'INVENTORY_ADJUSTMENT',status:'AVAILABLE',quantity:-balance.quantity,idempotencyKey:RUN+':'+balance.id,sourceDocument:RUN,
    comment:'Константин подтвердил фактический остаток 0; короб физически пуст и отсутствует на паллет-сорте. Корректировка расхождения, не повторная отгрузка.'}});
  }
  // FIX: retain each KIZ and its history; remove only its stale available source ownership.
  for(const m of b.productMarks){const changed=await tx.productMark.updateMany({where:{id:m.id,boxId:b.id,status:'AVAILABLE',updatedAt:m.updatedAt},data:{boxId:null,status:'BLOCKED'}});assert.equal(changed.count,1);}
  const changed=await tx.box.updateMany({where:{id:b.id,status:'active',warehouseId:IDS.warehouse},data:{status:'archived',zoneId:null,palletId:null}});assert.equal(changed.count,1);
  const result=await detach.detachIfArchivedAndEmpty({boxId:b.id,userId:IDS.user,reason:RUN},tx);assert.equal(result.detached,true);
 }
 // FIX: only clear a reservation before physical work; keep Karina, the order and request intact.
 const t=s.task;const changed=await tx.fbsTsdAssembly.updateMany({where:{id:t.id,status:'IN_PROGRESS',updatedAt:t.updatedAt,reservedBoxId:IDS.boxes[1].id,boxId:null,barcode:null,kiz:null},
  data:{reservedBoxId:null,reservedBoxCode:null,reservedAt:null,storageBoxes:[],errorMessage:'Фактический остаток исходного короба подтверждён равным 0. Маршрут обновляется; заказ сохранён.'}});assert.equal(changed.count,1);
 await tx.auditLog.create({data:{id:RUN,userId:IDS.user,action:'ADMIN_CONFIRMED_EMPTY_BOX_CORRECTION',entity:'Box',entityId:RUN,
  payload:{before:JSON.parse(JSON.stringify(s)),quantityDelta:-19,physicalQuantity:0,affectedRequestIds:[IDS.request],routePending:true}}});
 return 'APPLIED';
}
async function main(){
 const [mode,dir,digest]=process.argv.slice(2);assert(['preview','apply','route'].includes(mode));assert(dir?.startsWith('/tmp/confirmed-empty-1807-20260907'));
 const root='/app/apps/api';const {PrismaClient}=require(root+'/node_modules/@prisma/client');
 const {BoxCodePolicyService,preserveEmptyStorageBox}=require(root+'/dist/common/boxes/box-code-policy.service');
 const {SystemSettingsService}=require(root+'/dist/common/settings/system-settings.service');
 const {ArchivedEmptyBoxPalletDetachService}=require(root+'/dist/common/boxes/archived-empty-box-pallet-detach.service');
 const {storageBoxTransferKizIdentity:parse}=require(root+'/dist/modules/stock/stock-operations.service');
 assert.equal(process.env.WMS_PERMANENT_STORAGE_BOXES_ENABLED,'true');const db=new PrismaClient();
 const read=tx=>load(tx,code=>preserveEmptyStorageBox(code,new BoxCodePolicyService(new SystemSettingsService(tx))),parse);
 try{
  const user=await db.user.findUnique({where:{id:IDS.user},select:{status:true,isDemo:true,activeWarehouseId:true,roles:{select:{role:{select:{code:true}}}}}});
  assert.equal(user.status,'ACTIVE');assert.equal(user.isDemo,false);assert.equal(user.activeWarehouseId,IDS.warehouse);assert(user.roles.some(r=>r.role.code==='ADMIN'));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(mode==='preview'){
   const before=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return read(tx);},{timeout:60000});
   fs.writeFileSync(dir+'/before.json',JSON.stringify(before),{mode:0o600,flag:'wx'});validate(before);
   console.log(JSON.stringify({ready:true,quantity:19,kiz:19,boxes:before.states.map(s=>s.code),request:725,digest:hash(before)}));return;
  }
  const before=JSON.parse(fs.readFileSync(dir+'/before.json','utf8'));assert.equal(hash(before),digest);validate(before);
  if(mode==='apply'){
   const result=await db.$transaction(async tx=>{for(const b of [...IDS.boxes].sort((a,b)=>a.id.localeCompare(b.id)))await tx.$queryRawUnsafe('SELECT id FROM "Box" WHERE id=$1 FOR UPDATE',b.id);
    await tx.$queryRawUnsafe('SELECT id FROM "FbsTsdAssembly" WHERE id=$1 FOR UPDATE',IDS.task);
    const codes=new BoxCodePolicyService(new SystemSettingsService(tx));return applyData(tx,before,()=>read(tx),new ArchivedEmptyBoxPalletDetachService(tx,codes));
   },{isolationLevel:'Serializable',timeout:120000});console.log(JSON.stringify({correction:result}));
  }
  const audit=await db.auditLog.findUnique({where:{id:RUN}});assert(audit,'Correction must precede route rebuilding');
  const {ConfigService}=require(root+'/node_modules/@nestjs/config');const {AccessTokenService}=require(root+'/dist/modules/auth/access-token.service');
  const {UserSessionService}=require(root+'/dist/modules/auth/user-session.service');const tokens=new AccessTokenService(new ConfigService());
  const token=tokens.sign(IDS.user,{deviceCode:'WMS-MAINT-EMPTY-1807-20260907'});
  try{
   const response=await fetch('http://127.0.0.1:3000/api/v1/marketplace-connections/fbs/requests/'+IDS.request+'/route/rebuild',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'WMS approved empty box correction 20260907'},body:'{}',signal:AbortSignal.timeout(180000)});
   const body=await response.json();fs.writeFileSync(dir+'/route-result.json',JSON.stringify({status:response.status,body}),{mode:0o600});
   if(!response.ok)throw Error('Route rebuild failed: '+response.status+' '+String(body.message||''));
   await db.auditLog.update({where:{id:RUN},data:{payload:{...audit.payload,routePending:false,routeRefreshedAt:new Date().toISOString()}}});
   console.log(JSON.stringify({routeUpdated:725}));
  }finally{await new UserSessionService(db,tokens).revokeByToken(token);}
 }finally{await db.$disconnect();}
}
module.exports={validate,applyData,IDS};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
