import {describe,it,expect,vi} from 'vitest';
import {releaseFabricTask,releaseCancelledFabricOrder} from './fabric-fbs-task-release';
import {reserveFabricOrder,confirmFabricOrderCut} from './fabric-fbs-order';
function fixture(){
  const task:any={id:'task',clientId:'client',requestId:'req',marketplace:'OZON',connectionId:'shop',orderId:'order',sourceArticle:'__FABRIC_FBS__',status:'IN_PROGRESS',workerUserId:'worker',deviceCode:'device',barcode:'123'};
  const request={id:'req',clientId:'client',status:'SUBMITTED'};
  let ledger=confirmFabricOrderCut(reserveFabricOrder({rolls:[{id:'roll',warehouseId:'warehouse',material:'SATIN',color:'white',remainingMm:10000,cutMm:0,createdAt:'2026-11-05'}]},task,
    [{lineId:'item',skuId:'sku',warehouseId:'warehouse',material:'SATIN',color:'white',lengthMm:3000,units:2}]),task,'item',1,'op').state;
  const db:any={$queryRaw:vi.fn().mockResolvedValue([{locked:true}]),clientRequest:{findUnique:vi.fn(async()=>request)},
    systemSetting:{findUnique:vi.fn(async()=>({value:ledger})),update:vi.fn(async({data}:any)=>{ledger=data.value;})},
    fbsTsdAssembly:{findUnique:vi.fn(async()=>task),update:vi.fn(async({data}:any)=>Object.assign(task,data))},clientRequestEvent:{create:vi.fn()}};
  db.$transaction=async(fn:any)=>fn(db);return {db,task,request,ledger:()=>ledger};
}
describe('fabric task postponement and cancellation',()=>{
  // TEST: marketplace cancellation releases uncut metres even before WMS status changes.
  it('releases only this cancelled order and reports an already scanned cut',async()=>{
    const f=fixture();
    expect(await releaseCancelledFabricOrder(f.db,f.task)).toBe(true);
    expect(f.ledger().fbsReservations![0]).toMatchObject({released:true,confirmedUnits:1});
    expect(f.ledger().rolls[0].remainingMm).toBe(7000);
    expect(await releaseCancelledFabricOrder(f.db,f.task)).toBe(true);
    expect(f.ledger().rolls[0].remainingMm).toBe(7000);
  });
  it('does not read or change fabric for an ordinary order',async()=>{
    const f=fixture();f.task.sourceArticle='ordinary';
    expect(await releaseCancelledFabricOrder(f.db,f.task)).toBe(false);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.db.systemSetting.update).not.toHaveBeenCalled();
  });
  // TEST: partial manufacture survives changing worker without returning metres to the roll.
  it('postpones without clearing scan or raw reserve',async()=>{
    const f=fixture();await releaseFabricTask(f.db,f.task,'POSTPONE',{id:'worker',deviceCode:'device'});
    expect(f.task.status).toBe('RELEASED');expect(f.task.barcode).toBe('123');
    expect(f.ledger().rolls[0].remainingMm).toBe(7000);expect(f.ledger().fbsReservations![0].released).toBe(false);
  });
  it('closed request frees only the uncut commitment and parks produced goods for review',async()=>{
    const f=fixture();f.request.status='CANCELLED';await releaseFabricTask(f.db,f.task,'CLOSED_REQUEST');
    expect(f.task.status).toBe('RETURN_REQUIRED');expect(f.ledger().rolls[0].remainingMm).toBe(7000);
    expect(f.ledger().fbsReservations![0]).toMatchObject({released:true,confirmedUnits:1});
  });
  it('does not cancel an open request or release another worker task',async()=>{
    const f=fixture();expect(await releaseFabricTask(f.db,f.task,'CLOSED_REQUEST')).toBe(false);
    await expect(releaseFabricTask(f.db,f.task,'POSTPONE',{id:'other',deviceCode:'device'})).rejects.toThrow('изменилось');
    expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
  });
  // TEST: cancellation after postponement must release the remaining reservation.
  it('releases a postponed task on cancellation and tolerates a retry',async()=>{
    const f=fixture();
    await releaseFabricTask(f.db,f.task,'POSTPONE',{id:'worker',deviceCode:'device'});
    f.request.status='CANCELLED';
    await releaseFabricTask(f.db,f.task,'CLOSED_REQUEST');
    expect(f.ledger().fbsReservations![0]).toMatchObject({released:true,confirmedUnits:1});
    expect(f.ledger().rolls[0].remainingMm).toBe(7000);
    const events=f.db.clientRequestEvent.create.mock.calls.length;
    await releaseFabricTask(f.db,f.task,'CLOSED_REQUEST');
    expect(f.db.clientRequestEvent.create).toHaveBeenCalledTimes(events);
    expect(f.ledger().rolls[0].remainingMm).toBe(7000);
  });
});
