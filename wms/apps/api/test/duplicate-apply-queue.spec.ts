import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DuplicateApplyQueue, completeDuplicateApply } from '../src/modules/marketplace-connections/duplicate-apply-queue';

function fixture() {
  vi.stubEnv('WMS_DUPLICATE_APPLY_QUEUE_ENABLED', 'true');
  const rows = new Map<string, any>();
  const db: any = {
    systemSetting: {
      findUnique: vi.fn(async ({where}) => rows.get(where.key) ?? null),
      findMany: vi.fn(async ({where, take, orderBy}) => {
        const found = [...rows.values()].filter(r => r.key.startsWith(where.key.startsWith) &&
          (!where.value || r.value.status === where.value.equals));
        if (orderBy?.createdAt === 'desc') found.reverse();
        return take ? found.slice(0, take) : found;
      }),
      upsert: vi.fn(async ({where, create, update}) => {
        const row = {...(rows.get(where.key) ?? create), ...(rows.has(where.key) ? update : {}), updatedAt: new Date()};
        rows.set(where.key, row); return row;
      }),
      update: vi.fn(async ({where, data}) => { const row = {...rows.get(where.key), ...data}; rows.set(where.key, row); return row; }),
    },
    auditLog: {create: vi.fn()}, $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async () => [{acquired: true}]),
    user: {findUnique: vi.fn(async () => ({id:'u', status:'ACTIVE', isDemo:false, roles:[{role:{code:'ADMIN', permissions:[{permission:{code:'system:admin'}}]}}], clientScopes:[], warehouseScopes:[]}))},
  };
  db.$transaction = vi.fn(async fn => fn(db));
  const apply = vi.fn(async (_client, _body, _user, key) => completeDuplicateApply(db, key));
  const queue = new DuplicateApplyQueue(db, apply);
  const body = {group:{id:'g',name:'Группа'},revision:null,previewKey:'p'};
  const user:any = {id:'u'};
  return {db,rows,apply,queue,body,user};
}
afterEach(() => vi.unstubAllEnvs());

// TEST: durable acceptance replaces the request rejected while WB holds its publisher lock.
describe('duplicate apply queue', () => {
  it('accepts once without calling publisher and survives a worker restart', async () => {
    const f=fixture(); const job=await f.queue.enqueue('c',f.body,f.user);
    expect(job.status).toBe('WAITING'); expect(f.apply).not.toHaveBeenCalled();
    expect(await f.queue.enqueue('c',f.body,f.user)).toEqual(job);
    expect(f.db.auditLog.create).toHaveBeenCalledOnce();
    const restarted=new DuplicateApplyQueue(f.db,f.apply); await restarted.tick(); await restarted.tick();
    expect(f.apply).toHaveBeenCalledOnce(); expect((await restarted.list('c'))[0].status).toBe('APPLIED');
  });
  it('keeps lock timeouts pending and applies on the following attempt', async () => {
    const f=fixture(); await f.queue.enqueue('c',f.body,f.user);
    f.apply.mockRejectedValueOnce({code:'P2010',meta:{code:'55P03'}});
    await f.queue.tick(); expect((await f.queue.list('c'))[0].status).toBe('WAITING');
    await f.queue.tick(); expect((await f.queue.list('c'))[0].status).toBe('APPLIED');
  });
  it('records changed preview failure rather than silently applying stale settings', async () => {
    const f=fixture(); await f.queue.enqueue('c',f.body,f.user);
    f.apply.mockRejectedValueOnce(new ConflictException('Повторите предпросмотр'));
    await f.queue.tick(); expect((await f.queue.list('c'))[0]).toMatchObject({status:'FAILED',message:'Повторите предпросмотр'});
    await f.queue.tick(); expect(f.apply).toHaveBeenCalledOnce();
    expect(await f.queue.existing('c',f.user,f.body)).toBeNull();
    expect((await f.queue.enqueue('c',f.body,f.user)).status).toBe('WAITING');
  });
  it('rechecks the author permissions before applying', async () => {
    const f=fixture(); await f.queue.enqueue('c',f.body,f.user); f.db.user.findUnique.mockResolvedValue(null);
    await f.queue.tick(); expect(f.apply).not.toHaveBeenCalled(); expect((await f.queue.list('c'))[0].status).toBe('FAILED');
  });
  it('does not overwrite committed success when the response is lost', async () => {
    const f=fixture(); await f.queue.enqueue('c',f.body,f.user);
    f.apply.mockImplementationOnce(async (_c,_b,_u,key) => {await completeDuplicateApply(f.db,key);throw new Error('connection lost');});
    await f.queue.tick(); expect((await f.queue.list('c'))[0].status).toBe('APPLIED');
  });
  it('does not process jobs on the sold VM with the flag disabled', async () => {
    const f=fixture(); await f.queue.enqueue('c',f.body,f.user);vi.stubEnv('WMS_DUPLICATE_APPLY_QUEUE_ENABLED','false');
    await f.queue.tick();expect(f.apply).not.toHaveBeenCalled();expect(await f.queue.list('c')).toEqual([]);
  });
  it('refuses a second different request for the same pending group', async () => {
    const f=fixture();await f.queue.enqueue('c',f.body,f.user);
    await expect(f.queue.enqueue('c',{...f.body,previewKey:'new'},f.user)).rejects.toThrow('уже ожидает');
  });
  it('does not claim work already claimed by another replica', async () => {
    const f=fixture();await f.queue.enqueue('c',f.body,f.user);f.db.$queryRaw.mockResolvedValue([{acquired:false}]);
    await f.queue.tick();expect(f.apply).not.toHaveBeenCalled();
  });
});
