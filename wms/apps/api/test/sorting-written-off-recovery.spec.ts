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
it('routes a written-off KIZ to administrative physical reconciliation without the old confirmation gate',async()=>{
  // TEST: the separate legacy restoration helper retains its own protections below.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED','true');
  const service:any=Object.create(PalletSortingService.prototype);
  service.stock={reconcileAdminSortingUnit:vi.fn().mockResolvedValue({skuId:'sku',movementId:'receipt',sourceBoxId:null,recovered:true,alreadyApplied:false})};
  service.audit=vi.fn(); service.assertUnclaimed=vi.fn(); service.assertMovementAllowed=vi.fn();
  const state:any={id:'session',clientId:'client',warehouseId:'wh',version:1,stage:'FORMING',sources:[],moves:[],pendingRoutes:[],
    activeTargetId:'target',targets:[{id:'target',code:'TARGET',quantity:0,closed:false}]};
  const tx:any={productMark:{findMany:vi.fn().mockResolvedValue([{id:'mark',status:'BLOCKED',boxId:null}])}};
  await service.move(tx,state,{barcode:'4600000000001',kiz},user);
  expect(service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(tx,expect.objectContaining({barcode:'4600000000001',kiz}),user);
  expect(state.targets[0].quantity).toBe(1);expect(state.moves[0]).toMatchObject({recovered:true});
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
