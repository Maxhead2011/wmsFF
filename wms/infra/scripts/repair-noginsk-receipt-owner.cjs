// FIX: one-time ownership/scope correction for six confirmed Noginsk receipt boxes only.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const {collect}=require('./archive-reviewed-empty-boxes.cjs');
const C={old:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',target:'68cbb87b-5f53-4123-8b08-62ef372059b5',
 ng:'5bf26aae-424d-41d0-8357-5ee573d99410',msk:'afb244a1-50ae-4ae6-9111-afe85949fa58',
 admin:'b045e060-dfd7-48af-bb88-12c191ee8eae'};
const BOXES=[{"id":"0c6650f0-6fad-43cd-91b1-0bf0abdca32f","code":"FFL_NLKB0109_3","quantity":0},{"id":"a4dff636-dc5a-4670-9342-5816d5b2e2fa","code":"FFL_NLKB0109_10","quantity":6},{"id":"4c45dafd-a117-42bf-b10a-3769c58588f0","code":"FFL_NLKB0109_3FFL_NLKB0109_3","quantity":9},{"id":"eec82159-7549-434a-a90d-618a214590c1","code":"FFL_NLKB0109_8FFL_NLKB0109_8","quantity":10},{"id":"1c239d59-0f7f-4117-a249-1107aa5f157d","code":"FFL_NLKB0109_12FFL_NLKB0109_12","quantity":0},{"id":"c7738b51-2b5f-40e6-959d-7905962ec8f8","code":"FFL_NLKB0109_20","quantity":12}],MAP=[{"from":"44d4dc90-3a78-4e3b-b486-0213f6c80661","to":"f538a60b-47fb-4b5c-9811-72494923a2fa","barcode":"2052733385075"},{"from":"3bc63af4-0002-446f-ba89-267836d1260b","to":"eb1fd521-385a-4f2e-aeb6-53269f08d6c4","barcode":"2051753809820"},{"from":"9173699f-63ea-48d7-8e7f-ac379d20eea1","to":"ee7b689a-e336-411f-a728-faab02596fa4","barcode":"2052733385099"}];
const RUN='noginsk-receipt-owner-20260907',ADMIN_DOC='Административный перенос MSK → NG · FFL_NLKB0109*';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const mapped=id=>{const m=MAP.find(m=>m.from===id);assert(m,'Unknown SKU');return m.to;};
function identity(m,parse){
 const parsed=parse(m.value);if(parsed)return parsed;
 // FIX: inspect the known historical doubled scan without rewriting its original value.
 if(m.id==='cb8ea0ad-2759-483e-ab07-7dd1cfb13f19'&&m.value.length===170&&m.value.slice(0,85)===m.value.slice(85))return parse(m.value.slice(0,85));
 return null;
}
function validate(s){
 assert.equal(s.states.length,6);assert.deepEqual(s.conflicts,[]);
 assert.equal(s.clients.find(c=>c.id===C.target)?.name,'ИП Лукин И.И.');
 for(const m of MAP){
  const a=s.skus.find(x=>x.id===m.from),b=s.skus.find(x=>x.id===m.to);assert(a&&b);
  assert.equal(a.clientId,C.old);assert.equal(b.clientId,C.target);
  for(const k of ['name','article','size','color','internalSku'])assert.equal(a[k],b[k],'SKU mismatch '+k);
  assert(a.barcodes.some(v=>v.value===m.barcode)&&b.barcodes.some(v=>v.value===m.barcode));
 }
 for(const spec of BOXES){
  const row=s.states.find(r=>r.code===spec.code),b=row?.box;assert(b);assert.deepEqual(row.references,[]);
  assert.equal(b.id,spec.id);assert.equal(b.clientId,C.old);assert.equal(b.warehouseId,C.ng);
  assert.equal(b.status,'receiving');assert(!b.palletId&&!b.zoneId&&!b.storagePlacement);
  assert.equal(b.balances.reduce((n,v)=>n+v.quantity,0),spec.quantity);
  for(const v of b.balances){assert.equal(v.clientId,C.old);assert.equal(v.warehouseId,C.ng);assert.equal(v.status,'AVAILABLE');assert(v.quantity>0);assert(!v.palletId);mapped(v.skuId);}
  assert.equal(s.marks.filter(m=>m.boxId===b.id).length,spec.quantity);
  for(const v of b.balances)assert.equal(s.marks.filter(m=>m.boxId===b.id&&m.skuId===v.skuId).length,v.quantity);
 }
 assert.equal(s.marks.length,37);assert.equal(s.movements.length,45);assert.equal(s.operations.length,46);
 const ids=BOXES.map(b=>b.id),codes=BOXES.map(b=>b.code);
 for(const m of s.marks){assert.equal(m.clientId,C.old);assert.equal(m.status,'AVAILABLE');assert(ids.includes(m.boxId));mapped(m.skuId);
  assert(!m.stockMovementId||s.movements.some(v=>v.id===m.stockMovementId));}
 let received=0,technical=0,net=0,adminRows=0;
 for(const m of s.movements){
  assert(ids.includes(m.boxId));assert.equal(m.clientId,C.old);assert.equal(m.status,'AVAILABLE');mapped(m.skuId);
  assert([C.ng,C.msk].includes(m.warehouseId));net+=m.quantity;
  if(m.sourceDocument===ADMIN_DOC){assert(['MOVE','RECEIPT'].includes(m.type));technical+=m.quantity;adminRows++;}
  else {assert(m.sourceDocument?.startsWith('TSD-RECEIPT-'));assert.equal(m.type,'RECEIPT');assert.equal(m.quantity,1);received++;}
 }
 assert.equal(received,37);assert.equal(technical,0);assert.equal(adminRows,8);assert.equal(net,37);
 assert.equal(s.movements.filter(m=>m.sourceDocument===ADMIN_DOC&&m.type==='RECEIPT'&&m.quantity>0).reduce((n,m)=>n+m.quantity,0),37);
 for(const o of s.operations){assert.equal(o.status,'ACCEPTED');assert(['receipt_scan','receipt_open_box'].includes(o.operationType));
  assert.equal(o.payload.clientId,C.old);assert(codes.includes(o.payload.boxCode));
  assert(!o.payload.warehouseId||[C.ng,C.msk].includes(o.payload.warehouseId));
  if(o.payload.skuId)mapped(o.payload.skuId);}
}
function movementData(m){return {clientId:C.target,warehouseId:C.ng,skuId:mapped(m.skuId),
 // FIX: original physical receipt stays a receipt; the old +/- branch correction is a net-zero MOVE pair.
 type:m.sourceDocument===ADMIN_DOC?'MOVE':m.type};}
function operationData(o){return {payload:{...o.payload,clientId:C.target,warehouseId:C.ng,
 ...(o.payload.skuId?{skuId:mapped(o.payload.skuId)}:{})}};}
async function read(tx,parse){
 const states=await collect(tx,{warehouseId:C.ng,rows:BOXES.map(b=>({code:b.code,pallet:null}))},async()=>false);
 const ids=BOXES.map(b=>b.id);
 const marks=await tx.productMark.findMany({where:{boxId:{in:ids}},orderBy:{id:'asc'}});
 const movements=await tx.stockMovement.findMany({where:{boxId:{in:ids}},orderBy:{id:'asc'}});
 const operations=await tx.tsdOperation.findMany({where:{OR:BOXES.map(b=>({payload:{path:['boxCode'],equals:b.code}}))},orderBy:{id:'asc'}});
 const clients=await tx.client.findMany({where:{id:{in:[C.old,C.target]}},select:{id:true,name:true},orderBy:{id:'asc'}});
 const skus=await tx.sku.findMany({where:{id:{in:MAP.flatMap(m=>[m.from,m.to])}},include:{barcodes:{orderBy:{value:'asc'}}},orderBy:{id:'asc'}});
 const prefixes=marks.flatMap(m=>{const i=identity(m,parse);assert(i,'Invalid stored mark');return [
  '01'+i.gtin+'21'+i.serial,']d201'+i.gtin+'21'+i.serial,'(01)'+i.gtin+'(21)'+i.serial,
  '01'+i.gtin+'\u001d21'+i.serial,'01'+i.gtin+'<GS>21'+i.serial];});
 assert(prefixes.length);const kw={OR:prefixes.map(p=>({kiz:{startsWith:p}}))};const conflicts=[];
 const peers=await tx.productMark.findMany({where:{OR:prefixes.map(p=>({value:{startsWith:p}}))},orderBy:{id:'asc'}});
 if(hash(peers)!==hash(marks))conflicts.push('OTHER_KIZ_OWNER_OR_DUPLICATE');
 for(const [name,model,where] of [['ASSEMBLY',tx.fbsTsdAssembly,kw],['SHIPPED',tx.shippedKizHistory,kw],
 ['ATTEMPT',tx.fbsAssemblyAttemptHistory,kw],['WEB_PRINT',tx.fbsWebKizStickerPrint,kw],['TSD_PRINT',tx.fbsPrintJob,kw],
 ['CIRCULATION',tx.kizCirculationItem,{OR:prefixes.map(p=>({kizRaw:{startsWith:p}}))}]]){
  if(await model.findFirst({where,select:{id:true}}))conflicts.push(name);
 }
 return {states,marks,movements,operations,clients,skus,conflicts};
}
async function apply(tx,approved,reread,balanceKey){
 if(await tx.auditLog.findUnique({where:{id:RUN}}))return 'ALREADY_APPLIED';
 const s=await reread();validate(s);assert.equal(hash(s),hash(approved),'Live snapshot changed');
 for(const row of s.states){
  const b=row.box;
  for(const v of b.balances){const data={clientId:C.target,skuId:mapped(v.skuId),warehouseId:C.ng};
   await tx.stockBalance.update({where:{id:v.id},data:{...data,balanceKey:balanceKey({...v,...data})}});}
  await tx.box.update({where:{id:b.id},data:{clientId:C.target}});
 }
 for(const m of s.marks)await tx.productMark.update({where:{id:m.id},data:{clientId:C.target,skuId:mapped(m.skuId)}});
 for(const m of s.movements)await tx.stockMovement.update({where:{id:m.id},data:movementData(m)});
 for(const o of s.operations)await tx.tsdOperation.update({where:{id:o.id},data:operationData(o)});
 await tx.auditLog.create({data:{id:RUN,userId:C.admin,action:'NOGINSK_RECEIPT_OWNER_SCOPE_CORRECTION',entity:'Box',entityId:RUN,
 payload:{before:JSON.parse(JSON.stringify(s)),boxCount:6,quantity:37,quantityDelta:0,clientFrom:C.old,clientTo:C.target,warehouseId:C.ng}}});
 return 'APPLIED';
}
async function main(){
 const [mode,dir,digest]=process.argv.slice(2);assert(['preview','apply'].includes(mode));assert.equal(dir,'/tmp/'+RUN);
 const root='/app/apps/api';const {PrismaClient}=require(root+'/node_modules/@prisma/client');
 const {storageBoxTransferKizIdentity:parse}=require(root+'/dist/modules/stock/stock-operations.service');
 const {StockBalancesService}=require(root+'/dist/modules/stock/stock-balances.service');
 const db=new PrismaClient();try{
  const user=await db.user.findUnique({where:{id:C.admin},include:{roles:{include:{role:true}}}});
  assert.equal(user?.status,'ACTIVE');assert.equal(user.isDemo,false);assert(user.roles.some(r=>r.role.code==='ADMIN'));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(mode==='preview'){const s=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return read(tx,parse);},{timeout:60000});
   fs.writeFileSync(dir+'/before.json',JSON.stringify(s),{mode:0o600,flag:'wx'});validate(s);
   console.log(JSON.stringify({ready:true,boxes:6,quantity:37,kiz:37,digest:hash(s)}));return;}
  const approved=JSON.parse(fs.readFileSync(dir+'/before.json','utf8'));assert.equal(hash(approved),digest);validate(approved);
  const result=await db.$transaction(async tx=>{
   for(const b of [...BOXES].sort((a,b)=>a.id.localeCompare(b.id)))await tx.$queryRawUnsafe('SELECT id FROM "Box" WHERE id=$1 FOR UPDATE',b.id);
   return apply(tx,approved,()=>read(tx,parse),v=>new StockBalancesService(tx).balanceKey(v));
  },{isolationLevel:'Serializable',timeout:120000});console.log(JSON.stringify({result}));
 }finally{await db.$disconnect();}
}
module.exports={C,BOXES,MAP,RUN,ADMIN_DOC,validate,movementData,operationData,apply,hash,identity};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
