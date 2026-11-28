const test = require('node:test'), assert = require('node:assert/strict');
const root = require('node:path').resolve(process.argv[2]);
const {planShipments} = require(root+'/modules/warehouse/fabric-shipment-accounting');
const {ozonShipments} = require(root+'/modules/warehouse/fabric-ozon-done');
test('Ozon and FBO handovers consume cut credit once; retry preserves roll balance',async()=>{
 const sku={material:'SATIN',color:'red',mm:3000};
 const tx={auditLog:{findMany:async()=>[{payload:{requestId:'r'},createdAt:new Date(5)}]},
 clientRequest:{findMany:async()=>[{id:'r',warehouseId:'w',items:[{id:'i',skuId:'s',quantity:2}]}]}};
 const [oz]=await ozonShipments(tx,'client',new Map([['s',sku]]));
 const roll={id:'roll',warehouseId:'w',material:'SATIN',color:'red',remainingMm:20000,createdAt:new Date(0)};
 const fb={...oz,marketplace:undefined,requestId:'f',key:'fbo:f:i',at:new Date(4),mm:3000};
 const bound={...oz,key:'cut',taskId:'t',at:new Date(2),mm:3000};
 const loose={key:'ready',skuId:'s',warehouseId:'w',at:new Date(1),mm:3000};
 const a=planShipments({rolls:[roll]},[oz,fb],[bound,loose]);
 assert.equal(a.state.rolls[0].remainingMm,17000);
 assert.equal(a.state.shipmentAccounting.events[oz.key].coveredMm,3000);
 assert.equal(a.state.shipmentAccounting.events[fb.key].coveredMm,3000);
 assert.deepEqual(planShipments(a.state,[oz,fb],[bound,loose]).changes,[]);
});
