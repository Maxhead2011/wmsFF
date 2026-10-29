// TEST: run the actual patched production modules with isolated synthetic collaborators.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2];if(!root)throw Error('Runtime directory required');
const {TsdReceiptService}=require(path.join(root,'modules/tsd/tsd-receipt.service.js'));
const {StockOperationsService}=require(path.join(root,'modules/stock/stock-operations.service.js'));
const {TsdReviewService}=require(path.join(root,'modules/tsd/tsd-review.service.js'));
const {ImportsService}=require(path.join(root,'modules/imports/imports.service.js'));
const {clientKizIdentity}=require(path.join(root,'common/kiz-client-registry.js'));
const serial='010460000000000121AbCdEfGhIjKlM';
const full=serial+'\u001d91EE12\u001d92proof';
let passed=0;
function fixture() {
 const writes=[];let prior=true;
 const tx={$queryRaw:async q=>q.strings.join('').includes('FROM "KizClientRegistry"')&&prior?
  [{identity:serial,source:'RECEIPT',firstReceivedAt:new Date('2026-01-01'),firstBoxCode:'ORIGINAL',firstWarehouseId:'wh'}]:[],
  $executeRaw:async()=>{writes.push('registry');return 1;},
  productMark:{findMany:async()=>[],findFirst:async()=>null,create:async()=>{writes.push('mark');return{id:'mark'}}},
  shippedKizHistory:{findMany:async()=>[]},stockMovement:{findUnique:async()=>null,create:async()=>{writes.push('movement');return{id:'movement',createdAt:new Date()}}}};
 const stock=Object.create(StockOperationsService.prototype);
 Object.assign(stock,{clientScopes:{requireClientAccess(){}},resolveWritableWarehouseId:()=> 'wh',requireBalanceWarehouseId:x=>x,
  resolveOrCreateSkuForReceipt:async()=>({sku:{id:'sku',name:'Suit',needsChestnyZnak:true}}),
  ensureTargetBox:async()=>({id:'box',code:'BOX',warehouseId:'wh'}),incrementTargetBalance:async()=>{writes.push('balance');return{}},
  prisma:{$transaction:fn=>fn(tx)}});
 return{tx,stock,writes,setPrior:v=>{prior=v}};
}
(async()=>{
 process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';
 assert.equal(clientKizIdentity(full),serial);assert.notEqual(clientKizIdentity(full.toLowerCase()),serial);passed++;
 const a=fixture();const preflight=new TsdReceiptService(a.tx,{requireClientAccess(){}},{touchActiveDevice:async()=>{}});
 const user={id:'u',activeWarehouseId:'wh',permissionCodes:['system:admin'],roleCodes:['ADMIN']};
 const response=await preflight.checkKiz('client',serial,user);
 assert.equal(response.code,'KIZ_DUPLICATE');assert.equal(response.duplicateInfo.firstBoxCode,'ORIGINAL');
 assert(response.message.includes('ОТЛОЖИТЕ ТОВАР'));assert.equal(a.writes.length,0);passed++;
 const input={clientId:'client',boxCode:'BOX',barcode:'4600000000001',kiz:full,quantity:1,idempotencyKey:'op'};
 await assert.rejects(a.stock.receiveIntoBox(input,user),/ДУБЛЬ КИЗ/);assert.equal(a.writes.length,0);passed++;
 let call=0;a.tx.stockMovement.findUnique=async()=>++call===1?null:{id:'existing'};
 assert.equal((await a.stock.receiveIntoBox(input,user)).status,'ALREADY_APPLIED');assert.equal(a.writes.length,0);passed++;
 const b=fixture();b.setPrior(false);assert.equal((await b.stock.receiveIntoBox(input,user)).status,'APPLIED');
 assert.deepEqual(b.writes,['balance','movement','mark','registry']);passed++;
 const c=fixture();const review=Object.create(TsdReviewService.prototype);
 c.tx.$transaction=fn=>fn(c.tx);
 Object.assign(review,{prisma:c.tx,clientScopes:{requireGlobalClientAccess(){},requireClientAccess(){}},
  payloadParser:{parseReceiptPayload:()=>({clientId:'client',kiz:serial})},stockOperations:c.stock});
 await assert.rejects(review.acceptReceiptWithError({operationType:'receipt_scan',payload:{}},{},user),/ДУБЛЬ КИЗ/);
 assert.equal(c.writes.length,0);passed++;
 const d=fixture();d.setPrior(false);const imports=Object.create(ImportsService.prototype);imports.prisma=d.tx;
 const issues=await imports.duplicateKizIssues([{clientId:'client',kiz:serial,sourceRow:2},{clientId:'client',kiz:full,sourceRow:3}]);
 assert.equal(issues.length,1);assert.equal(issues[0].row,3);passed++;
 process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='false';
 const legacy=await preflight.checkKiz('client',serial,user);assert.equal(legacy.duplicate,false);assert.equal(legacy.code,undefined);passed++;
 console.log(JSON.stringify({passed,syntheticOnly:true}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
