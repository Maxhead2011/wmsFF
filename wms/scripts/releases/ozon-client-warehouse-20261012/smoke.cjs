// TEST: candidate API validates DTO/DI, client branch scope and read-only production preview.
require('reflect-metadata');
const assert=require('assert/strict'),XLSX=require('xlsx');
const base='/app/apps/api/dist/';
const {PrismaService}=require(base+'common/prisma/prisma.service'),{ClientScopeService}=require(base+'modules/auth/client-scope.service'),{OzonFboImportService}=require(base+'modules/client-requests/ozon-fbo-import.service'),{OzonFboImportController}=require(base+'modules/client-requests/ozon-fbo-import.controller'),{OzonFboImportDto}=require(base+'modules/client-requests/dto/ozon-fbo-import.dto'),{OzonLinkImportService}=require(base+'modules/client-requests/ozon-link-import.service');
const client='d12fa230-3bd1-4aff-afc3-98771ce89669',warehouse='afb244a1-50ae-4ae6-9111-afe85949fa58';
const user={id:'runtime-test',roleCodes:['CLIENT'],permissionCodes:[],clientIds:[client],writableClientIds:[client],activeWarehouseId:null};
assert.equal(Reflect.getMetadata('design:paramtypes',OzonFboImportController)[0],OzonFboImportService);assert.equal(Reflect.getMetadata('design:paramtypes',OzonFboImportController)[1],OzonLinkImportService);assert.equal(Reflect.getMetadata('design:paramtypes',OzonFboImportController.prototype,'preview')[1],OzonFboImportDto);
assert.equal(Reflect.getMetadata('path',OzonFboImportController.prototype.warehouses),'warehouses');
function file(barcode){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Склад хранения','Артикул','ШК','Поставка, шт'],['Москва','',barcode,1]]),'Поставка');return {buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),originalname:'runtime-test.xlsx',mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};}
(async()=>{const db=new PrismaService(),scope=new ClientScopeService();try{
 const service=new OzonFboImportService(db,scope),choices=await service.warehouses(client,user);assert.deepEqual(choices.map(x=>x.id),[warehouse]);
 const sku=await db.barcode.findFirst({where:{sku:{clientId:client}},select:{value:true}});assert(sku?.value);
 const dto={clientId:client,destinationCity:'Москва'},p=await service.preview(file(sku.value),dto,user);assert.equal(p.warehouseId,warehouse);assert.equal(p.totalQuantity,1);await service.list(client,user,warehouse);
 await assert.rejects(()=>service.preview(file(sku.value),{...dto,warehouseId:'foreign'},user));await assert.rejects(()=>service.warehouses('foreign',user));
 let written;const tx={$executeRaw:async()=>{},ozonFboShipment:{findUnique:async()=>null},clientRequest:{create:async arg=>{written=arg.data;return {id:'mock'};}}};
 const mock={warehouseClient:{findMany:async()=>choices.map(x=>({warehouseId:x.id,warehouse:{name:x.name}}))},client:{findUniqueOrThrow:async()=>({storesWithoutBoxes:false})},barcode:{findMany:async()=>[{value:sku.value,skuId:'test',sku:{name:'test'}}]},$transaction:fn=>fn(tx)};
 await new OzonFboImportService(mock,scope).commit(file(sku.value),dto,user);assert.equal(written.warehouseId,warehouse);
 console.log(JSON.stringify({passed:true,readOnly:true,client,warehouse,previewQuantity:p.totalQuantity,clientAutoBranch:true,foreignBranchDenied:true,commitMock:true,di:true}));
 }finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
