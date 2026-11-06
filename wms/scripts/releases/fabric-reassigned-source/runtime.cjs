// TEST: exercise the exact deployed module, with no production database access.
const assert = require('node:assert/strict');
const path = require('node:path');
const { tryAssignFabricTask, assignFabricTaskForQueue } = require(path.resolve(process.argv[2], 'modules/marketplace-connections/fbs-fabric-queue.js'));
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
  return {service:{prisma:db},order:{id:'order',connectionId:'shop',marketplace:'WILDBERRIES',itemCount:2,product:sku,request:{id:'request'},requiredMeta:[]},user:{id:'worker',name:'Worker',activeWarehouseId:'warehouse',tsdFabricCutConfirmation:true},ledger:()=>ledger,writes:()=>writes, db};
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
  // TEST: exact runtime allocates later rolls without erasing historic pending consumption.
  const later=fixture();
  later.ledger().shipmentPending=[{key:'wb:shipment',warehouseId:'warehouse',material:'SATIN',color:'white',meters:264}];
  later.ledger().rolls.unshift({...later.ledger().rolls[0],id:'old',createdAt:'2026-10-18',remainingMm:500000});
  later.db.wbOrderShipment={findMany:async({where})=>{assert.equal(where.clientId,'client');assert.equal(where.warehouseId,'warehouse');return [{id:'shipment',shippedAt:new Date('2026-10-21')}];}};
  const before=structuredClone(later.ledger());
  assert.equal((await assignFabricTaskForQueue(later.service,'client',later.order,existing,later.user,'device')).task.status,'IN_PROGRESS');
  assert.deepEqual(later.ledger().rolls,before.rolls);
  assert.deepEqual(later.ledger().shipmentPending,before.shipmentPending);
  assert.deepEqual(later.ledger().fbsReservations[0].rollIds,['roll','roll']);
  const blocked=fixture();
  blocked.ledger().shipmentPending=[{warehouseId:'warehouse',material:'SATIN',color:'white',meters:264}];
  const reason=await assignFabricTaskForQueue(blocked.service,'client',blocked.order,existing,blocked.user,'device');
  assert.match(reason.blockedReason,/сверка/);assert.equal(blocked.writes(),0);

  // TEST: exact runtime restores a released fabric source without changing its ledger.
  const ledgerBefore=structuredClone(f.ledger());
  let assigned;
  f.db.fbsTsdAssembly.updateMany=async({data})=>{assigned=data;return {count:1};};
  await tryAssignFabricTask(f.service,'client',f.order,{id:'task',status:'RELEASED',sourceArticle:'__FABRIC_FBS__',boxId:null,boxCode:null,barcode:null},f.user,'device');
  assert.equal(assigned.boxCode,'\u0411\u0415\u0417 \u041a\u041e\u0420\u041e\u0411\u0410');
  assert.equal(assigned.sourceBoxPending,false);assert.equal('barcode' in assigned,false);
  assert.deepEqual(f.ledger(),ledgerBefore);
  const state=require(path.resolve(process.argv[2],'modules/warehouse/fabric-fbs-task-state.js'));
  const confirmation=require(path.resolve(process.argv[2],'modules/warehouse/fabric-fbs-confirmation.js'));
  const scan=require(path.resolve(process.argv[2],'modules/warehouse/fabric-fbs-scan.js')).scanWbFabric;
  state.readFabricTaskLines=async()=>[{lineId:'item',skuId:'sku',quantity:1,confirmedUnits:1,remainingUnits:0}];
  confirmation.confirmFabricProduction=async()=>{throw Error('Double debit');};
  const task={id:'t',requestId:'r',clientId:'c',sourceArticle:'__FABRIC_FBS__',marketplace:'WILDBERRIES',requestItemId:'item',skuId:'sku',itemCount:1,barcodes:['123'],barcode:null};
  let updates=0;
  const tx={$queryRaw:async()=>[{locked:true}],fbsTsdAssembly:{findUnique:async()=>task,update:async({data})=>{updates++;return {...task,...data};}}};
  const svc={prisma:{$transaction:fn=>fn(tx)},requireCurrentFbsTsdLease:()=>{}};
  for(const count of [0,1]) assert.equal((await scan(svc,task,'123',count,{})).barcode,'123');
  await assert.rejects(scan(svc,task,'wrong',0,{}));assert.equal(updates,2);

  process.env.WMS_FBS_FABRIC_CUT_ENABLED='false';
  assert.deepEqual(await tryAssignFabricTask({prisma:null},'client',null,null,null,null),{handled:false});
  console.log('later-receipts runtime OK: assignment, no consumption, five evidence guards, disabled isolation');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
