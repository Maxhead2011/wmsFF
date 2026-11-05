import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryAssignFabricTask } from './fbs-fabric-queue';
vi.mock('./marketplace-product-links', () => ({ozonLinkedSkus: async (_db:any,_c:any,_s:any,skus:any)=>skus}));
afterEach(()=>vi.unstubAllEnvs());
function fixture(marketplace='WILDBERRIES') {
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','true');
  vi.stubEnv('WMS_OZON_MULTILINE_PICKING','true');
  let ledger:any={rolls:[{id:'roll',warehouseId:'warehouse',material:'SATIN',color:'white',remainingMm:20000,cutMm:0,createdAt:'2026-11-05'}]};
  const sku={id:'sku',clientId:'client',name:'Ткань',internalSku:'white_3',marketplaceProductId:'101',barcodes:[{value:'1234567890123'}]};
  const items:any[]=[{id:'item',requestId:'request',skuId:'sku',quantity:2,sku}];
  const db:any={
    $queryRaw:vi.fn(async(q:any)=>q.join('').includes('advisory')?[{locked:true}]:[]),$executeRaw:vi.fn(),
    systemSetting:{findUnique:vi.fn(async({where}:any)=>({value:where.key==='fabric.rolls.v1:client'?ledger:{enabled:true}})),update:vi.fn(async({data}:any)=>{ledger=data.value;})},
    sku:{findMany:vi.fn().mockResolvedValue([sku])},
    clientRequest:{findUnique:vi.fn().mockResolvedValue({id:'request',clientId:'client',warehouseId:'warehouse',status:'SUBMITTED'})},
    clientRequestItem:{findFirst:vi.fn(async({where}:any)=>items.find(i=>i.skuId===where.skuId)),findMany:vi.fn(async()=>items),
      update:vi.fn(async({where,data}:any)=>{const item=items.find(i=>i.id===where.id);item.quantity+=(data.quantity.increment??0)-(data.quantity.decrement??0);return item;}),
      create:vi.fn(async({data}:any)=>{const item={id:'item2',...data};items.push(item);return item;})},
    fbsTsdAssembly:{create:vi.fn(async({data}:any)=>({id:'task',...data})),updateMany:vi.fn().mockResolvedValue({count:0})},
    clientRequestEvent:{create:vi.fn()},stockBalance:{create:vi.fn()},
  };
  db.$transaction=async(fn:any)=>fn(db);
  const service={prisma:db,readOzonFbsPickPosting:vi.fn().mockResolvedValue({status:'awaiting_packaging',products:[{sku:101,offer_id:'cloth',quantity:2}]})};
  const order={id:'order',connectionId:'shop',marketplace,itemCount:2,product:sku,request:{id:'request'},requiredMeta:[]};
  const user={id:'worker',name:'Worker',activeWarehouseId:'warehouse',tsdFabricCutConfirmation:true};
  return {service,db,order,user,sku,items,ledger:()=>ledger};
}
describe('fabric queue integration',()=>{
  // TEST: reserve nothing when Ozon's mandatory piece-by-piece workflow is disabled.
  it('requires Ozon line accounting before reserving fabric',async()=>{
    const f=fixture('OZON');vi.stubEnv('WMS_OZON_MULTILINE_PICKING','false');
    await expect(tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device')).rejects.toThrow('поштучный');
    expect(f.db.systemSetting.update).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
  });
  // TEST: ordinary marked goods retain their existing path for a fabric-enabled client.
  it('leaves ordinary marked Ozon goods on the legacy path',async()=>{
    const f=fixture('OZON');Object.assign(f.sku,{name:'Платье',internalSku:'dress',needsChestnyZnak:true});
    expect(await tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device')).toEqual({handled:false});
    expect(f.db.systemSetting.update).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
  });
  // TEST: absent finished stock no longer prevents an order from reserving raw metres.
  it('assigns WB from raw rolls without creating finished AVAILABLE stock',async()=>{
    const f=fixture();const result=await tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device');
    expect(result.task.status).toBe('IN_PROGRESS');expect(result.task.barcode).toBeNull();
    expect(result.task.sourceArticle).toBe('__FABRIC_FBS__');expect(result.task.sourceBoxPending).toBe(false);
    expect(f.ledger().fbsReservations[0].units).toBe(2);expect(f.ledger().rolls[0].remainingMm).toBe(20000);
    expect(f.db.stockBalance.create).not.toHaveBeenCalled();
  });
  it('persists Ozon line proof even for a single product with multiple pieces',async()=>{
    const f=fixture('OZON');await tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device');
    const json=f.db.$executeRaw.mock.calls[0][2];const state=JSON.parse(json);
    expect(state.lines).toEqual([expect.objectContaining({quantity:2,skuId:'sku',requestItemId:'item',picks:[]})]);
  });
  it('leaves disabled installations on their old path without reads',async()=>{
    const f=fixture();vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','false');
    expect(await tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device')).toEqual({handled:false});
    expect(f.db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('never steals an in-progress fabric task',async()=>{
    const f=fixture();expect(await tryAssignFabricTask(f.service,'client',f.order,{status:'IN_PROGRESS'},f.user,'device')).toEqual({handled:true});
    expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
  });
  it('does not persist raw reservation if task claim loses its compare-and-set',async()=>{
    const f=fixture();await expect(tryAssignFabricTask(f.service,'client',f.order,{id:'old',status:'RELEASED'},f.user,'device')).rejects.toThrow('другим');
    expect(f.db.systemSetting.update).not.toHaveBeenCalled();
  });
  it('rejects missing capability, wrong warehouse and changed composition',async()=>{
    for(const change of [{tsdFabricCutConfirmation:false},{activeWarehouseId:'other'}]){
      const f=fixture();await expect(tryAssignFabricTask(f.service,'client',f.order,null,{...f.user,...change},'device')).rejects.toThrow();
      expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
    }
    const f=fixture('OZON');f.order.itemCount=3;
    await expect(tryAssignFabricTask(f.service,'client',f.order,null,f.user,'device')).rejects.toThrow('Состав');
  });
});
