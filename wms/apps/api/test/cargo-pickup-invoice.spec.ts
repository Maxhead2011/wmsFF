import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';

function fixture() {
  process.env.WMS_CARGO_PICKUP_ENABLED='true';
  const rows:any[]=[{id:'a',payload:{clientId:'c',warehouseId:'w',arrivalDate:'2026-10-02',ourDelivery:true,deliveryCostRub:1200,status:'ACTIVE'},createdAt:new Date(),userId:'u'},
    {id:'b',payload:{clientId:'c',warehouseId:'w',arrivalDate:'2026-10-01',ourDelivery:true,deliveryCostRub:800,status:'ACTIVE'},createdAt:new Date(),userId:'u'}];
  let active=false;
  const db:any={auditLog:{create:vi.fn(async()=>({})),findMany:vi.fn(async()=>rows),findUnique:vi.fn(async({where}:any)=>rows.find(r=>r.id===where.id)),update:vi.fn(async({where,data}:any)=>Object.assign(rows.find(r=>r.id===where.id),data))},
    billingInvoiceItem:{findMany:vi.fn(async()=>[])},billingService:{upsert:vi.fn(async()=>({id:'service'}))},billingInvoice:{findFirst:vi.fn(async()=>active?{id:'invoice'}:null)},$queryRaw:vi.fn(async()=>[])};
  db.$transaction=vi.fn(async(fn:any)=>fn(db));
  for(const row of rows)row.entity='goods-arrival';
  const billing={createManualInvoice:vi.fn(async(..._args:any[])=>{active=true;return {id:'invoice',number:'1'};})};
  const scopes={requireClientAccess:vi.fn()};
  const service=new WarehouseService(db,scopes as any,{} as any,{} as any,{} as any,billing as any,{} as any);
  const user:any={id:'u',name:'Admin',roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
  return {service,user,db,billing,rows,scopes,cancel:()=>{active=false;}};
}
describe('cargo invoice sources',()=>{
  const old=process.env.WMS_CARGO_PICKUP_ENABLED;
  afterEach(()=>{if(old===undefined)delete process.env.WMS_CARGO_PICKUP_ENABLED;else process.env.WMS_CARGO_PICKUP_ENABLED=old;});
  // TEST: separate dated lines; source links and invoice share financial transaction.
  it('creates chronological lines and refuses duplicate billing',async()=>{
    const f=fixture();await f.service.billCargoPickups({clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'},f.user);
    expect(f.billing.createManualInvoice.mock.calls[0][0]).toMatchObject({comment:'Забор товара с карго',rows:[{serviceDate:'2026-10-01',unitPriceRub:800,quantity:1},{serviceDate:'2026-10-02',unitPriceRub:1200,quantity:1}]});
    expect(f.db.auditLog.update).toHaveBeenCalledTimes(2);
    await expect(f.service.billCargoPickups({clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'},f.user)).rejects.toThrow();
    expect(f.billing.createManualInvoice).toHaveBeenCalledTimes(1);
  });
  it('excludes other dates, legacy and other-warehouse arrivals',async()=>{
    const f=fixture();f.rows[0].payload.ourDelivery=false;f.rows[1].payload.warehouseId='other';
    await expect(f.service.billCargoPickups({clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'},f.user)).rejects.toThrow();
    expect(f.billing.createManualInvoice).not.toHaveBeenCalled();
  });
  it('releases a cancelled invoice for rebilling',async()=>{
    const f=fixture();const dto={clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'};
    await f.service.billCargoPickups(dto,f.user);f.cancel();await f.service.billCargoPickups(dto,f.user);
    expect(f.billing.createManualInvoice).toHaveBeenCalledTimes(2);
  });
  it('never links sources when invoice creation fails',async()=>{
    const f=fixture();f.billing.createManualInvoice.mockRejectedValueOnce(new Error('failed'));
    await expect(f.service.billCargoPickups({clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'},f.user)).rejects.toThrow('failed');
    expect(f.db.auditLog.update).not.toHaveBeenCalled();
  });
  it('edits delivery with history but blocks edits after billing',async()=>{
    const f=fixture();await f.service.updateCargoPickup('a',{ourDelivery:true,deliveryCostRub:500},f.user);
    expect(f.rows[0].payload.deliveryCostRub).toBe(500);expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
    await f.service.billCargoPickups({clientId:'c',periodFrom:'2026-10-01',periodTo:'2026-10-02'},f.user);
    await expect(f.service.updateCargoPickup('a',{ourDelivery:false},f.user)).rejects.toThrow();
  });
  it('rejects client and out-of-scope edits',async()=>{
    const f=fixture();await expect(f.service.updateCargoPickup('a',{ourDelivery:false},{...f.user,roleCodes:['CLIENT']})).rejects.toThrow();
    await expect(f.service.updateCargoPickup('a',{ourDelivery:false},{...f.user,activeWarehouseId:'other'})).rejects.toThrow();
  });
});
