import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manualOrderIds, requireManualAssembly, untouchedManualTask, validateManualChoices, type ManualRow } from '../src/modules/marketplace-connections/fbs-manual-assembly';
import type { AuthUser } from '../src/modules/auth/auth.types';

const owner = { id:'owner', roleCodes:['OWNER'], isDemo:false } as AuthUser;
const row = (id:string, free=2):ManualRow => ({ orderId:id,skuId:'sku',article:'Зима',size:'M / 46',supplyId:'WB-1',
  supplierStatus:'confirm',wbStatus:'waiting',blockers:[],free,boxes:[{boxId:'box',boxCode:'BOX',palletCode:'PALLET',free}] });
// TEST: closed-by-default tenant gate, untouched orders, and shared stock capacity.
describe('manual FBS assembly invariants',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  it('is disabled in sold/default WMS, including for owners',()=>{
    vi.stubEnv('WMS_FBS_MANUAL_ASSEMBLY_ENABLED','');expect(()=>requireManualAssembly(owner)).toThrow();
    vi.stubEnv('WMS_FBS_MANUAL_ASSEMBLY_ENABLED','true');expect(()=>requireManualAssembly(owner)).not.toThrow();
    for(const role of ['MANAGER','CLIENT','WORKER'])expect(()=>requireManualAssembly({...owner,roleCodes:[role]})).toThrow();
    expect(()=>requireManualAssembly({...owner,isDemo:true})).toThrow();
  });
  it('rejects duplicate, unsafe numeric, empty and over-limit input',()=>{
    for(const ids of [[],['1','1'],['9007199254740992'],['1e5'],['01'],Array.from({length:101},(_,i)=>String(i+1))])expect(()=>manualOrderIds(ids)).toThrow();
    expect(manualOrderIds(['5996851459','5996192771'])).toEqual(['5996192771','5996851459']);
  });
  it('does not reassign picked, completed, relabelled, or already linked tasks',()=>{
    const task={requestId:'AUTO:WB:1',status:'WAITING_STOCK',itemCount:1};expect(untouchedManualTask(task)).toBe(true);
    for(const delta of [{requestId:'real'},{status:'COMPLETED'},{status:'IN_PROGRESS'},{kiz:'mark'},{sourceBarcode:'barcode'},
      {boxId:'box'},{startedAt:new Date()},{workerUserId:'worker'},{scannedItemCount:1},{sourceSkuId:'other'},{itemCount:2}])
      expect(untouchedManualTask({...task,...delta})).toBe(false);
  });
  it('allocates two units to two orders, never the same last unit twice',()=>{
    const choices=[{orderId:'1',boxId:'box'},{orderId:'2',boxId:'box'}];
    expect(()=>validateManualChoices([row('1'),row('2')],choices)).not.toThrow();
    expect(()=>validateManualChoices([row('1',1),row('2',1)],choices)).toThrow('не хватает');
  });
  it('rejects unknown boxes, forged orders, duplicates and incomplete choices',()=>{
    for(const choices of [[{orderId:'1',boxId:'foreign'}],[{orderId:'2',boxId:'box'}],[],[{orderId:'1',boxId:'box'},{orderId:'1',boxId:'box'}]])
      expect(()=>validateManualChoices([row('1')],choices)).toThrow();
    expect(()=>validateManualChoices([{...row('1'),blockers:['ФБО']}],[{orderId:'1',boxId:'box'}])).toThrow();
  });
});
