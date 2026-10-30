import {afterEach,describe,it,expect,vi} from 'vitest';
import {requestStoreContexts} from '../src/modules/clients/request-store-context';
const stores=[{id:'m',name:'Монларти',connectionIds:['mw','mo']},{id:'b',name:'Брайбо',connectionIds:['bw','bo']}];
function db(){return {systemSetting:{findMany:vi.fn().mockResolvedValue([{key:'client.stores.v1:c',value:stores}])},
  clientMarketplaceConnection:{findMany:vi.fn().mockResolvedValue(['mw','mo','bw','bo'].map(id=>({id,clientId:'c'})))},
  fbsOrderRequestLink:{findMany:vi.fn().mockResolvedValue([])},ozonFboShipment:{findMany:vi.fn().mockResolvedValue([])}};}
// TEST: metadata follows the seller connection, never the product or request title.
describe('request store context',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('keeps disabled deployments free of reads',async()=>{vi.stubEnv('WMS_CLIENT_STORES_ENABLED','false');const p=db();expect((await requestStoreContexts(p as never,[{id:'r',clientId:'c'}])).size).toBe(0);expect(p.systemSetting.findMany).not.toHaveBeenCalled();});
 it('uses Ozon binding for FBO and seller binding for FBS',async()=>{
  vi.stubEnv('WMS_CLIENT_STORES_ENABLED','true');const p=db();
  p.ozonFboShipment.findMany.mockResolvedValue([{requestId:'fbo',integration:{connectionId:'mo'}}] as never);
  p.fbsOrderRequestLink.findMany.mockResolvedValue([{requestId:'fbs',clientId:'c',connectionId:'bw'}] as never);
  const result=await requestStoreContexts(p as never,[{id:'fbo',clientId:'c'},{id:'fbs',clientId:'c'}]);
  expect(result.get('fbo')).toMatchObject({storeNames:['Монларти'],storeState:'ASSIGNED'});
  expect(result.get('fbs')).toMatchObject({storeNames:['Брайбо'],storeState:'ASSIGNED'});
 });
 it('does not conceal mixed or unknown connections',async()=>{
  vi.stubEnv('WMS_CLIENT_STORES_ENABLED','true');const p=db();
  p.fbsOrderRequestLink.findMany.mockResolvedValue(['mw','bw'].map(connectionId=>({requestId:'r',clientId:'c',connectionId})) as never);
  expect((await requestStoreContexts(p as never,[{id:'r',clientId:'c'}])).get('r')?.storeState).toBe('MIXED');
  p.fbsOrderRequestLink.findMany.mockResolvedValue([{requestId:'r',clientId:'c',connectionId:'foreign'}] as never);
  expect((await requestStoreContexts(p as never,[{id:'r',clientId:'c'}])).get('r')?.storeState).toBe('UNASSIGNED');
 });
 it('scopes database queries to authorized request and client pairs',async()=>{
  vi.stubEnv('WMS_CLIENT_STORES_ENABLED','true');const p=db();await requestStoreContexts(p as never,[{id:'r',clientId:'c'}]);
  expect(p.fbsOrderRequestLink.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{OR:[{requestId:'r',clientId:'c'}]}}));
  expect(p.ozonFboShipment.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{OR:[{requestId:'r',request:{clientId:'c'}}]}}));
 });
});
