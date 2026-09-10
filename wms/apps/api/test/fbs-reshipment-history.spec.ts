import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFbsAttemptHistory, hasFbsAttemptHistory, readFbsAttemptHistory } from '../src/common/shipment-history/fbs-attempt-history';
import { recordReshipmentTransition } from '../src/modules/marketplace-connections/fbs-reshipment-transition';

// TEST: reshipment history survives normal synchronization and feature pause.
describe('reshipment transition history', () => {
  afterEach(() => vi.unstubAllEnvs());
  const link = { id: 'link', clientId: 'c', connectionId: 'wb', orderId: '123', requestId: 'r',
    lastCategory: 'shipped', lastSupplierStatus: 'complete', lastSupplyId: 'old', syncStatus: 'ACTIVE' };
  const order = { marketplace: 'WILDBERRIES', id: '123', connectionId: 'wb', supplierStatus: 'confirm', wbStatus: 'waiting', supplyId: 'new' };
  const task = { id: 'attempt', requestId: 'r' };
  it('reads previous work/payroll with only the new reshipment feature enabled', async () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'false'); vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true');
    expect(hasFbsAttemptHistory()).toBe(true);
    const db = { fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([]) } };
    await readFbsAttemptHistory(db as never, {});
    expect(db.fbsAssemblyAttemptHistory.findMany).toHaveBeenCalledTimes(1);
  });
  it('keeps old history visible in read-only mode', () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED','false'); vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','read-only');
    expect(hasFbsAttemptHistory()).toBe(true);
  });
  it('retains SAME_ITEM original request evidence without counting another physical attempt globally', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true');
    const task = { id: 'physical', requestId: 'original', status: 'COMPLETED', completedAt: '2026-09-01T10:00:00Z' };
    const db = { fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([]) },
      fbsReshipmentRun: { findMany: vi.fn().mockResolvedValue([{ snapshot: { physicalEvidence: [{ task, link: {requestId:'original'} }] } }]) } };
    const history = await readFbsAttemptHistory(db as never, {requestId:'original'});
    expect(history).toHaveLength(1);
    expect(history[0].task.requestId).toBe('original');
    expect(db.fbsReshipmentRun.findMany.mock.calls[0][0].where.sourceRequestIds).toEqual({hasSome:['original']});
    db.fbsReshipmentRun.findMany.mockClear();
    const physicalRows = [{id:'physical'}];
    await appendFbsAttemptHistory(db as never, physicalRows, {clientId:'client'});
    expect(physicalRows).toHaveLength(1);
    expect(db.fbsReshipmentRun.findMany).not.toHaveBeenCalled();
  });
  it('records an exact real supplier transition without changing stock or links', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true');
    const db = { auditLog: { upsert: vi.fn().mockResolvedValue({}) } };
    await recordReshipmentTransition(db as never, link, order, task);
    const args = db.auditLog.upsert.mock.calls[0][0];
    expect(args.create.action).toBe('FBS_WB_RETURNED_TO_ASSEMBLY');
    expect(args.create.payload).toMatchObject({ sourceSupplyId: 'old', targetSupplyId: 'new', assemblyId: 'attempt', requestId: 'r' });
    expect(args.update).toEqual({});
  });
  it('deduplicates repeat synchronization of the same transition', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true'); const db = { auditLog: { upsert: vi.fn().mockResolvedValue({}) } };
    await recordReshipmentTransition(db as never, link, order, task);
    await recordReshipmentTransition(db as never, link, order, task);
    expect(db.auditLog.upsert.mock.calls[0][0].where).toEqual(db.auditLog.upsert.mock.calls[1][0].where);
  });
  it.each([
    { next: { ...order, wbStatus: 'sold' } },
    { next: { ...order, supplierStatus: 'complete' } },
    { next: { ...order, marketplace: 'OZON' } },
    { next: { ...order, id: '456' } },
    { next: { ...order, supplyId: null } },
  ])('does not label an unproven transition as a WB return: $next', async ({next}) => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true'); const db = { auditLog: { upsert: vi.fn() } };
    await recordReshipmentTransition(db as never, link, next, task);
    expect(db.auditLog.upsert).not.toHaveBeenCalled();
  });
  it('does not query new history in sold deployments', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','false'); vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED','false');
    const db = { auditLog: { upsert: vi.fn() }, fbsAssemblyAttemptHistory: { findMany: vi.fn() } };
    await recordReshipmentTransition(db as never, link, order, task);
    expect(await readFbsAttemptHistory(db as never, {})).toEqual([]);
    expect(db.auditLog.upsert).not.toHaveBeenCalled();
    expect(db.fbsAssemblyAttemptHistory.findMany).not.toHaveBeenCalled();
  });
});
