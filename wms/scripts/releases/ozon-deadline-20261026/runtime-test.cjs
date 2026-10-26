// TEST: candidate runtime, no database or marketplace connection.
const assert=require('assert/strict');
const root='/app/apps/api/dist/';
require(root+'app.module.js');
const p=require(root+'modules/client-requests/ozon-supply-policy.js');
const {OzonAssemblySupplyService:S}=require(root+'modules/client-requests/ozon-assembly-supply.service.js');
const {OzonFboService:L}=require(root+'modules/ozon-fbo/ozon-fbo.service.js');
(async()=>{
 assert.equal(p.ozonEditDeadline({data_filling_deadline_utc:'2026-10-26T18:00:00+03:00'}),'2026-10-26T15:00:00.000Z');
 for(const v of [null,0,'bad','2026-10-26T18:00:00'])assert.equal(p.ozonEditDeadline({data_filling_deadline:v}),null);
 const svc=new S({},{});svc.call=async(c,path)=>path==='/v3/supply-order/get'?{orders:[{order_id:1,order_number:'A',data_filling_deadline:'2026-10-26T15:00:00Z',supplies:[{supply_id:2}]}]}:path==='/v1/cluster/list'?{clusters:[]}:{items:[]};
 const snap=await svc.snapshot({id:'c'},'1');assert.equal(p.supplyOrders(snap)[0].editDeadlineAt,'2026-10-26T15:00:00.000Z');
 const merged=p.mergeSupplyOrders(snap,[{...snap,editDeadlineAt:null},{...snap,orderId:'2',supplies:[],editDeadlineAt:'later'}]);assert.equal(merged.editDeadlineAt,null);assert.equal(p.supplyOrders(merged)[1].editDeadlineAt,'later');
 const plan={id:'p',clientId:'c',connectionId:'conn',ozonOrderId:'1',clusters:[],boxes:[],importSummary:{rows:4}};
 const db={ozonFboPlan:{findUnique:async()=>plan,update:async({data})=>Object.assign(plan,data)}};
 const legacy=new L(db,{requireClientAccess(){}});legacy.connection=async()=>({});legacy.ozonJson=async()=>({orders:[{order_id:1,data_filling_deadline:'2026-10-26T15:00:00Z',supplies:[]}]});
 const result=await legacy.refreshOrder('p',{});assert.equal(result.editDeadlineAt,'2026-10-26T15:00:00.000Z');assert.equal(plan.importSummary.rows,4);assert.equal(legacy.planSummary(plan).editDeadlineAt,result.editDeadlineAt);
 console.log(JSON.stringify({passed:4,moduleGraph:true,network:false}));
})().catch(e=>{console.error(e);process.exitCode=1});

