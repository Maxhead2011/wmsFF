// TEST: read-only published handlers and audited shop metadata; no business writes.
require('reflect-metadata');const {PrismaClient}=require('@prisma/client'),assert=require('node:assert/strict');const p=new PrismaClient();(async()=>{
const client=await p.client.findUniqueOrThrow({where:{code:'CL-000016'},select:{id:true}});
const requests=await p.clientRequest.findMany({where:{clientId:client.id,number:{in:[2529,2530,2531]}},select:{id:true,number:true,clientId:true,warehouseId:true,status:true}});
const {requestStoreContexts}=require('./dist/modules/clients/request-store-context');const contexts=await requestStoreContexts(p,requests);
const {OzonFboImportService}=require('./dist/modules/client-requests/ozon-fbo-import.service');const {ClientScopeService}=require('./dist/modules/auth/client-scope.service');
const user={id:'readonly-release-verification',administrationEnabled:true,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',isDemo:false};
const svc=new OzonFboImportService(p,new ClientScopeService());let all=[];for(const view of ['active','completed'])all.push(...await svc.list(client.id,user,requests[0].warehouseId,view,'true'));
const mappings=requests.map(r=>{const row=all.find(x=>x.id===r.id);assert(row);assert.deepEqual(row.storeNames,[r.number===2531?'Брайбо':'Монларти']);assert.equal(row.clientName,'ИП Елецкая Карина Равшановна');return {number:r.number,status:r.status,store:row.storeNames[0],payer:row.clientName}});
const {fboPickerStatistics}=require('./dist/modules/administration/fbo-picker-statistics');const start=Date.now();
const stats=await p.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");return fboPickerStatistics(tx,user,{from:new Date('2026-10-29T21:00:00Z'),to:new Date('2026-10-30T21:00:00Z')})},{timeout:15000});
assert(stats);
const {AdministrationService}=require('./dist/modules/administration/administration.service');
const monitor=await p.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");return new AdministrationService(tx).listTsdMonitor(user,'2026-10-30')},{timeout:20000});assert(monitor.fboPickerStatistics);assert(monitor.pickerStatistics);assert.equal(monitor.pickerStatistics.period.date,'2026-10-30');
const setting=await p.systemSetting.findUniqueOrThrow({where:{key:'client.stores.v1:'+client.id}});const audit=await p.auditLog.findFirst({where:{action:'CLIENT_STORES_SAVED',entityId:client.id},orderBy:{createdAt:'desc'},select:{createdAt:true,payload:true}});assert.deepEqual(audit.payload.after,setting.value);
console.log(JSON.stringify({mappings,summary:stats.summary,elapsedMs:Date.now()-start,settingsAudited:true,fullMonitorVerified:true,readOnly:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());