import {afterEach,expect,it,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {PalletSortingService} from '../src/modules/inventory/pallet-sorting.service';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('WMS_PALLET_SORTING_ENABLED','true');
 const request:any={id:'r',number:536,type:'OUTBOUND',status:'IN_WORK',clientId:'c',warehouseId:'w',fbsOrderLinks:[]};
 const task:any={id:'t',clientId:'c',requestId:'r',marketplace:'WILDBERRIES',connectionId:'conn',orderId:'order',status:'WAITING_STOCK',barcode:null,kiz:null,sourceBarcode:null,relabelConfirmedAt:null,boxId:null};
 const link:any={clientId:'c',requestId:'r',marketplace:'WILDBERRIES',connectionId:'conn',orderId:'order',lastSupplierStatus:'complete',lastWbStatus:'waiting'};
 const db:any={clientRequest:{findUnique:vi.fn().mockResolvedValue(request)},fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([task]),updateMany:vi.fn()},fbsOrderRequestLink:{findMany:vi.fn().mockResolvedValue([link])},stockMovement:{create:vi.fn()},stockBalance:{findMany:vi.fn()}};
 const service:any=Object.create(MarketplaceConnectionsService.prototype);service.prisma=db;service.clientScopes={requireClientAccess:vi.fn()};
 return {service,db,request,task,link,user:{id:'admin',roleCodes:['ADMIN'],activeWarehouseId:'w'}};
}
it.each(['complete','cancel'])('finishes a sorting retry for terminal WB status %s without rerouting or stock writes',async status=>{
 // TEST: request 536 is FBS but has no confirm links, so there is nothing to route.
 const f=fixture();f.link.lastSupplierStatus=status;
 const result=await f.service.repairFbsRequestSelection('r',f.user,['t']);
 expect(result.skippedTaskIds).toEqual(['t']);
 expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();expect(f.db.stockMovement.create).not.toHaveBeenCalled();expect(f.db.stockBalance.findMany).not.toHaveBeenCalled();
});
it.each(['wrong-client','wrong-warehouse','non-outbound','missing-link','unknown-status','active-order','wrong-order','missing-task','foreign-task','physical-scan','non-admin','disabled'])('does not silently skip %s',async kind=>{
 const f=fixture();
 if(kind==='wrong-client')f.link.clientId='other';
 if(kind==='wrong-warehouse')f.request.warehouseId='other';
 if(kind==='non-outbound')f.request.type='SKU_COLLECTION';
 if(kind==='missing-link')f.db.fbsOrderRequestLink.findMany.mockResolvedValue([]);
 if(kind==='unknown-status')f.link.lastSupplierStatus=null;
 if(kind==='active-order')f.link.lastSupplierStatus='confirm';
 if(kind==='wrong-order')f.link.orderId='other';
 if(kind==='missing-task')f.db.fbsTsdAssembly.findMany.mockResolvedValue([]);
 if(kind==='foreign-task')f.task.clientId='other';
 if(kind==='physical-scan')f.task.kiz='scanned';
 if(kind==='non-admin')f.user.roleCodes=['WORKER'];
 if(kind==='disabled')vi.stubEnv('WMS_PALLET_SORTING_ENABLED','false');
 await expect(f.service.repairFbsRequestSelection('r',f.user,['t'])).rejects.toThrow();
 expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
});
it('keeps ordinary whole-request repair strict',async()=>{
 const f=fixture();await expect(f.service.repairFbsRequestSelection('r',f.user)).rejects.toThrow('FBS');
 expect(f.db.fbsOrderRequestLink.findMany).not.toHaveBeenCalled();
});
it.each([false,true])('clears a terminal route retry while respecting a concurrent revision: %s',async concurrent=>{
 // TEST: exercise both services; never remove newer pending work or repeat inventory receipt.
 const f=fixture();
 const pending={requestId:'r',taskIds:['t'],revision:46,error:'old failure'};
 const snapshot={id:'session',clientId:'c',warehouseId:'w',version:83,pendingRoutes:[pending]};
 const current=structuredClone(snapshot);
 if(concurrent){current.pendingRoutes[0].revision=47;current.pendingRoutes[0].taskIds.push('new-task');}
 const sorting:any=Object.create(PalletSortingService.prototype);
 sorting.marketplace=f.service;
 sorting.prisma={$transaction:vi.fn(async(run:any)=>run({}))};
 sorting.get=vi.fn().mockResolvedValueOnce(snapshot).mockImplementation(async()=>current);
 sorting.load=vi.fn().mockResolvedValue(current);
 sorting.save=vi.fn();sorting.audit=vi.fn();
 const result=await sorting.rebuildRoutes('session',f.user);
 if(concurrent){
  expect(result.pendingRoutes[0].taskIds).toEqual(['t','new-task']);
  expect(sorting.save).not.toHaveBeenCalled();
 }else{
  expect(result.pendingRoutes).toEqual([]);expect(result.version).toBe(84);
  expect(sorting.audit).toHaveBeenCalledWith(expect.anything(),current,f.user,'FBS_ROUTES_REBUILT',expect.objectContaining({success:true}));
 }
 expect(f.db.stockMovement.create).not.toHaveBeenCalled();
 expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
});
