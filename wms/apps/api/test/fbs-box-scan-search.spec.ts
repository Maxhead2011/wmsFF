import { describe, expect, it, vi } from 'vitest';
import { boxCandidateSkuIds, boxReservationSnapshot, sharePendingBoxScan } from '../src/modules/marketplace-connections/fbs-box-scan-search';

describe('physical box candidate helpers', () => {
  // TEST: reverse mapping must preserve case-insensitive article aliases and exact size.
  it('includes direct and same-size relabel candidates only', async () => {
    const db: any = {
      client: { findUnique: vi.fn().mockResolvedValue({relabelingEnabled:true}) },
      clientArticleMapping: {findMany:vi.fn().mockResolvedValue([{sourceArticle:'Source',targetArticle:'TARGET'}])},
      sku: {findMany:vi.fn().mockResolvedValueOnce([{id:'source',internalSku:'source-S',size:'S'}])
        .mockResolvedValueOnce([{id:'target',article:'target',size:'s'},{id:'wrong-size',clientSku:'TARGET',size:'M'},{id:'unknown-size',article:'TARGET',size:null}])},
    };
    expect(await boxCandidateSkuIds(db,'client',['source'])).toEqual(['source','target','unknown-size']);
    expect(db.clientArticleMapping.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{clientId:'client'}}));
  });
  // TEST: no stock must not expand to an unfiltered request or query catalog.
  it('does not query anything for an empty box', async () => {
    expect(await boxCandidateSkuIds({} as never,'client',[])).toEqual([]);
  });
  // TEST: each candidate excludes its own reservation without repeating bulk reads.
  it('batches reservations and reloads after a reservation mutation', async () => {
    const load=vi.fn().mockResolvedValue(new Map([['sku',[
      {taskId:'a',boxId:'box',itemCount:1,releasableBackground:false},
      {taskId:'b',boxId:'box',itemCount:2,releasableBackground:true},
      {taskId:'c',boxId:'other',itemCount:10,releasableBackground:false},
    ]]]));
    const cache=boxReservationSnapshot(load);
    expect((await cache.read('sku','box','a')).map(x=>x.taskId)).toEqual(['b']);
    expect((await cache.read('sku','box','b')).map(x=>x.taskId)).toEqual(['a']);
    expect(load).toHaveBeenCalledOnce();
    cache.invalidate(); await cache.read('sku','box',null);
    expect(load).toHaveBeenCalledTimes(2);
  });
  // TEST: different users/devices/payloads and service instances never share operations.
  it('isolates pending operations and never retains successful responses', async () => {
    const owner={};let finish!:()=>void;
    const action=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const a=sharePendingBoxScan(owner,'user-device-task-box',action);
    const b=sharePendingBoxScan(owner,'user-device-task-box',action);
    await Promise.resolve();expect(action).toHaveBeenCalledOnce();finish();await Promise.all([a,b]);
    const next=vi.fn().mockResolvedValue(1);
    await sharePendingBoxScan(owner,'user-device-task-box',next);
    await Promise.all([sharePendingBoxScan(owner,'other-device',next),sharePendingBoxScan({},'user-device-task-box',next)]);
    expect(next).toHaveBeenCalledTimes(3);
  });
});
