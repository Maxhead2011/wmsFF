import { afterEach, describe, expect, it, vi } from 'vitest';
import { fboProgressState, reconcileFboProgress, fboProgressLabels, fboRetryableTransactionError } from './fbo-progress-status';
const lines = [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }];
const units = [{ requestItemId: 'a', state: 'PICKED' }, { requestItemId: 'a', state: 'PACKED' }, { requestItemId: 'b', state: 'PICKED' }];
afterEach(() => vi.unstubAllEnvs());
describe('FBO read-only labels', () => {
  // TEST: a deliberately closed partial pick uses its frozen target, not the original demand.
  const page = (closure: unknown, counts = [{ requestId: 'r', requestItemId: 'a', state: 'PACKED', _count: { _all: 1 } }]) => ({
    fboAssembly: { findMany: vi.fn().mockResolvedValue([{ requestId: 'r', phase: 'PACKING', pickClosure: closure, request: { items: lines } }]) },
    fboAssemblyUnit: { groupBy: vi.fn().mockResolvedValue(counts) },
  });
  it('keeps reads disabled in the sold configuration', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'false');
    expect(await fboProgressLabels({} as any, ['r'])).toEqual({});
  });
  it('uses exact per-line aggregate counts', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    expect(await fboProgressLabels(page(null) as any, ['r'])).toEqual({ r: 'В работе' });
  });
  it('labels packed partial closure without reopening excluded lines', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    expect(await fboProgressLabels(page({ version: 1, quantities: { a: 1, b: 0 } }) as any, ['r']))
      .toEqual({ r: 'Упаковано, ожидает проверки' });
  });
  it('does not label invalid closures as packed', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    expect(await fboProgressLabels(page({ version: 1, quantities: { a: 1 } }) as any, ['r'])).toEqual({});
  });
});
describe('FBO progress', () => {
  // TEST: reproduced with concurrent FOR UPDATE on disposable PostgreSQL.
  it('retries only explicit aborted SQL transactions', () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    expect(fboRetryableTransactionError({ code: 'P2010', meta: { code: '40001' } })).toBe(true);
    expect(fboRetryableTransactionError({ code: 'P2010', meta: { code: '40P01' } })).toBe(true);
    expect(fboRetryableTransactionError({ code: 'P2010', meta: { code: '57014' } })).toBe(false);
    expect(fboRetryableTransactionError({ code: 'P2028' })).toBe(false);
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'false');
    expect(fboRetryableTransactionError({ code: 'P2010', meta: { code: '40001' } })).toBe(false);
    expect(fboRetryableTransactionError({ code: 'P2034' })).toBe(true);
  });
  // TEST: packing must not rescan all picked units on every subsequent barcode.
  it('does not recount settled packing progress', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    const readUnits = vi.fn().mockRejectedValue(new Error('Unnecessary full scan'));
    await reconcileFboProgress({ clientRequest: { findUnique: vi.fn().mockResolvedValue({ status: 'IN_WORK', items: lines }) },
      fboAssembly: { findUnique: vi.fn().mockResolvedValue({ phase: 'PACKING' }) },
      fboAssemblyUnit: { findMany: readUnits } } as any, 'r', 'u');
    expect(readUnits).not.toHaveBeenCalled();
  });
  // TEST: terminal lifecycle states must never be reopened by late scans.
  it.each(['DONE', 'CANCELLED', 'REJECTED', 'PACKED'])('preserves %s', async status => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    await reconcileFboProgress({ clientRequest: { findUnique: vi.fn().mockResolvedValue({ status, items: lines }) } } as any, 'r', 'u');
  });
  it('does not advance partially picked requests', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    const update = vi.fn();
    await reconcileFboProgress({ clientRequest: { findUnique: vi.fn().mockResolvedValue({ status: 'IN_WORK', items: lines }) },
      fboAssembly: { findUnique: vi.fn().mockResolvedValue({ phase: 'PICKING' }), update },
      fboAssemblyUnit: { findMany: vi.fn().mockResolvedValue(units.slice(0, 1)) } } as any, 'r', 'u');
    expect(update).not.toHaveBeenCalled();
  });
  // TEST: request2494 has full picking including units already packed.
  it('counts packing as previously picked material', () => expect(fboProgressState(lines, units)).toEqual({ started: true, picked: true, packed: false }));
  it('does not hide missing SKU behind an excess', () => expect(fboProgressState(lines, units.map(u => ({ ...u, requestItemId: 'a' }))).picked).toBe(false));
  it('does not finish an empty request', () => expect(fboProgressState([], []).picked).toBe(false));
  it('excludes returned material', () => expect(fboProgressState(lines, units.map(u => ({ ...u, state: 'RETURNED' }))).started).toBe(false));
  it('reports all packed independently of control', () => expect(fboProgressState(lines, units.map(u => ({ ...u, state: 'PACKED' }))).packed).toBe(true));
  it('does no reads in sold/disabled configuration', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'false');
    await reconcileFboProgress({} as any, 'r', 'u');
  });
  it.each(['PICKING', 'PACKING'])('repairs stale submitted/%s state atomically without completing control', async phase => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    const tx = { clientRequest: { findUnique: vi.fn().mockResolvedValue({ status: 'SUBMITTED', items: lines }), update: vi.fn() },
      fboAssembly: { findUnique: vi.fn().mockResolvedValue({ phase }), update: vi.fn() },
      fboAssemblyUnit: { findMany: vi.fn().mockResolvedValue(units) }, auditLog: { create: vi.fn() } };
    await reconcileFboProgress(tx as any, 'r', 'u');
    expect(tx.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { status: 'IN_WORK' } });
    if (phase === 'PICKING') expect(tx.fboAssembly.update).toHaveBeenCalledWith({ where: { requestId: 'r' }, data: { phase: 'PACKING' } });
    else expect(tx.fboAssembly.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
