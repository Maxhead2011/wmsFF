import { describe, expect, it, vi } from 'vitest';
import { requireAdminRecount, validateRecountTask, rebuildRecountRequests, runAdminRecount } from '../src/modules/marketplace-connections/tsd-admin-recount-release';

const admin: any = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: [], activeWarehouseId: 'wh', writableWarehouseIds: ['wh'] };
const task: any = { id: 'task', requestId: 'request', clientId: 'client', skuId: 'sku', marketplace: 'WILDBERRIES',
  status: 'IN_PROGRESS', itemCount: 1, kiz: 'physical', boxId: 'box' };
const source: any = { id: 'box', clientId: 'client', warehouseId: 'wh', status: 'active' };
const request: any = { id: 'request', clientId: 'client', warehouseId: 'wh', status: 'IN_PROGRESS' };
const link: any = { requestId: 'request', syncStatus: 'ACTIVE', lastCategory: 'active', lastSupplierStatus: 'confirm' };

describe('admin physical recount release safeguards', () => {
  // TEST: physical possession authorizes unfinished pick release, never a completed shipment.
  it('accepts an administrator and a physically scanned unfinished WB unit', () => {
    expect(() => requireAdminRecount(admin, true)).not.toThrow();
    expect(() => validateRecountTask(task, source, 'sku', ['physical'], request, link)).not.toThrow();
  });
  it.each([{ roleCodes: ['CLIENT', 'ADMIN'] }, { roleCodes: ['OPERATOR'] }, { isDemo: true }])('rejects forged or demo administration %j', changes => {
    expect(() => requireAdminRecount({ ...admin, ...changes }, true)).toThrow();
  });
  it('requires the WMSFF feature flag', () => expect(() => requireAdminRecount(admin, false)).toThrow());
  it.each([{ status: 'COMPLETED' }, { completedAt: new Date() }, { cargoPackingId: 'packed' }, { marketplace: 'OZON' },
    { itemCount: 2 }, { clientId: 'other' }, { skuId: 'other' }, { kiz: 'another-unit' }, { boxId: 'other' }])('protects unrelated or shipped work %j', changes => {
    expect(() => validateRecountTask({ ...task, ...changes }, source, 'sku', ['physical'], request, link)).toThrow();
  });
  it.each([{ lastCategory: 'cancelled' }, { lastSupplierStatus: 'complete' }, { syncStatus: 'CONFLICT' }, { requestId: 'other' }])('rejects inactive or delivered WB link %j', changes => {
    expect(() => validateRecountTask(task, source, 'sku', ['physical'], request, { ...link, ...changes })).toThrow();
  });
  it.each([{ status: 'DONE' }, { warehouseId: 'other' }, { clientId: 'other' }])('protects request scope %j', changes => {
    expect(() => validateRecountTask(task, source, 'sku', ['physical'], { ...request, ...changes }, link)).toThrow();
  });
  it('rebuilds only distinct affected requests and propagates failures for retry', async () => {
    const repair = vi.fn().mockResolvedValue({ repaired: true });
    await rebuildRecountRequests(['r1', 'r1', 'r2'], repair);
    expect(repair.mock.calls).toEqual([['r1'], ['r2']]);
    repair.mockRejectedValueOnce(new Error('route unavailable'));
    await expect(rebuildRecountRequests(['r1'], repair)).rejects.toThrow('route unavailable');
  });
});

// TEST: durable external/local boundary; retries never repeat stock correction or silently skip routes.
describe('admin recount orchestration', () => {
  function fixture() {
    let audit: any = null;
    const held: any[] = [];
    const db: any = { auditLog: {
      findUnique: vi.fn(async () => audit),
      create: vi.fn(async ({ data }: any) => { audit = structuredClone(data); return audit; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(audit, structuredClone(data)); return audit; }),
    }, fbsTsdAssembly: { updateMany: vi.fn(async ({ data }: any) => { held.push(data); return { count: 1 }; }) } };
    db.$transaction = vi.fn(async (fn: any) => {
      const before = structuredClone(audit), length = held.length;
      try { return await fn(db); } catch (e) { audit = before; held.splice(length); throw e; }
    });
    const context: any = { tasks: [{ ...task, updatedAt: new Date(1) }], requestIds: ['request'], snapshot: 'snapshot' };
    const load = vi.fn(async () => context), releaseWb = vi.fn(async () => {}), apply = vi.fn(async () => {}), repair = vi.fn(async () => {});
    const options: any = { db, user: admin, id: 'audit', fingerprint: 'fingerprint', snapshot: 'snapshot', load, releaseWb, apply, repair };
    return { db, load, releaseWb, apply, repair, options, audit: () => audit, held };
  }
  it('holds only affected tasks, applies once and retries only failed routes', async () => {
    const f = fixture(); f.repair.mockRejectedValueOnce(new Error('route failure'));
    await expect(runAdminRecount(f.options)).rejects.toThrow('route failure');
    expect(f.audit().payload.phase).toBe('APPLIED');
    await runAdminRecount(f.options);
    expect(f.apply).toHaveBeenCalledTimes(1); expect(f.releaseWb).toHaveBeenCalledTimes(1);
    expect(f.held[0]).toMatchObject({ status: 'ADMIN_RECOUNT_PENDING' });
    expect(f.repair).toHaveBeenCalledWith('request'); expect(f.audit().payload.phase).toBe('DONE');
    await runAdminRecount(f.options); expect(f.repair).toHaveBeenCalledTimes(2);
  });
  it('does not change stock when WB is unavailable; retries the same held operation', async () => {
    const f = fixture(); f.releaseWb.mockRejectedValueOnce(new Error('WB unavailable'));
    await expect(runAdminRecount(f.options)).rejects.toThrow('WB unavailable');
    expect(f.apply).not.toHaveBeenCalled(); expect(f.audit().payload.phase).toBe('PREPARED');
    await runAdminRecount(f.options); expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it('rejects stale previews without holding any work', async () => {
    const f = fixture(); f.options.snapshot = 'old';
    await expect(runAdminRecount(f.options)).rejects.toThrow(); expect(f.held).toHaveLength(0);
  });
  it('rejects altered retry payloads', async () => {
    const f = fixture(); await runAdminRecount(f.options); f.options.fingerprint = 'changed';
    await expect(runAdminRecount(f.options)).rejects.toThrow(); expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it('rolls back local failure and keeps the durable preparation for safe retry', async () => {
    const f = fixture(); f.apply.mockRejectedValueOnce(new Error('database failure'));
    await expect(runAdminRecount(f.options)).rejects.toThrow('database failure');
    expect(f.audit().payload.phase).toBe('PREPARED'); expect(f.repair).not.toHaveBeenCalled();
    await runAdminRecount(f.options); expect(f.audit().payload.phase).toBe('DONE');
  });
  it('lets the admin cancel a failed preparation on the TSD without returning stock', async () => {
    const f = fixture(); f.releaseWb.mockRejectedValueOnce(new Error('WB unavailable'));
    await expect(runAdminRecount(f.options)).rejects.toThrow();
    const result = await runAdminRecount({ ...f.options, abort: true });
    expect(result.state).toBe('RECOUNT_CANCELLED'); expect(f.apply).not.toHaveBeenCalled();
    expect(f.held.at(-1)).toMatchObject({ status: 'RESCAN_REQUIRED', wbMetaStatus: 'PENDING' });
    expect(f.audit().payload.phase).toBe('ABORTED');
    expect((await runAdminRecount(f.options)).state).toBe('RECOUNT_CANCELLED');
  });
  it('does not undo a committed count when abort races with completed application', async () => {
    const f = fixture(); f.repair.mockRejectedValueOnce(new Error('route error'));
    await expect(runAdminRecount(f.options)).rejects.toThrow();
    await runAdminRecount({ ...f.options, abort: true });
    expect(f.apply).toHaveBeenCalledTimes(1); expect(f.audit().payload.phase).toBe('DONE');
  });
  it('also refreshes requests waiting for the newly available SKU, without changing their order ownership', async () => {
    const f = fixture(); f.apply.mockResolvedValue({ affectedRequestIds: ['waiting-request', 'request'] });
    await runAdminRecount(f.options);
    expect(f.repair.mock.calls).toEqual([['request'], ['waiting-request']]);
  });
});
