import { describe, it, expect, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

// TEST: physical FBS pickup must not be deducted again during request closure.
describe('closing FBS without consuming AVAILABLE twice', () => {
  function setup() {
    const sku = {id:'s',internalSku:'SKU',weightGrams:1};
    const box = {id:'b',code:'BOX',warehouseId:'w',palletId:null};
    const available = {id:'av',skuId:'s',clientId:'c',warehouseId:'w',boxId:'b',palletId:null,status:'AVAILABLE',quantity:2,updatedAt:new Date(),box};
    const balances:any[]=[available];
    const rows:any[]=[{id:'pick',clientId:'c',warehouseId:'w',skuId:'s',boxId:'b',palletId:null,status:'AVAILABLE',quantity:-1,idempotencyKey:'fbs-sticker-pick:t:av:out'}];
    const tx:any={
      fbsTsdAssembly:{findMany:vi.fn(async()=>[{id:'t',requestId:'r',requestItemId:'i',clientId:'c',skuId:'s',boxId:'b',itemCount:1,status:'COMPLETED',completedAt:new Date()}])},
      stockMovement:{findMany:vi.fn(async({where}:any)=>where.type==='INVENTORY_ADJUSTMENT'?[]:rows),create:vi.fn(async({data}:any)=>{rows.push(data);return data;})},
      stockBalance:{findMany:vi.fn(async({where}:any)=>balances.filter(b=>typeof where.status==='string'?b.status===where.status:!where.status?.in||where.status.in.includes(b.status))),
        upsert:vi.fn(async({create}:any)=>{const row={...create,id:'process',box};balances.push(row);return row;}),update:vi.fn(),delete:vi.fn()},
      box:{findMany:vi.fn(async()=>[box]),findUnique:vi.fn(async()=>box)},
      sku:{findUnique:vi.fn(async()=>sku),findFirst:vi.fn(async()=>sku)},
      fbsOrderRequestLink:{findMany:vi.fn(async()=>[])},
    };
    const service:any=new StockOperationsService(tx,{} as any,{balanceKey:({status}:any)=>status} as any);
    const request={id:'r',clientId:'c',items:[{id:'i',skuId:'s',barcode:null,quantity:1}]};
    const selections=[{id:'sel',requestItemId:'i',skuId:'s',boxId:'b',quantity:1,box}];
    return {service,tx,request,selections,balances,rows};
  }
  it.each(['saved','no selections','physical box','no box'])('uses recorded pick with %s', async mode=>{
    const f=setup();
    const sources=mode==='physical box'?[{requestItemId:'i',boxCode:'BOX',quantity:1}]:mode==='no box'?[{requestItemId:'i',noBox:true,quantity:1}]:[];
    const plan=await f.service.planFbsSafeManualShipment(f.tx,f.request,mode==='no selections'?[]:f.selections,sources,'close','w');
    expect(plan.lines[0].requestedQuantity).toBe(1);
    expect(plan.lines[0].allocations.every((a:any)=>a.balance.status!=='AVAILABLE')).toBe(true);
    expect(f.tx.stockBalance.update).not.toHaveBeenCalled();
    expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(f.rows.some(r=>r.status==='AVAILABLE'&&r.idempotencyKey!=='fbs-sticker-pick:t:av:out')).toBe(false);
  });
  // TEST: one picked unit must not hide a still-unpicked unit of the same SKU.
  it.each([false, true])('allocates mixed picked/unpicked quantities, existing process=%s', async existing => {
    const f=setup(); f.request.items[0].quantity=2; f.selections[0].quantity=2;
    if(existing) f.balances.push({...f.balances[0],id:'packing',status:'PACKING',quantity:1});
    const plan=await f.service.planFbsSafeManualShipment(f.tx,f.request,f.selections,[],'close','w');
    expect(plan.lines[0].requestedQuantity).toBe(2);
    expect(plan.lines[0].allocations.filter((a:any)=>a.balance.status==='AVAILABLE').reduce((s:number,a:any)=>s+a.quantity,0)).toBe(1);
    expect(plan.lines[0].allocations.reduce((s:number,a:any)=>s+a.quantity,0)).toBe(2);
  });
  it('coalesces two completed orders using the same process balance', async()=>{
    const f=setup(); f.request.items[0].quantity=2;
    const task=(await f.tx.fbsTsdAssembly.findMany())[0];
    f.tx.fbsTsdAssembly.findMany.mockResolvedValue([task,{...task,id:'t2'}]);
    f.rows.push({...f.rows[0],id:'pick2',idempotencyKey:'fbs-sticker-pick:t2:av:out'});
    f.balances.push({...f.balances[0],id:'packing',status:'PACKING',quantity:2});
    const plan=await f.service.planFbsSafeManualShipment(f.tx,f.request,[],[],'close','w');
    expect(plan.lines[0].allocations).toHaveLength(1);
    expect(plan.lines[0].allocations[0].quantity).toBe(2);
  });
  it.each(['ensureAvailableStockIsInPacking','ensurePackedStockIsInShipping'])('protects the ordinary preparation path %s', async method=>{
    const f=setup();
    f.service.applyStatusMove=vi.fn();
    await f.service[method](f.tx,f.request,'prepare','w');
    for(const [,input] of f.service.applyStatusMove.mock.calls) {
      expect(input.sourceStatus).not.toBe('AVAILABLE');
    }
    expect(f.rows.filter(r=>r.status==='AVAILABLE')).toHaveLength(1);
    expect(f.tx.stockBalance.update).not.toHaveBeenCalled();
  });
  it('preserves normal non-FBS closing',async()=>{
    const f=setup();f.tx.fbsTsdAssembly.findMany.mockResolvedValue([]);
    const plan=await f.service.planFbsSafeManualShipment(f.tx,f.request,[],[],'close','w');
    expect(plan.lines[0].allocations[0].balance.status).toBe('AVAILABLE');
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('rejects invalid confirmation before any reconciliation write',async()=>{
    const f=setup();
    await expect(f.service.planFbsSafeManualShipment(f.tx,f.request,[],[{requestItemId:'i',noBox:true,quantity:2}],'close','w')).rejects.toThrow();
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });
});
