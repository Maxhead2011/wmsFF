// TEST: exercise the actual catalog classifier before and after the runtime patch.
const assert=require('assert/strict'),path=require('path');
const {classifyWbCatalog}=require(path.join(process.argv[2],'modules/marketplace-connections/wb-catalog-sync.js'));
const sku={id:'sku',marketplaceProductId:'1164385938:1718971701',marketplaceOfferId:'2052400023910',article:'Мото_черный',size:'XS / 40'};
const product={productId:sku.marketplaceProductId,article:sku.article,size:'XS / 42',barcodes:['2052400023910']};
assert.deepEqual(classifyWbCatalog([sku],[product]),[]);
assert.equal(classifyWbCatalog([sku],[product,{...product,productId:'2:3'}]).length,1);
assert.equal(classifyWbCatalog([sku],[product],[sku,{...sku,id:'other'}]).length,1);
assert.equal(sku.size,'XS / 40');
console.log('PASS actual catalog classifier: barcode identity, duplicates, WMS metadata preserved');
// TEST: execute the full runtime synchronization against an isolated database fixture.
// The restored link must clear its old block and update descriptions only under proof.
(async()=>{
 const {synchronizeWbCatalog}=require(path.join(process.argv[2],'modules/marketplace-connections/wb-catalog-sync.js'));
 const writes=[],upserts=[];
 const lease={$queryRaw:async()=>[{acquired:true}]};
 const db={
  $transaction:async fn=>fn(lease),
  sku:{findMany:async({where})=>{assert.equal(where.clientId,'client');return [sku];}},
  systemSetting:{findUnique:async()=>({value:{excluded:[{skuId:sku.id,reason:'IDENTITY_CHANGED'}]}}),upsert:async args=>writes.push(['initial',args.create.value]),update:async args=>writes.push(['completed',args.data.value])},
  fbsStockPublication:{updateMany:async args=>writes.push(['publication',args])},
  auditLog:{create:async args=>writes.push(['audit',args.data.payload])}
 };
 const result=await synchronizeWbCatalog(db,{id:'connection',clientId:'client'},async()=>[product],async p=>{upserts.push(p);return {created:false,mergedDrafts:0,barcodesTouched:0}},true);
 assert.equal(result.excluded,0);assert.deepEqual(upserts,[product]);
 const completed=writes.find(x=>x[0]==='completed')[1];assert.equal(completed.warnings.length,1);assert.deepEqual(completed.excluded,[]);
 const cleared=writes.find(x=>x[0]==='publication')[1];assert.equal(cleared.where.connectionId,'connection');assert.deepEqual(cleared.where.skuId.in,['sku']);assert.equal(cleared.data.lastError,null);
 assert.equal(writes.find(x=>x[0]==='audit')[1].warnings[0].reason,'BARCODE_MATCH_DESCRIPTION_CHANGED');
 const {withVerifiedBarcodeUpdate}=require(path.join(process.argv[2],'modules/marketplace-connections/wb-barcode-identity.js'));
 const {MarketplaceConnectionsService}=require(path.join(process.argv[2],'modules/marketplace-connections/marketplace-connections.service.js'));
 const mutations=[];
 const service=new MarketplaceConnectionsService({sku:{findFirst:async()=>({...sku,isDraft:false}),update:async args=>{mutations.push(args);return {...sku,...args.data}}},barcode:{findMany:async()=>[],upsert:async()=>({})}},{});
 const dto={...product,marketplace:'WILDBERRIES',offerId:sku.marketplaceOfferId,barcode:sku.marketplaceOfferId,name:'Updated name',internalSku:'stable',payload:{}};
 await assert.rejects(service.upsertMarketplaceSku('client',dto));
 await withVerifiedBarcodeUpdate(sku.id,dto,()=>service.upsertMarketplaceSku('client',dto));
 assert.equal(mutations.length,1);assert.deepEqual(mutations[0].where,{id:sku.id});assert.equal(mutations[0].data.size,'XS / 42');assert.equal(mutations[0].data.name,'Updated name');
 await assert.rejects(service.upsertMarketplaceSku('client',dto));
 console.log('PASS actual catalog sync and SKU upsert: scoped proof, size/name update on same SKU, guard restored outside context');
})().catch(e=>{console.error(e);process.exitCode=1});
