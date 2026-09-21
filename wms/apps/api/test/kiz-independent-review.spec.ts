import {afterEach,expect,it,vi} from 'vitest';
import {KizReviewQueue,unitReviewContext} from '../src/common/kiz-review-queue';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import {kizReuseMessage} from '../src/common/kiz-wb-reuse';
afterEach(()=>vi.unstubAllEnvs());
// TEST: independent permissions are tied to the physical unit, not a picker/request.
it('invalidates permission when the physical unit changes',()=>{
 const m={id:'m',clientId:'c',skuId:'s',boxId:'b',status:'AVAILABLE',updatedAt:new Date(0)};
 for(const delta of [{skuId:'other'},{boxId:'other'},{status:'SHIPPING'},{updatedAt:new Date(1)}])
  expect(unitReviewContext(m)).not.toBe(unitReviewContext({...m,...delta}));
 expect(kizReuseMessage('RELABEL')).toContain('КИЗ НЕОБХОДИМО ЗАМЕНИТЬ');
});
it('denies a standalone decision to pickers before database access',async()=>{
 vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');vi.stubEnv('WMS_KIZ_REUSE_EVIDENCE_ENABLED','true');
 const db:any={productMark:{findFirst:vi.fn()}};
 await expect(new KizReviewQueue(db,new ClientScopeService()).decide('unit:m','REUSE','Проверено',true,
  {roleCodes:['PICKER'],permissionCodes:[],activeWarehouseId:'w'} as any)).rejects.toThrow();
 expect(db.productMark.findFirst).not.toHaveBeenCalled();
});
