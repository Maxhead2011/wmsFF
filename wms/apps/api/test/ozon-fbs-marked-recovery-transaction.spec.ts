import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {recoverOzonMarkedPacking} from '../src/modules/marketplace-connections/ozon-fbs-marked-recovery';
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({wbReservationQuantities:vi.fn(async()=>new Map())}));
vi.mock('../src/common/kiz-client-review',()=>({
 clientPhysicalMark:vi.fn(async()=>null),assertClientKizUse:vi.fn(async()=> 'ALLOW'),refreshClientKizClaim:vi.fn(async()=>{}),
}));
import {assertClientKizUse} from '../src/common/kiz-client-review';
const units=[
 {productId:1,skuId:'small',barcode:'4610460840526',kiz:'0104610460840526215OdGM-'},
 {productId:2,skuId:'large',barcode:'4610460840540',kiz:'0104610460840540215K.W,b'},
];
const input={taskId:'task',operationKey:'recovery',reason:'Owner confirmed physical packing',units};
const user={id:'owner',roleCodes:['OWNER'],activeWarehouseId:'wh'};
function fixture(){
 let state:any=null;
 const task:any={id:'task',clientId:'client',marketplace:'OZON',requestId:'request',requestItemId:'item',skuId:'small',connectionId:'connection',orderId:'order',itemCount:2,status:'IN_PROGRESS'};
 const request:any={id:'request',clientId:'client',warehouseId:'wh',type:'OUTBOUND',status:'SUBMITTED',items:[{id:'item',skuId:'small',quantity:2}]};
 const db:any={
  $queryRaw:vi.fn(async(strings:any)=>String(strings).includes('OzonFbsPickState')&&state?[{data:state}]:[]),
  $executeRaw:vi.fn(async(strings:any,...values:any[])=>{if(String(strings).includes('OzonFbsPickState'))state=JSON.parse(values[1]);return 1;}),
  fbsTsdAssembly:{findUnique:vi.fn(async()=>({...task})),findMany:vi.fn(async()=>[task]),update:vi.fn(async({data}:any)=>Object.assign(task,data))},
  clientRequest:{findUnique:vi.fn(async()=>structuredClone(request)),update:vi.fn(async({data}:any)=>Object.assign(request,data))},
  fbsOrderRequestLink:{findMany:vi.fn(async()=>[{orderId:'order',connectionId:'connection'}])},
  stockMovement:{findFirst:vi.fn(async()=>null),create:vi.fn()},
  clientRequestBoxSelection:{findFirst:vi.fn(async()=>null)},clientRequestPackage:{findFirst:vi.fn(async()=>null)},
  inventorySession:{findFirst:vi.fn(async()=>null)},
  sku:{findMany:vi.fn(async()=>units.map((u,n)=>({id:u.skuId,clientId:'client',name:u.skuId,barcodes:[{value:u.barcode},{value:'offer'+(n+1)}]})))},
  stockBalance:{findMany:vi.fn(async()=>[{quantity:10,boxId:null,palletId:null}]),update:vi.fn()},
  clientRequestItem:{update:vi.fn(async({data}:any)=>Object.assign(request.items[0],data)),create:vi.fn(async({data}:any)=>{const row={id:'item2',...data};request.items.push(row);return row;})},
  productMark:{create:vi.fn(async({data}:any)=>({id:'mark-'+data.skuId,...data}))},
  clientRequestEvent:{create:vi.fn()},auditLog:{create:vi.fn()},
 };
 db.$transaction=vi.fn(async(fn:any)=>fn(db));
 const service={prisma:db,clientScopes:{requireClientAccess:vi.fn()},readOzonFbsPickPosting:vi.fn(async()=>({posting_number:'order',status:'awaiting_deliver',products:units.map((u,n)=>({sku:u.productId,offer_id:'offer'+(n+1),quantity:1}))})),submitOzon:vi.fn()};
 return {db,service,task,request,state:()=>state};
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(assertClientKizUse).mockResolvedValue('ALLOW');for(const flag of ['WMS_OZON_UNIT_MARKS_ENABLED','WMS_OZON_MULTILINE_PICKING','WMS_KIZ_CLIENT_GUARD_ENABLED'])vi.stubEnv(flag,'true');});
afterEach(()=>vi.unstubAllEnvs());
// TEST: restore physical evidence once; neither marketplace submission nor stock debit is packing.
it('records both marks and corrected items once, retaining stock for handover',async()=>{
 const f=fixture();expect(await recoverOzonMarkedPacking(f.service,input,user)).toMatchObject({status:'APPLIED',units:2});
 expect(f.request.items.map((i:any)=>[i.skuId,i.quantity])).toEqual([['small',1],['large',1]]);
 expect(f.state().lines.map((l:any)=>l.picks[0].kiz)).toEqual(units.map(u=>u.kiz));
 expect(f.task).toMatchObject({status:'COMPLETED',stockWarehouseId:'wh',sourceBoxPending:false});
 expect(f.request.status).toBe('PACKED');
 // TEST: selections belong to request items, not directly to requests.
 expect(f.db.clientRequestBoxSelection.findFirst).toHaveBeenCalledWith({where:{requestItem:{requestId:'request'}}});
 expect(await recoverOzonMarkedPacking(f.service,input,user)).toMatchObject({status:'ALREADY_APPLIED'});
 expect(f.db.productMark.create).toHaveBeenCalledTimes(2);expect(f.db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
 expect(f.db.stockMovement.create).not.toHaveBeenCalled();expect(f.db.stockBalance.update).not.toHaveBeenCalled();expect(f.service.submitOzon).not.toHaveBeenCalled();
 expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable',timeout:30000});
});
it('rejects changed retry composition without new writes',async()=>{
 const f=fixture();await recoverOzonMarkedPacking(f.service,input,user);
 await expect(recoverOzonMarkedPacking(f.service,{...input,units:units.slice(0,1)},user)).rejects.toThrow('другим составом');
 expect(f.db.productMark.create).toHaveBeenCalledTimes(2);
});
it.each(['role','warehouse','balance','movement'])('fails closed on %s',async(kind)=>{
 const f=fixture(),actor={...user};
 if(kind==='role')actor.roleCodes=['WORKER'];if(kind==='warehouse')actor.activeWarehouseId='other';
 if(kind==='balance')f.db.stockBalance.findMany.mockResolvedValue([]);
 if(kind==='movement')f.db.stockMovement.findFirst.mockResolvedValue({id:'old'});
 await expect(recoverOzonMarkedPacking(f.service,input,actor)).rejects.toThrow();
 expect(f.db.productMark.create).not.toHaveBeenCalled();expect(f.db.clientRequestItem.update).not.toHaveBeenCalled();
});
it('does not complete packing if the second mark is refused',async()=>{
 const f=fixture();vi.mocked(assertClientKizUse).mockResolvedValueOnce('ALLOW').mockRejectedValueOnce(new Error('historical shipment'));
 await expect(recoverOzonMarkedPacking(f.service,input,user)).rejects.toThrow('historical shipment');
 expect(f.db.clientRequest.update).not.toHaveBeenCalled();expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
});
it('does not run on installations without the per-unit feature',async()=>{
 const f=fixture();vi.stubEnv('WMS_OZON_UNIT_MARKS_ENABLED','false');
 await expect(recoverOzonMarkedPacking(f.service,input,user)).rejects.toThrow('не включён');
 expect(f.service.readOzonFbsPickPosting).not.toHaveBeenCalled();expect(f.db.$transaction).not.toHaveBeenCalled();
});
