// TEST: candidate runtime against persisted production receipts, read only.
require('reflect-metadata');const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client'),ExcelJS=require('exceljs');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
const {OzonAssemblySupplyController}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.controller');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
const db=new PrismaClient(),id='13b326b1-ed5c-44c3-9ecc-09e1b65d90fb';
(async()=>{
 const actor=await db.user.findUniqueOrThrow({where:{id:'b045e060-dfd7-48af-bb88-12c191ee8eae'},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
 const permissionCodes=[...new Set(actor.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.code)))];assert.equal(actor.status,'ACTIVE');assert.ok(permissionCodes.includes('system:admin'));
 const user={id:actor.id,email:actor.email,name:actor.name,roleCodes:actor.roles.map(r=>r.role.code),permissionCodes,activeWarehouseId:actor.activeWarehouseId,clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
 const svc=new OzonAssemblySupplyService(db,new ClientScopeService());
 const before=await svc.load(id,user),file=await svc.cargoMappingFile(id,user);assert.equal(file.fileName,'ozon-boxes-1861.xlsx');
 const book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);const sheet=book.worksheets[0];assert.equal(sheet.rowCount,28);
 const expected=before.request.fboAssembly.boxes;const seen=new Set();
 for(let i=2;i<=28;i++){const row=sheet.getRow(i),box=expected.find(b=>b.boxCode===row.getCell(1).value);assert.ok(box);assert.equal(row.getCell(2).value,box.direction);const sid=before.integration.mapping[box.direction],receipt=before.integration.operations[sid].cargoes.find(c=>c.key===box.id);assert.equal(row.getCell(3).value,receipt.cargoId);assert.equal(row.getCell(3).numFmt,'@');assert.equal(typeof row.getCell(3).value,'string');assert.equal(row.getCell(4).value,sid);seen.add(box.id);}
 assert.equal(seen.size,27);assert.deepEqual(await svc.load(id,user),before);
 const controller=new OzonAssemblySupplyController(svc),headers={};const stream=await controller.cargoMapping(id,user,{setHeader(k,v){headers[k]=v;}});assert.ok(stream.getStream());assert.match(headers['Content-Disposition'],/1861.xlsx/);assert.equal(Reflect.getMetadata('path',controller.cargoMapping),'cargo-mapping.xlsx');
 console.log(JSON.stringify({passed:true,readOnly:true,request:1861,boxes:27,directions:11,textIdentifiers:true,controller:true}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.stack);process.exitCode=1});
