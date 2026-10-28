import {afterEach,expect,it,vi} from 'vitest';
import {reconcileTerminalAutoReservations as sourceReconcile} from '../src/modules/marketplace-connections/wb-terminal-auto-reservations';
import {MarketplaceConnectionsService as SourceService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {createRequire} from 'node:module';
const runtime=(name:string)=>createRequire(import.meta.url)(process.env.KUBRIN_RUNTIME+'/modules/marketplace-connections/'+name+'.js');
const reconcileTerminalAutoReservations=process.env.KUBRIN_RUNTIME?runtime('wb-terminal-auto-reservations').reconcileTerminalAutoReservations:sourceReconcile;
const MarketplaceConnectionsService=process.env.KUBRIN_RUNTIME?runtime('marketplace-connections.service').MarketplaceConnectionsService:SourceService;
afterEach(()=>vi.unstubAllEnvs());
const task={id:'t',clientId:'client',connectionId:'c',orderId:'42',requestId:'AUTO:WILDBERRIES:c:42',marketplace:'WILDBERRIES',skuId:'sku',itemCount:1,status:'WAITING_STOCK',updatedAt:new Date(0),startedAt:null,completedAt:null,boxId:null,barcode:null,sourceBarcode:null,kiz:null,relabelConfirmedAt:null};
function setup(overrides:any={}) {
  vi.stubEnv('WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED','true');
  vi.stubEnv('WMS_WB_TERMINAL_AUTO_RESERVATION_CLIENTS','client');
  const row={...task,...overrides},updateMany=vi.fn().mockResolvedValue({count:1}),audit=vi.fn();
  const db:any={fbsTsdAssembly:{findMany:async()=>[row],findUnique:async()=>row,updateMany},
    clientMarketplaceConnection:{findMany:async()=>[{id:'c',clientId:'client',apiKey:'test'}]},
    fbsOrderRequestLink:{findFirst:async()=>null},stockMovement:{findFirst:async()=>null},
    fbsPrintJob:{findFirst:async()=>null},wbOrderShipment:{findFirst:async()=>null},
    shippedKizHistory:{findFirst:async()=>null},auditLog:{create:audit},$queryRaw:async()=>[],
  };db.$transaction=(f:any)=>f(db);
  return {db,updateMany,audit};
}
// TEST: the ordinary lookback omits this sold order, but its orphan reserve must close.
it('releases an untouched AUTO demand after a fresh exact WB terminal response, with audit',async()=>{
  const {db,updateMany,audit}=setup();
  const result=await reconcileTerminalAutoReservations(db,'client',async()=>new Map([['42',{supplierStatus:'complete',wbStatus:'sold'}]]));
  expect(result.released).toBe(1);expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'RELEASED'})}));expect(audit).toHaveBeenCalledOnce();
});
it.each([{}, {supplierStatus:'confirm',wbStatus:'waiting'}, {supplierStatus:'complete',wbStatus:'waiting'}])('retains uncertain or active orders %j',async status=>{
  const {db,updateMany}=setup();await reconcileTerminalAutoReservations(db,'client',async()=>new Map([['42',status as any]]));expect(updateMany).not.toHaveBeenCalled();
});
it.each([{workerUserId:'worker'},{cargoPackingId:'cargo'},{marketplaceSubmittedAt:new Date()},{startedAt:new Date()},{barcode:'b'},{kiz:'k'},{boxId:'box'},{sourceBarcode:'b'},{completedAt:new Date()},{requestId:'real-request'},{status:'IN_PROGRESS'}])('preserves physical/assigned work %j',async override=>{
  const {db,updateMany}=setup(override);await reconcileTerminalAutoReservations(db,'client',async()=>new Map([['42',{supplierStatus:'complete',wbStatus:'sold'}]]));expect(updateMany).not.toHaveBeenCalled();
});
it.each(['stockMovement','fbsPrintJob','wbOrderShipment','shippedKizHistory','fbsOrderRequestLink'])('preserves %s evidence even when task fields are empty',async model=>{
  const {db,updateMany}=setup();db[model].findFirst=async()=>({id:'evidence'});await reconcileTerminalAutoReservations(db,'client',async()=>new Map([['42',{supplierStatus:'complete',wbStatus:'sold'}]]));expect(updateMany).not.toHaveBeenCalled();
});
it('does nothing on sold installations without the opt-in',async()=>{
  vi.stubEnv('WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED','false');const read=vi.fn();expect(await reconcileTerminalAutoReservations({} as any,'client',read)).toEqual({checked:0,released:0});expect(read).not.toHaveBeenCalled();
});
it('fails closed when WB cannot be read',async()=>{
  const {db,updateMany}=setup();await expect(reconcileTerminalAutoReservations(db,'client',async()=>{throw Error('WB unavailable')})).rejects.toThrow();expect(updateMany).not.toHaveBeenCalled();
});
// TEST: the old scheduler never inspected AUTO tasks outside the order window.
it('checks orphan reservations before automatic publication',async()=>{
  vi.stubEnv('WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED','true');
  vi.stubEnv('WMS_WB_TERMINAL_AUTO_RESERVATION_CLIENTS','client');
  const findMany=vi.fn().mockResolvedValue([]);
  const db:any={fbsTsdAssembly:{findMany},clientMarketplaceConnection:{findMany:async()=>[]}};
  const service:any=new MarketplaceConnectionsService(db,{} as any);service.stockControl={isEnabled:async()=>true};
  await service.autoSyncFbsStocksForClient('client');expect(findMany).toHaveBeenCalledOnce();
});
// TEST: preserve work acquired after the WB read, and never affect another client.
it('retains a task modified during the remote status request',async()=>{
  const {db,updateMany}=setup();db.fbsTsdAssembly.findUnique=async()=>({...task,updatedAt:new Date(1)});
  await reconcileTerminalAutoReservations(db,'client',async()=>new Map([['42',{supplierStatus:'complete',wbStatus:'sold'}]]));expect(updateMany).not.toHaveBeenCalled();
});
it('requires an explicit client opt-in',async()=>{
  setup();const read=vi.fn();expect(await reconcileTerminalAutoReservations({} as any,'other',read)).toEqual({checked:0,released:0});expect(read).not.toHaveBeenCalled();
});
it('does not release a task twice',async()=>{
  const {db,updateMany,audit}=setup();const status=async()=>new Map([['42',{supplierStatus:'complete',wbStatus:'sold'}]]);
  await reconcileTerminalAutoReservations(db,'client',status);
  db.fbsTsdAssembly.findUnique=async()=>({...task,status:'RELEASED'});
  await reconcileTerminalAutoReservations(db,'client',status);expect(updateMany).toHaveBeenCalledOnce();expect(audit).toHaveBeenCalledOnce();
});
