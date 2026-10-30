import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach,expect,it,vi } from 'vitest';
import { requireKnownFboKiz } from '../src/modules/tsd/fbo-known-kiz';
afterEach(()=>vi.unstubAllEnvs());
// TEST: exercise the actual published method, whose recovery path is absent from old TS source.
it.skipIf(!process.env.FBO_KNOWN_KIZ_RUNTIME)('runtime rejects an unknown scan before touching stock',async()=>{
  vi.stubEnv('WMS_INVENTORY_FOUND_UNIT_ENABLED','true');
  const source=readFileSync(process.env.FBO_KNOWN_KIZ_RUNTIME!,'utf8');
  const method=source.slice(source.indexOf('    async bindPickedMark('),source.indexOf('    async exactMark(',source.indexOf('    async bindPickedMark(')));
  expect(method).toContain('FBO-PICK:');
  const call=runInNewContext(`({${method}}).bindPickedMark`,{
    require:()=>({requireKnownFboKiz}),clientKizReview:{assertClientKizUse:async()=>{}},clientKizRegistry:{clientKizGuardEnabled:()=>false},
    kiz_physical_identity_1:{physicalKizIdentity:()=> 'physical'},identity:()=> 'physical',client_1:{Prisma:{sql:()=>null}},
    common_1:{ConflictException:Error,BadRequestException:Error},
  });
  const write=vi.fn();const tx:any={$executeRaw:async()=>{},productMark:{findMany:async()=>[],create:write},stockBalance:{updateMany:write}};
  await expect(call(tx,{id:'2371',clientId:'client',warehouseId:'wh'},'sku','box','scan','key',{})).rejects.toThrow('не зарегистрирован');
  expect(write).not.toHaveBeenCalled();
});
