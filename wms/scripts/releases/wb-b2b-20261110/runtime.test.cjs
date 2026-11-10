// TEST: real runtime handler, synthetic WB transport, no live business writes.
const a=require('node:assert/strict'),root=process.argv[2]||'/app/apps/api/dist',mod=root+'/modules/marketplace-connections';
const labels=require(mod+'/wb-label-orders'),durable=require(mod+'/auto-assembly-durable');
const {MarketplaceConnectionsService}=require(mod+'/marketplace-connections.service');
async function run(flags,opts={}){
 process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED=opts.off?'false':'true';
 process.env.WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED='true';process.env.WMS_REQUEST_REMOVAL_ENABLED='false';
 const orders=flags.map((_,i)=>({id:String(100+i),connectionId:'cab',marketplace:'WILDBERRIES',supplierStatus:'new',itemCount:1,warehouseId:'wh',cargoType:'1',crossBorderType:'0',product:{id:'sku'+i}}));
 let count=0,reads=0,events=[],members=new Map(),requests=[];
 labels.wbLabelOrders=async()=>{reads++;return orders.map((o,i)=>({...o,isB2b:flags[i],supplierStatus:opts.changed?'cancel':'new'}))};
 durable.beginSupply=async(_p,_c,g)=>{events.push('journal');return {ids:g.map(o=>o.id)}};
 durable.stage=async()=>{};durable.completeSupply=async(_p,h,supply)=>{a.deepEqual(h.ids,members.get(supply).map(String));events.push('complete')};
 global.fetch=async(url,init)=>{
  events.push(init.method);let data={};url=String(url);
  if(init.method==='POST'&&url.endsWith('/supplies'))data={id:'WB-GI-test'+(++count)};
  if(init.method==='PATCH'){
   const ids=JSON.parse(init.body).orders;if(new Set(ids.map(id=>flags[id-100])).size>1)return new Response('mixed',{status:409});
   members.set(url.split('/').at(-2),ids);
  }
  if(url.endsWith('/order-ids'))data={orderIds:members.get(url.split('/').at(-2))};
  return new Response(JSON.stringify(data),{status:200});
 };
 const response={client:{code:'TEST'},orders},s=new MarketplaceConnectionsService({fbsSupplyPlan:{upsert:async()=>{}},fbsOrderRequestLink:{findMany:async()=>opts.linked?orders.map(o=>({connectionId:'cab',orderId:o.id,syncStatus:'ACTIVE',request:{status:'SUBMITTED'}})):[]}}, {requireClientAccess(){}});
 s.resolveSelectedFbsOrders=async()=>({response,orders});s.loadFbsDeliveryPlan=async()=>({destination:'SORTING_CENTER'});s.loadSelectedConnections=async()=>[{id:'cab',apiKey:'synthetic'}];s.resolveFbsRequestWarehouseId=async()=> 'wh';
 s.createFbsRequest=async(dto,_u,snapshot)=>{a(snapshot.orders.every(o=>o.supplierStatus==='confirm'));requests.push(dto.orders.map(o=>o.id));return {request:{number:1}}};
 let error,result;try{result=await s.moveFbsOrdersToSupply({clientId:'client'},{id:'user'},'assemble',{response,orders})}catch(e){error=e}
 return {error,result,requests,members,reads,events,count};
}
(async()=>{
 let x=await run([false,true,false,false,false]);a.ifError(x.error);a.deepEqual([...x.members.values()],[ [100,102,103,104],[101] ]);a.deepEqual(x.requests,[['100','102','103','104'],['101']]);a.equal(x.events.filter(e=>e==='complete').length,2);
 x=await run([false,true],{linked:true});a.ifError(x.error);a.equal(x.requests.length,0);
 x=await run([true,true]);a.ifError(x.error);a.equal(x.count,1);
 x=await run([false,null]);a.match(x.error.message,/B2B/);a.equal(x.count,0);a.equal(x.events.length,0);
 x=await run([false],{changed:true});a.match(x.error.message,/Статус/);a.equal(x.count,0);
 x=await run([false,false],{off:true});a.ifError(x.error);a.equal(x.reads,0);
 console.log('PASS runtime6: B2B4+1, manual requests, existing links, durable journal, unknown/status rejection, sold path');
})().catch(e=>{console.error(e);process.exitCode=1});
