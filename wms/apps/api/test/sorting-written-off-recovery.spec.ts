import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

const user: any = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
const kiz = '010460000000000121ABCDEFGHIJKLM';
if(process.env.SORTING_WRITEOFF_COVERAGE==='true'){
  const profiler=new Session();
  const post=(method:string,params={})=>new Promise<any>((resolve,reject)=>profiler.post(method as any,params,(e,r)=>e?reject(e):resolve(r)));
  beforeAll(async()=>{profiler.connect();await post('Profiler.enable');await post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});});
  afterAll(async()=>{try{
    const report=await post('Profiler.takePreciseCoverage');
    const scripts=report.result.filter((s:any)=>s.url.includes('/sorting-written-off-recovery.ts')&&!s.url.includes('/test/'));
    expect(scripts).toHaveLength(1);
    const fn=scripts[0].functions.find((f:any)=>f.functionName==='restoreWrittenOffSortingUnit');
    expect(fn).toBeDefined();const covered=fn.ranges.filter((r:any)=>r.count>0).length;
    console.log(JSON.stringify({function:fn.functionName,covered,blocks:fn.ranges.length,percent:covered/fn.ranges.length*100}));
    expect(covered/fn.ranges.length).toBeGreaterThanOrEqual(0.8);
  }finally{await post('Profiler.stopPreciseCoverage');profiler.disconnect();}});
}
it('routes a written-off KIZ to the administrator confirmation instead of the misleading source-box refusal',async()=>{
  // TEST: actual pre-existing move path, not a missing new method.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED','true');
  const service:any=Object.create(PalletSortingService.prototype);
  service.stock={restoreWrittenOffSortingUnit:vi.fn().mockResolvedValue({skuId:'sku',movementId:'receipt'})};
  service.audit=vi.fn();
  const state:any={id:'session',clientId:'client',warehouseId:'wh',version:1,stage:'FORMING',sources:[],moves:[],pendingRoutes:[],
    activeTargetId:'target',targets:[{id:'target',code:'TARGET',quantity:0,closed:false}]};
  const tx:any={productMark:{findMany:vi.fn().mockResolvedValue([{id:'mark',status:'BLOCKED',boxId:null}])}};
  await service.move(tx,state,{barcode:'4600000000001',kiz,confirmRestore:true,restoreFingerprint:'proof'},user);
  expect(state.targets[0].quantity).toBe(1);expect(state.moves[0]).toMatchObject({recovered:true,recoveryReason:'WRITTEN_OFF_KIZ'});
});
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(StockOperationsService.prototype);
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.incrementTargetBalance = vi.fn();
  const mark = { id: 'mark', clientId: 'client', skuId: 'sku', boxId: null, value: kiz, status: 'BLOCKED',
    sourceDocument: 'admin-unpalleted-writeoff', updatedAt: new Date('2026-08-27T17:17:56.948Z') };
  const writeoff = { id: 'writeoff', clientId: 'client', warehouseId: 'wh', skuId: 'sku', boxId: 'old', quantity: -5,
    type: 'INVENTORY_ADJUSTMENT', sourceDocument: mark.sourceDocument, createdAt: new Date('2026-08-27T17:17:56.945Z') };
  const target = { id: 'target', code: 'TARGET', status: 'active', clientId: 'client', warehouseId: 'wh', palletId: null };
  const tx: any = { $executeRaw: vi.fn(), productMark: { findMany: vi.fn(async()=>[mark]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    box: { findUnique: vi.fn(async()=>target) }, barcode: { findMany: vi.fn().mockResolvedValue([{ sku: { id: 'sku' } }]) },
    stockMovement: { findMany: vi.fn(async()=>[writeoff]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'receipt' }) },
    stockBalance: { findFirst: vi.fn().mockResolvedValue(null) }, auditLog: { create: vi.fn() },
    ...Object.fromEntries(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsAssemblyAttemptHistory','fbsPrintJob','kizCirculationItem'].map(k=>[k,{ findFirst: vi.fn().mockResolvedValue(null) }])) };
  const input: any = { clientId: 'client', toBoxCode: 'TARGET', barcode: '4600000000001', kiz, sessionId: 'session', version: 7, idempotencyKey: 'recovery' };
  return { service, tx, input, mark, writeoff, target };
}
async function preview(f: ReturnType<typeof fixture>) {
  try { await f.service.restoreWrittenOffSortingUnit(f.tx, f.input, user); throw Error('Expected confirmation'); }
  catch(e: any) { const body=e.getResponse(); expect(body.code).toBe('SORTING_WRITEOFF_CONFIRM_REQUIRED'); return body.fingerprint; }
}
function orphanFixture() {
  const f=fixture();
  f.mark.sourceDocument='repair:inventory-after-movement:20260827';
  Object.assign(f.mark,{stockMovementId:'writeoff'});
  f.tx.stockMovement.findUnique.mockImplementation(async({where}:any)=>where.id==='writeoff'?f.writeoff:null);
  f.tx.box.findUnique.mockImplementation(async({where}:any)=>where.id==='old'?{id:'old',code:'OLD',status:'active',clientId:'client',warehouseId:'wh'}:f.target);
  f.tx.stockBalance.findMany=vi.fn().mockResolvedValue([]);
  f.tx.stockBalance.updateMany=vi.fn().mockResolvedValue({count:1});
  f.tx.productMark.findMany.mockImplementation(async({where}:any)=>where.boxId?[]:[f.mark]);
  return f;
}
it.each([0,1])('uses linked ledger evidence for an orphan BLOCKED KIZ with %s available source units',async quantity=>{
  // TEST: FFL_LKB1807_240 / 2051754300715: do not require one hard-coded repair document name.
  const f=orphanFixture();
  if(quantity) f.tx.stockBalance.findMany.mockResolvedValue([{id:'balance',quantity,status:'AVAILABLE',clientId:'client',warehouseId:'wh',skuId:'sku',boxId:'old',palletId:null,updatedAt:new Date()}]);
  f.input.restoreFingerprint=await preview(f);
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.tx.stockMovement.create).toHaveBeenCalledTimes(quantity?2:1);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledWith(f.tx,expect.objectContaining({boxId:'target',quantity:1}));
  if(quantity) expect(f.tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({boxId:'old',quantity:-1,type:'MOVE'})}));
});
it.each(['foreign-ledger','foreign-source','stale-balance','shipment','sku'])('rejects unsafe orphan correction: %s',async kind=>{
  // TEST: administrative confirmation cannot change identity ownership or use stale quantities.
  const f=orphanFixture(); f.input.restoreFingerprint=await preview(f); f.input.confirmRestore=true;
  if(kind==='foreign-ledger')f.writeoff.warehouseId='other';
  if(kind==='foreign-source') f.tx.box.findUnique.mockImplementation(async({where}:any)=>where.id?{id:'old',clientId:'other',warehouseId:'wh'}:f.target);
  if(kind==='stale-balance') f.tx.stockBalance.findMany.mockResolvedValue([{id:'balance',quantity:1,status:'AVAILABLE',updatedAt:new Date()}]);
  if(kind==='shipment')f.tx.shippedKizHistory.findFirst.mockResolvedValue({id:'shipped'});
  if(kind==='sku')f.mark.skuId='other';
  await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('lets the administrator confirm an orphan from a physical snapshot retaining its original receipt',async()=>{
  // TEST: another real repair variant has a RECEIPT FK, not a negative adjustment FK.
  const f=orphanFixture(); f.mark.sourceDocument='admin-unpalleted-physical-snapshot-20260827';
  f.writeoff.type='RECEIPT';f.writeoff.quantity=1;
  f.input.restoreFingerprint=await preview(f); f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
  expect(f.tx.auditLog.create.mock.calls[0][0].data.payload).toMatchObject({previousSourceDocument:f.mark.sourceDocument,discrepancy:'ORPHAN_KIZ_PHYSICAL_CONFIRMATION'});
});
function availableFixture() {
  const f=fixture(); f.mark.status='AVAILABLE'; f.mark.boxId='old' as any;
  f.mark.sourceDocument='TSD-RECEIPT'; f.writeoff.type='SHIP'; f.writeoff.quantity=-1;
  f.writeoff.sourceDocument='done-request'; f.writeoff.createdAt=new Date('2026-08-31T09:02:26Z');
  f.tx.box.findUnique.mockImplementation(async ({where}:any)=>where.id==='old'?{id:'old',clientId:'client',warehouseId:'wh',code:'OLD'}:f.target);
  f.tx.clientRequest={findFirst:vi.fn().mockResolvedValue({id:'done-request'})};
  f.tx.fbsTsdAssembly.findMany=vi.fn().mockResolvedValue([{id:'other-assembly',status:'COMPLETED',completedAt:new Date(),kiz:'010460000000000121OTHER00000001',boxCode:'DIFFERENT'}]);
  return f;
}
it('confirms AVAILABLE KIZ with zero balance after closing a request that collected another KIZ from another box',async()=>{
  // TEST: incident 397 / box 260: mark remained AVAILABLE after quantity was shipped.
  const f=availableFixture(); f.input.restoreFingerprint=await preview(f);
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled(); f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:'AVAILABLE',boxId:'old'})}));
  expect(f.service.incrementTargetBalance).toHaveBeenCalledWith(f.tx,expect.objectContaining({quantity:1,boxId:'target'}));
});
it.each(['reserve','missing-box','foreign-box','own-kiz','newer-credit'])('refuses unsafe AVAILABLE recovery: %s',async kind=>{
  // TEST: no blind +1 when request evidence or physical source identity is ambiguous.
  const f=availableFixture();
  if(kind==='reserve')f.tx.stockBalance.findFirst.mockResolvedValue({quantity:1});
  if(kind==='missing-box')f.tx.box.findUnique.mockImplementation(async({where}:any)=>where.id?null:f.target);
  if(kind==='foreign-box')f.tx.box.findUnique.mockImplementation(async({where}:any)=>where.id?{id:'old',clientId:'other',warehouseId:'wh'}:f.target);
  if(kind==='no-request')f.tx.clientRequest.findFirst.mockResolvedValue(null);
  const row={id:'assembly',status:'COMPLETED',completedAt:new Date(),kiz:'010460000000000121OTHER00000001',boxCode:'DIFFERENT'};
  if(kind==='own-kiz')row.kiz=kiz;
  if(kind==='same-box')row.boxCode='OLD';
  if(kind==='no-kiz')row.kiz='';
  if(kind==='not-completed')row.status='PICKING';
  if(['own-kiz','same-box','no-kiz','not-completed'].includes(kind))f.tx.fbsTsdAssembly.findMany.mockResolvedValue([row]);
  if(kind==='ambiguous')f.tx.fbsTsdAssembly.findMany.mockResolvedValue([row,row]);
  if(kind==='newer-credit')f.writeoff.quantity=1;
  await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each(['no-request','same-box','no-kiz','ambiguous','not-completed'])('offers audited physical confirmation despite unrelated request evidence: %s',async kind=>{
  // TEST: request-level accounting cannot prove this physically scanned identity was shipped.
  const f=availableFixture();
  if(kind==='no-request')f.tx.clientRequest.findFirst.mockResolvedValue(null);
  const row={id:'other',status:'COMPLETED',completedAt:new Date(),kiz:'010460000000000121OTHER00000001',boxCode:'OLD'};
  if(kind==='no-kiz')row.kiz='';
  if(kind==='not-completed')row.status='IN_PROGRESS';
  f.tx.fbsTsdAssembly.findMany.mockResolvedValue(kind==='ambiguous'?[row,row]:[row]);
  f.input.restoreFingerprint=await preview(f);
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
});
it('offers confirmation without writing and restores the same previously written-off KIZ once confirmed', async()=>{
  // TEST: reproduces BLOCKED/no box after a -5 adjustment; only the physically found unit returns.
  const f=fixture(); f.input.restoreFingerprint=await preview(f);
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled(); expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
  f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledWith(f.tx,expect.objectContaining({ quantity: 1, boxId: 'target' }));
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'mark', status: 'BLOCKED' }), data: expect.objectContaining({ status: 'AVAILABLE', boxId: 'target' }) }));
  expect(f.tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({ quantity: 1, type: 'INVENTORY_ADJUSTMENT' });
});
it.each(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsAssemblyAttemptHistory','fbsPrintJob','kizCirculationItem'])('never restores over %s evidence',async delegate=>{
  // TEST: possession does not erase shipment, order or print history.
  const f=fixture();f.tx[delegate].findFirst.mockResolvedValue({ id:'evidence' });
  await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user)).rejects.toThrow('заказ');
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each(['client','warehouse','sku','status','duplicate','positive','writeoff','stale','consent','source'])('fails closed for %s without changing stock',async kind=>{
  // TEST: no broad unblock, foreign-client transfer, duplicate identity or stale consent.
  const f=fixture();f.input.restoreFingerprint=await preview(f);f.input.confirmRestore=true;
  if(kind==='client')f.mark.clientId='other';
  if(kind==='warehouse')f.target.warehouseId='other';
  if(kind==='sku')f.mark.skuId='other';
  if(kind==='status')f.mark.status='SHIPPING';
  if(kind==='duplicate')f.tx.productMark.findMany.mockResolvedValue([f.mark,{...f.mark,id:'duplicate'}]);
  if(kind==='positive')f.tx.stockBalance.findFirst.mockResolvedValue({quantity:1});
  if(kind==='writeoff')f.tx.stockMovement.findMany.mockResolvedValue([]);
  if(kind==='stale')f.mark.updatedAt=new Date('2026-08-27T17:17:56.999Z');
  if(kind==='consent')f.input.confirmRestore=false;
  if(kind==='source')f.mark.sourceDocument='quality-hold';
  await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('rejects a non-administrator before any database lookup',async()=>{
  // TEST: admin-only, even if a client forges a confirmation request.
  const f=fixture();await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,{...user,roleCodes:['CLIENT']})).rejects.toThrow();
  expect(f.tx.productMark.findMany).not.toHaveBeenCalled();
});
it('restores a written-off mark retaining its historical box without reactivating that box',async()=>{
  // TEST: normal sorting shortages preserve the old boxId; only the new target receives stock.
  const f=fixture();f.mark.boxId='old' as any;f.input.restoreFingerprint=await preview(f);f.input.confirmRestore=true;
  await f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
});
it.each(['missing-target','ambiguous-sku','missing-source','replay','parallel-change'])('rejects %s safely',async kind=>{
  // TEST: late changes are re-read in the confirming transaction, not trusted from the dialog.
  const f=fixture();f.input.restoreFingerprint=await preview(f);f.input.confirmRestore=true;
  if(kind==='missing-target')f.tx.box.findUnique.mockResolvedValue(null);
  if(kind==='ambiguous-sku')f.tx.barcode.findMany.mockResolvedValue([]);
  if(kind==='missing-source')f.writeoff.boxId=null as any;
  if(kind==='replay')f.tx.stockMovement.findUnique.mockResolvedValue({id:'old-op'});
  if(kind==='parallel-change')f.tx.productMark.updateMany.mockResolvedValue({count:0});
  await expect(f.service.restoreWrittenOffSortingUnit(f.tx,f.input,user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
