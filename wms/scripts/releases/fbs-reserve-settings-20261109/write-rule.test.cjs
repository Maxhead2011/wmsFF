// TEST: actual write handler accepts a shared SKU only through an active same-client WB link.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(process.argv[2],'utf8');
const method=text.slice(text.indexOf('async updateFineRule('),text.indexOf('async isEnabled(')).trim();
const handler=vm.runInNewContext('({'+method+'})',{
 wb_stock_reserve_1:{fineStockSettingsEnabled:()=>true,parseWbStockReserve:x=>x},
 common_1:{ForbiddenException:Error,BadRequestException:Error,NotFoundException:Error,ConflictException:Error}
}).updateFineRule;
let marketplace='OZON',linked=true,active=true,version=null,writes=0;
const body={reserve:{mode:'NONE',value:0},blocked:true,expectedUpdatedAt:null};
const tx={$executeRaw:async()=>0,client:{findUnique:async()=>({id:'client'})},systemSetting:{findUnique:async()=>version?{updatedAt:new Date(version),value:{}}:null,upsert:async args=>{writes++;assert.equal(args.create.value.blocked,true);return {updatedAt:new Date('2026-11-09T12:00:00Z')}}},auditLog:{create:async()=>({})}};
const context={requireReserveEditor:()=>{},scopes:{requireClientAccess:(_u,c,mode)=>{assert.equal(c,'client');assert.equal(mode,'write')}},prisma:{
 sku:{findFirst:async args=>args.where.marketplace&&args.where.marketplace!==marketplace?null:({id:'sku',marketplace})},
 marketplaceProductLink:{findMany:async args=>{assert.equal(args.where.clientId,'client');assert.equal(args.where.skuId,'sku');assert.equal(args.where.status,'LINKED');assert.equal(args.where.marketplace,'WILDBERRIES');return linked?[{connectionId:'cab'}]:[]}},
 clientMarketplaceConnection:{findFirst:async args=>{assert.equal(args.where.clientId,'client');assert.equal(args.where.isActive,true);assert.equal(args.where.marketplace,'WILDBERRIES');assert.equal(args.where.id.in[0],'cab');return active?{id:'cab'}:null}},
 $transaction:async fn=>fn(tx)
}};
(async()=>{
 await handler.call(context,'client','sku',body,{id:'staff'});assert.equal(writes,1,'Shared linked SKU must retain the existing versioned write path');
 linked=false;await assert.rejects(()=>handler.call(context,'client','sku',body,{id:'staff'}));assert.equal(writes,1);
 linked=true;active=false;await assert.rejects(()=>handler.call(context,'client','sku',body,{id:'staff'}));assert.equal(writes,1);
 active=true;version='2026-11-09T11:00:00Z';await assert.rejects(()=>handler.call(context,'client','sku',body,{id:'staff'}),/изменена/);assert.equal(writes,1);
 version=null;marketplace='WILDBERRIES';linked=false;await handler.call(context,'client','sku',body,{id:'staff'});assert.equal(writes,2);
 console.log('PASS write5: shared active WB link, no link, inactive/wrong-scope query, stale version, native WB');
})().catch(e=>{console.error(e);process.exitCode=1});
