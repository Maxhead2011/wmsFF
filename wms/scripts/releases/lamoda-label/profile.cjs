// FIX: import only the user-supplied label profile. No stock, reservation, request or print writes.
const fs=require('fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root='/app/apps/api',requireApp=createRequire(root+'/package.json'),{PrismaClient}=requireApp('@prisma/client');
const {validateLamodaLabel}=require(root+'/dist/modules/print/lamoda-label');
const {lamodaLabelKey}=require(root+'/dist/modules/print/lamoda-label.service');
const p=new PrismaClient(),catalog=JSON.parse(fs.readFileSync(process.argv[2])),shipment=JSON.parse(fs.readFileSync(process.argv[3]));
const clientId='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
(async()=>{
 const client=await p.client.findUniqueOrThrow({where:{id:clientId},select:{id:true,code:true,name:true}});assert.equal(client.code,'CL-000001');assert(client.name.includes('Лукин'));
 assert.equal(Object.keys(catalog.records).length,136);for(const [barcode,r] of Object.entries(catalog.records))assert.equal(validateLamodaLabel(r).barcode,barcode);
 let units=0;for(const line of shipment){const sku=await p.sku.findFirst({where:{id:line.skuId,clientId},include:{barcodes:true,lamodaProducts:{where:{isPresent:true,linkState:'CONFIRMED',account:{clientId,isActive:true}}}}});assert(sku);assert(sku.barcodes.some(b=>b.value===line.warehouseBarcode));assert.equal(sku.lamodaProducts.length,1);const card=sku.lamodaProducts[0];assert.equal(catalog.records[card.barcode]?.article,card.remoteSku);units+=line.copies;}
 assert.equal(shipment.length,15);assert.equal(units,144);
 const sample=Object.values(catalog.records)[0],value={...catalog,clientId,enabled:true,defaults:{brand:sample.brand,importer:sample.importer,care:sample.care,eac:sample.eac}};
 const key=lamodaLabelKey(clientId),existing=await p.systemSetting.findUnique({where:{key}});
 if(existing)assert.deepEqual(existing.value,value);
 if(!['install','install-3405'].includes(process.argv[4])){console.log(JSON.stringify({ready:true,records:136,shipmentSku:15,shipmentUnits:144}));return;}
 if(!existing)await p.$transaction(async tx=>{await tx.systemSetting.create({data:{key,value}});await tx.auditLog.create({data:{action:'LAMODA_LABEL_PROFILE_IMPORTED',entity:'SystemSetting',entityId:key,payload:{clientId,sourceSha256:catalog.sourceSha256,records:136,shipmentSku:15,shipmentUnits:144,source:'User supplied Lamoda PDF 23.11',authorizedBy:'Катерина',stockUnchanged:true}}});});
 let preparedRequest=null;
 if(process.argv[4]==='install-3405'){
  const request=await p.clientRequest.findFirst({where:{number:3405,clientId},include:{items:{include:{sku:{include:{barcodes:true}}}}}});assert(request);assert.equal(request.items.length,15);assert.equal(request.items.reduce((n,i)=>n+i.quantity,0),144);
  for(const line of shipment){const item=request.items.find(i=>i.skuId===line.skuId);assert(item);assert.equal(item.quantity,line.copies);assert.equal(item.barcode,line.warehouseBarcode);}
  const {lamodaRelabelData}=require(root+'/dist/modules/print/lamoda-relabel-data');
  const before=await p.fbsPrintJob.count({where:{requestId:request.id}});
  const view=await lamodaRelabelData(p,request,{});assert(view.enabled);assert.equal(view.drafts.length,15);
  await lamodaRelabelData(p,request,{},{confirmed:true,labelData:view.drafts.map(d=>({skuId:d.skuId,composition:d.composition,manufacturer:d.manufacturer,origin:d.origin,manufacturedAt:d.manufacturedAt}))});
  assert.equal(await p.fbsPrintJob.count({where:{requestId:request.id}}),before);
  preparedRequest={number:3405,sku:15,units:144,printJobsUnchanged:true};
 }
 console.log(JSON.stringify({installed:!existing,records:136,shipmentSku:15,shipmentUnits:144,preparedRequest,stockAndReservationsUntouched:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
