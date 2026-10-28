import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientRequestsService } from './client-requests.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

describe('FBO active card counts', () => {
  beforeEach(()=>vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true'));
  afterEach(()=>vi.unstubAllEnvs());
  // TEST: sold installation must not read new marketplace relations.
  it('does not query storage when the feature is disabled', async()=>{
    vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','false');
    const findMany=vi.fn();
    const service=new ClientRequestsService({clientRequest:{findMany}} as never,new ClientScopeService(),{} as never);
    await expect(service.activeFboCounts({} as AuthUser)).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  // TEST: client cabinet cannot count another customer's requests.
  it('retains client access and rejects an inaccessible internal branch',async()=>{
    const findMany=vi.fn().mockResolvedValue([]);
    const service=new ClientRequestsService({clientRequest:{findMany}} as never,new ClientScopeService(),{} as never);
    const user={roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['own'],activeWarehouseId:'other'} as unknown as AuthUser;
    expect(await service.activeFboCounts(user)).toEqual({wb:0,ozon:0});
    expect(findMany.mock.calls[0][0].where.clientId).toEqual({in:['own']});
    expect(findMany.mock.calls[0][0].where.warehouseId).toBeUndefined();
    findMany.mockClear();
    await expect(service.activeFboCounts({...user,roleCodes:['BRANCH_MANAGER'],warehouseIds:['moscow']})).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  // TEST: totals must not inherit the list's 200-row cap or mix marketplaces.
  it('counts all active WB/Ozon requests using client and warehouse scope', async () => {
    const row = {id:'wb',title:'Excel',comment:null,ozonShipment:null,_count:{fbsOrderLinks:0}};
    const findMany = vi.fn().mockResolvedValue([
      ...Array.from({length:205},(_,i)=>({...row,id:String(i)})),
      {...row,id:'ozon',ozonShipment:{requestId:'ozon'}},
      {...row,id:'fbs',_count:{fbsOrderLinks:1}},
      {...row,id:'legacy',title:' FBS old'},
      {...row,id:'comment',comment:'Создано из FBS-заказов: 1'},
    ]);
    const resolveClientFilter=vi.fn().mockReturnValue({in:['own-client']});
    const service=new ClientRequestsService({clientRequest:{findMany}} as never,{resolveClientFilter} as never,{} as never);
    const user={roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'moscow'} as unknown as AuthUser;
    expect(await service.activeFboCounts(user)).toEqual({wb:205,ozon:1});
    const query=findMany.mock.calls[0][0];
    expect(query.take).toBeUndefined();
    expect(query.where).toMatchObject({clientId:{in:['own-client']},warehouseId:'moscow',type:'OUTBOUND',status:{notIn:['DONE','CANCELLED','REJECTED']}});
    expect(query.where.lamodaAssembly).toEqual(null);
    expect(query.where.yandexFbyShipment).toEqual(null);
  });
});
