import {afterEach,it,expect,vi} from 'vitest';
import {fetchOzonCustomerWarehouses,fetchOzonCustomerRequests,previewOzonCustomerFile,createOzonCustomerFile} from './api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: the actual transports keep the same selected branch through all steps.
it('sends the client and warehouse to list, preview and commit',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>[]});vi.stubGlobal('fetch',fetcher);
 await fetchOzonCustomerWarehouses('token','client');
 expect(fetcher.mock.calls[0][0]).toContain('/warehouses?clientId=client');
 await fetchOzonCustomerRequests('token','client','branch');
 expect(fetcher.mock.calls[1][0]).toContain('/requests?clientId=client&warehouseId=branch');
 const payload={file:new Blob(['test']) as File,clientId:'client',destinationCity:'Москва',warehouseId:'branch'};
 await previewOzonCustomerFile('token',payload);await createOzonCustomerFile('token',payload);
 for(const call of fetcher.mock.calls.slice(2)){
   expect(call[1].body.get('warehouseId')).toBe('branch');
   expect(call[1].body.get('clientId')).toBe('client');
 }
});
