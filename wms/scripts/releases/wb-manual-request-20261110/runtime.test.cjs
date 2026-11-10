// TEST: execute the actual candidate method with synthetic WB/DB adapters only.
const assert = require('node:assert/strict'), path = require('node:path');
const root = process.argv[2] || '/app/apps/api/dist';
const mod = path.join(root, 'modules/marketplace-connections');
const durable = require(mod + '/auto-assembly-durable');
const {MarketplaceConnectionsService} = require(mod + '/marketplace-connections.service');
async function scenario(options = {}) {
  process.env.WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED = options.off ? 'false' : 'true';
  process.env.WMS_REQUEST_REMOVAL_ENABLED = 'false';
  const events = [], orders = Array.from({length:6}, (_,i)=>({id:String(100+i),connectionId:'cab',
    marketplace:'WILDBERRIES',supplierStatus:'new',itemCount:1,warehouseId:'wh',product:{id:'sku'+i},pickupPointShipmentAllowed:true}));
  if(options.unmapped) orders[0].product=null;
  const response={client:{code:'TEST'},orders};
  durable.beginSupply=async()=>{events.push('journal');return {id:'journal'};};
  durable.stage=async(_p,_j,s)=>events.push(s.stage);
  durable.completeSupply=async()=>events.push('complete');
  global.fetch=async(url,init)=>{
    events.push(init.method+':'+String(url).split('/').pop());
    if(options.cargoFails && String(url).endsWith('/trbx')) throw Error('cargo failed');
    let data={id:'WB-GI-test'};
    if(String(url).endsWith('/order-ids')) data={orderIds:options.mismatch?[100]:orders.map(o=>Number(o.id))};
    if(String(url).endsWith('/trbx')) data={trbxIds:['box']};
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  };
  const service=new MarketplaceConnectionsService({fbsSupplyPlan:{upsert:async()=>events.push('plan'),update:async()=>{}},
    fbsOrderRequestLink:{findMany:async()=>options.linked?orders.map(o=>({connectionId:'cab',orderId:o.id,syncStatus:'ACTIVE',request:{status:'SUBMITTED'}})):[]}},
    {requireClientAccess(){}});
  service.resolveSelectedFbsOrders=async()=>({response,orders});
  service.loadFbsDeliveryPlan=async()=>({destination:options.cargoFails?'PICKUP_POINT':'SORTING_CENTER'});
  service.loadSelectedConnections=async()=>[{id:'cab',apiKey:'synthetic'}];
  service.resolveFbsRequestWarehouseId=async()=>{events.push('warehouse');return 'wh';};
  service.createFbsRequest=async(dto,_user,snapshot)=>{
    events.push('request'); assert.equal(dto.orders.length,6);
    assert(snapshot.orders.every(o=>o.supplyId==='WB-GI-test' && o.supplierStatus==='confirm'));
    if(options.requestFails) throw Error('synthetic DB failure');
    return {request:{number:1},linkedOrders:6};
  };
  service.refreshFbsOrdersCache=async()=>{events.push('refresh');if(options.refreshFails)throw Error('refresh failed');return response;};
  let result,error;
  try {result=await service.moveFbsOrdersToSupply({clientId:'client'}, {id:'user'}, 'assemble', options.legacy?undefined:{response,orders});}
  catch(e){error=e;}
  assert(orders.every(o=>o.supplierStatus==='new'));
  return {events,result,error};
}
(async()=>{
  let s=await scenario();if(s.error)throw s.error;
  assert(s.result.ordersPartial);assert(!s.events.includes('refresh'));
  assert(s.events.indexOf('request')>s.events.indexOf('GET:order-ids'));
  assert(s.events.indexOf('request')<s.events.indexOf('complete'));
  assert(s.events.includes('ASSIGN_PENDING')&&s.events.includes('VERIFY_PENDING'));
  s=await scenario({off:true});if(s.error)throw s.error;assert(!s.events.includes('request'));assert(s.events.includes('complete'));
  s=await scenario({linked:true});if(s.error)throw s.error;assert(!s.events.includes('request'));
  s=await scenario({cargoFails:true});assert(s.error);assert(s.events.includes('request'));assert(!s.events.includes('complete'));
  s=await scenario({requestFails:true});assert.match(s.error.message,/WB-GI-test.*WMS/);assert(!s.events.includes('complete'));
  s=await scenario({unmapped:true});assert(s.error);assert(!s.events.includes('journal'));
  s=await scenario({legacy:true,refreshFails:true});assert(s.error);assert(s.events.includes('request'));
  console.log('PASS runtime7: selected fast path, durable journal, no duplicate, partial failures, preflight, default-off');
})().catch(e=>{console.error(e);process.exitCode=1;});
