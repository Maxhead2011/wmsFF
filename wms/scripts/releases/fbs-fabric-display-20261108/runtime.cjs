// TEST: exact deployed list method, read-only and reservation refresh, synthetic data only.
const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
const root=path.resolve(process.argv[2]);
const {MarketplaceConnectionsService}=require(root+'/modules/marketplace-connections/marketplace-connections.service.js');
const sku={id:'sku',clientId:'client',name:'Ткань белая',internalSku:'white_3-0',needsChestnyZnak:false};
const order={id:'order',connectionId:'shop',marketplace:'WILDBERRIES',category:'active',supplierStatus:'confirm',product:sku,requiredMeta:[],optionalMeta:[]};
function fixture(task){
 const fail=async()=>{throw Error('Unexpected stock read/write')};
 const service=Object.create(MarketplaceConnectionsService.prototype);
 service.prisma={systemSetting:{findUnique:async()=>({value:{enabled:true}}),findMany:async()=>[]},sku:{findMany:async()=>[sku]},
 client:{findUnique:async()=>({storesWithoutBoxes:false})},fbsTsdAssembly:{findMany:async()=>task?[task]:[],create:fail,updateMany:fail},stockBalance:{findMany:fail}};
 service.fbsTsdReservationRowsBySku=async()=>new Map();return service;
}
async function main(){
 process.env.WMS_FBS_FABRIC_CUT_ENABLED='true';
 let passed=0;
 for(const readOnly of [true,false])for(const task of [null,{id:'task',connectionId:'shop',orderId:'order',status:'WAITING_STOCK',errorMessage:'Нет короба'}]){
  const s=fixture(task);const r=await s.syncFbsPalletSortReservations('client',[order],readOnly);
  assert.equal(r.get('shop:order').status,'FABRIC_ON_DEMAND');assert.equal(r.get('shop:order').withoutBox,true);passed++;
 }
 for(const status of ['IN_PROGRESS','COMPLETED']){
  const s=fixture({connectionId:'shop',orderId:'order',status,barcode:'physical'});
  const r=await s.syncFbsPalletSortReservations('client',[order],true);assert.equal(r.get('shop:order').status,status);passed++;
 }
 process.env.WMS_FBS_FABRIC_CUT_ENABLED='false';
 const s=fixture({connectionId:'shop',orderId:'order',status:'WAITING_STOCK'});
 const r=await s.syncFbsPalletSortReservations('client',[order],true);assert.equal(r.get('shop:order').status,'WAITING_STOCK');passed++;
 const result={passed,syntheticOnly:true};if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1});
