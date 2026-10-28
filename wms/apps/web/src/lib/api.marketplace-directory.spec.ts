import {afterEach,expect,it,vi} from 'vitest';
import {fetchClients} from './api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: new directory metadata must not discard deployed FBS branch selection.
it('retains the explicit branch and all-branches query while requesting the directory',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>[]});vi.stubGlobal('fetch',fetcher);
 await fetchClients('test',{marketplaceDirectory:true,displayWarehouseId:'branch'});
 let url=new URL(fetcher.mock.calls[0][0],'https://example.invalid');
 expect(url.searchParams.get('marketplaceDirectory')).toBe('true');expect(url.searchParams.get('displayWarehouseId')).toBe('branch');expect(url.searchParams.has('allBranches')).toBe(false);
 await fetchClients('test',{marketplaceDirectory:true,allBranches:true});url=new URL(fetcher.mock.calls[1][0],'https://example.invalid');expect(url.searchParams.get('allBranches')).toBe('1');
});
