// TEST: actual snapshot HTTP method and legacy roll modules; synthetic objects only.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]),load=n=>require(root+'/modules/'+n);
const {MarketplaceConnectionsService:S}=load('marketplace-connections/marketplace-connections.service.js');
const {MarketplaceConnectionsController:C}=load('marketplace-connections/marketplace-connections.controller.js');
const {applyRollAction,fabricSku}=load('warehouse/fabric-rolls.js');
const {identify,planShipments}=load('warehouse/fabric-shipment-accounting.js');
const {identifyFabricSku,fabricMaterialAvailability}=load('warehouse/fabric-fbs-availability.js');
const {reserveFabric,confirmFabricCut}=load('warehouse/fabric-fbs-ledger.js');
async function main(){
 process.env.WMS_FBS_FABRIC_CUT_ENABLED='true';let passed=0;
 for(const article of ['ivory_10','white_1','green_10','blue_5']){
  const sku={id:'sku',clientId:'client',name:'Ткань',internalSku:article+'-0',needsChestnyZnak:false};
  const order={id:'order',connectionId:'shop',marketplace:'WILDBERRIES',category:'active',supplierStatus:'confirm',product:sku,reservation:null,storageBoxes:[]};
  const response={orders:[order],sync:{partial:true}};let scoped=false,snapshot=false;
  const service=Object.create(S.prototype);service.prisma={systemSetting:{findUnique:async()=>({value:{enabled:true}})},sku:{findMany:async()=>[sku]},fbsTsdAssembly:{findMany:async()=>[{connectionId:'shop',orderId:'order',status:'WAITING_STOCK'}]}};
  service.listFbsOrdersForDisplay=async(...args)=>{assert.deepEqual(args,['client',{id:'u'},false,true,'w']);snapshot=true;return response};
  service.listFbsOrders=async()=>{throw Error('Snapshot must not call WB live loader')};
  const controller=Object.create(C.prototype);controller.connections=service;controller.stores={decorateOrders:async(_,data)=>{assert(snapshot);scoped=true;return data}};
  const result=await controller.listFbsOrders({id:'u'},'client',undefined,'snapshot','1','w');
  assert(scoped);assert.equal(result.orders[0].reservation.status,'FABRIC_ON_DEMAND');assert.equal(order.reservation,null);assert.equal(result.sync,response.sync);passed++;
 }
 const sku={id:'blue',name:'Ткань синяя',internalSku:'blue_5-0'};
 assert.equal(fabricSku(sku).colorName,'Синий');assert.deepEqual(identify(sku),{material:'SATIN',color:'blue',mm:5000});
 assert.equal(identifyFabricSku(sku).lengthMm,5000);passed++;
 const state=applyRollAction({rolls:[]},{action:'RECEIVE',material:'SATIN',color:'blue',count:1},null,'w');
 assert.equal(state.rolls[0].remainingMm,100000);assert(fabricMaterialAvailability(state,sku,'w',20).available);assert(!fabricMaterialAvailability(state,sku,'w',21).available);passed++;
 const demand={...identifyFabricSku(sku),key:'task',warehouseId:'w',units:1};
 const reserved=reserveFabric(state,demand);const cut=confirmFabricCut(reserved,'task',1,'scan');
 assert.equal(cut.state.rolls[0].remainingMm,95000);assert.deepEqual(confirmFabricCut(cut.state,'task',1,'scan').state,cut.state);passed++;
 const at=new Date(Date.now()+10000).toISOString(),event={key:'delivery',at,warehouseId:'w',skuId:'blue',material:'SATIN',color:'blue',mm:5000};
 const ship=planShipments(state,[event],[]);assert.equal(ship.state.rolls[0].remainingMm,95000);assert.equal(ship.pending.length,0);
 assert.equal(planShipments(ship.state,[event],[]).state.rolls[0].remainingMm,95000);passed++;
 process.env.WMS_FBS_FABRIC_CUT_ENABLED='false';
 const s=Object.create(S.prototype);s.prisma=null;const original={orders:[{id:'ordinary'}]};assert.equal(await s.decorateFbsFabricDisplay('client',original),original);passed++;
 const result={passed,syntheticOnly:true,snapshotCases:4};if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1});
