import {afterEach,expect,it,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import * as routes from '../src/modules/marketplace-connections/fbs-relabel-route';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
function fixture(){
 vi.stubEnv('WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED','true');vi.stubEnv('WMS_FBS_SIZE_SUBSTITUTION_ENABLED','false');
 const task:any={id:'t',deviceCode:'AUTO:FBS:PALLET_SORT',clientId:'c',marketplace:'WILDBERRIES',connectionId:'conn',orderId:'o',requestId:'r',requestItemId:'i',skuId:'target',sourceSkuId:'source',relabelRequired:true,status:'RESERVED',reservedBoxId:'box',reservedBoxCode:'BOX',reservedAt:new Date(),itemCount:1,boxId:null,sourceBarcode:null,barcode:null,kiz:null,relabelConfirmedAt:null,completedAt:null,updatedAt:new Date()};
 const order:any={id:'o',marketplace:'WILDBERRIES',connectionId:'conn',category:'active',supplierStatus:'confirm',itemCount:1,product:{id:'target',name:'target',internalSku:'target'},request:{id:'r',warehouseId:'w'},relabeling:null,requiredMeta:[],optionalMeta:[],barcodes:['new'],storageBoxes:[],supplyId:'s'};
 const db:any={systemSetting:{findUnique:vi.fn().mockResolvedValue(null)},client:{findUnique:vi.fn().mockResolvedValue({storesWithoutBoxes:false})},clientRequestItem:{findMany:vi.fn().mockResolvedValue([{id:'i',requestId:'r',skuId:'target'}])},fbsTsdAssembly:{findMany:vi.fn(async()=>[{...task}]),updateMany:vi.fn(async({data})=>{Object.assign(task,data);return {count:1};})},stockBalance:{findMany:vi.fn(async({where})=>where.skuId.in.includes('source')?[{skuId:'source',boxId:'box',quantity:2,box:{id:'box',code:'BOX',warehouseId:'w',storagePlacement:{pallet:{id:'p',code:'PL',warehouseId:'w',status:'ACTIVE'}}}}]:[])}};
 db.storagePalletBox={findMany:vi.fn().mockResolvedValue([])};const svc:any=new MarketplaceConnectionsService(db,{} as any);
 vi.spyOn(svc,'fbsTsdReservationRowsBySku').mockResolvedValue(new Map());vi.spyOn(svc,'fbsTsdReservationRows').mockResolvedValue([]);vi.spyOn(svc,'withActivePalletSortBoxLock').mockImplementation(async(_:any,fn:any)=>fn(db));
 const lookup=vi.spyOn(routes,'findFbsRelabelRoute').mockResolvedValue({sourceSkuId:'source',sourceProductName:'old',sourceArticle:'old',sourceBarcodes:['old'],boxes:[]});return {task,order,db,svc,lookup};
}
// TEST: repeated marketplace refresh must not erase a validated repaired route.
// TEST: both independently deployed features must coexist after merging their shared service.
it.each(['false','true'])('preserves relabel source across two refreshes with sequential picking=%s',async sequential=>{const f=fixture();vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED',sequential);for(let i=0;i<2;i++)await f.svc.syncFbsPalletSortReservations('c',[f.order]);expect(f.task).toMatchObject({sourceSkuId:'source',relabelRequired:true,status:'RESERVED',reservedBoxId:'box'});expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.order.relabeling).toBeNull();expect(f.lookup).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({exactSourceId:'source',warehouseId:'w',quantity:1}),expect.any(Function));});
// TEST: removed mappings or exhausted stock must fail live source validation.
it('does not retain a source rejected by live validation',async()=>{const f=fixture();f.lookup.mockResolvedValue(null);await f.svc.syncFbsPalletSortReservations('c',[f.order]);expect(f.task).toMatchObject({status:'WAITING_STOCK',sourceSkuId:null,relabelRequired:false});});
// TEST: sold installations and physical work retain existing behavior.
it.each(['flag','started','changed-target'])('does not enrich an ineligible task: %s',async kind=>{const f=fixture();if(kind==='flag')vi.stubEnv('WMS_FBS_RELABEL_ROUTE_REPAIR_ENABLED','false');if(kind==='started'){f.task.status='IN_PROGRESS';f.task.kiz='scan';}if(kind==='changed-target')f.task.skuId='other';await f.svc.syncFbsPalletSortReservations('c',[f.order]);expect(f.lookup).not.toHaveBeenCalled();if(kind==='started')expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();});


