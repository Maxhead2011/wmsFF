// TEST: exercise the exact runtime list handler without database writes.
const assert = require('node:assert/strict');
const {TsdAssemblyService} = require(process.argv[2]);
(async () => {
 let select;
 const prisma={clientRequest:{findMany:async args=>{select=args.select;return [{id:'r',number:2656,title:'Ozon',status:'IN_WORK',createdAt:new Date(),updatedAt:new Date(),items:[{quantity:7},{quantity:2}],_count:{items:2},pickWaveRequests:[]}];}}};
 const service=new TsdAssemblyService(prisma,{resolveClientFilter:()=>undefined});
 service.loadActiveTsdProcesses=async()=>new Map();
 const [row]=await service.listActiveRequests({id:'u'});
 assert.equal(row.number,2656);assert.equal(row.totalQuantity,9);assert.equal(row.rowsCount,2);
 assert.deepEqual(select.items,{select:{quantity:true}});assert.equal(select.number,true);
 console.log(JSON.stringify({passed:5,number:row.number,units:row.totalQuantity,rows:row.rowsCount}));
})().catch(e=>{console.error(e);process.exit(1)});
