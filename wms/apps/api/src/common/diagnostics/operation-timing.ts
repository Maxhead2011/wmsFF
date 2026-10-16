import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { createOperationHistogram } from './operation-histogram';

type Stage = 'database' | 'external' | 'calculation' | 'fbs_task_load' | 'fbs_wb_preflight' | 'fbs_stock_reserve' | 'fbs_response' | 'fbs_request_status' | 'fbs_notifications' | 'fbs_sticker' | 'fbs_complete' | 'fbs_scan';
type Timing = { count: number; totalMs: number; maxMs: number };
type Context = { traceId: string; stages: Partial<Record<Stage, Timing>> };
export type OperationReport = Context & { operation: string; durationMs: number; failed: boolean; statusCode?: number };
type Sink = (report: OperationReport) => void;
const context = new AsyncLocalStorage<Context>();
// FIX: bounded per-process diagnostics: slow/error requests plus 1/100 fast requests.
// Stage totals may overlap; they are not a decomposition of wall-clock latency.
export function boundedTimingSink(log: (record: object) => void, now = Date.now): Sink {
  let windowStart = now(), emitted = 0, suppressed = 0, fast = 0;
  return report => {
    const time = now();
    if (time - windowStart >= 60_000 || time < windowStart) {
      if (suppressed) log({event:'wms_operation_suppressed',count:suppressed});
      windowStart = time; emitted = 0; suppressed = 0;
    }
    if (!report.failed && report.durationMs < 1000) {
      fast = (fast + 1) % 100;
      if (fast !== 0) return;
    }
    if (emitted >= 60) { suppressed++; return; }
    emitted++;
    log({event:'wms_operation',...report});
  };
}
const detailSink = boundedTimingSink(record => console.info(JSON.stringify(record)));
// FIX: own-WMS opt-in; one bounded summary per minute counts fast responses too.
const histogram = process.env.WMS_OPERATION_HISTOGRAM_ENABLED === 'true'
  ? createOperationHistogram(record => console.info(JSON.stringify(record))) : null;
if (histogram) setInterval(() => histogram.flush(), 60_000).unref();
const defaultSink: Sink = report => { histogram?.record(report); detailSink(report); };
const rounded = (n: number) => Math.round(n * 100) / 100;
function publish(sink: Sink, report: OperationReport) {
  // FIX: diagnostics must never change an operation's result; no payload, SQL or credentials.
  try { sink(report); } catch { /* logging is best effort */ }
}
function snapshot(state: Context): Context {
  return { traceId: state.traceId, stages: Object.fromEntries(Object.entries(state.stages).map(([key, value]) => [key, { ...value, totalMs: rounded(value.totalMs), maxMs: rounded(value.maxMs) }])) };
}
export async function measureOperation<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
  const state = context.getStore();
  if (!state) return operation();
  const start = performance.now();
  try { return await operation(); }
  finally {
    const elapsed = performance.now() - start;
    const timing = state.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0 };
    timing.count++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed);
  }
}
export async function operationTiming<T>(operation: string, work: () => Promise<T>, sink: Sink = defaultSink): Promise<T> {
  const state: Context = { traceId: context.getStore()?.traceId ?? randomUUID(), stages: {} };
  const start = performance.now(); let failed = false;
  return context.run(state, async () => {
    try { return await work(); } catch (error) { failed = true; throw error; }
    finally { publish(sink, { ...snapshot(state), operation, failed, durationMs: rounded(performance.now() - start) }); }
  });
}
export function timingMiddleware(sink: Sink = defaultSink) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.WMS_OPERATION_TIMING_ENABLED !== 'true') return next();
    const state: Context = { traceId: randomUUID(), stages: {} };
    const start = performance.now(); let recorded = false;
    const finish = () => {
      if (recorded) return; recorded = true;
      res.removeListener('finish', finish); res.removeListener('close', finish);
      // Express resolves the route after middleware. Never fall back to raw URLs.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      publish(sink, { ...snapshot(state), operation: `${req.method} ${route}`, statusCode: res.statusCode,
        failed: res.statusCode >= 500 || !res.writableFinished, durationMs: rounded(performance.now() - start) });
    };
    res.once('finish', finish); res.once('close', finish);
    return context.run(state, next);
  };
}
