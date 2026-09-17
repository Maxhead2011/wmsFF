import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';

// TEST: queue filtering happens in SQL, before the limit, preserving client/warehouse scope.
describe('separate FBO picking and packing queues', () => {
  afterEach(() => vi.unstubAllEnvs());
  function setup() {
    const findMany=vi.fn().mockResolvedValue([]);
    const service=new TsdAssemblyService({clientRequest:{findMany}} as never,
      {resolveClientFilter:()=>({in:['client-1']})} as never, {} as never, {} as never, {} as never);
    return {service,findMany};
  }
  it.each(['fbo-pick','fbo-pack'])('excludes FBS for %s regardless of Excel/manual origin',async workflow=>{
    vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');
    const {service,findMany}=setup();await service.listActiveRequests({id:'worker'} as never,workflow);
    const where=findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({clientId:{in:['client-1']},type:'OUTBOUND',fbsOrderLinks:{none:{}}});
    expect(where).not.toHaveProperty('source');
    if(workflow==='fbo-pack') expect(where.fboAssembly).toEqual({is:{phase:{in:['PACKING','CONTROL']}}});
    else expect(where.OR).toEqual([{fboAssembly:{is:null}},{fboAssembly:{is:{phase:'PICKING'}}}]);
  });
  it('preserves the legacy installation and refuses unsupported workflow',async()=>{
    vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','false');
    const {service,findMany}=setup();await service.listActiveRequests({id:'worker'} as never);
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('fbsOrderLinks');
    await expect(service.listActiveRequests({id:'worker'} as never,'fbo-pack')).rejects.toThrow();
    await expect(service.listActiveRequests({id:'worker'} as never,'garbage')).rejects.toThrow();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
