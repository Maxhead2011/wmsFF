// TEST: exercise the exact deployed module, with no production database access.
const assert = require('node:assert/strict');
const path = require('node:path');
const { tryAssignFabricTask } = require(path.resolve(process.argv[2], 'modules/marketplace-connections/fbs-fabric-queue.js'));
function fixture() {
  let writes=0;
  let ledger={rolls:[{id:'roll',warehouseId:'warehouse',material:'SATIN',color:'white',remainingMm:20000,cutMm:0,createdAt:'2026-11-05'}]};
  const sku={id:'sku',clientId:'client',name:'Ткань',internalSku:'white_3',barcodes:[{value:'1234567890123'}]};
  const db={
    $queryRaw:async q=>q.join('').includes('advisory')?[{locked:true}]:[],
    systemSetting:{findUnique:async({where})=>({value:where.key==='fabric.rolls.v1:client'?ledger:{enabled:true}}),update:async({data})=>{writes++;ledger=data.value;}},
    sku:{findMany:async()=>[sku]},
    clientRequest:{findUnique:async()=>({id:'request',clientId:'client',warehouseId:'warehouse',status:'IN_WORK'})},
    clientRequestItem:{findFirst:async()=>({id:'item',requestId:'request',skuId:'sku',quantity:2}),findMany:async()=>[{id:'item',requestId:'request',skuId:'sku',quantity:2,sku}]},
    fbsTsdAssembly:{updateMany:async({where,data})=>{assert.deepEqual(where,{id:'task',status:'WAITING_STOCK',updatedAt:'version'});assert.equal(data.status,'IN_PROGRESS');return {count:1};},findUnique:async()=>({id:'task',status:'IN_PROGRESS'})},
    clientRequestEvent:{create:async()=>{}},
  };
  db.$transaction=async fn=>fn(db);
  return {service:{prisma:db},order:{id:'order',connectionId:'shop',marketplace:'WILDBERRIES',itemCount:2,product:sku,request:{id:'request'},requiredMeta:[]},user:{id:'worker',name:'Worker',activeWarehouseId:'warehouse',tsdFabricCutConfirmation:true},ledger:()=>ledger,writes:()=>writes};
}
async function run(){
  process.env.WMS_FBS_FABRIC_CUT_ENABLED='true';
  const existing={id:'task',status:'WAITING_STOCK',updatedAt:'version'};
  const f=fixture();
  const result=await tryAssignFabricTask(f.service,'client',f.order,existing,f.user,'device');
  assert.equal(result.task?.status,'IN_PROGRESS');
  assert.equal(f.ledger().rolls[0].remainingMm,20000);
  assert.equal(f.ledger().fbsReservations[0].units,2);
  for(const field of ['barcode','kiz','sourceBarcode','relabelConfirmedAt','marketplaceSubmittedAt']){
    const g=fixture();
    await assert.rejects(tryAssignFabricTask(g.service,'client',g.order,{...existing,[field]:'proof'},g.user,'device'),/физические/);
    assert.equal(g.writes(),0);
  }
  process.env.WMS_FBS_FABRIC_CUT_ENABLED='false';
  assert.deepEqual(await tryAssignFabricTask({prisma:null},'client',null,null,null,null),{handled:false});
  console.log('waiting-stock runtime OK: assignment, no consumption, five evidence guards, disabled isolation');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
