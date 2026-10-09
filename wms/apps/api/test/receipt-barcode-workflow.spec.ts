import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptBarcodeReviewService } from '../src/modules/tsd/receipt-barcode-review.service';
import { TsdReviewService } from '../src/modules/tsd/tsd-review.service';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';
const user = {id:'admin',name:'Admin',email:'a',roleCodes:['ADMIN'],permissionCodes:['stock:write'],activeWarehouseId:'w',writableWarehouseIds:['w']} as any;
function fixture() {
  const payload = {clientId:'c',warehouseId:'w',barcode:'18',firstBarcodeScan:'18',secondBarcodeScan:'18',boxCode:'FFL_TEST',quantity:'1',sourceDocument:'receipt',barcodeReview:'PENDING'};
  let op:any = {id:'issue',operationKey:'scan',deviceId:'tsd',operationType:'receipt_scan',status:'NEEDS_REVIEW',payload,createdAt:new Date('2026-10-01')};
  const scopes={requireClientAccess:vi.fn(),resolveClientFilter:vi.fn().mockReturnValue({in:['c']})};
  const tx:any={
    $queryRaw:vi.fn(),
    barcode:{findFirst:vi.fn().mockResolvedValue(null)},
    client:{findMany:vi.fn().mockResolvedValue([{id:'c',name:'Client',code:'CL'}])},
    box:{updateMany:vi.fn(),findUnique:vi.fn().mockResolvedValue({id:'box',clientId:'c',warehouseId:'w',status:'receiving'})},
    tsdOperation:{findUnique:vi.fn(async()=>op),findFirst:vi.fn().mockResolvedValue(null),count:vi.fn().mockResolvedValue(1),findMany:vi.fn(async()=>[op]),
      update:vi.fn(async({data})=>{op={...op,...data};return op;}),upsert:vi.fn(async({create})=>({...create,id:'issue'}))},
    auditLog:{create:vi.fn()},
  };
  let lock=Promise.resolve();
  tx.$transaction=vi.fn((fn:any)=>{const result=lock.then(async()=>{const before={...op};try{return await fn(tx);}catch(e){op=before;throw e;}});lock=result.catch(()=>{});return result;});
  const stock={receiveIntoBox:vi.fn().mockResolvedValue({status:'APPLIED'})};
  const service=new ReceiptBarcodeReviewService(tx,scopes as any,stock as any,new TsdPayloadParser());
  return {tx,service,stock,scopes,op,payload};
}
beforeEach(()=>vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true'));
afterEach(()=>vi.unstubAllEnvs());
describe('suspicious barcode workflow',()=>{
  // TEST: reproduce the silent draft creation entry point without creating either a SKU or stock.
  it('holds old APK scans without rescan evidence',async()=>{
    const f=fixture();const {secondBarcodeScan,...payload}=f.payload;
    expect(await f.service.capture({operationKey:'scan',operationType:'receipt_scan',deviceId:'tsd',payload},user)).toMatchObject({status:'NEEDS_REVIEW'});
    expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();
    expect(f.tx.tsdOperation.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{},create:expect.objectContaining({payload:expect.objectContaining({secondBarcodeScan:'',actorUserId:'admin'})})}));
  });
  it('known approved short barcode keeps ordinary receipt',async()=>{
    const f=fixture();f.tx.barcode.findFirst.mockResolvedValue({id:'known'});
    expect(await f.service.capture({operationKey:'scan',operationType:'receipt_scan',deviceId:'tsd',payload:f.payload},user)).toBeNull();
  });
  it('sold installation stays unchanged',async()=>{
    vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','false');const f=fixture();
    expect(await f.service.capture({operationKey:'scan',operationType:'receipt_scan',deviceId:'tsd',payload:f.payload},user)).toBeNull();
    expect(f.tx.barcode.findFirst).not.toHaveBeenCalled();
  });
  it('confirmation and audit share the receipt transaction',async()=>{
    const f=fixture();await f.service.resolve('issue',{action:'CONFIRM',comment:'Этикетка проверена'},user);
    expect(f.stock.receiveIntoBox).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:'scan',barcode:'18',quantity:1}),user,f.tx,'RECEIPT');
    expect(f.tx.auditLog.create).toHaveBeenCalled();
    expect(f.op.payload.barcode).toBe('18');
  });
  it('only one of two concurrent decisions receives goods',async()=>{
    const f=fixture();const decisions=await Promise.allSettled([f.service.resolve('issue',{action:'CONFIRM',comment:'yes'},user),f.service.resolve('issue',{action:'REJECT',comment:'no'},user)]);
    expect(decisions.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.stock.receiveIntoBox).toHaveBeenCalledTimes(1);
  });
  it('correction resolves an existing client SKU and keeps original evidence',async()=>{
    const f=fixture();f.tx.barcode.findFirst.mockResolvedValue({skuId:'correct'});
    await f.service.resolve('issue',{action:'CORRECT',barcode:'4006381333931',comment:'label'},user);
    expect(f.stock.receiveIntoBox).toHaveBeenCalledWith(expect.objectContaining({barcode:'4006381333931',skuId:'correct'}),user,f.tx,'RECEIPT');
    expect(f.payload.barcode).toBe('18');
  });
  it('rejects unknown corrected SKU and never mutates inventory',async()=>{
    const f=fixture();await expect(f.service.resolve('issue',{action:'CORRECT',barcode:'other',comment:'label'},user)).rejects.toThrow('карточке');
    expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();expect(f.tx.tsdOperation.update).not.toHaveBeenCalled();
  });
  it('reject decision does not receive anything',async()=>{
    const f=fixture();await f.service.resolve('issue',{action:'REJECT',comment:'Неверный скан'},user);expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();
  });
  it.each([{roleCodes:['WORKER']},{isDemo:true},{activeWarehouseId:'other'}])('denies %j before stock write',async override=>{
    const f=fixture();await expect(f.service.resolve('issue',{action:'CONFIRM',comment:'label'},{...user,...override})).rejects.toThrow();expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();
  });
  it('blocks later reuse of a box',async()=>{
    const f=fixture();f.tx.tsdOperation.findFirst.mockResolvedValue({id:'reuse'});
    await expect(f.service.resolve('issue',{action:'CONFIRM',comment:'label'},user)).rejects.toThrow('переиспользован');expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();
  });
  it('list scopes records to client and current warehouse',async()=>{
    const f=fixture();await f.service.list(user);expect(f.tx.tsdOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({AND:expect.arrayContaining([{payload:{path:['warehouseId'],equals:'w'}}])}),take:200}));
  });
  // TEST: a forged/stale SKU id cannot override the reviewed physical label.
  it('ignores a cached SKU id on confirmation', async()=>{
    const f=fixture();(f.payload as any).skuId='wrong-product';
    await f.service.resolve('issue',{action:'CONFIRM',comment:'checked'},user);
    expect(f.stock.receiveIntoBox.mock.calls[0][0].skuId).toBeUndefined();
  });
  it('denies a read-only warehouse',async()=>{
    const f=fixture();await expect(f.service.list({...user,writableWarehouseIds:[]})).rejects.toThrow('филиала');
    expect(f.tx.tsdOperation.findMany).not.toHaveBeenCalled();
  });
  it('lists pending issues ahead of recent rejected history',async()=>{
    const f=fixture();await f.service.list(user);
    expect(f.tx.tsdOperation.findMany.mock.calls[0][0].where.status).toBe('NEEDS_REVIEW');
    expect(f.tx.tsdOperation.findMany.mock.calls[1][0].where.status).toEqual({not:'NEEDS_REVIEW'});
  });
  it('summary does not load receipt payloads',async()=>{
    const f=fixture();expect(await f.service.summary(user)).toEqual({pending:1});expect(f.tx.tsdOperation.findMany).not.toHaveBeenCalled();
  });
  it('rolls back the decision on stock write failure',async()=>{
    const f=fixture();f.stock.receiveIntoBox.mockRejectedValue(new Error('stock failed'));
    await expect(f.service.resolve('issue',{action:'CONFIRM',comment:'label'},user)).rejects.toThrow('stock failed');
    expect(f.tx.tsdOperation.update).not.toHaveBeenCalled();expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: the old generic receipt action must not bypass the new privileged review.
  it.each(['ACCEPT_RECEIPT_WITH_ERROR','REJECT'])('blocks generic %s',async action=>{
    const f=fixture();const old=new TsdReviewService(f.tx,f.scopes as any,f.stock as any,new TsdPayloadParser());
    await expect(old.resolveReviewOperation('issue',{action} as any,user)).rejects.toThrow('Проблемы приёмки');
    expect(f.stock.receiveIntoBox).not.toHaveBeenCalled();expect(f.tx.tsdOperation.update).not.toHaveBeenCalled();
  });

});
