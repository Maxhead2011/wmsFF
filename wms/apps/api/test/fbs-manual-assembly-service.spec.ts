import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked=vi.hoisted(()=>({wb:vi.fn(),fetch:vi.fn(),reserved:vi.fn(),rules:vi.fn(),pending:vi.fn()}));
vi.mock('../src/modules/marketplace-connections/marketplace-connections.service',()=>({MarketplaceConnectionsService:class {},marketplaceJson:mocked.wb,marketplaceFetch:mocked.fetch,formatMarketplaceHttpError:()=> 'WB HTTP error'}));
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({wbReservationQuantities:mocked.reserved}));
vi.mock('../src/modules/warehouse/receipt-channel-policy',()=>({receiptRules:mocked.rules,pendingReceiptBoxIds:mocked.pending,
  receiptAllows:(r:any)=>!r||r.fbs===true}));
import { FbsManualAssemblyService } from '../src/modules/marketplace-connections/fbs-manual-assembly.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';

const user:any={id:'owner',name:'Owner',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],writableWarehouseIds:['moscow']};
const input={clientId:'client',connectionId:'connection',warehouseId:'moscow',orderIds:['11','12']};
const wb=input.orderIds.map(id=>({id,supplyId:'WB-'+id,barcodes:['4601'],article:'Зима',warehouseId:'external',createdAt:'2026-10-10T00:00:00Z',supplierStatus:'confirm',wbStatus:'waiting',supplyOpen:true,member:true}));
function fixture(){
  const saved=new Map<string,any>();let tasks:any[]=input.orderIds.map(orderId=>({id:'task'+orderId,clientId:'client',connectionId:'connection',orderId,requestId:'AUTO:'+orderId,
    status:'WAITING_STOCK',skuId:'sku',itemCount:1,stockWarehouseId:'noginsk',updatedAt:new Date('2026-10-10')}));
  let links:any[]=[],quantity=2,created=0;const events:any[]=[];
  const sku={id:'sku',clientId:'client',article:'Зима',name:'Костюм',size:'M / 46',needsChestnyZnak:true,barcodes:[{value:'4601',isPrimary:true}]};
  const db:any={
    client:{findFirst:vi.fn(async()=>({id:'client'}))},warehouse:{findFirst:vi.fn(async()=>({id:'moscow'}))},
    clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'connection',apiKey:'SECRET'}))},
    sku:{findMany:vi.fn(async()=>[sku])},
    fbsTsdAssembly:{findMany:vi.fn(async()=>structuredClone(tasks)),update:vi.fn(async({where,data}:any)=>{const t=tasks.find(t=>t.id===where.id);Object.assign(t,data);return t;}),create:vi.fn()},
    fbsOrderRequestLink:{findMany:vi.fn(async()=>structuredClone(links)),create:vi.fn(async({data}:any)=>{links.push(data);return data;})},
    stockBalance:{findMany:vi.fn(async()=>[{id:'balance',skuId:'sku',boxId:'box',quantity,box:{code:'BOX',storagePlacement:{pallet:{code:'PALLET'}}}}])},
    clientRequestBoxSelection:{findMany:vi.fn(async()=>[])},
    wbOrderShipment:{findMany:vi.fn(async()=>[])},stockMovement:{findMany:vi.fn(async()=>[])},
    systemSetting:{findUnique:vi.fn(async({where}:any)=>saved.has(where.key)?{value:structuredClone(saved.get(where.key))}:null),
      findUniqueOrThrow:vi.fn(async({where}:any)=>({value:structuredClone(saved.get(where.key))})),
      create:vi.fn(async({data}:any)=>{saved.set(data.key,data.value);return data;}),
      update:vi.fn(async({where,data}:any)=>{saved.set(where.key,data.value);return data;})},
    clientRequest:{create:vi.fn(async({data}:any)=>{created++;return {id:'request',number:1922,status:data.status,items:data.items.create.map((x:any)=>({...x,id:'item'}))};})},
    clientRequestEvent:{create:vi.fn(async({data}:any)=>events.push(data))},auditLog:{create:vi.fn(async()=>({}))},
    $queryRaw:vi.fn(async()=>[]),
  };
  db.$transaction=vi.fn(async(fn:any)=>{const before={tasks:structuredClone(tasks),links:structuredClone(links),saved:structuredClone(saved),created};try{return await fn(db);}catch(e){tasks=before.tasks;links=before.links;created=before.created;saved.clear();for(const [k,v]of before.saved)saved.set(k,v);throw e;}});
  const connections:any={repeatAssemblyStockReservations:vi.fn(async()=>new Map()),invalidateRepeatAssemblyCache:vi.fn()};
  const service=new FbsManualAssemblyService(db,new ClientScopeService(),connections);
  const live=vi.spyOn(service,'readOrders').mockImplementation(async()=>structuredClone(wb));
  return {service,db,saved,connections,live,events,quantity:(n:number)=>{quantity=n;},tasks:()=>tasks,links:()=>links,created:()=>created};
}
describe('manual FBS assembly service',()=>{
  beforeEach(()=>{vi.stubEnv('WMS_FBS_MANUAL_ASSEMBLY_ENABLED','true');mocked.reserved.mockResolvedValue(new Map());mocked.rules.mockResolvedValue(new Map());mocked.pending.mockResolvedValue([]);});
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
  // TEST: exact operational regression: remote branch orders, same SKU, separate WB supplies, one Moscow box.
  it('previews without reservations and creates one request with two units and preserved supplies',async()=>{
    const f=fixture(),preview=await f.service.preview(input,user);expect(preview.canCreate).toBe(true);expect(f.created()).toBe(0);
    expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
    const choices=input.orderIds.map(orderId=>({orderId,boxId:'box'}));const result=await f.service.create({token:preview.token!,choices},user);
    expect(result.request.number).toBe(1922);expect(f.created()).toBe(1);
    expect(f.db.clientRequest.create.mock.calls[0][0].data.items.create).toEqual([expect.objectContaining({quantity:2,skuId:'sku'})]);
    expect(f.tasks().every(t=>t.stockWarehouseId==='moscow'&&t.reservedBoxId==='box'&&t.status==='RESERVED')).toBe(true);
    expect(f.links().map(l=>l.lastSupplyId)).toEqual(['WB-11','WB-12']);
    expect(JSON.stringify(preview)).not.toContain('SECRET');
  });
  it('returns the existing result after a lost response, without WB or duplicate writes',async()=>{
    const f=fixture(),p=await f.service.preview(input,user),dto={token:p.token!,choices:input.orderIds.map(orderId=>({orderId,boxId:'box'}))};
    const first=await f.service.create(dto,user);f.live.mockRejectedValue(new Error('WB unavailable after commit'));
    const second=await f.service.create(dto,user);expect(second).toEqual({request:first.request,alreadyCreated:true});expect(f.created()).toBe(1);
    await expect(f.service.create({...dto,choices:[{orderId:'11',boxId:'other'},{orderId:'12',boxId:'box'}]},user)).rejects.toThrow('другими коробами');
  });
  it('rejects a depleted box after preview without partial creation',async()=>{
    const f=fixture(),p=await f.service.preview(input,user);f.quantity(1);
    await expect(f.service.create({token:p.token!,choices:input.orderIds.map(orderId=>({orderId,boxId:'box'}))},user)).rejects.toThrow('изменились');
    expect(f.created()).toBe(0);expect(f.tasks().every(t=>t.requestId.startsWith('AUTO:'))).toBe(true);
  });
  it.each(['cancelled','missing','closedSupply','movedSupply','picked','linked','pending','fboOnly','reserved','physicalPick','shipment'])(
    'fails closed for %s',async(kind)=>{const f=fixture();
      if(kind==='cancelled')f.live.mockResolvedValue(wb.map(o=>({...o,wbStatus:'canceled'})));
      if(kind==='missing')f.live.mockResolvedValue(wb.map(o=>({...o,barcodes:[]})));
      if(kind==='closedSupply')f.live.mockResolvedValue(wb.map(o=>({...o,supplyOpen:false})));
      if(kind==='movedSupply')f.live.mockResolvedValue(wb.map(o=>({...o,member:false})));
      if(kind==='picked')f.tasks()[0].kiz='mark';
      if(kind==='physicalPick')f.db.stockMovement.findMany.mockResolvedValue([{idempotencyKey:'fbs-sticker-pick:task11:1'}]);
      if(kind==='shipment')f.db.wbOrderShipment.findMany.mockResolvedValue([{assemblyId:'task11'}]);
      if(kind==='linked')f.links().push({orderId:'11',request:{number:10}});
      if(kind==='pending')mocked.pending.mockResolvedValue(['box']);
      if(kind==='fboOnly')mocked.rules.mockResolvedValue(new Map([['box',{fbs:false,fbo:true}]]));
      if(kind==='reserved')mocked.reserved.mockResolvedValue(new Map([['sku',1]]));
      const p=await f.service.preview(input,user);expect(p.canCreate).toBe(false);expect(p.token).toBeNull();expect(f.created()).toBe(0);
    });
  it('rechecks WB cancellation before committing',async()=>{const f=fixture(),p=await f.service.preview(input,user);f.live.mockResolvedValue(wb.map(o=>({...o,supplierStatus:'cancel'})));
    await expect(f.service.create({token:p.token!,choices:input.orderIds.map(orderId=>({orderId,boxId:'box'}))},user)).rejects.toThrow('изменились');expect(f.created()).toBe(0);});
  it('enforces actor, client and warehouse scopes',async()=>{
    const f=fixture();await expect(f.service.preview({...input,warehouseId:'foreign'},user)).rejects.toThrow('филиале');
    await expect(f.service.preview(input,{...user,permissionCodes:[],clientScopeMode:'LIMITED'})).rejects.toThrow('клиента');
    const p=await f.service.preview(input,user);await expect(f.service.create({token:p.token!,choices:[]},{...user,id:'someone'})).rejects.toThrow('другому пользователю');
  });
  it('rolls back if an event or audit fails after task updates',async()=>{
    const f=fixture(),p=await f.service.preview(input,user);f.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(f.service.create({token:p.token!,choices:input.orderIds.map(orderId=>({orderId,boxId:'box'}))},user)).rejects.toThrow('audit failed');
    expect(f.created()).toBe(0);expect(f.links()).toEqual([]);expect(f.tasks().every(t=>t.requestId.startsWith('AUTO:'))).toBe(true);
  });
  it('rejects an expired preview without WB reads',async()=>{
    const f=fixture(),p=await f.service.preview(input,user);f.saved.get('fbs.manual.preview.v1:'+p.token).expiresAt=0;f.live.mockClear();
    await expect(f.service.create({token:p.token!,choices:[]},user)).rejects.toThrow('устарела');expect(f.live).not.toHaveBeenCalled();
  });
});

describe('fresh WB gateway',()=>{
  afterEach(()=>vi.clearAllMocks());
  it('uses only read endpoints and verifies exact supply membership',async()=>{
    const f=fixture();f.live.mockRestore();
    mocked.fetch.mockResolvedValue(new Response(JSON.stringify({orders:[{id:11,supplyId:'WB-X',skus:['4601'],article:'A'}],next:0})));
    mocked.wb.mockImplementation(async(url:string)=>{
      if(url.includes('/orders?'))return {orders:[{id:11,supplyId:'WB-X',skus:['4601'],article:'A'}],next:0};
      if(url.endsWith('/orders/status'))return {orders:[{id:11,supplierStatus:'confirm',wbStatus:'waiting'}]};
      if(url.endsWith('/order-ids'))return {orderIds:[11]};
      return {id:'WB-X',done:false};
    });
    expect((await f.service.readOrders('secret',['11']))[0]).toMatchObject({id:'11',member:true,supplyOpen:true});
    expect(mocked.wb.mock.calls.every(([url,init])=>init.method==='GET'||(init.method==='POST'&&url.endsWith('/orders/status')))).toBe(true);
  });
  it('never treats repeated pagination as complete',async()=>{
    const f=fixture();f.live.mockRestore();mocked.fetch.mockImplementation(async()=>new Response('{"orders":[],"next":1}'));
    await expect(f.service.readOrders('secret',['11'])).rejects.toThrow('повторил страницу');
  });
  // TEST: reproduces the live uint64 cursor; its low digits must survive the next request.
  it('passes a uint64 WB cursor to the next page without rounding',async()=>{
    const f=fixture();f.live.mockRestore();
    mocked.fetch.mockResolvedValueOnce(new Response('{"orders":[],"next":1789212864297140123}'))
      .mockResolvedValueOnce(new Response('{"orders":[],"next":0}'));
    mocked.wb.mockResolvedValue({orders:[]});
    await f.service.readOrders('secret',['11']);
    expect(mocked.fetch.mock.calls.at(-1)![0]).toContain('next=1789212864297140123&');
    expect(mocked.fetch.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
  });
});
