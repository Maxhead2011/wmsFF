import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {LamodaSubmission} from '../src/modules/lamoda/lamoda-submission';
import {LamodaApiError} from '../src/modules/lamoda/lamoda-client';
// TEST: real orchestration with a persistent fake receipt; no external API requests.
const user:any={id:'user',permissionCodes:['system:admin'],roleCodes:['ADMIN'],warehouseIds:['w'],writableWarehouseIds:['w']};
const form={externalShipmentId:'UPD-1',warehouseCode:'BYKOVO',plannedDate:'2026-11-01',prices:[{skuId:'s',priceMinor:100}]};
function fixture(){
 let receipt:any=null;
 const binding:any={plan:{warehouseId:'w',remoteShipmentId:null,items:[{barcode:'4600000000001',article:'seller'}]},request:{status:'PACKED',items:[{skuId:'s',quantity:1,sku:{name:'Product',needsChestnyZnak:false}}]}};
 const assembly:any={phase:'COMPLETED',units:[{id:'u',skuId:'s',state:'PACKED',targetBoxId:'b',kiz:null,markId:null}],boxes:[{boxId:'b',closedAt:new Date(),confirmedAt:new Date()}]};
 const tx:any={lamodaFboAssembly:{findFirst:vi.fn(async()=>binding)},fboAssembly:{findUnique:vi.fn(async()=>assembly)},lamodaProduct:{findMany:vi.fn(async()=>[{skuId:'s',externalSku:'seller',remoteSku:'remote',barcode:'4600000000001'}])},lamodaOperation:{create:vi.fn(async()=>({}))},auditLog:{create:vi.fn(async()=>({}))},$queryRaw:vi.fn(async(strings:any)=>String(strings).includes('submission')?[{submission:receipt}]:[]),$executeRaw:vi.fn(async(_s:any,json:string)=>{receipt=JSON.parse(json);if(receipt?.payload)receipt.payload=Object.fromEntries(Object.entries(receipt.payload).reverse());return 1;})};
 tx.lamodaOperation.updateMany=vi.fn(async()=>({count:1}));
 tx.lamodaOperation.deleteMany=vi.fn(async()=>({count:1}));
 const execute=tx.$executeRaw;
 tx.$executeRaw=vi.fn(async(strings:any,...args:any[])=>{if(String(strings).includes('=NULL')){receipt=null;return 1;}return execute(strings,...args);});
 const db:any={$transaction:async(fn:any)=>fn(tx)};
 const remote:any={execute:vi.fn(async()=>({id:'MPG1',externalShipmentId:'UPD-1',plannedDate:form.plannedDate})),fboShipment:vi.fn(async()=>({shipment:{externalShipmentId:'UPD-1',status:'VALIDATION'},items:[]}))};
 return {service:new LamodaSubmission(db,remote),remote,tx,binding,assembly,receipt:()=>receipt};
}
beforeEach(()=>vi.stubEnv('WMS_LAMODA_FBO_SUBMISSION_ENABLED','true'));afterEach(()=>vi.unstubAllEnvs());
describe('Lamoda submission',()=>{
 it('allows correction only after explicit rejection',async()=>{const f=fixture();f.remote.execute.mockRejectedValueOnce(new LamodaApiError('INVALID',400,'REJECTED'));expect((await f.service.send('a','r',user,form,{} as any)).state).toBe('REJECTED');await f.service.resetRejected('a','r',user);expect(f.receipt()).toBeNull();expect((await f.service.send('a','r',user,form,{} as any)).state).toBe('SUCCEEDED');expect(f.remote.execute).toHaveBeenCalledTimes(2);});
 it('reports reused shipment numbers before any external request',async()=>{const f=fixture();f.tx.lamodaOperation.create.mockRejectedValue({code:'P2002'});await expect(f.service.send('a','r',user,form,{} as any)).rejects.toThrow('Этот номер');expect(f.remote.execute).not.toHaveBeenCalled();});
 it('does not restore an obsolete receipt while reset runs',async()=>{const f=fixture();f.remote.execute.mockRejectedValue(new LamodaApiError('INVALID',400,'REJECTED'));await f.service.send('a','r',user,form,{} as any);f.remote.collection=vi.fn(async()=>[{id:'MPG1',externalShipmentId:'UPD-1'}]);f.remote.fboShipment.mockImplementation(async()=>{await f.service.resetRejected('a','r',user);return {shipment:{externalShipmentId:'UPD-1',plannedDate:form.plannedDate,warehouseCode:'BYKOVO',status:'VALIDATION'},items:[{ean:'4600000000001',quantityPlanned:1}]};});await expect(f.service.refresh('a','r',user,{} as any)).rejects.toThrow('изменилось');expect(f.receipt()).toBeNull();});
 it('sends once and replays success',async()=>{const f=fixture();await f.service.send('a','r',user,form,{} as any);await f.service.send('a','r',user,form,{} as any);expect(f.remote.execute).toHaveBeenCalledTimes(1);expect(f.receipt().remoteId).toBe('MPG1');});
 it('unknown result persists and blocks retry',async()=>{const f=fixture();f.remote.execute.mockRejectedValue(new LamodaApiError('TRANSPORT_ERROR',undefined,'UNKNOWN'));expect((await f.service.send('a','r',user,form,{} as any)).state).toBe('UNKNOWN');await expect(f.service.send('a','r',user,form,{} as any)).rejects.toThrow();expect(f.remote.execute).toHaveBeenCalledTimes(1);});
 it('rejects a changed payload after sending',async()=>{const f=fixture();await f.service.send('a','r',user,form,{} as any);await expect(f.service.send('a','r',user,{...form,plannedDate:'2026-11-02'},{} as any)).rejects.toThrow();});
 it('requires completed assembly',async()=>{const f=fixture();f.assembly.phase='PACKING';await expect(f.service.preview('a','r',user,form)).rejects.toThrow();expect(f.remote.execute).not.toHaveBeenCalled();});
 it('does not duplicate imported shipment',async()=>{const f=fixture();f.binding.plan.remoteShipmentId='MPG2';await expect(f.service.send('a','r',user,form,{} as any)).rejects.toThrow();});
 it('checks actual count against the request',async()=>{const f=fixture();f.binding.request.items[0].quantity=2;await expect(f.service.preview('a','r',user,form)).rejects.toThrow();});
 it('rejects a mismatched success response as unknown',async()=>{const f=fixture();f.remote.execute.mockResolvedValue({id:'wrong'});expect((await f.service.send('a','r',user,form,{} as any)).state).toBe('UNKNOWN');});
 it('refreshes remote status',async()=>{const f=fixture();await f.service.send('a','r',user,form,{} as any);expect((await f.service.refresh('a','r',user,{} as any)).remoteStatus).toBe('VALIDATION');});
 it('never resets an unknown result',async()=>{const f=fixture();f.remote.execute.mockRejectedValue(new Error('timeout'));await f.service.send('a','r',user,form,{} as any);await expect(f.service.resetRejected('a','r',user)).rejects.toThrow();});
 it('reconciles unknown result without sending again',async()=>{const f=fixture();f.remote.execute.mockRejectedValue(new Error('timeout'));await f.service.send('a','r',user,form,{} as any);f.remote.collection=vi.fn(async()=>[{id:'MPG1',externalShipmentId:'UPD-1'}]);f.remote.fboShipment.mockResolvedValue({shipment:{externalShipmentId:'UPD-1',plannedDate:form.plannedDate,warehouseCode:'BYKOVO',status:'VALIDATION'},items:[{ean:'4600000000001',quantityPlanned:1}]});expect((await f.service.refresh('a','r',user,{} as any)).remoteId).toBe('MPG1');expect(f.remote.execute).toHaveBeenCalledTimes(1);});
 it('rejects remapping after relabel',async()=>{const f=fixture();f.binding.relabelLabels=[{skuId:'s',barcode:'4600000000002',article:'remote'}];await expect(f.service.preview('a','r',user,form)).rejects.toThrow();});
 it('enforces warehouse scope',async()=>{const f=fixture();await expect(f.service.view('a','r',{...user,permissionCodes:[],roleCodes:['BRANCH_MANAGER'],activeWarehouseId:'other',warehouseIds:['other']})).rejects.toThrow();});
});
