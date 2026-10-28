import { afterEach, expect, it, vi } from 'vitest';
import { ClientRequestMarketplaceFilesService } from '../src/modules/client-requests/client-request-marketplace-files.service';
// TEST: a persisted Lamoda assembly cannot leak into either generic WB export endpoint.
afterEach(()=>vi.unstubAllEnvs());
it('blocks both WB files even when the Lamoda assembly switch is disabled',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','false');
 const db:any={clientRequest:{findUnique:vi.fn(async()=>({id:'r',clientId:'c',warehouseId:'w'}))},lamodaFboAssembly:{findUnique:vi.fn(async()=>({requestId:'r'}))}};
 const service=new ClientRequestMarketplaceFilesService(db,{requireClientAccess:vi.fn()} as any);
 const user:any={permissionCodes:['system:admin'],roleCodes:['OWNER']};
 await expect(service.getWbProductsTemplate('r',user)).rejects.toThrow('Lamoda');
 await expect(service.getWbPackagingTemplate('r',user)).rejects.toThrow('Lamoda');
});
