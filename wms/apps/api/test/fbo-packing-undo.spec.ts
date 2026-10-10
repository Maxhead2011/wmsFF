// TEST: exact-unit receipt prevents duplicate/foreign/closed/stale undo.
import {it,afterEach,vi} from 'vitest';
import assert from 'node:assert/strict';
import {packedUnitForUndo,rememberPackedUnit} from '../src/modules/tsd/fbo-packing-undo';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('WMS_FBO_PACK_UNDO_ENABLED','true');
 const unit:any={id:'u',requestId:'r',state:'PACKED',targetBoxId:'b',packedByUserId:'worker',packedAt:new Date('2026-10-10T10:00:00Z')};
 const receipt:any={id:'receipt',userId:'worker',createdAt:new Date(),payload:{unitId:'u',requestId:'r',boxId:'b',packedAt:unit.packedAt.toISOString()}};
 const box:any={requestId:'r'};
 const tx:any={auditLog:{findUnique:vi.fn(async()=>receipt),create:vi.fn()},fboAssemblyAction:{findFirst:vi.fn(async()=>null)},fboAssemblyUnit:{findUnique:async()=>unit},fboAssemblyBox:{findUnique:async()=>box}};
 return {tx,unit,box,receipt,undo:()=>packedUnitForUndo(tx,'r','original','worker')};
}
it('returns exact packed unit; original operation and actor scope receipt lookup',async()=>{
 const f=fixture();assert.equal(await f.undo(),f.unit);assert.deepEqual(f.tx.auditLog.findUnique.mock.calls[0][0].where,{id:'fbo-pack:r:original'});
});
it('rejects changed unit and closed carton',async()=>{
 const f=fixture();f.unit.state='PICKED';await assert.rejects(f.undo,/изменилась/);f.unit.state='PACKED';f.box.closedAt=new Date();await assert.rejects(f.undo,/открытом/);
 f.box.closedAt=null;f.unit.packedAt=new Date();await assert.rejects(f.undo,/изменилась/);
});
it('rejects foreign actor and any earlier packing even when the latest was undone',async()=>{
 const f=fixture();f.unit.packedByUserId='other';await assert.rejects(f.undo,/изменилась/);f.unit.packedByUserId='worker';
 f.tx.fboAssemblyAction.findFirst.mockImplementationOnce(async()=>({id:'newer'}));await assert.rejects(f.undo,/последнюю/);
});
it('disabled feature never adds receipt and cannot undo',async()=>{
 const f=fixture();vi.stubEnv('WMS_FBO_PACK_UNDO_ENABLED','false');await rememberPackedUnit(f.tx,f.unit,'worker','r:original');assert.equal(f.tx.auditLog.create.mock.calls.length,0);await assert.rejects(f.undo,/выключена/);
});
