import {afterEach,describe,expect,it,vi} from 'vitest';
import {OzonFboImportService} from '../src/modules/client-requests/ozon-fbo-import.service';
import {OzonFboImportController} from '../src/modules/client-requests/ozon-fbo-import.controller';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';

// TEST: browsing every permitted client must not relax creation, warehouse or customer scopes.
describe('Ozon all-client list',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 const staff={id:'staff',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',activeWarehouseId:'msk',clientIds:[],writableClientIds:[]} as any;
 const customer={...staff,id:'customer',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['a','b'],writableClientIds:['a'],activeWarehouseId:'stale'};
 function setup(){
  vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
  const findMany=vi.fn().mockResolvedValue([]);
  const db={clientRequest:{findMany},warehouseClient:{findMany:vi.fn().mockResolvedValue([{warehouseId:'msk',warehouse:{name:'Москва'}}])}};
  return {findMany,db,service:new OzonFboImportService(db as any,new ClientScopeService())};
 }
 it('defaults the opt-in read to all authorized clients in the active staff branch',async()=>{
  const s=setup();await (s.service.list as any)('',staff,undefined,'active','true');
  expect(s.findMany.mock.calls[0][0]).toMatchObject({where:{warehouseId:'msk',ozonShipment:{isNot:null},status:{notIn:['DONE','CANCELLED','REJECTED']}},orderBy:{number:'desc'},take:100});
  expect(s.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  expect(s.db.warehouseClient.findMany).not.toHaveBeenCalled();
  expect(JSON.stringify(s.findMany.mock.calls[0][0].where)).not.toContain('marketplaceConnections');
 });
 it('keeps restricted customers, empty scopes and hidden demo clients restricted',async()=>{
  const s=setup();await (s.service.list as any)('',customer,undefined,'active','true');
  expect(s.findMany.mock.calls[0][0].where).toMatchObject({clientId:{in:['a','b']}});
  expect(s.findMany.mock.calls[0][0].where.warehouseId).toBeUndefined();
  await (s.service.list as any)('',{...customer,clientIds:[]},undefined,'active','true');
  expect(s.findMany.mock.calls[1][0].where.clientId).toEqual({in:[]});
  await (s.service.list as any)('',{...staff,hiddenClientIds:['demo']},undefined,'active','true');
  expect(s.findMany.mock.calls[2][0].where.clientId).toEqual({notIn:['demo']});
  await expect((s.service.list as any)('foreign',customer,undefined,'active','true')).rejects.toThrow('Нет доступа');
  expect(s.findMany).toHaveBeenCalledTimes(3);
 });
 it('allows a permitted single-client read without depending on the creation warehouse selector',async()=>{
  const s=setup();await (s.service.list as any)('b',customer,undefined,'completed','true');
  expect(s.findMany.mock.calls[0][0].where).toMatchObject({clientId:'b',status:{in:['DONE','CANCELLED','REJECTED']}});
  expect(s.db.warehouseClient.findMany).not.toHaveBeenCalled();
 });
 it('rejects branch escapes and internal users with no valid active branch',async()=>{
  const s=setup();const internal={...customer,roleCodes:['BRANCH_MANAGER'],activeWarehouseId:'msk',warehouseIds:['msk'],writableWarehouseIds:[]};
  await expect((s.service.list as any)('',internal,'foreign','active','true')).rejects.toThrow('филиал');
  await expect((s.service.list as any)('',{...internal,activeWarehouseId:null},undefined,'active','true')).rejects.toThrow('филиал');
  await expect((s.service.list as any)('',staff,'foreign','active','true')).rejects.toThrow('филиал');
  expect(s.findMany).not.toHaveBeenCalled();
  await (s.service.list as any)('',internal,'msk','active','true');
  expect(s.findMany.mock.calls[0][0].where).toMatchObject({clientId:{in:['a','b']},warehouseId:'msk'});
 });
 it('pages by descending unique request number and validates the cursor before reading',async()=>{
  const s=setup();await (s.service.list as any)('',staff,undefined,'active','true','2506');
  expect(s.findMany.mock.calls[0][0]).toMatchObject({where:{number:{lt:2506}},orderBy:{number:'desc'},take:100});
  for(const cursor of ['0','-1','1.5','NaN','1e3','9007199254740993','', ['2']]) await expect((s.service.list as any)('',staff,undefined,'active','true',cursor)).rejects.toThrow();
  for(const flag of ['yes','1',['true']]) await expect((s.service.list as any)('',staff,undefined,'active',flag)).rejects.toThrow();
  expect(s.findMany).toHaveBeenCalledTimes(1);
 });
 it('continues beyond the first hundred without duplicate request numbers',async()=>{
  const s=setup();const rows=Array.from({length:205},(_,n)=>({id:'r'+n,number:205-n,title:'Ozon',status:'SUBMITTED',items:[],ozonShipment:{directions:[]}}));
  s.findMany.mockImplementation(async query=>rows.filter(r=>!query.where.number||r.number<query.where.number.lt).slice(0,query.take));
  const first=await (s.service.list as any)('',staff,undefined,'active','true');
  const second=await (s.service.list as any)('',staff,undefined,'active','true',String(first.at(-1).number));
  const third=await (s.service.list as any)('',staff,undefined,'active','true',String(second.at(-1).number));
  expect([first.length,second.length,third.length]).toEqual([100,100,5]);
  expect(new Set([...first,...second,...third].map(r=>r.number)).size).toBe(205);
 });
 it('does not make creation possible without a concrete client',async()=>{
  const s=setup();await expect(s.service.preview({} as any,{clientId:'',destinationCity:'Москва'},staff)).rejects.toThrow('Выберите клиента');
  expect(s.findMany).not.toHaveBeenCalled();expect(s.db.warehouseClient.findMany).not.toHaveBeenCalled();
 });
 it('retains the legacy client requirement and client/warehouse path when opt-in is absent or disabled',async()=>{
  const s=setup();await expect(s.service.list('',staff)).rejects.toThrow('Выберите клиента');
  vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','false');
  await expect((s.service.list as any)('',staff,undefined,'active','true')).rejects.toThrow('Выберите клиента');
  await s.service.list('a',staff);
  expect(s.db.warehouseClient.findMany).toHaveBeenCalledOnce();
  expect(s.findMany.mock.calls[0][0]).toMatchObject({where:{clientId:'a',warehouseId:'msk'},orderBy:{createdAt:'desc'},take:100});
  await expect((s.service.list as any)('a',staff,undefined,'active',undefined,'2506')).rejects.toThrow();
 });
 it('returns client, warehouse and bounded content metadata with the same single query',async()=>{
  const s=setup();s.findMany.mockResolvedValue([{id:'r',number:2506,clientId:'a',title:'Сборка',status:'SUBMITTED',createdAt:new Date('2026-10-29'),desiredDate:null,destinationCity:'Москва',client:{name:'Клиент А',code:'CL-A'},warehouse:{name:'ФФ Москва'},items:[1,2,3,4].map(n=>({name:'Товар '+n,barcode:String(n),quantity:n})),ozonShipment:{directions:[{}]},fboAssembly:{phase:'PICKING'}}]);
  const [row]=await (s.service.list as any)('',staff,undefined,'active','true');
  expect(row).toMatchObject({clientId:'a',clientName:'Клиент А',clientCode:'CL-A',warehouseName:'ФФ Москва',createdAt:new Date('2026-10-29'),itemCount:4,quantity:10,itemsPreview:[{name:'Товар 1',barcode:'1',quantity:1},{name:'Товар 2',barcode:'2',quantity:2},{name:'Товар 3',barcode:'3',quantity:3}]});
  expect(s.findMany).toHaveBeenCalledOnce();expect(s.db.warehouseClient.findMany).not.toHaveBeenCalled();
 });
 it('passes the opt-in and cursor through the read-only route',async()=>{
  const list=vi.fn().mockResolvedValue([]);const controller=new OzonFboImportController({list} as any,{} as any);
  await (controller.list as any)('',staff,undefined,'active','true','2506');
  expect(list).toHaveBeenCalledWith('',staff,undefined,'active','true','2506');
 });
});
