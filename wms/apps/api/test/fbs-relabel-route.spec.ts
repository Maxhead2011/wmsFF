import {afterEach, expect, it, vi} from 'vitest';
import {findFbsRelabelRoute} from '../src/modules/marketplace-connections/fbs-relabel-route';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import * as routes from '../src/modules/marketplace-connections/fbs-relabel-route';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const input={clientId:'c',warehouseId:'w',skuId:'target',taskId:'t',quantity:2};
function fixture(){
 vi.stubEnv('WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED','true');
 const source=(id:string,quantity:number)=>({id,name:'source',article:id,barcodes:[{value:'old-barcode'}],balances:[{quantity,box:{id,code:id,warehouseId:'w',storagePlacement:{pallet:{code:'PL1'}}}}]});
 const db:any={client:{findUnique:vi.fn().mockResolvedValue({relabelingEnabled:true})},sku:{findFirst:vi.fn().mockResolvedValue({article:'target',size:'XS / 42'}),findMany:vi.fn().mockResolvedValue([source('a',3),source('b',4)])},clientArticleMapping:{findMany:vi.fn().mockResolvedValue([{sourceArticle:'old'}])}};
 return {db,source};
}
// TEST: exhausted first source cannot hide a second source, and reservations are subtracted by box.
it('finds another mapped source with enough free units for the whole order',async()=>{
 const f=fixture();const result=await findFbsRelabelRoute(f.db,input,async sku=>[{boxId:sku,itemCount:sku==='a'?2:1}]);
 expect(result?.sourceSkuId).toBe('b');expect(result?.boxes[0].freeQuantity).toBe(3);
 expect(f.db.sku.findMany.mock.calls[0][0].where).toMatchObject({clientId:'c',size:{equals:'XS / 42'},id:{not:'target'}});
 expect(f.db.sku.findMany.mock.calls[0][0].select.balances.where).toMatchObject({warehouseId:'w',status:'AVAILABLE',box:{clientId:'c',warehouseId:'w',status:{notIn:['deleted','archived']}}});
});
// TEST: sold installations, disabled mapping and ambiguous sizes do not enable a new source.
it.each(['flag','disabled','size','warehouse','mapping','reserved','location'])('does not invent a route: %s',async kind=>{
 const f=fixture();let args={...input};
 if(kind==='flag')vi.stubEnv('WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED','false');
 if(kind==='disabled')f.db.client.findUnique.mockResolvedValue({relabelingEnabled:false});
 if(kind==='size')f.db.sku.findFirst.mockResolvedValue({article:'target',size:null});
 if(kind==='warehouse')args.warehouseId=null as any;
 if(kind==='mapping')f.db.clientArticleMapping.findMany.mockResolvedValue([]);
 if(kind==='location'){const s=f.source('a',9);s.balances[0].box.storagePlacement=null as any;f.db.sku.findMany.mockResolvedValue([s]);}
 expect(await findFbsRelabelRoute(f.db,args,async sku=>kind==='reserved'?[{boxId:sku,itemCount:9}]:[])).toBeNull();
 if(kind==='flag')expect(f.db.client.findUnique).not.toHaveBeenCalled();
});
function serviceFixture(){
 vi.stubEnv('WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED','true');
 const task:any={id:'t',requestId:'r',connectionId:'conn',orderId:'o',skuId:'target',sourceSkuId:null,itemCount:2,status:'WAITING_STOCK',boxId:null,barcode:null,kiz:null,sourceBarcode:null,relabelConfirmedAt:null,updatedAt:new Date()};
 const request:any={id:'r',number:1,clientId:'c',warehouseId:'w',type:'OUTBOUND',status:'IN_WORK',client:{storesWithoutBoxes:false},fbsOrderLinks:[{marketplace:'WILDBERRIES',connectionId:'conn',orderId:'o',lastSkuId:'target',lastItemCount:2}],items:[{id:'i',skuId:'target',sku:{id:'target',name:'target',article:'target',barcodes:[]}}]};
 const db:any={clientRequest:{findUnique:vi.fn().mockResolvedValue(request)},fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([task]),updateMany:vi.fn().mockResolvedValue({count:1})},stockBalance:{findMany:vi.fn().mockResolvedValue([])},clientRequestEvent:{create:vi.fn()}};
 const svc:any=new MarketplaceConnectionsService(db,{requireClientAccess:vi.fn()} as any);
 vi.spyOn(svc,'getFbsRequestRoute').mockResolvedValue({version:1,boxes:[]});vi.spyOn(svc,'fbsTsdReservationRows').mockResolvedValue([]);
 const lock=vi.spyOn(svc,'withActivePalletSortBoxLock').mockImplementation(async (_:any,run:any)=>run(db));
 vi.spyOn(routes,'findFbsRelabelRoute').mockResolvedValue({sourceSkuId:'source',sourceProductName:'old',sourceArticle:'old',sourceBarcodes:['old-barcode'],boxes:[{id:'box',code:'BOX',warehouseId:'w',palletCode:'PL1',quantity:3,freeQuantity:3}]});
 return {task,db,svc,lock};
}
// TEST: reproduces WAITING_STOCK + null source despite mapped stock; metadata and reservation commit together.
it('repairs a direct-only waiting task through the existing reservation lock',async()=>{
 const f=serviceFixture();const result=await f.svc.repairFbsRequestSelection('r',{id:'admin'});
 expect(result.reservedTasks).toBe(1);expect(f.lock).toHaveBeenCalledWith(expect.objectContaining({skuId:'source',requiredQuantity:2,excludeTaskId:'t'}),expect.any(Function));
 expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({where:expect.objectContaining({updatedAt:f.task.updatedAt,kiz:null,sourceBarcode:null}),data:expect.objectContaining({sourceSkuId:'source',relabelRequired:true,sourceBarcodes:['old-barcode'],reservedBoxCode:'BOX',status:'RESERVED'})}));
});
// TEST: a box archived or reserved concurrently cannot save relabel metadata or a misleading route.
it('keeps waiting when the locked recheck rejects the source box',async()=>{
 const f=serviceFixture();f.lock.mockResolvedValue(null);await f.svc.repairFbsRequestSelection('r',{id:'admin'});
 const data=f.db.fbsTsdAssembly.updateMany.mock.calls.at(-1)[0].data;
 expect(data.status).toBe('WAITING_STOCK');expect(data.storageBoxes).toEqual([]);expect(data.sourceSkuId).toBeUndefined();
});
// TEST: physical scans always win over route repair.
it('does not change a task whose physical picking has started',async()=>{
 const f=serviceFixture();f.task.kiz='SCANNED';await f.svc.repairFbsRequestSelection('r',{id:'admin'});
 expect(routes.findFbsRelabelRoute).not.toHaveBeenCalled();expect(f.lock).not.toHaveBeenCalled();
});

// TEST: an explicitly approved duplicate source restricts the candidate query.
it('restricts relabel stock to the exact approved duplicate source',async()=>{
 const f=fixture();
 f.db.sku.findMany.mockResolvedValue([f.source('a',1)]);
 expect(await findFbsRelabelRoute(f.db,{...input,exactSourceId:'a'},async()=>[])).toBeNull();
 expect(f.db.sku.findMany.mock.calls[0][0].where.id).toEqual({equals:'a',not:'target'});
});
