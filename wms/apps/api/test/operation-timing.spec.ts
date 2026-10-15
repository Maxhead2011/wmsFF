import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationTiming, measureOperation, timingMiddleware, boundedTimingSink } from '../src/common/diagnostics/operation-timing';
import { EventEmitter } from 'node:events';

afterEach(() => vi.unstubAllEnvs());
describe('operation diagnostics', () => {
  // TEST: diagnostics cannot recreate the high-volume log problem from the audit.
  it('samples fast requests and bounds slow request logs per minute', () => {
    let now = 0;
    const log = vi.fn(), sink = boundedTimingSink(log, () => now);
    const row = {traceId:'trace',stages:{},operation:'GET /safe',failed:false,durationMs:1};
    for(let i=0;i<100;i++) sink(row);
    expect(log).toHaveBeenCalledTimes(1);
    for(let i=0;i<100;i++) sink({...row,durationMs:2000});
    expect(log).toHaveBeenCalledTimes(60);
    now = 60000; sink({...row,failed:true});
    expect(log).toHaveBeenCalledTimes(62);
    expect(log.mock.calls[60][0]).toMatchObject({event:'wms_operation_suppressed',count:41});
  });
  // TEST: concurrent scans must not attribute database time to another request.
  it('isolates concurrent operations and preserves results', async () => {
    const reports: any[] = [];
    const run = (name: string) => operationTiming(name, async () => {
      await measureOperation('database', () => new Promise(resolve => setTimeout(resolve, 5)));
      return name;
    }, row => reports.push(row));
    expect(await Promise.all([run('fbo.plan'), run('fbs.scan')])).toEqual(['fbo.plan','fbs.scan']);
    expect(reports.map(r => r.operation).sort()).toEqual(['fbo.plan','fbs.scan']);
    expect(new Set(reports.map(r => r.traceId)).size).toBe(2);
    for (const row of reports) expect(row.stages.database.count).toBe(1);
  });
  it('records failure without swallowing the original error or logging its secrets', async () => {
    const reports: any[] = [];
    const error = new Error('token=secret');
    await expect(operationTiming('fbo.scan', () => measureOperation('external', async () => { throw error; }), r => reports.push(r))).rejects.toBe(error);
    expect(reports[0].failed).toBe(true);
    expect(reports[0].stages.external.count).toBe(1);
    expect(JSON.stringify(reports)).not.toContain('secret');
  });
  it('logging failures cannot break warehouse operations', async () => {
    expect(await operationTiming('fbo.scan', async () => 42, () => { throw new Error('logger'); })).toBe(42);
  });
  it('keeps sold WMS disabled and does not read request bodies', () => {
    const res = new EventEmitter();
    const next = vi.fn(); const emit = vi.fn();
    timingMiddleware(emit)({} as any, res as any, next);
    res.emit('finish');
    expect(next).toHaveBeenCalledOnce(); expect(emit).not.toHaveBeenCalled();
  });
  it('records a request once, with route template instead of identifiers and query secrets', () => {
    vi.stubEnv('WMS_OPERATION_TIMING_ENABLED', 'true');
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
    const emit = vi.fn();
    timingMiddleware(emit)({method:'GET', route:{path:'/boxes/:id'}, originalUrl:'/boxes/secret?token=password'} as any, res as any, () => {});
    res.emit('finish'); res.emit('close');
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0][0].operation).toBe('GET /boxes/:id');
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/secret|password/);
  });
});
