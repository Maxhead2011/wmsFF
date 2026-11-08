// TEST: run the real compiled service and PDF generators, with read-only synthetic WB/DB.
const assert=require('node:assert/strict'),fs=require('fs'),{PDFDocument}=require('pdf-lib'),bwip=require('bwip-js');
const {MarketplaceConnectionsService:S}=require(process.argv[2]+'/modules/marketplace-connections/marketplace-connections.service');
const reads=[];let ids=['42'],cancel=false;
(async()=>{
 const png=(await bwip.toBuffer({bcid:'code128',text:'12345678',scale:2,height:10})).toString('base64');
 global.fetch=async(url,init={})=>{
  const p=new URL(String(url)).pathname;reads.push(p);let value;
  if(p==='/api/v3/orders')value={orders:ids.map(id=>({id:Number(id),skus:['12345678'],article:'fabric',supplyId:'WB-GI-123'})),next:0};
  else if(p==='/api/v3/orders/status')value={orders:ids.map(id=>({id:Number(id),supplierStatus:cancel?'cancel':'confirm',wbStatus:cancel?'canceled':'waiting'}))};
  else if(p.endsWith('/order-ids'))value={orderIds:ids.map(Number)};
  else if(p==='/api/v3/offices')value=[{id:7,name:'Москва_Восток'}];
  else if(p==='/api/v3/supplies/WB-GI-123')value={id:'WB-GI-123',done:false,destinationOfficeId:7};
  else if(p.endsWith('/trbx'))value={trbxes:[{id:'cargo'}]};
  else if(p.endsWith('/trbx/stickers'))value={stickers:[{barcode:'cargo',file:png}]};
  else if(p==='/api/v3/orders/stickers')value={stickers:JSON.parse(init.body).orders.map(id=>({orderId:id,barcode:'label',file:png}))};
  else throw Error('Unexpected endpoint '+p);
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 };
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='false';
 const sku={id:'sku',name:'Ткань',article:'fabric',internalSku:'fabric',needsChestnyZnak:false,isUnmarked:true,barcodes:[{value:'12345678'}]};
 const db={clientMarketplaceConnection:{findMany:async()=>[{id:'cab',apiKey:'synthetic',marketplace:'WILDBERRIES'}]},
  fbsOrderRequestLink:{findMany:async()=>ids.map(id=>({orderId:id,connectionId:'cab',orderPlacedAt:new Date('2026-11-08')}))},
  sku:{findMany:async()=>[sku]},fbsSupplyPlan:{findMany:async()=>[{connectionId:'cab',supplyId:'WB-GI-123',deliveryDestination:'PICKUP_POINT'}]}};
 const service=Object.create(S.prototype);service.prisma=db;service.clientScopes={requireClientAccess:()=>{}};
 service.resolveSelectedFbsOrders=async()=>{throw Error('Operational refresh forbidden')};
 service.loadFbsDeliveryPlan=async()=>({destination:'PICKUP_POINT',itemsPerCargoPlace:2e9,requiresCargoPlaces:true});
 const dto=()=>({clientId:'client',orders:ids.map(id=>({id,connectionId:'cab'}))});
 const ribbon=await service.getFbsAllLabels(dto(),{});assert.equal(ribbon.pageCount,4);assert.equal(ribbon.warnings.length,0);
 assert.equal(reads.filter(p=>p==='/api/v3/orders').length,1);assert.equal(reads.filter(p=>p==='/api/v3/orders/status').length,1);
 const pdf=await PDFDocument.load(Buffer.from(ribbon.fileBase64,'base64'));assert.equal(pdf.getPageCount(),4);
 reads.length=0;ids=['43'];const pair=await service.getFbsOrderStickersPdf(dto(),{});
 assert.equal((await PDFDocument.load(pair.buffer)).getPageCount(),2);assert.equal(reads.filter(p=>p==='/api/v3/orders').length,1);
 await assert.rejects(service.resolveFbsLabelOrders('client',[{id:'other',connectionId:'cab'}],[{id:'42',connectionId:'cab'}]));
 const original=db.clientMarketplaceConnection.findMany;db.clientMarketplaceConnection.findMany=async()=>[];
 await assert.rejects(service.getFbsAllLabels(dto(),{}),/кабинета/);db.clientMarketplaceConnection.findMany=original;
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='false';let legacy=0;
 service.resolveSelectedFbsOrders=async()=>{legacy++;return {orders:[]}};await service.resolveFbsLabelOrders('client',[]);assert.equal(legacy,1);
 assert(!reads.some(p=>p.endsWith('/deliver')||p.endsWith('/barcode')));
 const {buildWbSupplyLabelsPdf}=require(process.argv[2]+'/modules/marketplace-connections/wb-supply-label');
 fs.writeFileSync(process.argv[3]+'.pdf',await buildWbSupplyLabelsPdf([{supplyId:'WB-GI-306846466',quantity:1,destination:'Москва_Восток'}]));
 const proof={passed:6,realService:true,realPdf:true,syntheticOnly:true};fs.writeFileSync(process.argv[3],JSON.stringify(proof));console.log(JSON.stringify(proof));
})().catch(e=>{console.error(e);process.exitCode=1});
