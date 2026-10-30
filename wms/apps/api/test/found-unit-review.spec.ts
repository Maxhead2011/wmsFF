import { afterEach, expect, it, vi } from 'vitest';
import { confirmFoundUnit } from '../src/modules/inventory/found-unit-review';
import { requireKnownFboKiz } from '../src/modules/tsd/fbo-known-kiz';
afterEach(()=>vi.unstubAllEnvs());
const value='0104630584393470215BIoZiCfNz>Qd';
function fixture(kind='ok') {
  vi.stubEnv('WMS_INVENTORY_FOUND_UNIT_ENABLED',kind==='disabled'?'false':'true');
  const mark={id:'mark',clientId:'client',skuId:'sku',boxId:'source',status:'AVAILABLE',value,updatedAt:new Date('2026-10-23')};
  const audit={id:'audit',boxId:'target',clientId:'client',status:'MISMATCH',completedAt:new Date('2026-10-30T07:41Z'),startedAt:new Date('2026-10-30T07:36Z'),
    session:{type:'BOX_CHECK',status:kind==='cancelled'?'CANCELLED':'REVIEW',warehouseId:'wh'},lines:[{id:'line',skuId:'sku',countedQuantity:1}]};
  const payload={kiz:value,skuId:'sku',lineId:'line',clientId:'client',boxId:'target',roundStartedAt:audit.startedAt.toISOString()};
  const tx:any={
    $executeRaw:vi.fn(),$queryRaw:vi.fn(),
    inventoryAuditBox:{findUniqueOrThrow:async()=>audit,findFirst:vi.fn(async({where}:any)=>where.boxId==='target'?{id:kind==='new-audit'?'new':'audit'}:kind==='counting'?{id:'other'}:null)},
    productMark:{findMany:async()=>kind==='duplicate'?[mark,mark]:[mark],updateMany:vi.fn(async()=>({count:kind==='race'?0:1}))},
    box:{findMany:async()=>['source','target'].map(id=>({id,clientId:'client',warehouseId:kind==='warehouse'?'other':'wh',status:'active'}))},
    stockBalance:{findMany:async()=>[{boxId:'source',skuId:'sku',clientId:'client',warehouseId:'wh',status:'AVAILABLE',quantity:kind==='source-stock'?1:0},
      {boxId:'target',skuId:'sku',clientId:'client',warehouseId:'wh',status:kind==='reserved-balance'?'RESERVED':'AVAILABLE',quantity:kind==='target-quantity'?2:1}],updateMany:vi.fn()},
    auditLog:{findUnique:async()=>kind==='retry'?{id:'proof'}:null,findMany:async()=>kind==='no-scan'?[]:[{id:'scan',payload}],create:vi.fn()},
    fboAssemblyUnit:{findFirst:async({where}:any)=>kind==='fbo'||kind==='active-fbo'&&where.assembly?{id:'unit'}:null},
    fbsTsdAssembly:{findFirst:async({where}:any)=>kind==='fbs'||kind==='reservation'&&where.AND?{id:'task'}:null},
    shippedKizHistory:{findFirst:async()=>kind==='shipped'?{id:'history'}:null},
    wbOrderShipment:{findFirst:async()=>kind==='wb-shipment'?{id:'history'}:null},
    stockMovement:{findFirst:async()=>kind==='movement'?{id:'move'}:null,create:vi.fn()},
  };
  const user:any={id:'admin',roleCodes:[kind==='worker'?'WORKER':'ADMIN'],permissionCodes:kind==='client'?[]:['system:admin'],clientScopeMode:kind==='client'?'SCOPED':'ALL',
    clientIds:[],writableClientIds:[],isDemo:kind==='demo'};
  return {tx,user,input:{kiz:value,reason:'Подтверждено физическим пересчётом',confirmed:true}};
}
// TEST: reproduce 2371: quantity was consumed by a different unknown KIZ, this known KIZ is physically counted elsewhere.
it('rebinds a proven found unit without a second receipt, debit or shipment edit',async()=>{
  const {tx,user,input}=fixture();await expect(confirmFoundUnit(tx,'audit',input,user)).resolves.toMatchObject({confirmed:true,alreadyApplied:false});
  expect(tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({boxId:'source',updatedAt:expect.any(Date)}),data:{boxId:'target',stockMovementId:null}}));
  expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({payload:expect.objectContaining({quantityChanged:0,historicalShipmentsPreserved:true})})}));
  expect(tx.stockMovement.create).not.toHaveBeenCalled();expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
});
// TEST: a repeated confirmation must not transfer/debit twice.
it('replays its durable proof without writes',async()=>{
  const {tx,user,input}=fixture('retry');expect(await confirmFoundUnit(tx,'audit',input,user)).toMatchObject({alreadyApplied:true});
  expect(tx.productMark.updateMany).not.toHaveBeenCalled();expect(tx.auditLog.create).not.toHaveBeenCalled();
});
it.each(['disabled','worker','demo','client','warehouse','cancelled','new-audit','duplicate','no-scan','source-stock','target-quantity','reserved-balance','reservation','fbo','active-fbo','fbs','shipped','wb-shipment','movement','counting','race'])('rejects unsafe found-unit confirmation: %s',async kind=>{
  // TEST: source exhaustion never authorizes stealing a reserve or reviving a shipment.
  const {tx,user,input}=fixture(kind);await expect(confirmFoundUnit(tx,'audit',input,user)).rejects.toThrow();
  expect(tx.auditLog.create).not.toHaveBeenCalled();expect(tx.stockMovement.create).not.toHaveBeenCalled();
  if(kind!=='race')expect(tx.productMark.updateMany).not.toHaveBeenCalled();
});
it('requires both an explicit confirmation and a useful reason',async()=>{
  const {tx,user,input}=fixture();await expect(confirmFoundUnit(tx,'audit',{...input,confirmed:false},user)).rejects.toThrow();
  await expect(confirmFoundUnit(tx,'audit',{...input,reason:' '},user)).rejects.toThrow();expect(tx.productMark.updateMany).not.toHaveBeenCalled();
});
it('blocks unknown FBO KIZ only in the enabled deployment',()=>{
  // TEST: unknown KIZ used to create a mark and consume another mark’s quantity.
  vi.stubEnv('WMS_INVENTORY_FOUND_UNIT_ENABLED','true');expect(()=>requireKnownFboKiz(null)).toThrow('не зарегистрирован');
  expect(()=>requireKnownFboKiz({id:'known'})).not.toThrow();
  vi.stubEnv('WMS_INVENTORY_FOUND_UNIT_ENABLED','false');expect(()=>requireKnownFboKiz(null)).not.toThrow();
});
