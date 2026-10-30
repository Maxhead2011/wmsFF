import { afterEach, describe, expect, it, vi } from 'vitest';
import { fboProgressState, reconcileFboProgress } from './fbo-progress-status';
const lines = [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }];
const units = [{ requestItemId: 'a', state: 'PICKED' }, { requestItemId: 'a', state: 'PACKED' }, { requestItemId: 'b', state: 'PICKED' }];
afterEach(() => vi.unstubAllEnvs());
describe('FBO progress', () => {
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
  it('repairs stale submitted/picking state atomically without completing control', async () => {
    vi.stubEnv('WMS_FBO_PROGRESS_STATUS_ENABLED', 'true');
    const tx = { clientRequest: { findUnique: vi.fn().mockResolvedValue({ status: 'SUBMITTED', items: lines }), update: vi.fn() },
      fboAssembly: { findUnique: vi.fn().mockResolvedValue({ phase: 'PICKING' }), update: vi.fn() },
      fboAssemblyUnit: { findMany: vi.fn().mockResolvedValue(units) }, auditLog: { create: vi.fn() } };
    await reconcileFboProgress(tx as any, 'r', 'u');
    expect(tx.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { status: 'IN_WORK' } });
    expect(tx.fboAssembly.update).toHaveBeenCalledWith({ where: { requestId: 'r' }, data: { phase: 'PACKING' } });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
