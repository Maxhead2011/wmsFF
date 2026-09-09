import { afterEach, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

const kiz = '010460000000000121ABCDEFGHIJKLM';
const user: any = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh', permissionCodes: [] };
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(StockOperationsService.prototype);
  service.incrementTargetBalance = vi.fn();
  const mark: any = { id: 'mark', value: kiz, clientId: 'old-client', skuId: 'old-sku', boxId: 'source', status: 'RESERVED', updatedAt: new Date() };
  const source = { id: 'source', code: 'SOURCE', clientId: 'old-client', warehouseId: 'old-wh', status: 'archived' };
  const target = { id: 'target', code: 'TARGET', clientId: 'client', warehouseId: 'wh', status: 'active', palletId: null };
  const balance: any = { id: 'balance', clientId: mark.clientId, skuId: mark.skuId, warehouseId: 'old-wh', boxId: 'source', palletId: null, status: 'RESERVED', quantity: 1 };
  const tx: any = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    box: { findUnique: vi.fn(async({where}: any) => where.code === 'TARGET' || where.id === 'target' ? target : source), update: vi.fn() },
    barcode: { findMany: vi.fn().mockResolvedValue([{sku: {id: 'sku'}}]) },
    productMark: { findMany: vi.fn(async()=>[mark]), updateMany: vi.fn().mockResolvedValue({count: 1}), create: vi.fn().mockResolvedValue({id: 'new-mark'}) },
    stockBalance: { findMany: vi.fn(async()=>[balance]), updateMany: vi.fn().mockResolvedValue({count: 1}), deleteMany: vi.fn() },
    stockMovement: { create: vi.fn(async({data}: any)=>({id: `movement-${data.quantity}`, ...data})), findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
  };
  const input = {toBoxCode:'TARGET',barcode:'4600000000001',kiz,sessionId:'session',idempotencyKey:'admin-unit',sourceBoxCode:'SOURCE'};
  return {service,tx,input,mark,source,target,balance};
}
it('settles SKU collection receipt and debits its boxless PACKING stock through the ADMIN entry point',async()=>{
  // TEST: merge regression: physical reconciliation must not strand the original PICKED scan.
  const f=fixture();Object.assign(f.mark,{boxId:null,status:'PACKING',sourceDocument:'collection',stockMovementId:'pick'});
  Object.assign(f.balance,{boxId:null,status:'PACKING'});
  f.tx.stockMovement.findUnique.mockResolvedValue({warehouseId:'old-wh',clientId:'old-client',skuId:'old-sku'});
  const source={id:'collection-source',requestId:'collection',clientId:'old-client',skuId:'old-sku',receivedQuantity:0,updatedAt:new Date()};
  f.tx.clientRequest={findUnique:vi.fn().mockResolvedValue({id:'collection',clientId:'old-client',type:'SKU_COLLECTION',status:'PACKED'}),update:vi.fn()};
  f.tx.skuCollectionScan={findMany:vi.fn().mockResolvedValue([{id:'scan',kiz,source,updatedAt:new Date()}]),updateMany:vi.fn().mockResolvedValue({count:1})};
  f.tx.skuCollectionSource={updateMany:vi.fn().mockResolvedValue({count:1}),aggregate:vi.fn().mockResolvedValue({_sum:{plannedQuantity:1,pickedQuantity:1,receivedQuantity:1}})};
  const result=await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  expect(result).toMatchObject({recovered:false,sourceBoxId:null});
  expect(f.tx.stockMovement.create.mock.calls.map((c:any)=>c[0].data.quantity)).toEqual([-1,1]);
  expect(f.tx.skuCollectionScan.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'RECEIVED',targetBoxId:'target'})}));
  expect(f.tx.clientRequest.update).toHaveBeenCalledWith({where:{id:'collection'},data:{status:'DONE'}});
});
it('moves a reserved foreign-client unit to the target ownership without increasing total stock',async()=>{
  // TEST: ADMIN physical truth overrides stale ownership/status, but the old quantity is consumed.
  const f=fixture(); const result=await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  expect(result).toMatchObject({skuId:'sku',sourceBoxId:'source',sourceClientId:'old-client',targetClientId:'client',recovered:false});
  expect(f.tx.stockBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'balance',quantity:{gte:1}}),data:{quantity:{decrement:1}}}));
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({clientId:'client',skuId:'sku',boxId:'target',status:'AVAILABLE'})}));
  expect(f.tx.stockMovement.create.mock.calls.map((c:any)=>c[0].data.quantity)).toEqual([-1,1]);
  expect(f.tx.auditLog.create).toHaveBeenCalled();
});
it.each(['PACKING','SHIPPING','BLOCKED','DEFECT','AVAILABLE'])('accepts a physically scanned %s mark without touching historical tables',async status=>{
  // TEST: no dependency on shipment/print-history mutations or manager approval.
  const f=fixture();f.mark.status=status;f.balance.status=status;
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).resolves.toMatchObject({recovered:false});
});
it('receives exactly one found unit when no recorded quantity exists',async()=>{
  // TEST: existing zero-stock KIZ is rebound, not duplicated.
  const f=fixture();f.tx.stockBalance.findMany.mockResolvedValue([]);
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toMatchObject({recovered:true});
  expect(f.tx.productMark.create).not.toHaveBeenCalled();
  expect(f.tx.stockMovement.create.mock.calls.map((c:any)=>c[0].data.quantity)).toEqual([1]);
});
it('registers an unknown KIZ against a real source balance even when other marks occupy its capacity',async()=>{
  // TEST: stale mark capacity cannot block the physical third unit.
  const f=fixture();f.tx.productMark.findMany.mockResolvedValue([]);f.balance.skuId='sku';f.balance.clientId='client';f.source.clientId='client';
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).resolves.toMatchObject({recovered:false,markId:'new-mark'});
});
it('does not add quantity for a repeated scan already in the target',async()=>{
  // TEST: different operation key still cannot duplicate an existing target identity.
  const f=fixture();Object.assign(f.mark,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  Object.assign(f.balance,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toMatchObject({alreadyApplied:true});
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each(['role','flag','demo','hidden','invalid-kiz','ambiguous-sku'])('rejects %s without stock mutation',async kind=>{
  // TEST: isolate administrator override from ordinary employees/demo installations.
  const f=fixture();const actor={...user};
  if(kind==='role')actor.roleCodes=['WAREHOUSE_KEEPER'];
  if(kind==='flag')vi.stubEnv('WMS_PALLET_SORTING_ENABLED','false');
  if(kind==='demo')actor.isDemo=true;
  if(kind==='hidden')actor.hiddenClientIds=['old-client'];
  if(kind==='invalid-kiz')f.input.kiz='invalid';
  if(kind==='ambiguous-sku')f.tx.barcode.findMany.mockResolvedValue([{sku:{id:'one'}},{sku:{id:'two'}}]);
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,actor)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('fails atomically when another operation consumed the selected source balance',async()=>{
  // TEST: guarded decrement, never a negative source or phantom receipt on a race.
  const f=fixture();f.tx.stockBalance.updateMany.mockResolvedValue({count:0});
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('uses physical source quantity instead of a new receipt when the stale recorded box is empty',async()=>{
  // TEST: correcting location must not leave the physically scanned box quantity behind.
  const f=fixture();f.tx.box.findUnique.mockImplementation(async({where}:any)=>where.code==='TARGET'?f.target:where.id==='source'?f.source:{...f.source,id:'physical'});
  Object.assign(f.balance,{boxId:'physical',clientId:'client',skuId:'sku'});
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).resolves.toMatchObject({sourceBoxId:'physical',recovered:false});
  const query=f.tx.stockBalance.findMany.mock.calls[0][0].where;
  expect(JSON.stringify(query)).toContain('physical');
});
it('replays the same operation from its audit with no new stock mutation',async()=>{
  // TEST: operation id is bound to normalized identity/user/session/target/barcode.
  const f=fixture();const result=await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  const audit=f.tx.auditLog.create.mock.calls[0][0].data;
  f.tx.auditLog.findFirst.mockResolvedValue(audit);f.service.incrementTargetBalance.mockClear();
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toEqual({...result,alreadyApplied:true});
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
  await expect(f.service.reconcileAdminSortingUnit(f.tx,{...f.input,toBoxCode:'DIFFERENT'},user)).rejects.toThrow('Ключ');
});
it('reuses a target-client identity variant and retires old aliases without erasing history',async()=>{
  // TEST: cross-client duplicate values must not hit (clientId,value) unique on reassignment.
  const f=fixture();const targetAlias={...f.mark,id:'target-alias',clientId:'client',skuId:'sku',boxId:null,status:'BLOCKED'};
  f.tx.productMark.findMany.mockResolvedValue([f.mark,targetAlias]);
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).resolves.toMatchObject({markId:'target-alias'});
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'mark'}),data:{status:'BLOCKED',boxId:null}}));
});
it('restores an archived target and audits a no-op physical confirmation without adding a unit',async()=>{
  // TEST: an already present identity is still an audited administrator confirmation.
  const f=fixture();f.target.status='archived';Object.assign(f.mark,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  Object.assign(f.balance,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  expect(f.tx.box.update).toHaveBeenCalledWith({where:{id:'target'},data:{status:'active'}});
  expect(f.tx.auditLog.create).toHaveBeenCalled();expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('retires a stale duplicate location even when the canonical unit is already in the target',async()=>{
  // TEST: a no-op scan still leaves only one current box binding for the identity.
  const f=fixture();Object.assign(f.mark,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  Object.assign(f.balance,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  f.tx.productMark.findMany.mockResolvedValue([f.mark,{...f.mark,id:'alias',clientId:'old',boxId:'source'}]);
  await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'alias'}),data:{status:'BLOCKED',boxId:null}}));
});
it.each(['target','source','alias'])('rechecks hidden %s ownership before returning an old operation',async kind=>{
  // TEST: idempotency is not an authorization cache after access changes.
  const f=fixture();await f.service.reconcileAdminSortingUnit(f.tx,f.input,user);
  const audit=f.tx.auditLog.create.mock.calls[0][0].data;
  if(kind==='alias')audit.payload.previousMarks.push({clientId:'hidden-alias'});
  f.tx.auditLog.findFirst.mockResolvedValue(audit);
  await expect(f.service.reconcileAdminSortingUnit(f.tx,f.input,{...user,hiddenClientIds:[kind==='target'?'client':kind==='source'?'old-client':'hidden-alias']})).rejects.toThrow();
});
it('uses proven boxless stock when provided source boxes have no stock',async()=>{
  // TEST: caller sourceBoxIds/source hint cannot hide a known boxless quantity and mint +1.
  const f=fixture();f.mark.boxId=null;f.mark.stockMovementId='origin';
  f.tx.stockMovement.findUnique.mockResolvedValue({id:'origin',clientId:'old-client',skuId:'old-sku',warehouseId:'old-wh'});
  f.balance.boxId=null;
  f.tx.stockBalance.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([f.balance]);
  expect(await f.service.reconcileAdminSortingUnit(f.tx,{...f.input,sourceBoxIds:['source']},user)).toMatchObject({recovered:false});
  expect(f.tx.stockMovement.create.mock.calls.map((c:any)=>c[0].data.quantity)).toEqual([-1,1]);
});
it.each(['N','-other-case'])('does not rebind another serial sharing the scanned prefix (%s)',async suffix=>{
  // TEST: SQL startsWith is candidate retrieval, never identity equality.
  const f=fixture();f.mark.value=suffix==='N'?`${kiz}N`:kiz.replace('ABCDEFGHIJKLM','abcdefghijklm');
  f.tx.stockBalance.findMany.mockResolvedValue([]);
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toMatchObject({markId:'new-mark'});
  expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
});
it.each([`]D2${kiz}`,kiz.replace('21ABCDEFGHIJKLM','<gs>21ABCDEFGHIJKLM')])('finds normalized stored variant %s without a duplicate receipt',async value=>{
  // TEST: wrapper notation is case-insensitive; serial identity is not.
  const f=fixture();Object.assign(f.mark,{value,boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  Object.assign(f.balance,{boxId:'target',skuId:'sku',clientId:'client',status:'AVAILABLE'});
  f.tx.productMark.findMany.mockImplementation(async({where}:any)=>where.OR.some((clause:any)=>{
    const start=clause.value.startsWith.replace(/\\([\\%_])/g,'$1');
    return clause.value.mode==='insensitive'?value.toLowerCase().startsWith(start.toLowerCase()):value.startsWith(start);
  })?[f.mark]:[]);
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toMatchObject({alreadyApplied:true,markId:'mark'});
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('prioritizes proven owned boxless quantity over an unrelated physical-box balance and preserves null source location',async()=>{
  // TEST: the source owner/location follow the existing identity, not a fallback box hint.
  const f=fixture();f.mark.boxId=null;f.mark.stockMovementId='origin';
  f.tx.stockMovement.findUnique.mockResolvedValue({id:'origin',clientId:'old-client',skuId:'old-sku',warehouseId:'old-wh'});
  const own={...f.balance,id:'own',boxId:null};
  const other={...f.balance,id:'other',clientId:'other-client',skuId:'other-sku',status:'AVAILABLE'};
  f.tx.stockBalance.findMany.mockResolvedValueOnce([other]).mockResolvedValueOnce([own]);
  expect(await f.service.reconcileAdminSortingUnit(f.tx,f.input,user)).toMatchObject({sourceBoxId:null,sourceClientId:'old-client',recovered:false});
  expect(f.tx.stockBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'own'})}));
});
