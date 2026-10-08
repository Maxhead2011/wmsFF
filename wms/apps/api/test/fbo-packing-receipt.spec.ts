import {afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {packingReceipt,withPackingReceipt} from '../src/modules/tsd/fbo-packing-receipt';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('WMS_FBO_COMPACT_PACKING_ENABLED','true');
 const request={id:'r',items:[{id:'l',skuId:'sku',barcode:'123',quantity:4,sku:{name:'Item',needsChestnyZnak:true}}]};
 const assembly={phase:'PACKING',compositionHash:createHash('sha256').update(JSON.stringify([['l','sku','123',4]])).digest('hex')};
 const db:any={$queryRaw:vi.fn().mockResolvedValue([assembly]),fboAssemblyUnit:{groupBy:vi.fn().mockImplementation(({by}:any)=>by.includes('requestItemId')?[
  {requestItemId:'l',state:'PICKED',wholeBox:false,_count:{_all:2}}, {requestItemId:'l',state:'PACKED',wholeBox:false,_count:{_all:2}}
 ]:by.includes('targetBoxId')?[{targetBoxId:'b',_count:{_all:2}}]:[])},fboAssemblyBox:{findMany:vi.fn().mockResolvedValue([{boxId:'b',boxCode:'FFL_BOX',wholeBox:false,closedAt:null,confirmedAt:null}])}};
 return {request,assembly,db};
}
describe('compact packing receipt',()=>{
 // TEST: no history or per-unit KIZ enumeration, including another packer’s committed progress.
 it('returns absolute grouped progress and box state',async()=>{const {request,db}=fixture();const state=await packingReceipt(db,request,'OPEN_BOX');expect(state).toMatchObject({picked:4,packed:2,looseRemaining:2,boxes:[{code:'FFL_BOX',quantity:2}]});expect(state).not.toHaveProperty('pickedUnits');expect(state).not.toHaveProperty('route');expect(state!.lines[0].requiresKiz).toBe(true);});
 it('honors a frozen partial pick',async()=>{const {request,db,assembly}=fixture();Object.assign(assembly,{pickClosure:{version:1,quantities:{l:3}}});expect((await packingReceipt(db,request,'PACK_UNIT'))?.needed).toBe(3);});
 it('requires full reconciliation after composition or phase changes',async()=>{const {request,db,assembly}=fixture();assembly.compositionHash='changed';expect(await packingReceipt(db,request,'PACK_UNIT')).toBeUndefined();assembly.phase='CONTROL';expect(await packingReceipt(db,request,'OPEN_BOX')).toBeUndefined();});
 it('leaves sold and picking paths unchanged',async()=>{const {request,db}=fixture();expect(await packingReceipt(db,request,'PICK_UNIT')).toBeUndefined();vi.stubEnv('WMS_FBO_COMPACT_PACKING_ENABLED','false');expect(await packingReceipt(db,request,'OPEN_BOX')).toBeUndefined();expect(db.$queryRaw).not.toHaveBeenCalled();});
 it('reads one consistent snapshot with current authorization',async()=>{const {request,db}=fixture();const svc={prisma:{$transaction:vi.fn((fn:any)=>fn(db))},load:vi.fn().mockResolvedValue(request)};const ack={accepted:true,requestId:'r',action:'OPEN_BOX'};expect(await withPackingReceipt(svc,ack,{id:'u'})).toHaveProperty('packing');expect(svc.load).toHaveBeenCalledWith(db,'r',{id:'u'},'write');expect(svc.prisma.$transaction.mock.calls[0][1]).toMatchObject({isolationLevel:'RepeatableRead'});});
 it('never invalidates a committed operation when compact read fails',async()=>{fixture();const ack={accepted:true,requestId:'r',action:'PACK_UNIT'};expect(await withPackingReceipt({prisma:{$transaction:vi.fn().mockRejectedValue(Error('timeout'))}},ack,{})).toBe(ack);});
 it('never reads state for an unconfirmed operation',async()=>{fixture();const ack={accepted:false,action:'OPEN_BOX'};expect(await withPackingReceipt({},ack,{})).toBe(ack);});
});
