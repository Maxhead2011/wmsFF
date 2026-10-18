// TEST: exercise actual production service methods; all external effects are mocked.
const assert=require('assert/strict');
const base=process.env.RUNTIME_ROOT||'/app/apps/api/dist';
process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS='client';
const {MarketplaceConnectionsService:S}=require(base+'/modules/marketplace-connections/marketplace-connections.service');
const reserve=require(base+'/modules/marketplace-connections/wb-stock-reserve');
reserve.fineStockSettingsEnabled=()=>true;
const {WbStockObservations:O}=require(base+'/modules/marketplace-connections/wb-stock-observations');
O.prototype.locked=async function(_id,_r,fn){return fn()};O.prototype.guard=async()=>{};
O.prototype.observe=async()=>{};O.prototype.recorder=()=>async()=>{};
function setup(){
 const db={clientMarketplaceConnection:{findMany:async()=>[{id:'connection'}]},fbsStockAllocationPolicy:{findFirst:async()=>null},fbsStockPublication:{findMany:async()=>[]}};
 const s=new S(db,{});s.stockControl={assertEnabled:async()=>{}};
 const amounts=new Map(),sends=[];
 s.fetchWildberriesStockAmounts=async(_k,_w,ids,_u,allow)=>{if(!allow&&ids.some(id=>!amounts.has(id)))throw Error('missing');return new Map(amounts)};
 s.putWildberriesStocksRaw=async(_c,_k,_w,rows,_z,initial)=>{sends.push({rows,initial});rows.forEach(r=>amounts.set(r.chrtId,r.amount));};
 // Keep real initializer orchestration, isolate catalog/DB validation below in its own cases.
 s.initializeExplicitWbPublication=async function(c,co,k,w,rows,o){
 const {initializeFirstPublication}=require(base+'/modules/marketplace-connections/wb-first-publication');
 return initializeFirstPublication(rows,{read:()=>this.fetchWildberriesStockAmounts(k,w,rows.map(r=>r.chrtId),true,true),verify:async()=>[{verified:true}],record:async()=>{},sendZeros:(z,ids)=>this.putWildberriesStocksRaw(c,k,w,z,[],ids)});
 };
 return {s,db,amounts,sends};
}
(async()=>{
 let n=0;
 {const {s,sends}=setup();await s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}],true);assert.deepEqual(sends.map(x=>x.rows),[[{chrtId:12,amount:0}],[{chrtId:12,amount:8}]]);n++;}
 {const {s,sends}=setup();await assert.rejects(s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}]));assert.equal(sends.length,0);n++;}
 {const {s,sends}=setup();await assert.rejects(s.putWildberriesStocks('legacy','key','warehouse',[{chrtId:12,amount:8}],true));assert.equal(sends.length,0);n++;}
 {const {s,db,sends}=setup();db.fbsStockAllocationPolicy.findFirst=async()=>({id:'policy'});await assert.rejects(s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}],true));assert.equal(sends.length,0);n++;}
 {const {s,sends}=setup();s.putWildberriesStocksRaw=async()=>{sends.push('timeout');throw Error('timeout')};await assert.rejects(s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}],true));assert.deepEqual(sends,['timeout']);n++;}
 {const {s,amounts,sends}=setup();amounts.set(12,3);await s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}],true);assert.equal(sends.length,1);assert.equal(sends[0].rows[0].amount,8);n++;}
 {const {s,sends}=setup();s.putWildberriesStocksRaw=async()=>{sends.push('ack-only')};await assert.rejects(s.putWildberriesStocks('client','key','warehouse',[{chrtId:12,amount:8}],true));assert.deepEqual(sends,['ack-only']);n++;}
 // Real initializer denies an excluded warehouse before fetching cards or sending zeros.
 {const s=new S({clientMarketplaceConnection:{findFirst:async()=>({apiKey:'key',fbsWarehouseId:'warehouse'})},fbsWarehouseRoutingRule:{findUnique:async()=>({mode:'EXCLUDED'})}},{});s.fetchWildberriesStockAmounts=async()=>new Map();s.fetchWildberriesProducts=async()=>{throw Error('must not reach catalog')};await assert.rejects(s.initializeExplicitWbPublication('client','connection','key','warehouse',[{chrtId:12,amount:8}],{}),/маршрутизации/);n++;}
 // Both real manual command call sites carry authority, no background methods do.
 assert.match(S.prototype.updateFbsStockPublicationFresh.toString(),/dto.enabled === true/);
 assert.match(S.prototype.updateFbsStockPublicationBulkFresh.toString(),/dto.enabled === true/);n++;
 // Real identity path, including an Ozon physical SKU and fresh WB catalog.
 {const links=require(base+'/modules/marketplace-connections/marketplace-product-links');const old=links.wbLinkedSkus;
 try {
 links.wbLinkedSkus=async()=>[{id:'physical',marketplaceProductId:'99:12',barcodes:[{value:'123'}]}];
 for (const matching of [true,false]) {
  const db={clientMarketplaceConnection:{findFirst:async()=>({apiKey:'key',fbsWarehouseId:'warehouse'})},fbsWarehouseRoutingRule:{findUnique:async()=>({mode:'CENTRAL'})},fbsStockPublication:{findMany:async()=>[]},auditLog:{create:async()=>{}}};
  const s=new S(db,{});const amounts=new Map();let writes=0;
  s.fetchWildberriesStockAmounts=async()=>new Map(amounts);
  s.fetchWildberriesProducts=async()=>[{productId:'99:12',barcodes:[matching?'123':'different']}];
  s.putWildberriesStocksRaw=async(_c,_k,_w,rows,zeroIds,initial)=>{assert.deepEqual(zeroIds,[]);assert.deepEqual(initial,[12]);assert.deepEqual(rows,[{chrtId:12,amount:0}]);writes++;amounts.set(12,0)};
  const action=()=>s.initializeExplicitWbPublication('client','connection','key','warehouse',[{chrtId:12,amount:8}],{guard:async()=>{}});
  if(matching){await action();assert.equal(writes,1);}else{await assert.rejects(action(),/каталогом/);assert.equal(writes,0);}n++;
 }
 } finally {links.wbLinkedSkus=old;}}
 console.log(JSON.stringify({passed:n}));
})().catch(e=>{console.error(e);process.exitCode=1});
