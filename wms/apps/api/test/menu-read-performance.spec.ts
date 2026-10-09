import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
import { PickInstructionService } from '../src/modules/stock/pick-instruction.service';

afterEach(() => vi.unstubAllEnvs());
describe('menu reads: isolated performance paths', () => {
  // TEST: web FBO must not build a second, discarded picking instruction.
  it('opens web FBO directly when enabled', async () => {
    vi.stubEnv('WMS_MENU_READS_ENABLED', 'true');
    vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', 'true');
    const fbo = { eligible: vi.fn().mockResolvedValue(true), plan: vi.fn().mockResolvedValue({ requestId:'r', title:'FBO' }) };
    const service = new TsdAssemblyService({} as never, {} as never, {} as never, {} as never, {} as never, fbo as never);
    vi.spyOn(service as any, 'requirePlanRead').mockResolvedValue({});
    const legacy = vi.spyOn(service, 'getRequestPlan').mockResolvedValue({} as never);
    expect(await service.getDeviceRequestPlan('r', {} as never)).toMatchObject({assemblyMode:'FBO_TWO_STAGE'});
    expect(legacy).not.toHaveBeenCalled();
  });
  it('keeps sold WMS and FBS on their existing path', async () => {
    vi.stubEnv('WMS_MENU_READS_ENABLED', 'false');
    const service = new TsdAssemblyService({} as never, {} as never, {} as never, {} as never);
    vi.spyOn(service, 'getRequestPlan').mockResolvedValue({ id:'legacy' } as never);
    expect(await service.getDeviceRequestPlan('r', {} as never)).toEqual({id:'legacy'});
  });
  // TEST: the faster browser path cannot bypass a pending client balance review.
  it('still blocks FBO while the wave awaits client review',async()=>{
    vi.stubEnv('WMS_MENU_READS_ENABLED','true');vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');
    const fbo={eligible:vi.fn().mockResolvedValue(true),plan:vi.fn()};
    const db={clientRequest:{findUnique:vi.fn().mockResolvedValue({id:'r',clientId:'c',warehouseId:'w',pickWaveRequests:[{wave:{waveNumber:1,balanceReviewStatus:'PENDING'}}]})}};
    const service=new TsdAssemblyService(db as never,{requireClientAccess:vi.fn()} as never,{} as never,{} as never,{} as never,fbo as never);
    await expect(service.getDeviceRequestPlan('r',{roleCodes:['OWNER'],activeWarehouseId:'w'} as never)).rejects.toThrow('ожидает проверки балансов');
    expect(fbo.plan).not.toHaveBeenCalled();
  });
  it('keeps FBS response when the optimization is enabled',async()=>{
    vi.stubEnv('WMS_MENU_READS_ENABLED','true');vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');
    const fbo={eligible:vi.fn().mockResolvedValue(false),plan:vi.fn()};
    const service=new TsdAssemblyService({} as never,{} as never,{} as never,{} as never,{} as never,fbo as never);
    vi.spyOn(service,'getRequestPlan').mockResolvedValue({id:'fbs',fbsAssembly:{completed:5}} as never);
    expect(await service.getDeviceRequestPlan('r',{} as never)).toEqual({id:'fbs',fbsAssembly:{completed:5}});
    expect(fbo.plan).not.toHaveBeenCalled();
  });
  // TEST: large marketplace media payload is not part of the picking balance algorithm.
  it('does not transfer marketplace payload for every available balance', async () => {
    vi.stubEnv('WMS_MENU_READS_ENABLED', 'true');
    vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED', 'false');
    const findMany=vi.fn().mockResolvedValue([]);
    const service=new PickInstructionService({stockBalance:{findMany}} as never, {} as never);
    await (service as any).loadAvailableBalances('c','w',[{skuId:'s'}],true);
    expect(findMany.mock.calls[0][0].include.sku.omit).toEqual({marketplacePayload:true});
    expect(findMany.mock.calls[0][0].where.skuId).toBeUndefined();
  });
});
