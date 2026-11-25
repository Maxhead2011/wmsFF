// TEST: compiled deployed service, DTO and real PDF composition; all remote writes are synthetic.
const assert=require('assert/strict'),path=require('path'),{createRequire}=require('module');
const dist=process.argv[2],req=createRequire(path.join(dist,'main.js')),{PDFDocument}=req('pdf-lib');
require=req;require('reflect-metadata');
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';process.env.WMS_WB_SHIPPING_POINTS_ENABLED='true';process.env.WMS_OZON_DIRECT_LABEL_ENABLED='true';process.env.WMS_FBS_ACTION_STATUS_ENABLED='false';
(async()=>{const pdf=await PDFDocument.create();pdf.addPage([58,40]).drawText('posting',{x:1,y:10,size:5});const buffer=Buffer.from(await pdf.save()),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
 const {MarketplaceConnectionsService}=require(dist+'/modules/marketplace-connections/marketplace-connections.service.js');
 const host=Object.create(MarketplaceConnectionsService.prototype);let ids=[],postCount=0,prepared=0;let marketplace='WILDBERRIES';
 const order=()=>({id:marketplace==='OZON'?'posting':'1',connectionId:'c',supplyId:marketplace==='OZON'?null:'WB-GI-1',marketplace});
 host.resolveFbsLabelOrders=async()=>({orders:[order()]});host.clientScopes={requireClientAccess:()=>{}};
 host.loadSelectedConnections=async()=>[{id:'c',apiKey:'synthetic'}];host.getFbsSupplyStickersPdf=async()=>({buffer});host.getFbsOrderStickersPdf=async()=>{const p=await PDFDocument.create();p.addPage();p.addPage();return {buffer:Buffer.from(await p.save())};};
 host.prisma={clientMarketplaceConnection:{findMany:async()=>[{id:'c',marketplace:'OZON',sellerId:'test',apiKey:'synthetic'}]},$transaction:async fn=>fn({$executeRaw:async()=>{}}),fbsSupplyPlan:{findFirst:async()=>({id:'p',deliveryDestination:'PICKUP_POINT',cargoPlaceCount:0}),update:async()=>{}},auditLog:{findFirst:async()=>null,create:async()=>{}},systemSetting:{findUnique:async()=>null}};
 global.fetch=async(url,init={})=>{let data;
  if(String(url).includes('/ship')||String(url).includes('/prepare')){prepared++;throw Error('Forbidden assembly');}
  if(String(url).endsWith('/trbx')){if(init.method==='POST'){postCount++;ids=['cargo'];}data={trbxes:ids.map(id=>({id}))};}
  else if(String(url).endsWith('/order-ids'))data={orderIds:[1,2]};
  else if(String(url).includes('/stickers'))data={stickers:[{barcode:'cargo',file:png}]};
  else if(String(url).endsWith('/WB-GI-1'))data={id:'WB-GI-1',done:false};
  else if(String(url).endsWith('/fbs/get'))data={result:{posting_number:'posting',status:'awaiting_deliver'}};
  else if(String(url).endsWith('/package-label/create'))data={tasks:[{task_type:'small_label',task_id:1}]};
  else if(String(url).endsWith('/package-label/get'))data={status:{code:'completed',postings_count:1,printed_postings_count:1},file_url:'https://ir.ozone.ru/test.pdf'};
  else if(String(url)==='https://ir.ozone.ru/test.pdf')return new Response(buffer,{headers:{'content-type':'application/pdf'}});
  else throw Error('Unexpected API '+url);
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 const dto=()=>({clientId:'client',orders:[{id:order().id,connectionId:'c'}],cargoLabelsOnly:true,prepareWbCargo:true});
 const supplyPdf=await require(dist+'/modules/marketplace-connections/wb-supply-label.js').buildWbSupplyLabelsPdf([{supplyId:'WB-GI-320469823',quantity:2,destination:'Москва (Белая дача)'}]);assert.equal((await PDFDocument.load(supplyPdf)).getPageCount(),1);
 const wb=await host.getFbsAllLabels(dto(),{id:'u'});assert.equal(wb.pageCount,2);assert.deepEqual(wb.warnings,[]);await host.getFbsAllLabels(dto(),{id:'u'});assert.equal(postCount,1);
 marketplace='OZON';const ozon=await host.getFbsAllLabels(dto(),{id:'u'});assert.equal(ozon.pageCount,1);assert.deepEqual(ozon.warnings,[]);assert.equal(prepared,0);
 const full=await host.getFbsAllLabels({...dto(),cargoLabelsOnly:false},{id:'u'});assert.equal(full.pageCount,2);
 const {FbsOrderSelectionDto}=require(dist+'/modules/marketplace-connections/dto/fbs-order-selection.dto.js'),{plainToInstance}=require('class-transformer'),{validateSync}=require('class-validator');
 assert.equal(validateSync(plainToInstance(FbsOrderSelectionDto,dto())).length,0);
 assert(validateSync(plainToInstance(FbsOrderSelectionDto,{...dto(),cargoLabelsOnly:'true'})).some(e=>e.property==='cargoLabelsOnly'));
 console.log(JSON.stringify({passed:true,synthetic:true,wbPages:wb.pageCount,ozonPages:ozon.pageCount,fullSetPreserved:true,createOnce:true,noAssembly:true,dtoValidated:true}));
})().catch(e=>{console.error(e);process.exitCode=1});

