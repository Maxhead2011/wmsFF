import 'reflect-metadata';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {reconcileFbsRequestStatus} from '../src/common/stock/fbs-request-auto-status';
import {PrintSeriesService} from '../src/modules/print/print-series.service';
import {confirmRibbon} from '../src/common/stock/fbs-ribbon-evidence';
vi.mock('../src/common/stock/fbs-request-auto-status',async original=>({...await original<object>(),reconcileFbsRequestStatus:vi.fn(async()=>undefined)}));
vi.mock('../src/common/stock/fbs-ribbon-evidence',async original=>({...await original<object>(),confirmRibbon:vi.fn(async()=>undefined)}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('successful agent ACK drives stages',()=>{
 // TEST: SOS_POST_PICK previously returned before request reconciliation.
 it.each([true,false])('post-pick acknowledgement success=%s',async success=>{
  vi.stubEnv('WMS_FBS_ACTION_STATUS_ENABLED','true');vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED','true');
  const job={source:'SOS_POST_PICK',status:success?'PRINTED':'FAILED',printedAt:success?new Date():null,requestId:'r',requestedById:'picker'};
  const tx={};const db:any={fbsPrintJob:{updateMany:vi.fn(),findUniqueOrThrow:vi.fn(async()=>job)},auditLog:{create:vi.fn()},$transaction:vi.fn(async(cb:any)=>cb(tx))};
  const service:any=new MarketplaceConnectionsService(db,{} as never);service.notifyFbsAutoStatusChanges=vi.fn();
  await service.finishFbsPrintJob('job',success,null,{id:'agent'});
  expect(reconcileFbsRequestStatus).toHaveBeenCalledTimes(success?1:0);
  if(success)expect(reconcileFbsRequestStatus).toHaveBeenCalledWith(tx,'r',{stage:'SOS_PRINT',occurredAt:job.printedAt,actorId:'picker'},[]);
 });
 it.each([true,false])('ribbon ACK is transactional success=%s',async success=>{
  vi.stubEnv('WMS_PRINT_SERIES_ENABLED','true');
  const payload={clientId:'c',fbsRibbon:[{requestId:'r'}]};
  const tx:any={printJob:{updateMany:vi.fn(async()=>({count:1}))}};
  const db:any={fbsPrintStation:{findFirst:vi.fn(async()=>({id:'s'}))},systemSetting:{findUnique:vi.fn(async()=>({value:{userId:'agent',warehouseId:'w'}}))},printJob:{findFirst:vi.fn(async()=>({id:'j',status:'sent',payload}))},$transaction:vi.fn(async(cb:any)=>cb(tx))};
  const svc=new PrintSeriesService(db,{} as never);await svc.finish('s','j',success,null,{id:'agent',activeWarehouseId:'w',permissionCodes:['print:write']} as any);
  expect(confirmRibbon).toHaveBeenCalledTimes(success?1:0);if(success)expect(confirmRibbon).toHaveBeenCalledWith(tx,payload,'j',expect.any(Date));
 });
});
