import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readTsdMonitorHistory } from '../src/modules/administration/tsd-monitor-history';
const url = process.env.FBO_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:554(?:69|85)\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw Error('Dedicated local test DB only');
describe.skipIf(!url).sequential('compact TSD monitor history', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const prefix = randomUUID();
  // Isolate the time window without touching warehouse records.
  const since = new Date('2090-01-01T00:00:00Z');
  afterEach(async () => { await db.tsdOperation.deleteMany({ where: { deviceId: prefix } }); vi.unstubAllEnvs(); });
  afterAll(() => db.$disconnect());
  async function row(operationType: string, status: 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVIEW' = 'ACCEPTED', age = 1) {
    return db.tsdOperation.create({ data: { deviceId: prefix, operationKey: randomUUID(), operationType, status,
      createdAt: new Date(since.getTime() + age * 1000), screenshotData: 'x'.repeat(300000),
      payload: { deviceCode: prefix, requestId: 'request', requestNumber: 1029, workerName: 'Picker', barcode: '2051234567890',
        response: { route: 'x'.repeat(400000) }, screenshotData: 'x'.repeat(300000) },
    } });
  }
  // TEST: a monitoring read must not deserialize large audit responses or screenshot blobs.
  it('keeps display fields and omits heavy fields without changing stored history', async () => {
    vi.stubEnv('WMS_TSD_MONITOR_COMPACT_ENABLED', 'true');
    const saved = await row('tsd_api_action');
    const result = await readTsdMonitorHistory(db as never, 'activity', since);
    expect(result).toHaveLength(1);
    expect(result[0].payload).toMatchObject({ requestNumber: 1029, workerName: 'Picker', barcode: '2051234567890' });
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(result[0]).not.toHaveProperty('screenshotData');
    expect(result[0].payload).not.toHaveProperty('response');
    expect((await db.tsdOperation.findUniqueOrThrow({ where: { id: saved.id } })).payload).toEqual(saved.payload);
  });
  // TEST: old clients' events, date boundary and rejected events retain existing inclusion semantics.
  it('preserves error/activity filters, descending order and the date boundary', async () => {
    vi.stubEnv('WMS_TSD_MONITOR_COMPACT_ENABLED', 'true');
    await row('monitor_command', 'NEEDS_REVIEW'); await row('monitor_heartbeat'); await row('monitor_message');
    await row('tsd_api_action', 'REJECTED', -1);
    const a = await row('assembly_stage', 'ACCEPTED', 2);
    const e = await row('tsd_api_action', 'REJECTED', 3);
    expect((await readTsdMonitorHistory(db as never, 'activity', since)).map(r => r.id)).toEqual([e.id, a.id]);
    expect((await readTsdMonitorHistory(db as never, 'errors', since)).map(r => r.id)).toEqual([e.id]);
  });
  // TEST: deployments without the opt-in flag retain the previous Prisma query and response.
  it('retains legacy behavior when disabled', async () => {
    vi.stubEnv('WMS_TSD_MONITOR_COMPACT_ENABLED', 'false');
    await row('tsd_api_action');
    const result = await readTsdMonitorHistory(db as never, 'activity', since);
    expect(result[0].payload).toHaveProperty('response');
  });
});
