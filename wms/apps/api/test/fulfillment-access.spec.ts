import 'reflect-metadata';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FulfillmentAnalyticsService} from '../src/modules/analytics/fulfillment.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import type {AuthUser} from '../src/modules/auth/auth.types';
const user={id:'reader',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:[],warehouseIds:[],isDemo:false} as AuthUser;
const query={clientId:'own',warehouseId:'ff',dateFrom:'2026-01-01',dateTo:'2026-03-01',channel:'FBS' as const};
// TEST: access failures must occur before any business-data query.
describe('fulfillment client and warehouse isolation',()=>{
 beforeEach(()=>vi.stubEnv('WMS_FULFILLMENT_ANALYTICS_ENABLED','true'));
 afterEach(()=>vi.unstubAllEnvs());
 it('disables all fulfillment reads when the own-WMS flag is absent',async()=>{
  vi.stubEnv('WMS_FULFILLMENT_ANALYTICS_ENABLED','');const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());
  await expect(s.clients(user)).rejects.toThrow('не включена');await expect(s.dashboard(query,user)).rejects.toThrow('не включена');
 });
 it('denies a client URL substituted with another client',async()=>{
  const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());await expect(s.dashboard({...query,clientId:'other'},user)).rejects.toThrow('Нет доступа');
 });
 it('denies a warehouse outside an employee scope',async()=>{
  const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());await expect(s.dashboard(query,{...user,roleCodes:['EMPLOYEE']})).rejects.toThrow('Нет доступа к складу');
 });
 it('does not bypass warehouse scope with a mixed CLIENT/OPERATOR role',async()=>{
  const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());await expect(s.dashboard(query,{...user,roleCodes:['CLIENT','OPERATOR']})).rejects.toThrow('Нет доступа к складу');
 });
 it('does not permit hidden clients for a global account',async()=>{
  const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());await expect(s.dashboard(query,{...user,clientScopeMode:'ALL',hiddenClientIds:['own']})).rejects.toThrow('Демонстрационные');
 });
 it('limits client selection and rejects a warehouse not connected to the client',async()=>{
  const prisma={client:{findMany:vi.fn().mockResolvedValue([{id:'own',name:'Own'}]),findFirst:vi.fn().mockResolvedValue({id:'own'})},warehouseClient:{findMany:vi.fn().mockResolvedValue([]),findFirst:vi.fn().mockResolvedValue(null)}};
  const s=new FulfillmentAnalyticsService(prisma as any,new ClientScopeService());await s.clients(user);
  expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({id:{in:['own']},isDemo:false,status:{not:'ARCHIVED'}});
  await expect(s.dashboard(query,user)).rejects.toThrow('Склад не подключён');
 });
 // TEST: archived clients must not become options or trigger warehouse lookups; paused clients remain eligible.
 it('omits archived clients from the selector while preserving active and paused clients',async()=>{
  const rows=[{id:'active',name:'Active',status:'ACTIVE'},{id:'paused',name:'Paused',status:'PAUSED'},{id:'archive',name:'Archived',status:'ARCHIVED'}];
  const prisma={client:{findMany:vi.fn(async({where}:any)=>rows.filter(r=>!where.status?.not||r.status!==where.status.not))},warehouseClient:{findMany:vi.fn(async(_query:any)=>[])}};
  const s=new FulfillmentAnalyticsService(prisma as any,new ClientScopeService());
  const result=await s.clients({...user,roleCodes:['OWNER'],clientScopeMode:'ALL'});
  expect(result.map(c=>c.id)).toEqual(['active','paused']);
  expect(prisma.warehouseClient.findMany.mock.calls[0][0].where.clientId.in).toEqual(['active','paused']);
 });
 it('rejects a real client when used through a demo session',async()=>{
  const prisma={client:{findFirst:vi.fn().mockResolvedValue(null)}};const s=new FulfillmentAnalyticsService(prisma as any,new ClientScopeService());
  await expect(s.dashboard(query,{...user,isDemo:true})).rejects.toThrow('Клиент не найден');
  expect(prisma.client.findFirst.mock.calls[0][0].where).toEqual({id:'own',isDemo:true});
 });
 // TEST: the header branch controls both client options and warehouse options, including a return switch.
 it('shows only active links in the selected branch and preserves shared clients',async()=>{
  const rows=[{id:'moscow'},{id:'noginsk'},{id:'shared'},{id:'inactive'}];
  const links=[{clientId:'moscow',warehouseId:'m',status:'ACTIVE'},{clientId:'noginsk',warehouseId:'n',status:'ACTIVE'},{clientId:'shared',warehouseId:'m',status:'ACTIVE'},{clientId:'shared',warehouseId:'n',status:'ACTIVE'},{clientId:'inactive',warehouseId:'m',status:'INACTIVE'}];
  const prisma={client:{findMany:vi.fn(async({where}:any)=>rows.filter(c=>!where.warehouseLinks||links.some(l=>l.clientId===c.id&&l.warehouseId===where.warehouseLinks.some.warehouseId&&l.status===where.warehouseLinks.some.status)))},warehouseClient:{findMany:vi.fn(async({where}:any)=>links.filter(l=>where.clientId.in.includes(l.clientId)&&(!where.warehouseId||l.warehouseId===where.warehouseId)&&(!where.status||l.status===where.status)).map(l=>({...l,warehouse:{id:l.warehouseId,name:l.warehouseId}})))}};
  const s=new FulfillmentAnalyticsService(prisma as any,new ClientScopeService());
  for(const branch of ['m','n','m']){
   const result=await s.clients({...user,roleCodes:['OWNER'],clientScopeMode:'ALL',activeWarehouseId:branch});
   expect(result.map(c=>c.id)).toEqual([branch==='m'?'moscow':'noginsk','shared']);
   expect(result.every(c=>c.warehouses.length===1&&c.warehouses[0].id===branch)).toBe(true);
  }
 });
 it('does not expand employee access through an unavailable selected branch',async()=>{
  const s=new FulfillmentAnalyticsService({} as any,new ClientScopeService());
  await expect(s.clients({...user,roleCodes:['OPERATOR'],warehouseIds:['m'],activeWarehouseId:'n'})).rejects.toThrow('Нет доступа к складу');
 });
});
