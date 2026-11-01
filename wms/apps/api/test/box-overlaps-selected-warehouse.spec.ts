import 'reflect-metadata';
import {expect,it,vi} from 'vitest';
import {PickInstructionService} from '../src/modules/stock/pick-instruction.service';

// TEST: switching an administrator from all warehouses must not reuse the all-warehouse report.
it('scopes overlap boxes and every counter to the selected warehouse',async()=>{
  const rows=['moscow','noginsk'].flatMap(warehouseId=>[1,2].map(i=>({
    id:warehouseId+i,number:i,warehouseId,clientId:'c',client:{id:'c',name:'Клиент',code:'C'},
    status:'IN_WORK',title:'Заявка',items:[],files:[],createdAt:new Date(),destinationCity:null,
  })));
  const db={
    box:{findMany:vi.fn(async({where})=>[{clientId:'c',code:where.warehouseId+'-box'}])},
    clientRequest:{findMany:vi.fn(async({where})=>rows.filter(r=>!where.warehouseId||r.warehouseId===where.warehouseId))},
    stockMovement:{findMany:vi.fn(async()=>[])},
    clientRequestBoxSelection:{findMany:vi.fn(async({where})=>rows.filter(r=>where.requestItem.requestId.in.includes(r.id))
      .map(r=>({requestItem:{requestId:r.id},box:{code:r.warehouseId+'-box',warehouseId:r.warehouseId}})))},
  };
  const service=new PickInstructionService(db as never,{} as never);
  const user={permissionCodes:['system:admin'],roleCodes:['OWNER']};
  for(const warehouseId of [null,'moscow','noginsk',null]){
    const report=await service.getActiveRequestBoxOverlaps({...user,activeWarehouseId:warehouseId} as never);
    expect(report.overlaps.map(b=>b.boxCode).sort()).toEqual(warehouseId?[warehouseId+'-box']:['moscow-box','noginsk-box']);
    expect(report.activeRequestsCount).toBe(warehouseId?2:4);
    expect(report.checkedRequestsCount).toBe(report.activeRequestsCount);
    expect(report.requestsWithOverlapsCount).toBe(report.activeRequestsCount);
    expect(report.overlappingBoxesCount).toBe(report.overlaps.length);
    expect(report.errors).toEqual([]);
  }
});

it('excludes an old selection when both local requests still reference a box in another branch', async () => {
  const requests = [1, 2].map(number => ({id:String(number), number, clientId:'client', warehouseId:'moscow',
    status:'IN_WORK', items:[], files:[], client:{id:'client',name:'Клиент'}}));
  const db = {
    clientRequest:{findMany:async()=>requests}, stockMovement:{findMany:async()=>[]},
    clientRequestBoxSelection:{findMany:async()=>requests.map(r=>({requestItem:{requestId:r.id},box:{code:'NLKB_031'}}))},
    box:{findMany:vi.fn(async()=>[])},
  };
  const result = await new PickInstructionService(db as never,{} as never).getActiveRequestBoxOverlaps({
    permissionCodes:['system:admin'], roleCodes:['OWNER'], activeWarehouseId:'moscow',
  } as never);
  expect(db.box.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({warehouseId:'moscow'})}));
  expect(result).toMatchObject({activeRequestsCount:2,checkedRequestsCount:2,overlaps:[],requestsWithOverlapsCount:0,overlappingBoxesCount:0});
});
