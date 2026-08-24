import { describe, expect, it, vi } from 'vitest';
import {
  applyCandidateSnapshot,
  collectCandidateSnapshot,
  parseReconcileArguments,
} from '../src/scripts/reconcile-archived-empty-pallet-boxes';

describe('archived-empty pallet-box reconciliation CLI', () => {
  // TEST: no flags always means read-only dry-run.
  it('defaults to dry-run', () => {
    expect(parseReconcileArguments([])).toEqual({
      apply: false,
      expectedCount: undefined,
      expectedDigest: undefined,
    });
  });

  // TEST: mass mutation cannot start without an explicit count from a previous dry-run.
  it('rejects apply without the expected candidate count', () => {
    expect(() => parseReconcileArguments(['--apply'])).toThrow(/expected-count/i);
  });

  // TEST: an exact non-negative expected count enables the guarded apply mode.
  it('accepts guarded apply arguments', () => {
    const digest = 'a'.repeat(64);
    expect(parseReconcileArguments([
      '--apply',
      '--expected-count=12',
      `--expected-digest=${digest}`,
    ])).toEqual({
      apply: true,
      expectedCount: 12,
      expectedDigest: digest,
    });
  });

  // TEST: dry-run freezes only eligible IDs and never invokes the mutating lifecycle method.
  it('collects an exact read-only candidate snapshot', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'box-1' }, { id: 'box-2' }])
      .mockResolvedValueOnce([]);
    const lifecycle = {
      previewIfArchivedAndEmpty: vi.fn()
        .mockResolvedValueOnce({ eligible: true })
        .mockResolvedValueOnce({ eligible: false }),
      detachIfArchivedAndEmpty: vi.fn(),
    };

    const snapshot = await collectCandidateSnapshot(
      { box: { findMany } } as never,
      lifecycle as never,
    );

    expect(snapshot.boxIds).toEqual(['box-1']);
    expect(snapshot.count).toBe(1);
    expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(lifecycle.detachIfArchivedAndEmpty).not.toHaveBeenCalled();
  });

  // TEST: apply mutates only the exact frozen IDs and counts successful idempotent detachments.
  it('applies only the frozen candidate snapshot', async () => {
    const detachIfArchivedAndEmpty = vi.fn()
      .mockResolvedValueOnce({ detached: true })
      .mockResolvedValueOnce({ detached: false });

    const result = await applyCandidateSnapshot(
      { detachIfArchivedAndEmpty } as never,
      ['box-1', 'box-2'],
    );

    expect(detachIfArchivedAndEmpty).toHaveBeenCalledTimes(2);
    expect(detachIfArchivedAndEmpty).toHaveBeenNthCalledWith(1, {
      boxId: 'box-1',
      reason: 'background-reconciliation',
    });
    expect(detachIfArchivedAndEmpty).toHaveBeenNthCalledWith(2, {
      boxId: 'box-2',
      reason: 'background-reconciliation',
    });
    expect(result).toEqual({ approved: 2, detached: 1 });
  });
});
