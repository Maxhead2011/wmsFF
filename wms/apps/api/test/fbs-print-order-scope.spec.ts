import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: September history must not block a newly picked order with the same KIZ.
function fixture(enabled = true, printedAssembly = 'old', printedOrder = '5646583244') {
  vi.stubEnv('WMS_FBS_PRINT_ATTEMPT_SCOPE_ENABLED', String(enabled));
  const task = {id:'current',clientId:'client',connectionId:'cabinet',orderId:'5862422382',kiz:'0104680992598745215vBpIst-cXXK5',status:'COMPLETED'};
  const history = {assemblyId:printedAssembly,orderId:printedOrder,clientId:'client',kiz:task.kiz,printedAt:new Date('2026-09-02T10:33:38Z'),printedBy:'Operator'};
  const db:any = {fbsTsdAssembly:{findMany:vi.fn(async()=>[task])},fbsWebKizStickerPrint:{findFirst:vi.fn(async({where}:any)=>
    where.OR ? history : where.assemblyId===history.assemblyId && where.orderId===history.orderId && where.clientId===history.clientId ? history : null)}};
  const service:any = new MarketplaceConnectionsService(db,{resolveClientFilter:()=> 'client'} as never);
  service.loadFbsTsdOrderSticker=vi.fn(async()=>{throw Error('sticker boundary');});
  return {db,service,task,run:()=>service.scanWebOrderAssembly(task.kiz,{clientIds:[]})};
}
it('permits a new order after historical printing of the same KIZ',async()=>{
  const f=fixture();await expect(f.run()).rejects.toThrow('sticker boundary');
  expect(f.service.loadFbsTsdOrderSticker).toHaveBeenCalledWith(f.task);
});
it('blocks an already printed current attempt',async()=>{
  const f=fixture(true,'current','5862422382');await expect(f.run()).rejects.toThrow('Повторная печать запрещена');
  expect(f.service.loadFbsTsdOrderSticker).not.toHaveBeenCalled();
});
it('allows a deliberately separate attempt of the same order',async()=>{
  await expect(fixture(true,'old','5862422382').run()).rejects.toThrow('sticker boundary');
});
it('preserves legacy protection when the new flag is disabled',async()=>{
  await expect(fixture(false).run()).rejects.toThrow('Повторная печать запрещена');
});
