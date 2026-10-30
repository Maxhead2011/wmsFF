import {afterEach,describe,it,expect,vi} from 'vitest';
import {assertFboProcessChange,wbDispatchContexts} from './wb-fbo-dispatch';
afterEach(()=>vi.unstubAllEnvs());
describe('WB dispatch projection',()=>{
 // TEST: no database reads or behavior changes outside the enabled deployment.
 it('is inactive for sold/default installations',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','false');
  expect(await wbDispatchContexts({} as never,['r'])).toEqual({});await assertFboProcessChange({} as never,'r','DONE');
 });
 // TEST: loading does not authorize delivery, and the WB gate status does.
 it('blocks premature delivery and reversing loaded goods',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
  let statusId=3;const db={systemSetting:{findUnique:vi.fn(async({where}:{where:{key:string}})=>({value:where.key.includes('dispatch')?{at:'today'}:{statusId}}))}};
  await expect(assertFboProcessChange(db as never,'r','IN_WORK')).rejects.toThrow();
  await expect(assertFboProcessChange(db as never,'r','DONE')).rejects.toThrow();
  for(statusId of [4,5,6])await assertFboProcessChange(db as never,'r','DONE');
 });
});
