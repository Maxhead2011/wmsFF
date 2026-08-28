import { describe, expect, it, vi } from 'vitest';
import { rebuildFbsRoutesBatch } from './fbsRouteBatch';

describe('rebuildFbsRoutesBatch', () => {
  // TEST: all visible active requests are rebuilt sequentially to avoid reservation races.
  it('rebuilds every request in order and reports progress', async () => {
    const calls: string[] = [];
    const progress: Array<{ completed: number; total: number }> = [];

    const result = await rebuildFbsRoutesBatch(
      [
        { id: 'request-401', number: 401 },
        { id: 'request-402', number: 402 },
      ],
      async (requestId) => {
        calls.push(requestId);
      },
      (state) => progress.push({ completed: state.completed, total: state.total }),
    );

    expect(calls).toEqual(['request-401', 'request-402']);
    expect(progress).toEqual([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);
    expect(result).toEqual({ total: 2, succeeded: 2, failed: 0, failures: [] });
  });

  // TEST: one broken request must not prevent routes for the remaining requests from rebuilding.
  it('continues after an individual request fails', async () => {
    const rebuild = vi.fn(async (requestId: string) => {
      if (requestId === 'request-402') throw new Error('Маршрут занят сборщиком');
    });

    const result = await rebuildFbsRoutesBatch(
      [
        { id: 'request-401', number: 401 },
        { id: 'request-402', number: 402 },
        { id: 'request-403', number: 403 },
      ],
      rebuild,
    );

    expect(rebuild).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      {
        requestId: 'request-402',
        requestNumber: 402,
        message: 'Маршрут занят сборщиком',
      },
    ]);
  });
});
