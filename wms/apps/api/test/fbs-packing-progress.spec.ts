import {expect,it} from 'vitest';
import { packingProgress } from '../src/modules/service/fbs-packing-progress';
import { inspectionScope } from '../src/modules/service/unprinted-kiz.policy';
const kiz='0104680992592323215t>rsrOYP,IXp';
const task={id:'a',requestId:'r',orderId:'1',kiz,status:'COMPLETED',completedAt:new Date('2026-09-15T11:00:00Z'),workerName:'Picker'};
const scan={entityId:'a',createdAt:new Date('2026-09-15T10:00:00Z'),payload:{requestId:'r',orderId:'1',kiz,workerName:'Picker'}};
const job={id:'j',assemblyId:'a',requestId:'r',orderId:'1',kiz,status:'PRINTED',printedAt:new Date('2026-09-15T12:00:00Z'),requestedBy:'Packer'};
// TEST: packing requires a confirmed print of this physical unit in this attempt.
it('separates picking from confirmed packing and records both actors',()=>{
 expect(packingProgress(task,[scan],[],[])).toMatchObject({stage:'FOUND',foundBy:'Picker',packedAt:null});
 expect(packingProgress(task,[scan],[job],[])).toMatchObject({stage:'PACKED',packedBy:'Packer',packedAt:job.printedAt.toISOString()});
 for(const change of [{status:'FAILED'},{status:'QUEUED'},{assemblyId:'old'},{kiz:kiz.toUpperCase()},{requestId:'other'},{printedAt:new Date('2026-09-14')}])
  expect(packingProgress(task,[scan],[{...job,...change}],[]).stage).toBe('FOUND');
});
it('keeps confirmed packing after retry failure and ignores a scan without completed physical pick',()=>{
 expect(packingProgress(task,[scan],[{...job,status:'FAILED',printedAt:null}],[{entityId:'j',createdAt:job.printedAt}]).stage).toBe('PACKED');
 expect(packingProgress({...task,status:'IN_PROGRESS',completedAt:null},[scan],[],[]).stage).toBeNull();
});
// TEST: request/supply filters do not require dates and cannot be combined ambiguously.
it('validates exactly one inspection scope',()=>{
 expect(inspectionScope({requestNumber:'001029'})).toMatchObject({kind:'request',number:1029});
 expect(inspectionScope({supplyId:'WB-GI-123'})).toMatchObject({kind:'supply',supplyId:'WB-GI-123'});
 expect(()=>inspectionScope({requestNumber:'1',supplyId:'WB-GI-123'})).toThrow();
 expect(()=>inspectionScope({supplyId:'WB-GI-123',dateFrom:'2026-09-01',dateTo:'2026-09-02'})).toThrow();
 expect(()=>inspectionScope({requestNumber:'0'})).toThrow();
});
