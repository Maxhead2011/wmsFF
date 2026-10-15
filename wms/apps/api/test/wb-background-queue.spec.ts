import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../src/common/reconciliation/queue',()=>({runReconciliationJobs:vi.fn(async(_db,jobs)=>jobs)}));
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({finalizeWbOrderShipment:vi.fn()}));
vi.mock('../src/common/stock/fbs-request-auto-status',()=>({reconcileFbsRequestStatus:vi.fn()}));
import {reconcileWbBackground} from '../src/common/reconciliation/wb-background';
import {finalizeWbOrderShipment} from '../src/common/stock/wb-order-stock-lifecycle';
afterEach(()=>{vi.clearAllMocks();delete process.env.WMS_DONE_PACKING_RECONCILIATION_ENABLED;});
const task={id:'t',requestId:'r',connectionId:'c',orderId:'o',stockWarehouseId:'w',skuId:'sku',completedAt:null};
function database(facts:any[]=[],prints:any[]=[]){const db:any={fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([task]),findUniqueOrThrow:vi.fn().mockResolvedValue(task)},wbOrderShipment:{findMany:vi.fn().mockResolvedValue(facts)},stockBalance:{groupBy:vi.fn().mockResolvedValue([])},stockMovement:{groupBy:vi.fn().mockResolvedValue([])},clientRequest:{findMany:vi.fn().mockResolvedValue([{id:'r',status:'IN_WORK',warehouseId:'w'}])},fbsPrintJob:{findMany:vi.fn().mockResolvedValue(prints)},$executeRawUnsafe:vi.fn()};db.$transaction=vi.fn(f=>f(db));return db;}
// TEST: scheduling never invents shipment evidence or changes the physical finalizer.
it('does not queue an ordinary unshipped task',async()=>{const db=database();const jobs=await reconcileWbBackground(db,'client',[],vi.fn(),vi.fn());expect(jobs).toEqual([]);expect(db.$transaction).not.toHaveBeenCalled();});
it('does not replay recorded shipment facts',async()=>{const db=database([{assemblyId:'t'}]);const jobs=await reconcileWbBackground(db,'client',[{connectionId:'c',id:'o',category:'shipped'}],vi.fn(),vi.fn());expect(jobs).toEqual([]);expect(db.$transaction).not.toHaveBeenCalled();});
it('retains print timestamp and transaction in the due callback',async()=>{const date=new Date();const db=database([],[{assemblyId:'t',printedAt:date}]);const order={id:'o'};const jobs:any=await reconcileWbBackground(db,'client',[],vi.fn().mockResolvedValue(order),vi.fn());expect(jobs).toHaveLength(1);expect(db.$transaction).not.toHaveBeenCalled();await jobs[0].run();expect(finalizeWbOrderShipment).toHaveBeenCalledWith(db,'t','PRINT_CONFIRMED',order,date);});
