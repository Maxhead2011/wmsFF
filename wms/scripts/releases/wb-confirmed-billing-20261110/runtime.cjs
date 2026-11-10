// TEST: execute the actual staged service with synthetic database writers only.
const assert=require('assert/strict');const {MarketplaceConnectionsService}=require('/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service');
const accepted={id:'o',connectionId:'cab',marketplace:'WILDBERRIES',category:'shipped',supplierStatus:'complete',wbStatus:'sorted',itemCount:1};
(async()=>{let passed=0;for(const [flag,wbStatus,fact,expected]of [[true,'sorted',false,1],[true,'waiting',false,0],[true,'waiting',true,0],[true,'sorted',true,1],[false,'sorted',false,1]]){
process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED=String(flag);const order={...accepted,wbStatus,supplierStatus:wbStatus==='waiting'?'confirm':'complete'};
const db={$queryRaw:async()=>[],wbOrderShipment:{findMany:async()=>fact?[{assemblyId:'a',connectionId:'cab',orderId:'o',assemblySnapshot:{},orderSnapshot:order,quantity:1,shippedAt:new Date()}]:[]}};db.$transaction=async cb=>cb(db);
const service=new MarketplaceConnectionsService(db,{});let rows=[];service.ensureFbsProcessingChargesLocked=async(c,o)=>{rows=o;return new Map()};await service.ensureFbsProcessingCharges('test', [order]);assert.equal(rows.length,expected);passed++;
}console.log('PASS runtime',passed);})().catch(e=>{console.error(e);process.exitCode=1});
