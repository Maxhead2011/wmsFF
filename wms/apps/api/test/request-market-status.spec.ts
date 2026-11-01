import {afterEach,describe,expect,it,vi} from 'vitest';
import {RequestMarketStatusController} from '../src/modules/client-requests/request-market-status.controller';

function setup() {
  vi.stubEnv('WMS_FBO_DELIVERY_SYNC_ENABLED','true');
  vi.stubEnv('WMS_OZON_PACKED_AUTO_DONE_ENABLED','true');
  vi.stubEnv('WMS_WB_PACKED_AUTO_DONE_ENABLED','true');
  const links=['1','2'].map(orderId=>({orderId,marketplace:'OZON',syncStatus:'ACTIVE',connectionId:'store'}));
  const row:any={id:'r',clientId:'c',warehouseId:'w',type:'OUTBOUND',status:'PACKED',updatedAt:new Date(),
    client:{isDemo:false},fbsEmergencyAssemblyAt:null,fbsOrderLinks:links};
  const db:any={clientRequest:{findUnique:vi.fn(async()=>row),findUniqueOrThrow:vi.fn(async()=>row),
    updateMany:vi.fn(async()=>{row.status='DONE';return {count:1};})},
    clientRequestEvent:{create:vi.fn()},client:{findUnique:vi.fn(async()=>row.client)},
    clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'store',apiKey:'fixture'}))},
    fbsReshipmentRun:{findUnique:vi.fn()},fbsRepeatAssemblyRun:{findUnique:vi.fn()},
    auditLog:{findFirst:vi.fn()},$queryRaw:vi.fn()};
  db.$transaction=async(fn:any)=>fn(db);
  const scopes={requireClientAccess:vi.fn()};
  const ozon={call:vi.fn(async(_account:any,_path:string,body:{posting_number:string})=>({result:{posting_number:body.posting_number,status:'delivering'}})),refresh:vi.fn()};
  const wb={refresh:vi.fn()};const delivery={reconcile:vi.fn()};
  const connections={readWbStatusesForConnection:vi.fn()};
  const ctl=new RequestMarketStatusController(db,scopes as any,connections as any,ozon as any,wb as any,delivery as any);
  const check=()=>ctl.check('r',{roleCodes:['OWNER'],permissionCodes:['system:admin']} as any);
  return {row,db,scopes,ozon,wb,delivery,connections,check};
}
afterEach(()=>vi.unstubAllEnvs());
describe('manual request status check',()=>{
  it('loads every eligible open row in the active branch and keeps only writable clients',async()=>{
    const db:any={clientRequest:{findMany:vi.fn(async()=>[{id:'a',number:1,clientId:'c'},{id:'b',number:2,clientId:'read-only'}])}};
    vi.stubEnv('WMS_FBO_DELIVERY_SYNC_ENABLED','true');
    const ctl=new RequestMarketStatusController(db,{resolveClientFilter:()=>({in:['c','read-only']})} as any,{} as any,{} as any,{} as any,{} as any);
    expect(await ctl.targets({roleCodes:['MANAGER'],permissionCodes:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w'],writableClientIds:['c']} as any)).toEqual([{id:'a',number:1}]);
    expect(db.clientRequest.findMany.mock.calls[0][0].where).toMatchObject({warehouseId:'w',type:'OUTBOUND',client:{isDemo:false},status:{notIn:['DONE','CANCELLED','REJECTED']}});
  });
  // TEST: every linked posting must be checked; there are no stock services in this FBS fixture.
  it('closes only after both postings are accepted and writes one history event',async()=>{
    const {check,db,ozon}=setup();expect((await check()).status).toBe('DONE');
    expect(ozon.call).toHaveBeenCalledTimes(2);expect(db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
  });
  it('keeps a partially delivered request packed',async()=>{
    const {check,db,ozon}=setup();ozon.call.mockResolvedValueOnce({result:{posting_number:'1',status:'awaiting_deliver'}});
    expect((await check()).status).toBe('PACKED');expect(db.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a mismatched Ozon posting before writing',async()=>{
    const {check,db,ozon}=setup();ozon.call.mockResolvedValueOnce({result:{posting_number:'another',status:'delivering'}});
    await expect(check()).rejects.toThrow();expect(db.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it('requires the scoped client before calling the marketplace',async()=>{
    const {check,scopes,ozon}=setup();scopes.requireClientAccess.mockImplementation(()=>{throw Error('Forbidden')});
    await expect(check()).rejects.toThrow();expect(ozon.call).not.toHaveBeenCalled();
  });
  it('refuses an incomplete WB response',async()=>{
    const {check,row,connections,db}=setup();row.fbsOrderLinks.forEach((l:any)=>l.marketplace='WILDBERRIES');
    connections.readWbStatusesForConnection.mockResolvedValue(new Map([['1',{supplierStatus:'complete',wbStatus:'sorted'}]]));
    await expect(check()).rejects.toThrow();expect(db.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it('detects a rebind during the remote call',async()=>{
    const {check,row,db}=setup();db.clientRequest.findUniqueOrThrow.mockResolvedValue({...row,fbsOrderLinks:[]});
    await expect(check()).rejects.toThrow();expect(db.clientRequest.updateMany).not.toHaveBeenCalled();
  });
  it('uses the ordinary FBO reconciliation guard after forced WB refresh',async()=>{
    const {check,row,wb,delivery}=setup();row.fbsOrderLinks=[];row.fboAssembly={phase:'COMPLETED'};
    wb.refresh.mockResolvedValue({binding:{statusId:6,status:'Сдано'},dispatch:null});
    expect((await check()).message).toContain('загрузки');expect(wb.refresh.mock.calls[0][2]).toBe(true);
    expect(delivery.reconcile).toHaveBeenCalledWith('r',undefined,row);
  });
});
