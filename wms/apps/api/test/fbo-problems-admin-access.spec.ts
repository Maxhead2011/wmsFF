import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoveryWarehouse } from '../src/modules/administration/fbo-problems-warehouse';
const actor = () => ({ status:'ACTIVE', isDemo:false, activeWarehouseId:'moscow', roles:[{role:{code:'ADMIN'}}], warehouseScopes:[{warehouseId:'moscow',canRead:true,canWrite:true},{warehouseId:'other',canRead:true,canWrite:true}] });
afterEach(()=>vi.unstubAllEnvs());
describe('persisted FBO administrator branch',()=>{
  // TEST: a real multi-warehouse administrator was rejected by the single-branch rule.
  it('permits only the selected granted branch for our WMS',()=>{vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true');expect(recoveryWarehouse(actor())).toBe('moscow');});
  it.each(['unassigned',null])('rejects missing or unassigned active branch %s',id=>{vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true');expect(()=>recoveryWarehouse({...actor(),activeWarehouseId:id})).toThrow();});
  it.each(['canRead','canWrite'] as const)('requires %s',key=>{vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true');const a=actor();a.warehouseScopes[0][key]=false;expect(()=>recoveryWarehouse(a)).toThrow();});
  it.each([{isDemo:true},{status:'BLOCKED'},{roles:[{role:{code:'OPERATOR'}}]}])('rejects unprivileged actors',patch=>{vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true');expect(()=>recoveryWarehouse({...actor(),...patch})).toThrow();});
  it('keeps the old sold-WMS restriction with flag disabled',()=>{vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','false');expect(()=>recoveryWarehouse(actor())).toThrow();const a=actor();a.warehouseScopes.pop();expect(recoveryWarehouse(a)).toBe('moscow');});
  it('preserves owner access',()=>{expect(recoveryWarehouse({...actor(),roles:[{role:{code:'OWNER'}}]})).toBeNull();});
});
