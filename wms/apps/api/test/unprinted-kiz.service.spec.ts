import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import { UnprintedKizService } from '../src/modules/service/unprinted-kiz.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
const kiz='0104680992592323215t>rsrOYP,IXp';
const filter={clientId:'c',warehouseId:'w',dateFrom:'2026-09-14',dateTo:'2026-09-15'};
const user={id:'admin',name:'Admin',permissionCodes:['system:admin'],roleCodes:['ADMIN'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]} as any;
beforeEach(()=>{vi.stubEnv('WMS_UNPRINTED_KIZ_SEARCH','true');vi.stubEnv('WMS_TSD_KIZ_SEARCH','true');});
afterEach(()=>vi.unstubAllEnvs());
function setup() {
  const audit={id:'scan',entityId:'a',userId:'worker',createdAt:new Date('2026-09-15T10:00:00Z'),payload:{clientId:'c',requestId:'r',orderId:'1',kiz,boxCode:'BOX',workerName:'Historical name'}};
  const state={jobs:[] as any[],ack:[] as any[],shipments:[] as any[],markers:[] as any[],searches:[] as any[],previous:null as any};
  const db:any={
    $executeRawUnsafe:vi.fn(),$queryRaw:vi.fn(),
    client:{findFirst:vi.fn(async()=>({id:'c'}))},warehouse:{findFirst:vi.fn(async()=>({id:'w'}))},
    auditLog:{findMany:vi.fn(async(q:any)=>q.where.action==='KIZ_SEARCH_CREATED'?state.markers:q.where.action==='FBS_TWO_LABELS_PRINTED'?state.ack:[audit]),findFirst:vi.fn(async()=>state.previous),create:vi.fn(async()=>({}))},
    clientRequest:{findMany:vi.fn(async(q:any)=>q.where.id.in.includes('r')?[{id:'r',number:100}]:state.searches),create:vi.fn(async()=>({id:'new',number:1055})),findUniqueOrThrow:vi.fn(async()=>({id:'new',number:1055}))},
    clientRequestEvent:{create:vi.fn(async()=>({}))},
    fbsTsdAssembly:{findMany:vi.fn(async()=>[{id:'a',clientId:'c',requestId:'r',orderId:'1',skuId:'sku',barcode:'123',productName:'Product',kiz,connectionId:'conn'}])},
    fbsAssemblyAttemptHistory:{findMany:vi.fn(async()=>[])},fbsPrintJob:{findMany:vi.fn(async()=>state.jobs)},shippedKizHistory:{findMany:vi.fn(async()=>state.shipments)},
    user:{findMany:vi.fn(async()=>[{id:'worker',name:'Current name'}])},box:{findMany:vi.fn(async()=>[{code:'BOX'}])},
  };
  db.$transaction=vi.fn(async(fn:any)=>fn(db));
  const service=new UnprintedKizService(db,new ClientScopeService());
  return {db,service,state,audit};
}
// TEST: read-only evidence and creation contract match the existing TSD search workflow.
describe('unprinted KIZ service',()=>{
  it('reports historical scanner/box in a read-only transaction and keeps branch/client scope',async()=>{
    const {service,db}=setup();const result=await service.report(filter,user);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(result.rows[0]).toMatchObject({workerName:'Historical name',boxCode:'BOX',requestNumber:100,kiz,blockedReason:''});
    expect(db.clientRequest.findMany.mock.calls[0][0].where).toMatchObject({clientId:'c',warehouseId:'w'});
    expect(db.clientRequest.create).not.toHaveBeenCalled();expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('a successful print acknowledgement removes a row even after a later failed retry',async()=>{
    const {service,state}=setup();state.jobs=[{id:'j',assemblyId:'a',requestId:'r',orderId:'1',kiz,status:'FAILED',printedAt:null}];
    expect((await service.report(filter,user)).rows).toHaveLength(1);
    state.ack=[{entityId:'j',createdAt:new Date('2026-09-16T12:00:00Z')}];
    expect((await service.report(filter,user)).rows).toHaveLength(0);
  });
  it('blocks an already shipped KIZ and an active legacy search such as 1054',async()=>{
    const {service,state}=setup();state.shipments=[{assemblyId:'a',kiz,shippedAt:new Date()}];
    expect((await service.report(filter,user)).rows[0].blockedReason).toContain('отгрузки');
    state.shipments=[];state.markers=[{entityId:'search',payload:{targets:[{kiz}]}}];state.searches=[{id:'search',number:1054,status:'IN_WORK'}];
    expect((await service.report(filter,user)).rows[0]).toMatchObject({searchRequestNumber:1054,blockedReason:'Уже в заявке поиска №1054'});
  });
  it('preserves the historical attempt if the active assembly has changed',async()=>{
    const {service,db}=setup();db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    db.fbsAssemblyAttemptHistory.findMany.mockResolvedValue([{id:'old',requestId:'r',orderId:'1',kiz,taskSnapshot:{id:'a',skuId:'sku',connectionId:'conn'}}]);
    expect((await service.report(filter,user)).rows[0].blockedReason).toBe('');
  });
  it('rejects access and disabled deployments before selecting audit data',async()=>{
    const {service,db}=setup();await expect(service.report(filter,{...user,permissionCodes:[]})).rejects.toThrow();
    vi.stubEnv('WMS_UNPRINTED_KIZ_SEARCH','false');await expect(service.report(filter,user)).rejects.toThrow();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
  it('rechecks printing at creation and refuses a stale selection',async()=>{
    const {service,state,db}=setup();vi.spyOn(service as any,'eligible').mockResolvedValue([{id:'worker'}]);
    expect((await service.report(filter,user)).rows).toHaveLength(1);
    state.jobs=[{id:'j',assemblyId:'a',requestId:'r',orderId:'1',kiz,status:'PRINTED',printedAt:new Date('2026-09-16')}];
    await expect(service.create({...filter,scanIds:['scan'],assignedToUserId:'worker',operationId:'operation'},user)).rejects.toThrow('Список изменился');
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('creates compatible search targets and returns the same request on retry',async()=>{
    const {service,db,state}=setup();vi.spyOn(service as any,'eligible').mockResolvedValue([{id:'worker'}]);
    const input={...filter,scanIds:['scan'],assignedToUserId:'worker',operationId:'operation'};
    expect(await service.create(input,user)).toEqual({id:'new',number:1055});
    const data=db.clientRequest.create.mock.calls[0][0].data,marker=db.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({type:'OTHER',assignedToUserId:'worker',clientId:'c',warehouseId:'w'});
    expect(marker.payload.targets[0]).toMatchObject({itemId:data.items.create[0].id,kiz,boxCode:'BOX',order:'1',firstWorker:'Historical name',sourceAuditId:'scan'});
    state.previous={...marker};
    expect(await service.create(input,user)).toEqual({id:'new',number:1055});
    expect(db.clientRequest.create).toHaveBeenCalledTimes(1);
    await expect(service.create({...input,assignedToUserId:'other'},user)).rejects.toThrow('Ключ операции');
  });
  it('rejects an assignee without access',async()=>{
    const {service,db}=setup();vi.spyOn(service as any,'eligible').mockResolvedValue([]);
    await expect(service.create({...filter,scanIds:['scan'],assignedToUserId:'bad',operationId:'operation'},user)).rejects.toThrow('Сотрудник');
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
});
