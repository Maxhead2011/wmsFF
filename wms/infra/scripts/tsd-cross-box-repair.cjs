// FIX: scoped, user-confirmed repair via the normal authenticated preview/confirm API.
// No direct balance writes; token stays in memory and its session is revoked afterwards.
const assert=require('node:assert/strict'),fs=require('node:fs');
const ids={user:'b045e060-dfd7-48af-bb88-12c191ee8eae',client:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',warehouse:'afb244a1-50ae-4ae6-9111-afe85949fa58',sku:'8140704f-54bf-48cd-aa41-5a8aebd0293e',old:'71ac762d-b0c8-4eba-bbb1-db0c814294c4',source:'a387911f-fbb8-470c-8522-da947e8b8987',mark:'1e8ff4b1-9dae-4d2f-a068-30075aabe437'};
const root=process.env.WMS_REPAIR_REPORT_DIR||'/opt/logoff-wms-backups/tsd-cross-box-20260907';
function validateBefore(s){
 assert.equal(s.user.status,'ACTIVE');assert.equal(s.user.isDemo,false);assert(s.user.roles.some(x=>x.role.code==='ADMIN'));
 assert.equal(s.old.code,'FFL_LKB1107_393');assert.equal(s.source.code,'FFL_LKB2107_170');
 for(const box of [s.old,s.source]){assert.equal(box.clientId,ids.client);assert.equal(box.warehouseId,ids.warehouse)}
 const quantity=id=>s.balances.filter(x=>x.boxId===id&&x.skuId===ids.sku&&x.status==='AVAILABLE').reduce((n,x)=>n+x.quantity,0);
 assert.equal(quantity(ids.old),5);assert.equal(quantity(ids.source),1);assert.equal(s.active.length,0);
 assert.equal(s.mark.id,ids.mark);assert.equal(s.mark.boxId,ids.old);assert.equal(s.mark.status,'AVAILABLE');assert.equal(s.mark.clientId,ids.client);assert.equal(s.mark.skuId,ids.sku);
}
function validatePreview(p){assert.equal(p.state,'RECOUNT_READY');assert.equal(p.quantity,1);assert.equal(p.previousQuantity,1);assert.equal(p.delta,0);assert.equal(p.registeredCount,0);assert.equal(p.adminConfirmationRequired,true);assert.equal(typeof p.snapshot,'string');assert(p.snapshot.length===64)}
async function main(){
 const mode=process.argv[2];assert(['preview','apply','retry'].includes(mode));
 const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
 const {ConfigService}=require('/app/apps/api/node_modules/@nestjs/config');
 const {AccessTokenService}=require('/app/apps/api/dist/modules/auth/access-token.service');
 const {UserSessionService}=require('/app/apps/api/dist/modules/auth/user-session.service');
 const db=new PrismaClient(),tokens=new AccessTokenService(new ConfigService());let token;
 try{
  let payload;
  if(mode==='retry')payload=JSON.parse(fs.readFileSync(root+'/repair-pending.json','utf8'));
  else {
   const before=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [user,old,source,balances,mark,active,marks]=await Promise.all([
     tx.user.findUnique({where:{id:ids.user},select:{status:true,isDemo:true,roles:{select:{role:{select:{code:true}}}}}}),
     tx.box.findUnique({where:{id:ids.old},select:{code:true,clientId:true,warehouseId:true}}),
     tx.box.findUnique({where:{id:ids.source},select:{code:true,clientId:true,warehouseId:true}}),
     tx.stockBalance.findMany({where:{boxId:{in:[ids.old,ids.source]}},orderBy:{id:'asc'}}),
     tx.productMark.findUnique({where:{id:ids.mark}}),
     tx.fbsTsdAssembly.findMany({where:{clientId:ids.client,completedAt:null,status:{notIn:['COMPLETED','CANCELLED','SHIPPED','RETURNED']},AND:[{OR:[{skuId:ids.sku},{sourceSkuId:ids.sku}]},{OR:[{boxId:{in:[ids.old,ids.source]}},{reservedBoxId:{in:[ids.old,ids.source]}}]}]},select:{id:true}}),
     tx.productMark.findMany({where:{boxId:{in:[ids.old,ids.source]}},orderBy:{id:'asc'}})]);
    return{user,old,source,balances,mark,active,marks};
   });
   validateBefore(before);fs.writeFileSync(root+'/repair-before-'+mode+'.json',JSON.stringify(before),{mode:0o600});
   payload={fromBoxCode:'FFL_LKB2107_170',barcode:'2047945626535',kizCodes:[before.mark.value],allUnitsScanned:true,oldBoxCounts:[{boxCode:'FFL_LKB1107_393',quantity:0}],idempotencyKey:'admin-cross-box-20260907-1107-393-2107-170'};
  }
  token=tokens.sign(ids.user,{deviceCode:'WMS-MAINT-CROSS-BOX-20260907'});
  const call=async(action,body)=>{
   const r=await fetch('http://127.0.0.1:3000/api/v1/tsd/transfers/kiz-recount/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'WMS authorized scoped stock correction 20260907'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
   const p=await r.json();fs.writeFileSync(root+'/repair-'+action+'-'+mode+'.json',JSON.stringify({status:r.status,...p}),{mode:0o600});
   if(!r.ok)throw new Error('API '+r.status+': '+(p.message||'see private operation report'));return p;
  };
  if(mode!=='retry'){
   const preview=await call('preview',payload);validatePreview(preview);
   console.log(JSON.stringify({state:preview.state,oldBox:'FFL_LKB1107_393',oldBefore:5,oldAfter:0,currentBox:'FFL_LKB2107_170',currentBefore:1,currentAfter:preview.quantity,registeredKiz:preview.registeredCount}));
   if(mode==='preview')return;
   payload={...payload,snapshot:preview.snapshot,adminConfirmed:true};fs.writeFileSync(root+'/repair-pending.json',JSON.stringify(payload),{mode:0o600,flag:'wx'});
  }
  const result=await call('confirm',payload);assert.equal(result.state,'RECOUNT_APPLIED');
  const balances=await db.stockBalance.findMany({where:{boxId:{in:[ids.old,ids.source]}},orderBy:{id:'asc'}});
  const mark=await db.productMark.findUnique({where:{id:ids.mark},select:{id:true,status:true,boxId:true,skuId:true}});
  const quantity=id=>balances.filter(x=>x.boxId===id&&x.skuId===ids.sku&&x.status==='AVAILABLE').reduce((n,x)=>n+x.quantity,0);
  assert.equal(quantity(ids.old),0);assert.equal(quantity(ids.source),1);assert.equal(mark.boxId,ids.source);assert.equal(mark.status,'AVAILABLE');
  fs.writeFileSync(root+'/repair-after.json',JSON.stringify({balances,mark,result}),{mode:0o600});
  console.log(JSON.stringify({state:result.state,oldQuantity:quantity(ids.old),currentQuantity:quantity(ids.source),markMoved:true,refreshedRequests:result.affectedRequestIds}));
 }finally{if(token)await new UserSessionService(db,tokens).revokeByToken(token);await db.$disconnect()}
}
module.exports={validateBefore,validatePreview,ids};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
