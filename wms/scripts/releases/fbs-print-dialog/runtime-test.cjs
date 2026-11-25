// TEST: exact compiled metadata preparation; no live business mutations.
const assert=require('assert/strict'),path=require('path'),root=process.argv[2]||'/app/apps/api/dist';
const {prepareMissingOzonGtd}=require(path.join(root,'modules/marketplace-connections/ozon-gtd-absence'));
const {prepareOzonPrint}=require(path.join(root,'modules/marketplace-connections/ozon-print-preparation'));
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';
(async()=>{
 let absent=false,shipped=false,calls=[];const posting={posting_number:'o',status:'awaiting_packaging',products:[{sku:42,quantity:1,offer_id:'red_50'}],requirements:{products_requiring_gtd:[42]}};
 const json=async(url,init)=>{calls.push(url);const body=JSON.parse(init.body);if(url.endsWith('/create-or-get'))return {posting_number:'o',multi_box_qty:1,products:[{product_id:42,quantity:1,exemplars:[{exemplar_id:10,gtd:'',is_gtd_absent:absent,is_rnpt_absent:false,rnpt:'keep',marks:[]}]}]};if(url.endsWith('/set')){assert.equal(body.products[0].exemplars[0].rnpt,'keep');absent=body.products[0].exemplars[0].is_gtd_absent;return {};}if(url.endsWith('/status'))return {products:[{product_id:42,exemplars:[{exemplar_id:10,is_gtd_absent:absent,gtd_check_status:'passed'}]}]};if(url.endsWith('/get'))return {result:{...posting,status:shipped?'awaiting_deliver':'awaiting_packaging'}};if(url.endsWith('/ship')){assert(absent);shipped=true;return {result:['o']};}throw Error('Unexpected URL');};
 const db={clientMarketplaceConnection:{findMany:async()=>[{id:'c',marketplace:'OZON',sellerId:'seller',apiKey:'fixture'}]},fbsOrderRequestLink:{findMany:async()=>[{connectionId:'c',orderId:'o',requestId:'r',syncStatus:'ACTIVE',request:{warehouseId:'w',status:'SUBMITTED'}}]},systemSetting:{upsert:async()=>{}},auditLog:{create:async()=>{}},$queryRaw:async()=>[{locked:true}]};db.$transaction=fn=>fn(db);
 await prepareOzonPrint(db,'client',[{connectionId:'c',id:'o'}],{id:'u',activeWarehouseId:'w'},json);await prepareOzonPrint(db,'client',[{connectionId:'c',id:'o'}],{id:'u',activeWarehouseId:'w'},json);
 assert.equal(calls.filter(u=>u.endsWith('/ship')).length,1);assert.equal(calls.filter(u=>u.endsWith('/set')).length,1);
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='false';await assert.rejects(prepareOzonPrint(db,'client',[{connectionId:'c',id:'o'}],{id:'u',activeWarehouseId:'w'},json));
 console.log(JSON.stringify({passed:true,synthetic:true,gtdAbsentBeforeShip:true,otherFieldsPreserved:true,repeatNoDuplicateShip:true,disabledFeatureRejected:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
