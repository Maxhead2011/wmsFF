// TEST: actual candidate classes, DTO validation and WB transport; no external writes.
const assert=require('node:assert/strict'),path=require('path');
const root=process.argv[2]||'/app/apps/api/dist';require('/app/apps/api/node_modules/reflect-metadata');
const mod=path.join(root,'modules/marketplace-connections');
const {MarketplaceConnectionsService}=require(mod+'/marketplace-connections.service');
const {FbsOrderSelectionDto}=require(mod+'/dto/fbs-order-selection.dto');
const {validate}=require('/app/apps/api/node_modules/class-validator');
const {plainToInstance}=require('/app/apps/api/node_modules/class-transformer');
const {saveShippingMethod,availableShippingPoint}=require(mod+'/wb-shipping-points');
(async()=>{
 process.env.WMS_WB_SHIPPING_POINTS_ENABLED='true';let calls=[],ids=['box1'];
 const dto={clientId:'client',orders:[{connectionId:'cab',id:'1'}],shippingCity:'Москва',plannedDeliveryDate:'2099-11-09',shippingPointId:'42',cargoPlaceTotal:2};
 assert.equal((await validate(plainToInstance(FbsOrderSelectionDto,dto),{whitelist:true,forbidNonWhitelisted:true})).length,0);
 assert((await validate(plainToInstance(FbsOrderSelectionDto,{...dto,cargoPlaceTotal:-1}))).length);
 assert.throws(()=>availableShippingPoint([{id:'42',available:false}],'42'));
 await assert.rejects(()=>saveShippingMethod(async()=>({results:[{supplyId:'s',error:{detail:'SupplyAlreadyScanned'}}]}),'s','42','2099-11-09'),/SupplyAlreadyScanned/);
 global.fetch=async(url,init)=>{calls.push({url:String(url),method:init.method,body:init.body});let data={shippingPointId:42,shippingDt:'2099-11-09',shippingType:'selfShipping'};
  if(String(url).includes('shipping-points?'))data={shippingPoints:[{id:42,available:true,officeType:'pp',city:'Москва',address:'Адрес'}]};
  if(String(url).endsWith('/shipping-method'))data={results:[{supplyId:'WB-GI-test',success:true}]};
  if(String(url).endsWith('/order-ids'))data={orders:[1,2,3,4]};
  if(String(url).endsWith('/trbx')){if(init.method==='POST')ids=['box1','box2'];data={trbxes:ids.map(id=>({id}))};}
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 let updates=0,audits=[];const host={clientScopes:{requireClientAccess(){}},refreshFbsOrdersCache:async()=>({}),resolveSelectedFbsOrders:async()=>({orders:[{id:'1',connectionId:'cab',supplyId:'WB-GI-test',marketplace:'WILDBERRIES',supplierStatus:'confirm'}]}),loadSelectedConnections:async()=>[{id:'cab',apiKey:'synthetic'}],prisma:{
  $transaction:async fn=>fn({$executeRaw:async()=>{}}),fbsSupplyPlan:{findFirst:async()=>({id:'plan',cargoPlaceIds:ids}),update:async()=>{updates++;}},auditLog:{findFirst:async()=>null,create:async row=>{audits.push(row);}},
 }};
 const execute=mode=>MarketplaceConnectionsService.prototype.configureFbsShipping.call(host,dto,{id:'user'},mode);
 assert.equal((await execute('points')).points.length,1);await execute('save');await execute('cargo');await execute('cargo');
 assert.equal(calls.filter(c=>c.url.endsWith('/trbx')&&c.method==='POST').length,1);
 assert(!calls.some(c=>c.url.endsWith('/deliver')));assert.equal(updates,3);
 assert(audits.some(row=>row.data.action==='WB_CARGO_CREATE_PENDING'));
 process.env.WMS_WB_SHIPPING_POINTS_ENABLED='false';await assert.rejects(()=>execute('save'),/отключена/);
 console.log(JSON.stringify({runtime:10,actualService:true,dto:true,duplicateCargoPrevented:true,soldGate:true,noStockWrites:true}));
})().catch(error=>{console.error(error);process.exitCode=1});
