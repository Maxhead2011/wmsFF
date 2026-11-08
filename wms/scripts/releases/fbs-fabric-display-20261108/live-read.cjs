// TEST: read-only transaction against real client settings and waiting tasks.
// Client identifiers are supplied locally, never hardcoded in the release.
const fs=require('fs'),Module=require('module');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
const origin='/app/apps/api/dist/modules/marketplace-connections/';
const load=(file,overrides={})=>{const m=new Module(origin+file);m.filename=origin+file;m.paths=Module._nodeModulePaths('/app/apps/api');const req=Module.createRequire(m.filename);m.require=id=>overrides[id]||req(id);m._compile(fs.readFileSync(process.argv[2]+'/'+file,'utf8'),m.filename);return m.exports;};
const helper=load('fbs-fabric-reservation.js');const {MarketplaceConnectionsService}=load('marketplace-connections.service.js',{'./fbs-fabric-reservation':helper});
const db=new PrismaClient();
(async()=>{const out=[];for(const clientId of process.argv.slice(3)){
 out.push(await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const tasks=await tx.fbsTsdAssembly.findMany({where:{clientId,marketplace:'WILDBERRIES',status:'WAITING_STOCK'},orderBy:{updatedAt:'desc'},take:10});
  const skus=await tx.sku.findMany({where:{clientId,id:{in:tasks.map(t=>t.skuId).filter(Boolean)}}});
  const orders=tasks.map(t=>({id:t.orderId,connectionId:t.connectionId,marketplace:t.marketplace,category:'active',supplierStatus:'confirm',product:skus.find(s=>s.id===t.skuId),requiredMeta:t.requiresKiz?['sgtin']:[],optionalMeta:[]}));
  const service=Object.create(MarketplaceConnectionsService.prototype);service.prisma=tx;
  const result=await service.syncFbsPalletSortReservations(clientId,orders,true);
  return {sampledWaitingTasks:tasks.length,fabricDisplay:[...result.values()].filter(v=>v.status==='FABRIC_ON_DEMAND').length,readOnly:true};
 }));}console.log(JSON.stringify(out));})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
