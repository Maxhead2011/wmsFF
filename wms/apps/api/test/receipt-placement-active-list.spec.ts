import {afterEach,expect,it,vi} from 'vitest';
const {facts}=vi.hoisted(()=>({facts:vi.fn()}));
vi.mock('../src/modules/warehouse/receipt-placement-workflow',async original=>({...await original<any>(),placementReceipts:facts}));
import {StorageLocationsService} from '../src/modules/warehouse/storage-locations.service';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('shows only open or deferred receipts while retaining completed progress for a selected receipt',async()=>{
 // TEST: completion disappears from the work list but remains readable by the terminal/history.
 vi.stubEnv('WMS_RECEIPT_PLACEMENT_ENABLED','true');
 const s=new StorageLocationsService({} as any,{} as any,{} as any);
 const user:any={activeWarehouseId:'wh',permissionCodes:['system:admin'],roleCodes:['ADMIN'],clientScopeMode:'ALL'};
 const open={id:'open',status:'OPEN'},deferred={id:'deferred',status:'DEFERRED'},done={id:'done',status:'COMPLETED'};
 facts.mockResolvedValue([open,deferred,done]);
 expect((await s.receiptPlacementTasks(user)).items).toEqual([open,deferred]);
 facts.mockResolvedValue([done]);
 expect((await s.receiptPlacementTasks(user,'client','document')).items).toEqual([done]);
});
