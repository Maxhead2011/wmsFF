import { expect, it } from 'vitest';
import { formatMonitorEvent } from '../src/modules/marketplace-connections/fbs-stock-monitoring.service';

// TEST: Prisma BIGINT must remain an exact JSON number, including legacy NULL IDs.
it('serializes a monitor event with a large WB size without leaking bigint', () => {
  const now = new Date();
  const event = { chrtId: 2158257494n, saleAt: now, detectedAt: now, deadlineAt: now, createdAt: now, updatedAt: now } as never;
  expect(JSON.parse(JSON.stringify(formatMonitorEvent(event))).chrtId).toBe(2158257494);
  expect(formatMonitorEvent({ ...event as object, chrtId: null } as never).chrtId).toBeNull();
  expect(() => formatMonitorEvent({ ...event as object, chrtId: 9007199254740993n } as never)).toThrow();
});
