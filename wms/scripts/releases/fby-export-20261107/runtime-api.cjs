// TEST: exercise the exact runtime service with synthetic marketplace/database adapters.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),Module=require('module');
const root=path.resolve(process.argv[2]),candidate=root+'/api-candidate';
fs.cpSync(root+'/api-base',candidate,{recursive:true});fs.cpSync(root+'/api-payload',candidate,{recursive:true});
const local=Module.createRequire(path.resolve('apps/api/package.json')),original=Module._load;
Module._load=function(name,parent,main){
 if(name.endsWith('/prisma.service'))return {PrismaService:class{}};
 if(name.endsWith('/client-scope.service'))return {ClientScopeService:class{}};
 if(name.endsWith('/client-requests.service'))return {ClientRequestsService:class{}};
 if(!name.startsWith('.')&&!path.isAbsolute(name)){Module._load=original;try{return local(name)}finally{Module._load=arguments.callee}}
 return original.call(this,name,parent,main);
};
const {YandexFbyService}=require(candidate+'/modules/yandex-fby/yandex-fby.service');
process.env.WMS_YANDEX_FBY_ENABLED='true';
let passed=0;
function fixture(){let saved,fail=false,count=1;const user={id:'u',roleCodes:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'w'};
 const db={clientMarketplaceConnection:{findFirst:async()=>({id:'a',clientId:'c'})},yandexFbyShipment:{findFirst:async()=>({remoteNumber:'100',remoteId:'42',request:{warehouseId:'w'},snapshot:{lines:[{offerId:'offer',quantity:2}]}}),updateMany:async arg=>{saved=arg;return {count}}}};
 const svc=new YandexFbyService(db,{requireClientAccess:()=>{}},{});svc.remote={supply:async()=>({id:{id:42},status:'FINISHED'}),items:async()=>{if(fail)throw Error('remote failure');return [{offerId:'offer',counters:{planCount:2}}]}};
 return {svc,user,get saved(){return saved},set fail(v){fail=v},set count(v){count=v}};
}
(async()=>{
 let f=fixture(),v=await f.svc.refresh('a','r',f.user);assert.equal(v.status,'FINISHED');assert.equal(v.matches,true);assert.deepEqual(Object.keys(f.saved.data).sort(),['checkedAt','remoteStatus']);assert.equal(f.saved.where.remoteId,'42');passed++;
 f=fixture();f.count=0;await assert.rejects(()=>f.svc.refresh('a','r',f.user),/Повторите/);passed++;
 f=fixture();f.fail=true;await assert.rejects(()=>f.svc.refresh('a','r',f.user),/remote failure/);assert.equal(f.saved,undefined);passed++;
 f=fixture();await f.svc.refresh('a','r',{...f.user,isDemo:true});assert.equal(f.saved,undefined);passed++;
 f=fixture();f.svc.remote.supply=async()=>({id:{id:99},status:'FINISHED'});await assert.rejects(()=>f.svc.refresh('a','r',f.user));assert.equal(f.saved,undefined);passed++;
 f=fixture();process.env.WMS_YANDEX_FBY_ENABLED='false';await assert.rejects(()=>f.svc.refresh('a','r',f.user));assert.equal(f.saved,undefined);passed++;
 // TEST: compiled route metadata, actual workbook and packaging recheck.
 process.env.WMS_YANDEX_FBY_ENABLED='true';
 const {YandexFbyController}=require(candidate+'/modules/yandex-fby/yandex-fby.controller');
 assert.equal(Reflect.getMetadata('path',YandexFbyController.prototype.exportActual),'accounts/:id/requests/:requestId/export');passed++;
 const request={number:42,status:'PACKED',items:[{id:'i',skuId:'s',quantity:1}],yandexFbyShipment:{snapshot:{lines:[]}},fboAssembly:{phase:'COMPLETED',units:[{id:'one',requestItemId:'i',skuId:'s',barcode:'001',state:'PACKED',targetBoxId:'b'}],boxes:[{boxId:'b',closedAt:new Date(),confirmedAt:new Date()}]}};
 const db={clientMarketplaceConnection:{findFirst:async()=>({clientId:'c'})},clientRequest:{findFirst:async arg=>{assert.equal(arg.where.clientId,'c');return request}},$transaction:async fn=>fn(db)};
 const svc=new YandexFbyService(db,{requireClientAccess:()=>{}},{});svc.remote={offers:async()=>[{offerId:'sku',name:'Name',barcodes:['001']}]};
 const result=await svc.exportActual('a','r',f.user);fs.writeFileSync(root+'/export-fixture.xlsx',result.buffer);const XLSX=local('xlsx'),book=XLSX.read(result.buffer);assert.equal(book.Sheets['Поставка'].C2.v,'001');assert.equal(book.Sheets['Поставка'].D2.v,1);passed++;
 svc.remote.offers=async()=>{request.fboAssembly.phase='PACKING';return [{offerId:'sku',name:'Name',barcodes:['001']}]};await assert.rejects(()=>svc.exportActual('a','r',f.user));passed++;
 fs.writeFileSync(root+'/runtime-api-proof.json',JSON.stringify({passed,synthetic:true}));console.log('Runtime API',passed);
})().catch(e=>{console.error(e);process.exitCode=1});
