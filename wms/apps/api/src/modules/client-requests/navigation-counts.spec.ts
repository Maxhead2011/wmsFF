import {describe,it,expect,vi,afterEach} from 'vitest';
import {ClientRequestsService} from './client-requests.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
const user={roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'moscow',clientScopeMode:'ALL'} as unknown as AuthUser;
afterEach(()=>vi.unstubAllEnvs());
describe('sidebar request counts',()=>{
 // TEST: complete queue, one request per assembly, current and archived FBS links.
 it('counts unfinished requests and strict IN_WORK subsets without list limits',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
  const row={id:'x',type:'OUTBOUND',status:'SUBMITTED',title:'Excel',comment:null,ozonShipment:null,lamodaAssembly:null,yandexFbyShipment:null,_count:{fbsOrderLinks:0}};
  const findMany=vi.fn().mockResolvedValue([...Array.from({length:205},(_,i)=>({...row,id:String(i)})),
   {...row,id:'fbs',status:'IN_WORK',_count:{fbsOrderLinks:8}}, {...row,id:'legacy',title:'FBS old'},
   {...row,id:'ozon',status:'IN_WORK',ozonShipment:{requestId:'ozon'}},
   {...row,id:'lamoda',status:'PACKED',lamodaAssembly:{requestId:'lamoda'}},
   {...row,id:'yandex',status:'IN_WORK',yandexFbyShipment:{id:'yandex'}},
   {...row,id:'inbound',type:'INBOUND',status:'IN_WORK'}]);
  const service=new ClientRequestsService({clientRequest:{findMany}} as never,new ClientScopeService(),{} as never);
  expect(await service.navigationCounts(user)).toEqual({requests:{total:211,inWork:4},fbs:{total:2,inWork:1},fbo:{total:208,inWork:2}});
  expect(findMany.mock.calls[0][0].where).toMatchObject({warehouseId:'moscow',status:{notIn:['DONE','CANCELLED','REJECTED']}});
  expect(findMany.mock.calls[0][0].take).toBeUndefined();
 });
 // TEST: an archived attempt still identifies FBS after the live link moved.
 it('keeps archived FBS requests out of the FBO count',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED','true');
  const findMany=vi.fn().mockResolvedValue([{id:'old',type:'OUTBOUND',status:'IN_WORK',title:'Old request',_count:{fbsOrderLinks:0}}]);
  const history=vi.fn().mockResolvedValue([{taskSnapshot:{id:'attempt',requestId:'old',status:'COMPLETED'},linkSnapshot:{},successorId:'next'}]);
  const service=new ClientRequestsService({clientRequest:{findMany},fbsAssemblyAttemptHistory:{findMany:history}} as never,new ClientScopeService(),{} as never);
  expect(await service.navigationCounts(user)).toEqual({requests:{total:1,inWork:1},fbs:{total:1,inWork:1},fbo:{total:0,inWork:0}});
  expect(history.mock.calls[0][0].where.requestId).toEqual({in:['old']});
 });
 // TEST: counts cannot expose another client or inaccessible warehouse.
 it('enforces client and branch scopes and disabled installation',async()=>{
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
  const findMany=vi.fn().mockResolvedValue([]),service=new ClientRequestsService({clientRequest:{findMany}} as never,new ClientScopeService(),{} as never);
  await service.navigationCounts({...user,permissionCodes:['client-requests:read'],roleCodes:['CLIENT'],clientScopeMode:'LIMITED',clientIds:['own']});
  expect(findMany.mock.calls[0][0].where.clientId).toEqual({in:['own']});
  expect(findMany.mock.calls[0][0].where.warehouseId).toBeUndefined();findMany.mockClear();
  await expect(service.navigationCounts({...user,permissionCodes:[],roleCodes:['BRANCH_MANAGER'],warehouseIds:['other']})).rejects.toThrow();
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','false');await expect(service.navigationCounts(user)).rejects.toThrow();expect(findMany).not.toHaveBeenCalled();
 });
});
