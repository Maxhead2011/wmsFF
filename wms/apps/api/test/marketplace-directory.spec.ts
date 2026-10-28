import { afterEach, expect, it, vi } from 'vitest';
import { ClientsService } from '../src/modules/clients/clients.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: directory reuses client/warehouse scope and selects no authentication secrets.
it('returns only scoped non-secret directory fields when opted in',async()=>{
 vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
 const findMany=vi.fn().mockResolvedValue([]);
 const service=new ClientsService({client:{findMany}} as any,{resolveClientFilter:()=>({in:['allowed']})} as any);
 await service.list({roleCodes:['WORKER'],activeWarehouseId:'warehouse'} as any,false,true);
 const q=findMany.mock.calls[0][0];
 expect(q.where.id).toEqual({in:['allowed']});
 expect(q.where.warehouseLinks.some.warehouseId).toBe('warehouse');
 expect(q.select.marketplaceConnections).toEqual({select:{marketplace:true,isActive:true}});
 expect(JSON.stringify(q.select)).not.toMatch(/apiKey|encryptedSecret|oauthClientId/);
 await service.list({roleCodes:[]} as any);
 expect(findMany.mock.calls[1][0].select.marketplaceConnections).toBeUndefined();
 vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','false');
 await service.list({roleCodes:[]} as any,false,true);
 expect(findMany.mock.calls[2][0].select.lamodaAccounts).toBeUndefined();
});
