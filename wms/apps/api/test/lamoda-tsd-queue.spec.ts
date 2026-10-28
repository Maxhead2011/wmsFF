import {afterEach,expect,it,vi} from 'vitest';
import {TsdAssemblyService} from '../src/modules/tsd/tsd-assembly.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: Lamoda is reachable through its own queue and absent from WB, before pagination.
it('separates Lamoda and WB and rejects a disabled Lamoda queue',async()=>{
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_LAMODA_ENABLED','true');vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','true');
 const findMany=vi.fn(async()=>[]),service=new TsdAssemblyService({clientRequest:{findMany}} as never,{resolveClientFilter:()=>undefined} as never,{} as never,{} as never,{} as never);
 await service.listActiveRequests({id:'worker'} as never,'fbo-pick','LAMODA');expect(findMany.mock.calls[0][0].where.lamodaAssembly).toEqual({isNot:null});
 await service.listActiveRequests({id:'worker'} as never,'fbo-pack','WB');expect(findMany.mock.calls[1][0].where.lamodaAssembly).toEqual({is:null});
 vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','false');await expect(service.listActiveRequests({id:'worker'} as never,'fbo-pick','LAMODA')).rejects.toThrow();
});
