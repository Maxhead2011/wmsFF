import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: archived boxes retain SHIPPING stock, but cannot provide AVAILABLE stock.
function fixture(enabled = true, boxStatus = 'archived', quantity = 15) {
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', String(enabled));
  const service = new StockOperationsService({} as never, {} as never, {} as never) as any;
  service.resolveSku = vi.fn(async () => ({id:'sku',internalSku:'Suit L',weightGrams:null}));
  const findMany = vi.fn(async ({where}:any) => {
    if (where.box.status.notIn.includes(boxStatus) || quantity <= 0) return [];
    return [{id:'balance',skuId:'sku',boxId:'box',quantity,status:where.status.in[0],updatedAt:new Date(),box:{code:'204'}}];
  });
  const plan = (statuses:string[] = ['SHIPPING']) => service.planRequestAllocationsFromSelections(
    {stockBalance:{findMany}},'client',[{id:'item',skuId:'sku',quantity:15}],
    [{requestItemId:'item',skuId:'sku',boxId:'box',quantity:15,box:{code:'204'}}],statuses,'warehouse');
  return {plan,findMany};
}
describe('archived SHIPPING source', () => {
  it('allocates existing SHIPPING without stock restoration or box changes',async()=>{
    const f=fixture(); const result=await f.plan();
    expect(result.lines[0].allocations[0].quantity).toBe(15);
    expect(f.findMany.mock.calls[0][0].where).toMatchObject({clientId:'client',warehouseId:'warehouse',status:{in:['SHIPPING']},box:{warehouseId:'warehouse'}});
  });
  it.each([{statuses:['AVAILABLE']},{statuses:['PACKING']},{statuses:['SHIPPING','PACKING','AVAILABLE']}])('excludes archived sources for $statuses',async({statuses})=>{
    await expect(fixture().plan(statuses)).rejects.toThrow('недостаточно');
  });
  it('preserves sold installation',async()=>{await expect(fixture(false).plan()).rejects.toThrow('недостаточно');});
  it('still excludes deleted boxes',async()=>{await expect(fixture(true,'deleted').plan()).rejects.toThrow('недостаточно');});
  it('never invents missing shipping units',async()=>{await expect(fixture(true,'archived',14).plan()).rejects.toThrow('недостаточно');});
});
