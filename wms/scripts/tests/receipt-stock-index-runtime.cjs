// TEST: compare exact runtime decisions on a repeatable snapshot; only a temporary index is written.
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const base='/app/apps/api/dist',candidate=process.env.CANDIDATE_ROOT||'/release/api';
const old=require(base+'/modules/warehouse/receipt-channel-policy'),next=require(candidate+'/modules/warehouse/receipt-channel-policy');
const OldFbo=require(base+'/modules/tsd/fbo-two-stage.service').FboTwoStageService,NewFbo=require(candidate+'/modules/tsd/fbo-two-stage.service').FboTwoStageService;
const scopes=new (require(base+'/modules/auth/client-scope.service').ClientScopeService)();
let queries=0;const db=new PrismaClient({log:[{emit:'event',level:'query'}]});db.$on('query',()=>queries++);
const normalize=v=>JSON.parse(JSON.stringify(v));
const rollback=Error('EXPECTED_ROLLBACK');
const report={passed:false,temporaryIndex:true,rolledBack:false,comparisons:[],timings:[]};
async function measure(name,fn){const q=queries,start=performance.now();const result=await fn();report.timings.push({name,ms:Math.round(performance.now()-start),queries:queries-q});return result;}
async function state(flag,fn){process.env.WMS_RECEIPT_STOCK_INDEX_ENABLED=flag;return fn();}
(async()=>{
 try{await db.$transaction(async tx=>{
  if(process.env.USE_PERSISTED_INDEX!=='true'){
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE "ReceiptStockIdentity" ON COMMIT DROP AS
    WITH movements AS (SELECT "boxId","clientId","warehouseId",MAX("createdAt") AS at FROM "StockMovement" WHERE type='RECEIPT' AND quantity>0 AND "boxId" IS NOT NULL GROUP BY "boxId","clientId","warehouseId"),
    openings AS (SELECT payload->>'boxCode' AS code,payload->>'clientId' AS client,payload->>'warehouseId' AS warehouse,MAX("createdAt") AS at FROM "TsdOperation"
      WHERE "operationType" IN ('receipt_open_box','receipt_box_status') AND status='ACCEPTED' AND jsonb_typeof(payload->'sourceDocument')='string' AND payload->>'sourceDocument'<>'' GROUP BY 1,2,3)
    SELECT b.id AS "boxId",GREATEST(m.at,o.at) AS "receiptAt",m.at AS "movementAt" FROM "Box" b
    LEFT JOIN movements m ON m."boxId"=b.id AND m."clientId"=b."clientId" AND m."warehouseId"=b."warehouseId"
    LEFT JOIN openings o ON o.code=b.code AND o.client=b."clientId" AND o.warehouse=b."warehouseId"`);
  await tx.$executeRawUnsafe('CREATE UNIQUE INDEX ON "ReceiptStockIdentity"("boxId")');
  }else report.temporaryIndex=false;
  const client=await tx.client.findFirst({where:{code:'CL-000001'},select:{id:true}});assert(client);
  const settings=await tx.systemSetting.findMany({where:{key:{startsWith:'receipt.approval.scope.v1:'+client.id+':'}},select:{value:true}});
  for(const scope of settings){const warehouseId=scope.value.warehouseId;
    const oldPending=await state('false',()=>measure('pending-before',()=>old.pendingReceiptBoxIds(tx,[client.id],warehouseId)));
    const newPending=await state('true',()=>measure('pending-after',()=>next.pendingReceiptBoxIds(tx,[client.id],warehouseId)));
    assert.deepEqual([...newPending].sort(),[...oldPending].sort());report.comparisons.push({kind:'pending',boxes:newPending.length});
    const oldRules=await state('false',()=>measure('rules-before',()=>old.receiptRules(tx,client.id,warehouseId)));
    const newRules=await state('true',()=>measure('rules-after',()=>next.receiptRules(tx,client.id,warehouseId)));
    assert.deepEqual(normalize([...newRules].sort()),normalize([...oldRules].sort()));report.comparisons.push({kind:'rules',boxes:newRules.size});
  }
  const tasks=await tx.fbsTsdAssembly.findMany({where:{clientId:client.id,boxId:{not:null}},take:3,orderBy:{updatedAt:'desc'},select:{id:true,clientId:true,boxId:true,connectionId:true,orderId:true,marketplace:true}});
  for(let i=0;i<tasks.length;i++){
    const check=async module=>{try{await module.assertReceiptFbsBox(tx,tasks[i]);return 'allowed';}catch(e){if(e.getStatus?.()!==409)throw e;return 'blocked';}};
    const before=await state('false',()=>measure('FBS-box-check-before-'+i,()=>check(old)));
    const after=await state('true',()=>measure('FBS-box-check-after-'+i,()=>check(next)));assert.equal(after,before);
  }
  const request=await tx.clientRequest.findUnique({where:{number:1813},select:{id:true,warehouseId:true}});assert(request);
  const user={id:'read-only-benchmark',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:request.warehouseId};
  for(const mode of ['before','after']){
    const Service=mode==='before'?OldFbo:NewFbo,service=new Service(db,scopes);
    const r=await service.load(tx,request.id,user,'read');
    const plan=await state(mode==='before'?'false':'true',()=>measure('FBO-plan-'+mode,()=>service.snapshot(tx,r)));
    delete plan.observedAt;
    if(mode==='before')report.oldPlan=normalize(plan);else{assert.deepEqual(normalize(plan),report.oldPlan);report.comparisons.push({kind:'FBO-plan',lines:plan.lines.length,routeBoxes:plan.route.length,picked:plan.picked});delete report.oldPlan;}
  }
  throw rollback;
 },{isolationLevel:'RepeatableRead',timeout:120000,maxWait:5000});}catch(e){if(e!==rollback)throw e;report.rolledBack=true;}
 report.passed=true;console.log(JSON.stringify(report));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.stack);process.exitCode=1});
