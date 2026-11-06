import { describe,it,expect,vi,afterEach } from 'vitest';
import {scanWbFabric} from './fabric-fbs-scan';
import {readFabricTaskLines} from './fabric-fbs-task-state';
import {confirmFabricProduction} from './fabric-fbs-confirmation';
vi.mock('./fabric-fbs-task-state',()=>({FABRIC_TASK_MARKER:'__FABRIC_FBS__',readFabricTaskLines:vi.fn()}));
vi.mock('./fabric-fbs-confirmation',()=>({confirmFabricProduction:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
// TEST: a rescanned, already produced piece restores lost barcode proof without another debit.
describe('fabric scan after release',()=>{
 // TEST: completed production never bypasses product/counter validation.
 it.each([['wrong',0],['123',2]])('rejects invalid restored proof %s/%s',async(barcode,expected)=>{
  const task={id:'t',requestId:'r',clientId:'c',sourceArticle:'__FABRIC_FBS__',marketplace:'WILDBERRIES',requestItemId:'i',skuId:'s',itemCount:1,barcodes:['123'],barcode:null};
  vi.mocked(readFabricTaskLines).mockResolvedValue([{lineId:'i',skuId:'s',quantity:1,confirmedUnits:1,remainingUnits:0}] as any);
  const update=vi.fn();
  const tx:any={$queryRaw:async()=>[{locked:true}],fbsTsdAssembly:{findUnique:async()=>task,update}};
  const service:any={prisma:{$transaction:(fn:any)=>fn(tx)},requireCurrentFbsTsdLease:vi.fn()};
  await expect(scanWbFabric(service,task,String(barcode),expected,{})).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();expect(confirmFabricProduction).not.toHaveBeenCalled();
 });
 it.each([0,1])('restores barcode for completed cut at counter %s',async expected=>{
  const task={id:'t',requestId:'r',clientId:'c',sourceArticle:'__FABRIC_FBS__',marketplace:'WILDBERRIES',requestItemId:'i',skuId:'s',itemCount:1,barcodes:['123'],barcode:null};
  vi.mocked(readFabricTaskLines).mockResolvedValue([{lineId:'i',skuId:'s',quantity:1,confirmedUnits:1,remainingUnits:0}] as any);
  const tx:any={$queryRaw:async()=>[{locked:true}],fbsTsdAssembly:{findUnique:async()=>task,update:vi.fn(async({data}:any)=>({...task,...data}))}};
  const service:any={prisma:{$transaction:(fn:any)=>fn(tx)},requireCurrentFbsTsdLease:vi.fn()};
  const result=await scanWbFabric(service,task,'123',expected,{});
  expect(result.barcode).toBe('123');expect(confirmFabricProduction).not.toHaveBeenCalled();
 });
});
