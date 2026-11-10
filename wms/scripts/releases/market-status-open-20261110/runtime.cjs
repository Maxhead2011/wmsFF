// TEST: execute compiled candidate helpers, including CAS, isolation and inventory-free mocks.
const assert=require('assert/strict'),path=require('path');
const root=path.resolve(process.argv[2]);
process.env.WMS_WB_PACKED_AUTO_DONE_ENABLED='true';process.env.WMS_OZON_PACKED_AUTO_DONE_ENABLED='true';
const wb=require(root+'/modules/marketplace-connections/wb-packed-auto-done').closeWbPackedRequest;
const ozon=require(root+'/modules/marketplace-connections/ozon-packed-auto-done').closeOzonPackedRequest;
async function check(close,market,status,flag=true,accepted=true,special=false,cas=true){
 process.env.WMS_FBS_ACTION_STATUS_ENABLED=String(flag);
 const r={id:'r',clientId:'c',type:'OUTBOUND',status,updatedAt:new Date(),fbsEmergencyAssemblyAt:null,
  fbsOrderLinks:[{connectionId:'a',orderId:'o',marketplace:market,syncStatus:'ACTIVE'}]};
 const events=[];let writes=0;
 const tx={client:{findUnique:async()=>({isDemo:false})},clientRequest:{updateMany:async({where,data})=>{
  assert.equal(where.status,status);assert.deepEqual(data,{status:'DONE'});writes++;return {count:cas?1:0};}},
  clientRequestEvent:{create:async({data})=>{assert.equal(data.statusFrom,status);events.push(data);}}};
 const orders=[{id:'o',connectionId:'a',marketplace:market,supplierStatus:market==='OZON'?(accepted?'delivering':'awaiting_deliver'):'complete',wbStatus:market==='OZON'?(accepted?'delivering':'awaiting_deliver'):(accepted?'sorted':'waiting')}];
 const expected=accepted&&!special&&cas&&(status==='PACKED'||flag&&['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK'].includes(status));
 assert.equal(await close(tx,r,orders,special),expected);
 assert.equal(events.length,expected?1:0);if(!accepted||special||['DONE','CANCELLED','REJECTED'].includes(status))assert.equal(writes,0);
}
(async()=>{let n=0;for(const [fn,market]of [[wb,'WILDBERRIES'],[ozon,'OZON']]){
 for(const status of ['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK','PACKED','DONE','CANCELLED','REJECTED']){
  await check(fn,market,status);n++;await check(fn,market,status,false);n++;
 }
 for(const args of [[true,false,false,true],[true,true,true,true],[true,true,false,false]]){await check(fn,market,'IN_WORK',...args);n++;}
}console.log('PASS runtime cases',n);})().catch(e=>{console.error(e);process.exitCode=1});
