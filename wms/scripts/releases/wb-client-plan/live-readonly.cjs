// TEST: real deployed DTO/service, real availability and always-rolled-back PostgreSQL transactions.
// Expected request/event/audit writes are intercepted in memory. The transaction is rolled back even after a successful check.
const fs=require('node:fs'),assert=require('node:assert/strict');
const req=require('node:module').createRequire('/app/apps/api/package.json');
req('reflect-metadata');
const {PrismaClient}=req('@prisma/client'),p=new PrismaClient();
const {ClientRequestsService}=req('./dist/modules/client-requests/client-requests.service');
const {ClientScopeService}=req('./dist/modules/auth/client-scope.service');
const {CreateClientRequestDto}=req('./dist/modules/client-requests/dto/create-client-request.dto');
const {plainToInstance}=req('class-transformer'),{validate}=req('class-validator');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));let recorded=[],audits=[];
function delegate(model,name){return new Proxy(model,{get(target,method){
 if(method==='create'&&['clientRequest','clientRequestEvent','auditLog'].includes(name))return async args=>{
  if(name==='clientRequest'){recorded.push(args.data);return {...args.data,id:'readonly-proof-not-stored',items:args.data.items.create,client:{name:'Read-only proof'}};}
  if(name==='auditLog')audits.push(args.data);return {};
 };
 const value=target[method];return typeof value==='function'?value.bind(target):value;
}})}
function wrap(db){return new Proxy(db,{get(target,key){
 if(key==='$transaction')return async (fn,options)=>{let value;const rollback=new Error('release proof rollback');try{await p.$transaction(async tx=>{value=await fn(wrap(tx));throw rollback;},options);}catch(error){if(error!==rollback)throw error;}return value;};
 if(['clientRequest','clientRequestEvent','auditLog'].includes(key))return delegate(target[key],key);
 const value=target[key];return typeof value==='function'?value.bind(target):value;
}})}
async function snapshot(){return {count:await p.clientRequest.count({where:{clientId:input.clientId}}),request:await p.clientRequest.findUnique({where:{id:input.existingRequestId},include:{items:true,files:true}})}}
(async()=>{
 const before=await snapshot(),service=new ClientRequestsService(wrap(p),new ClientScopeService(),{});
 const dto=plainToInstance(CreateClientRequestDto,{clientId:input.clientId,warehouseId:input.warehouseId,type:'OUTBOUND',title:'Read-only release proof',destinationCity:'Moscow',fboExcel:true,fboFormationMode:'WB_CLIENT_PLAN',items:input.items});
 assert.deepEqual(await validate(dto,{whitelist:true,forbidNonWhitelisted:true}),[]);
 const result=await service.create(dto,input.user);assert.equal(result.items.length,input.items.length);
 const key=rows=>rows.map(x=>x.skuId+':'+x.barcode+':'+x.quantity).sort();assert.deepEqual(key(result.items),key(input.items));
 assert.equal(audits[0].payload.formationMode,'WB_CLIENT_PLAN');assert(audits[0].payload.lines.some(x=>x.requested>x.available));
 await assert.rejects(service.create({...dto,fboFormationMode:undefined},input.user));assert.equal(recorded.length,1);
 const after=await snapshot();assert.deepEqual(after,before);
 console.log(JSON.stringify({noWrites:true,rolledBackTransaction:true,dtoAccepted:true,fullQuantity:result.items.reduce((n,x)=>n+x.quantity,0),lines:result.items.length,defaultShortageRejected:true,existingRequestNumber:before.request.number,existingRequestUnchanged:true,requestCountUnchanged:true}));
})().finally(()=>p.$disconnect()).catch(e=>{console.error(e);process.exitCode=1});
