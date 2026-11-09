// TEST: execute the exact candidate modules, without starting schedulers or touching production data.
const assert=require('node:assert/strict'),root=process.argv[2];
process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='true';process.env.WMS_RECEIPT_CHANNELS_ENABLED='true';
const pvz=require(root+'/modules/marketplace-connections/fbs-pvz-loss');
const index=require(root+'/modules/warehouse/receipt-stock-index');
const rule={id:'receipt',clientId:'client',warehouseId:'warehouse',sourceDocument:'SERIES:2026:BOX',fbs:false,fbo:true,stockAvailable:false,protectedOrders:[],revision:1,changedAt:''};
index.receiptStockIndexEnabled=()=>true;index.readIndexedReceiptState=async()=>({rules:new Map([['box',rule]]),pending:['box']});
const policy=require(root+'/modules/warehouse/receipt-channel-policy');
const task={id:'task',requestItemId:'item',requestId:'request',clientId:'client',stockWarehouseId:'warehouse',marketplace:'WILDBERRIES',connectionId:'wb',orderId:'order',skuId:'sku',itemCount:1,status:'RESERVED',reservedBoxId:'box'};
const value={version:1,purpose:'PVZ_LOSS_SETTLEMENT',...task,taskId:'task',warehouseId:'warehouse',shipmentId:'shipment',originalAttemptId:'old',receiptSourceApproval:{taskId:'task',boxId:'box',skuId:'sku',quantity:1,approvedByUserId:'owner',approvedAt:'2026-11-09T17:00:00Z'}};
const db={systemSetting:{findMany:async()=>[{key:pvz.pvzLossKey('request'),value}]},fbsTsdAssembly:{findUnique:async({where})=>where.id==='task'?task:{...task,id:'other',orderId:'other'},findMany:async()=>[task,{...task,id:'other',orderId:'other'}]},box:{findUnique:async()=>({id:'box',code:'BOX',clientId:'client',warehouseId:'warehouse',status:'active'})},stockBalance:{aggregate:async()=>({_sum:{quantity:6}})}};
(async()=>{
 assert.equal((await pvz.readPvzApprovedReceiptSource(db,task)).id,'box');
 await policy.assertReceiptFbsBox(db,task,'box');assert.deepEqual(await policy.receiptBlockedBoxes(db,'client','fbs','task'),[]);
 assert.deepEqual(await policy.receiptBlockedBoxes(db,'client','fbo','task'),['box']);
 assert.deepEqual(await policy.receiptBlockedBoxes(db,'client','fbs'),['box']);
 const blocked=await policy.receiptBlockedByTasks(db,'client',['task','other']);assert.deepEqual(blocked.get('task'),[]);assert.deepEqual(blocked.get('other'),['box']);
 await assert.rejects(()=>policy.assertReceiptFbsBox(db,{...task,id:'other',orderId:'other'},'box'));
 assert.equal(policy.receiptAllows(rule,'fbs',task),false);
 const service={prisma:db,fbsTsdReservationRows:async()=>[{boxId:'box',itemCount:2}]};assert.equal((await pvz.resolvePvzReceiptStockSource(service,task)).storageBoxes[0].quantity,1);
 service.fbsTsdReservationRows=async()=>[{boxId:'box',itemCount:6}];assert.equal(await pvz.resolvePvzReceiptStockSource(service,task),null);
 task.status='COMPLETED';assert.equal(await pvz.readPvzApprovedReceiptSource(db,task),null);await assert.rejects(()=>policy.assertReceiptFbsBox(db,task,'box'));
 task.status='RESERVED';process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='false';assert.equal(await pvz.readPvzApprovedReceiptSource(db,task),null);await assert.rejects(()=>policy.assertReceiptFbsBox(db,task,'box'));
 require(root+'/modules/marketplace-connections/marketplace-connections.service');
 console.log('PASS actual candidate: scoped receipt/queue source, no global approval, quantity1, competing stock, consumed and disabled rejection, service load');
})().catch(e=>{console.error(e);process.exitCode=1});
