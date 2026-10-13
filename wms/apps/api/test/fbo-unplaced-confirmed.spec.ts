import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {FboTwoStageService} from '../src/modules/tsd/fbo-two-stage.service';
vi.mock('../src/modules/tsd/fbo-request-route',async original=>({...await original<any>(),loadFboRoutePreference:async()=>null}));
const take=vi.fn();
vi.mock('../src/modules/tsd/fbo-fbs-reservations',()=>({loadFboFbsAvailability:async()=>({free:()=>1,take})}));
afterEach(()=>{vi.unstubAllEnvs();take.mockReset();});
function fixture(accepted=true){
 vi.stubEnv('WMS_FBO_UNPLACED_PICKING_ENABLED','true');vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED','true');vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');
 const box:any={id:'box',code:'BOX',storagePlacement:null,pallet:null,balances:[{skuId:'s',status:'AVAILABLE',quantity:1}],productMarks:[]};
 const r:any={id:'r',clientId:'c',warehouseId:'w',status:'IN_WORK',client:{stockBalanceMode:'PALLET_SORT'},items:[{id:'i',skuId:'s',barcode:'123',quantity:1,sku:{name:'Dress'}}]};
 const tx:any={$queryRaw:vi.fn(),stockMovement:{findMany:vi.fn(async()=>accepted?[{boxId:'box'}]:[])},fboAssembly:{findUnique:async()=>({phase:'PICKING',units:[],boxes:[],compositionHash:createHash('sha256').update(JSON.stringify([['i','s','123',1]])).digest('hex')})},fboAssemblyAction:{findUnique:async()=>null},fboAssemblyUnit:{findMany:async()=>[]},user:{findMany:async()=>[]},box:{findMany:async()=>[box],findUniqueOrThrow:async()=>box,upsert:async()=>({id:'holding'})},stockBalance:{findMany:async()=>box.balances},productMark:{findMany:async()=>[]}};
 const svc:any=new FboTwoStageService({$transaction:async(fn:any)=>fn(tx)} as any,{} as any,{} as any,{} as any,{assertStockMovementsAllowed:async()=>{}} as any,{} as any);
 svc.busyBoxes=async()=>new Set();svc.load=async()=>r;svc.requireFbo=()=>{};svc.box=async()=>box;svc.requireIdleBox=async()=>{};svc.move=vi.fn(async()=>{throw Error('STOCK_BOUNDARY');});return {svc,tx,r};
}
// TEST: confirmed receipts have no age cutoff, and only the warehouse route changes.
it('offers confirmed unplaced stock in the route',async()=>{const x=fixture();const p=await x.svc.snapshot(x.tx,x.r);expect(p.route).toHaveLength(1);expect(p.route[0]).toMatchObject({boxCode:'BOX',pallet:'',wholeBox:true});expect(p.pendingPlacementQuantity).toBe(0);expect(x.tx.stockMovement.findMany.mock.calls[0][0].where).toEqual({clientId:'c',warehouseId:'w',boxId:{in:['box']},type:'RECEIPT',status:'AVAILABLE',quantity:{gt:0}});});
it.each(['PICK_UNIT','PICK_BOX'])('allows %s from confirmed unplaced stock with reservation checks',async action=>{const x=fixture();await expect(x.svc.act('r',{action,operationId:'op',sourceBoxCode:'BOX',barcode:'123'},{id:'u'})).rejects.toThrow('STOCK_BOUNDARY');expect(take).toHaveBeenCalledWith('box','s',1);});
it.each(['PICK_UNIT','PICK_BOX'])('blocks %s without receipt evidence',async action=>{const x=fixture(false);await expect(x.svc.act('r',{action,operationId:'op',sourceBoxCode:'BOX',barcode:'123'},{id:'u'})).rejects.not.toThrow('STOCK_BOUNDARY');expect(x.svc.move).not.toHaveBeenCalled();});
it('retains placement wait with the capability off',async()=>{const x=fixture();vi.stubEnv('WMS_FBO_UNPLACED_PICKING_ENABLED','false');expect((await x.svc.snapshot(x.tx,x.r)).route).toEqual([]);expect(x.tx.stockMovement.findMany).not.toHaveBeenCalled();});
it('preserves reservations even for confirmed unplaced stock',async()=>{const x=fixture();take.mockImplementation(()=>{throw Error('RESERVED');});await expect(x.svc.act('r',{action:'PICK_UNIT',operationId:'op',sourceBoxCode:'BOX',barcode:'123'},{id:'u'})).rejects.toThrow('RESERVED');expect(x.svc.move).not.toHaveBeenCalled();});
