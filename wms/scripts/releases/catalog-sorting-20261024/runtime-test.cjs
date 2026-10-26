// TEST: compiled candidate, in-memory fixtures only; no database or external API.
const assert=require('node:assert/strict');require('reflect-metadata');
const root='/app/apps/api/dist/';const {SkusService}=require(root+'modules/skus/skus.service'),{SkusController}=require(root+'modules/skus/skus.controller');
const helper=require(root+'modules/skus/catalog-list'),links=require(root+'modules/marketplace-connections/marketplace-product-links');
(async()=>{
 assert.equal(process.env.WMS_CATALOG_SORT_ENABLED,'true');
 const items=Array.from({length:105},(_,i)=>({id:String(i),clientId:'client',name:'Product',article:'A'+i,color:i%2?'Blue':'White',updatedAt:new Date(i),marketplace:null,barcodes:[],marketplacePayload:null}));
 let writes=0;const db={sku:{findMany:async q=>{if(q.select){assert.equal(q.where.clientId,'client');return items;}assert.equal(q.where.AND[0].clientId,'client');return items.filter(s=>q.where.AND[1].id.in.includes(s.id));}},stockBalance:{groupBy:async q=>{assert.equal(q.where.warehouseId,'wh');assert.equal(q.where.sku.clientId,'client');assert.equal(q.where.status.not,'IN_TRANSIT');return [{skuId:'104',_sum:{quantity:8}}]}},systemSetting:{findUnique:async()=>({value:true})},clientMarketplaceConnection:{findMany:async()=>[{id:'wb'},{id:'oz'}]}};
 links.productLinksEnabled=()=>true;links.readProductLinks=async()=>[{skuId:'104',connectionId:'wb',marketplace:'WILDBERRIES',status:'LINKED'},{skuId:'104',connectionId:'oz',marketplace:'OZON',status:'LINKED'},{skuId:'0',connectionId:'inactive',marketplace:'OZON',status:'LINKED'}];
 const svc=Object.create(SkusService.prototype);svc.prisma=db;svc.clientScopes={resolveClientFilter:()=> 'client'};const user={roleCodes:['ADMIN'],permissionCodes:['skus:read'],warehouseIds:['wh'],activeWarehouseId:'wh'};
 const filtered=await svc.catalog({sort:'stock',direction:'desc',inStock:'true'},user);assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,'104');assert.equal(filtered.items[0].stockQuantity,8);assert.equal(filtered.items[0].correspondence,'linked');
 const sorted=await svc.catalog({sort:'article'},user);assert.equal(sorted.total,105);assert.deepEqual(sorted.items.slice(0,3).map(r=>r.article),['A0','A1','A2']);
 const missing=await svc.catalog({correspondence:'missing'},user);assert.equal(missing.total,104);
 const clamp=await svc.catalog({page:'99',inStock:'true'},user);assert.equal(clamp.page,1);
 await assert.rejects(()=>svc.catalog({},{...user,activeWarehouseId:'other'}));assert.throws(()=>helper.parseCatalogQuery({sort:'bad'}));
 assert.equal(Reflect.getMetadata('path',SkusController.prototype.catalog),'catalog');
 process.env.WMS_CATALOG_SORT_ENABLED='false';await assert.rejects(()=>svc.catalog({},user));
 require(root+'app.module');assert.equal(writes,0);console.log(JSON.stringify({passed:8,databaseUsed:false,moduleGraph:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
