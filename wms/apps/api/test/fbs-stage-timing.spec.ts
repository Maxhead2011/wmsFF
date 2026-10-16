import {describe,it,expect,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {operationTiming} from '../src/common/diagnostics/operation-timing';
// TEST: stage measurements preserve the original response and exception identity, without KIZ payloads.
describe('FBS stage timing',()=>{
 it('records scan and task lookup without swallowing database failure',async()=>{
  const service:any=Object.create(MarketplaceConnectionsService.prototype),error=new Error('private-kiz');
  service.prisma={fbsTsdAssembly:{findUnique:vi.fn().mockRejectedValue(error)}};const rows:any[]=[];
  await expect(operationTiming('POST /fbs/tasks/:id/scan-kiz',()=>service.scanFbsTsdKiz('private-task',{kiz:'private-kiz'},{}),row=>rows.push(row))).rejects.toBe(error);
  expect(rows[0].stages.fbs_scan.count).toBe(1);expect(rows[0].stages.fbs_task_load.count).toBe(1);expect(JSON.stringify(rows)).not.toMatch(/private-task|private-kiz/);
 });
 it('records completion failure without continuing or mutating stock',async()=>{
  const service:any=Object.create(MarketplaceConnectionsService.prototype),error=new Error('load failed');const load=vi.fn().mockRejectedValue(error);service.loadOwnedFbsTsdAssembly=load;const rows:any[]=[];
  await expect(operationTiming('POST /fbs/tasks/:id/complete',()=>service.completeFbsTsdAssembly('task',{}),row=>rows.push(row))).rejects.toBe(error);
  expect(load).toHaveBeenCalledOnce();expect(rows[0].stages.fbs_complete.count).toBe(1);
 });
 it('preserves a successful owned task lookup',async()=>{
  const service:any=Object.create(MarketplaceConnectionsService.prototype),task={workerUserId:'u',deviceCode:'d',clientId:'c'};
  service.prisma={fbsTsdAssembly:{findUnique:vi.fn().mockResolvedValue(task)}};service.clientScopes={requireClientAccess:vi.fn()};service.fbsTsdDeviceCode=()=> 'd';const rows:any[]=[];
  expect(await operationTiming('test',()=>service.loadOwnedFbsTsdAssembly('task',{id:'u'}),row=>rows.push(row))).toBe(task);expect(rows[0].stages.fbs_task_load.count).toBe(1);
 });
});
