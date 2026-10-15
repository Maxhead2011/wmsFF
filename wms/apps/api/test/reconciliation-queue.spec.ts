import {describe,it,expect,vi} from 'vitest';
import {version,jobKey,retryDelay,reasonCode,runReconciliationJobs} from '../src/common/reconciliation/queue';
describe('reconciliation queue',()=>{
  // TEST: tenants and exact external identifiers cannot share a deduplication key.
  it('keeps identity exact and canonicalizes evidence',()=>{
    const j={clientId:'a',entityId:'9007199254740993',cause:'PRINT_CONFIRMED' as const};
    expect(jobKey(j)).not.toBe(jobKey({...j,clientId:'b'}));expect(jobKey(j)).not.toBe(jobKey({...j,entityId:'9007199254740992'}));
    expect(version({a:1,b:2})).toBe(version({b:2,a:1}));expect(version({a:1})).not.toBe(version({a:2}));
  });
  it('bounds backoff and stores no raw error',()=>{expect(retryDelay(1)).toBe(300000);expect(retryDelay(500)).toBe(21600000);expect(reasonCode(new Error('password:secret'))).toBe('REVIEW_REQUIRED');});
  it('does not execute a case claimed by another worker',async()=>{
    const run=vi.fn();const j={clientId:'c',requestId:'r',warehouseId:'w',entityId:'e',cause:'PRINT_CONFIRMED' as const,label:'one',evidence:{v:1},run};
    const db={$executeRaw:vi.fn(),$queryRaw:vi.fn().mockResolvedValueOnce([{key:jobKey(j),evidenceVersion:version(j.evidence)}]).mockResolvedValueOnce([])};
    expect(await runReconciliationJobs(db as any,[j])).toEqual({attempted:0,failed:0});expect(run).not.toHaveBeenCalled();
  });
  it('never changes warehouse decisions after a failed physical check',async()=>{
    const run=vi.fn().mockRejectedValue(new Error('физическое списание не найдено'));
    const j={clientId:'c',requestId:'r',warehouseId:null,entityId:'e',cause:'PRINT_CONFIRMED' as const,label:'one',evidence:1,run};
    const db={$executeRaw:vi.fn(),$queryRaw:vi.fn().mockResolvedValueOnce([{key:jobKey(j),evidenceVersion:version(1)}]).mockResolvedValueOnce([{attempts:1}])};
    expect(await runReconciliationJobs(db as any,[j])).toEqual({attempted:1,failed:1});expect(run).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[1][0].values).toContain('MISSING_PHYSICAL_EVIDENCE');
  });
});

// TEST: one JSON parameter prevents PostgreSQL bind limits on large queues.
it('uses bounded parameters for the due-case lookup',async()=>{
 const j={clientId:'c',requestId:'r',warehouseId:null,entityId:'e',cause:'PRINT_CONFIRMED' as const,label:'one',evidence:1,run:vi.fn()};
 const db={$executeRaw:vi.fn(),$queryRaw:vi.fn().mockResolvedValue([])};
 await runReconciliationJobs(db as any,Array.from({length:1000},(_,i)=>({...j,entityId:String(i)})));
 expect(db.$queryRaw.mock.calls[0][0].values.length).toBeLessThan(5);
});
