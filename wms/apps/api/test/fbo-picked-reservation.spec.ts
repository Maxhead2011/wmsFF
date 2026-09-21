import { describe, expect, it, afterEach, vi } from 'vitest';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';
import { WmsStockAvailabilityService } from '../src/modules/stock/wms-stock-availability.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: real reservation code with movement fixtures filtered by the query's type/status.
function fixture(moves:any[],status='PACKED') { return {
 client:{findUnique:async()=>({id:'c',stockBalanceMode:'BOXES'})},
 sku:{findMany:async()=>[{id:'sku',barcodes:[{value:'123',isPrimary:true}]}]},
 fbsTsdAssembly:{findMany:async()=>[]},
 clientRequest:{findMany:async({where}:any)=>where.status.in.includes(status)?[{id:'r',items:[{skuId:'sku',quantity:5}]}]:[]},
 clientRequestItem:{groupBy:async()=>[{requestId:'r',skuId:'sku',_sum:{quantity:5}}]},
 stockBalance:{groupBy:async()=>[{skuId:'sku',_sum:{quantity:10}}]},
 stockMovement:{groupBy:async({where}:any)=>[{sourceDocument:'r',skuId:'sku',_sum:{quantity:moves.filter(m=>m.status===where.status&&(!where.type||where.type.in.includes(m.type))).reduce((s,m)=>s+m.quantity,0)}}]},
}; }
const move=(quantity:number,status='AVAILABLE',type='MOVE')=>({quantity,status,type});
describe('FBO physical reserve',()=>{
 it.each([
  ['partial',[move(-3)],2],['packed',[move(-5),move(5,'PACKING'),move(-5,'PACKING','PACK')],0],
  ['returned',[move(-5),move(1,'AVAILABLE','RETURN')],1],['storage transfer',[move(-5),move(5)],5],
 ])('%s',async(_name,moves,expected)=>expect((await wbReservationQuantities(fixture(moves as any[]) as never,'c',['sku'],'w')).get('sku')).toBe(expected));
 it('DONE does not reserve',async()=>expect((await wbReservationQuantities(fixture([],'DONE') as never,'c',['sku'],'w')).get('sku')).toBe(0));
 it.each([['true',0],['false',5]])('snapshot rollout %s',async(flag,reserved)=>{
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED',flag as string);
  const service=new WmsStockAvailabilityService(fixture([move(-5),move(5,'PACKING'),move(-5,'PACKING','PACK')]) as never,{requireClientAccess:()=>{}} as never,{get:()=>1000} as never);
  expect((await service.snapshot('c',{roleCodes:['OWNER'],permissionCodes:[]} as never,{warehouseId:'w'})).rows[0]).toEqual({barcode:'123',total:10,reserved,available:10-Number(reserved)});
 });
});
