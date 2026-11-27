import {afterEach,describe,expect,it,vi} from 'vitest';
import {assertSupplyMutable} from '../src/modules/client-requests/ozon-supply-policy';
const integration=()=>({frozenHash:'frozen',mapping:{North:'1'},packingPlan:{version:1,state:'ACTIVE',boxes:[{key:'box',boxCode:'FFL_ONE',supplyId:'1',direction:'North',cargoId:'123456'}]},operations:{'1':{state:'SUCCESS',cargoes:[{key:'box',cargoId:'123456'}]}}});
afterEach(()=>vi.unstubAllEnvs());
// TEST: an advance plan must not prevent remaining physical units from being picked.
describe('continued picking after advance Ozon upload',()=>{
 it.each(['START','PICK_UNIT','FINISH_PICK'])('allows %s only for confirmed plan',action=>{vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');expect(()=>assertSupplyMutable(integration(),action)).not.toThrow();});
 it.each(['PACK_UNIT','PACK_PRODUCT','PICK_BOX','PACK_BOX','OPEN_BOX','CLOSE_BOX','MANUAL_PACK_UNIT','UNDO_PICK_UNIT'])('keeps %s protected',action=>{vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');expect(()=>assertSupplyMutable(integration(),action)).toThrow();});
 it('does not unlock incomplete, changed, uncertain or legacy cargo plans',()=>{vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
  const cases:any[]=[{frozenHash:'old'}, {...integration(),packingPlan:{...integration().packingPlan,state:'SENDING'}}, {...integration(),operations:{'1':{state:'ACCEPTED'}}}, {...integration(),mapping:{North:'2'}}, {...integration(),adjustment:{state:'SENDING'}}];
  const changed=integration();changed.operations['1'].cargoes[0].cargoId='other';cases.push(changed);
  const duplicate=integration();duplicate.packingPlan.boxes.push(duplicate.packingPlan.boxes[0]);cases.push(duplicate);
  for(const value of cases)expect(()=>assertSupplyMutable(value,'PICK_UNIT')).toThrow();
 });
 it('preserves the disabled/sold contour',()=>{vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');expect(()=>assertSupplyMutable(integration(),'PICK_UNIT')).toThrow();});
});
