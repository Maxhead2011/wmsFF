import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: emulate elapsed DB work beyond Prisma's default 5 seconds without a slow sleep.
function fixture(enabled = true, fbo = true) {
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', String(enabled));
 const order: string[] = [];
 let elapsed = 0;
 let limit = 5000;
 const tx = { $queryRaw: vi.fn(async () => { order.push('lock'); }), stockMovement: { create: vi.fn() } };
 const prisma = { fboAssembly: { findUnique: vi.fn(async () => fbo ? {phase:'COMPLETED'} : null) },
  $transaction: vi.fn(async (callback: any, options: any) => {limit=options?.timeout??5000;elapsed=0;return callback(tx);}) };
 const service = new StockOperationsService(prisma as never, {} as never, {} as never) as any;
 service.resolveWritableWarehouseId=vi.fn(()=> 'warehouse');
 service.loadOutboundRequest=vi.fn(async()=>{order.push('load');return {id:'request',clientId:'client',warehouseId:'warehouse',status:'DONE'};});
 service.assertRequestWarehouse=vi.fn();service.applyClosedFboTarget=vi.fn(async()=>false);
 service.ensureRequestFulfillmentBillingCharges=vi.fn(async()=>{elapsed+=12046;if(elapsed>limit)throw Error('Transaction already closed');});
 service.ensureRequestLogisticsBilling=vi.fn();service.ensureRequestExpenseConsumption=vi.fn();
 return {service,prisma,tx,order};
}
describe('FBO shipment transaction',()=>{
 it('allows billing work exceeding five seconds and locks before reading request',async()=>{
  const f=fixture();
  await expect(f.service.shipClientRequest({requestId:'request'}, {id:'owner'})).resolves.toMatchObject({status:'ALREADY_APPLIED'});
  expect(f.order).toEqual(['lock','load']);
  expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({maxWait:10000,timeout:180000});
 });
 it('repeated completed shipment never creates another stock movement',async()=>{
  const f=fixture();
  for(let i=0;i<2;i++)await expect(f.service.shipClientRequest({requestId:'request'}, {id:'owner'})).resolves.toMatchObject({status:'ALREADY_APPLIED'});
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
 });
 it.each([[false,true],[true,false]])('preserves default transaction when enabled=%s, fbo=%s',async(enabled,fbo)=>{
  const f=fixture(enabled,fbo);f.service.ensureRequestFulfillmentBillingCharges.mockResolvedValue(undefined);
  await f.service.shipClientRequest({requestId:'request'}, {id:'owner'});
  expect(f.prisma.$transaction.mock.calls[0][1]).toBeUndefined();expect(f.tx.$queryRaw).not.toHaveBeenCalled();
 });
 it('rejects an unconfirmed FBO before starting shipment',async()=>{
  const f=fixture();f.prisma.fboAssembly.findUnique.mockResolvedValue({phase:'PACKING'});
  await expect(f.service.shipClientRequest({requestId:'request'}, {id:'owner'})).rejects.toThrow();
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
 });
});
