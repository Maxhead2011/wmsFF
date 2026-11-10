import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {reconcileFbsRequestStatus} from '../src/common/stock/fbs-request-auto-status';

// TEST: exercise the actual transition helper with warehouse finalization disabled.
describe('employee action request stages', () => {
 beforeEach(()=>{vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED','true');vi.stubEnv('WMS_FBS_ACTION_STATUS_ENABLED','true');vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED','false');});
 afterEach(()=>vi.unstubAllEnvs());
 function fixture(ribbon=false) {
  const request:any={id:'r',clientId:'c',number:1,title:'FBS',type:'OUTBOUND',status:'SUBMITTED',items:[{id:'i',skuId:'s',quantity:1}],fbsOrderLinks:[{marketplace:'WILDBERRIES',connectionId:'a',orderId:'o',syncStatus:'ACTIVE'}]};
  const task:any={id:'t',requestItemId:'i',skuId:'s',marketplace:'WILDBERRIES',connectionId:'a',orderId:'o',status:'COMPLETED',startedAt:new Date(),completedAt:new Date(),workerUserId:'picker',deviceCode:'TSD:1',itemCount:1};
  const tx:any={$queryRaw:vi.fn(),clientRequest:{findUnique:vi.fn(async()=>request),update:vi.fn(async({data}:any)=>Object.assign(request,data))},clientRequestEvent:{findFirst:vi.fn(async()=>null),create:vi.fn()},fbsTsdAssembly:{findMany:vi.fn(async()=>[task])},fbsPrintJob:{findMany:vi.fn(async()=>[])},wbOrderShipment:{findMany:vi.fn(async()=>[{assemblyId:'t',quantity:1}])},systemSetting:{findUnique:vi.fn(async()=>({value:{startOnRibbon:ribbon}}))}};
  return {tx,request,task};
 }
 const apply=(tx:any,stage:any)=>reconcileFbsRequestStatus(tx,'r',{stage,occurredAt:new Date(),actorId:'picker'});
 it('does not mark a completed pick packed before SOS printing',async()=>{const f=fixture();await apply(f.tx,'PICK');expect(f.request.status).toBe('IN_WORK');});
 it('Ozon also waits for SOS printing after picking',async()=>{const f=fixture();f.task.marketplace='OZON';f.request.fbsOrderLinks[0].marketplace='OZON';await apply(f.tx,'PICK');expect(f.request.status).toBe('IN_WORK');f.tx.fbsPrintJob.findMany.mockResolvedValue([{assemblyId:'t'}]);await apply(f.tx,'SOS_PRINT');expect(f.request.status).toBe('PACKED');});
 it('successful SOS coverage means packed, never delivered',async()=>{const f=fixture();f.tx.fbsPrintJob.findMany.mockResolvedValue([{assemblyId:'t'}]);await apply(f.tx,'SOS_PRINT');expect(f.request.status).toBe('PACKED');});
 it('fabric opening/picking does not start before a ribbon',async()=>{const f=fixture(true);await apply(f.tx,'START');await apply(f.tx,'PICK');expect(f.request.status).toBe('SUBMITTED');});
 it('a confirmed ribbon starts fabric before any TSD task',async()=>{const f=fixture(true);f.tx.fbsTsdAssembly.findMany.mockResolvedValue([]);await apply(f.tx,'RIBBON');expect(f.request.status).toBe('IN_WORK');});
 it('does not downgrade packed or delivered on reprint',async()=>{for(const status of ['PACKED','DONE']){const f=fixture(true);f.request.status=status;await apply(f.tx,'RIBBON');expect(f.request.status).toBe(status);expect(f.tx.clientRequest.update).not.toHaveBeenCalled();}});
 it('preserves the sold installation when the new flag is off',async()=>{vi.stubEnv('WMS_FBS_ACTION_STATUS_ENABLED','false');const f=fixture();await apply(f.tx,'PICK');expect(f.request.status).toBe('PACKED');});
 it('honors a newer manual decision',async()=>{const f=fixture();f.tx.clientRequestEvent.findFirst.mockResolvedValue({id:'manual'});await apply(f.tx,'START');expect(f.request.status).toBe('SUBMITTED');});
});
