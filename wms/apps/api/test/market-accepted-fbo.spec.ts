import { expect, it, vi } from 'vitest';
vi.mock('../src/common/kiz-client-review', () => ({ assertClientRequestKizShipment: vi.fn() }));
vi.mock('../src/modules/tsd/fbo-completion-batch', () => ({
  validateFboPackedBoxes: vi.fn(), fboCompletionPackages: vi.fn(() => []), saveFboCompletionSelections: vi.fn(),
}));
import { completeMarketAcceptedFbo } from '../src/modules/stock/market-accepted-fbo';
function fixture() {
  const phase = { phase: 'CONTROL' };
  const updateMany = vi.fn();
  const tx: any = {
    ozonFboShipment: {findUnique:vi.fn(async()=>null)},
    fboAssembly: { findUnique: vi.fn(async () => phase), update: vi.fn(async () => { phase.phase = 'COMPLETED'; }) },
    fboAssemblyBox: { findMany: vi.fn(async () => [{boxId:'b'}]), updateMany },
    fboAssemblyUnit: { findMany: vi.fn(async () => [{state:'PACKED', requestItemId:'i', targetBoxId:'b'}]), updateMany },
    productMark: { updateMany }, clientRequest: { update: vi.fn() }, auditLog: {create:vi.fn()},
  };
  const request = {id:'r',status:'PACKED',items:[{id:'i',quantity:1}]};
  return {tx,request,pack:vi.fn()};
}
// TEST: stale CONTROL plus PACKED status must finish real packing once before shipping/billing.
it('completes accepted packing and skips repeated completion', async () => {
  const f=fixture();
  await completeMarketAcceptedFbo(f.tx,f.request,{},f.pack);
  await completeMarketAcceptedFbo(f.tx,f.request,{},f.pack);
  expect(f.pack).toHaveBeenCalledTimes(1);
  expect(f.tx.fboAssemblyUnit.findMany).toHaveBeenCalledWith({where:{requestId:'r',state:{not:'RETURNED'}}});
  expect(f.pack.mock.calls[0][0].idempotencyKey).toBe('fbo-pack:r');
  expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
});
it('rejects missing units before any status or billing change',async()=>{
 const f=fixture();f.request.items[0].quantity=2;
 await expect(completeMarketAcceptedFbo(f.tx,f.request,{},f.pack)).rejects.toThrow('состав');
 expect(f.tx.clientRequest.update).not.toHaveBeenCalled();expect(f.pack).not.toHaveBeenCalled();
});
it('does not finish the assembly when packing fails',async()=>{
 const f=fixture();f.pack.mockRejectedValue(new Error('billing failure'));
 await expect(completeMarketAcceptedFbo(f.tx,f.request,{},f.pack)).rejects.toThrow('billing failure');
 expect(f.tx.fboAssembly.update).not.toHaveBeenCalled();
});

it('rejects an Ozon destination mismatch before packing', async()=>{
 const f=fixture();
 f.tx.ozonFboShipment.findUnique.mockResolvedValue({directions:[{name:'Воронеж',items:[{skuId:'s',barcode:'1',quantity:1}]}]});
 await expect(completeMarketAcceptedFbo(f.tx,f.request,{},f.pack)).rejects.toThrow('направлениями');
 expect(f.pack).not.toHaveBeenCalled();
});
