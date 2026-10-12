import {afterEach,it,expect,vi} from 'vitest';
import {isFboTwoStageRequest} from '../src/modules/tsd/fbo-two-stage-policy';
afterEach(()=>vi.unstubAllEnvs());
// TEST: this client is stored without boxes but must use Ozon destination packing.
it('enables unboxed Ozon only under the new deployment flag',async()=>{
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_FBO_UNBOXED_PICK_ENABLED','true');
 const row:any={type:'OUTBOUND',status:'SUBMITTED',client:{storesWithoutBoxes:true},ozonShipment:{requestId:'r'},_count:{fbsOrderLinks:0,packages:0}};
 const db:any={clientRequest:{findUnique:async()=>row},fboAssembly:{findUnique:async()=>null},stockMovement:{findFirst:async()=>null},tsdOperation:{findFirst:async()=>null}};
 expect(await isFboTwoStageRequest(db,'r')).toBe(true);
 vi.stubEnv('WMS_FBO_UNBOXED_PICK_ENABLED','false');expect(await isFboTwoStageRequest(db,'r')).toBe(false);
 vi.stubEnv('WMS_FBO_UNBOXED_PICK_ENABLED','true');row.ozonShipment=null;expect(await isFboTwoStageRequest(db,'r')).toBe(true);
});

