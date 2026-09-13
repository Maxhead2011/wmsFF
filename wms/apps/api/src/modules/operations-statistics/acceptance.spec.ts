import { describe, expect, it } from 'vitest';
import { acceptanceObservation } from './acceptance';
const placed = new Date('2026-09-01T00:00:00Z'), now = new Date('2026-09-03T00:00:00Z');
describe('acceptance facts // TEST', () => {
  it('does not equate supply scanning with order acceptance', () => {
    const row = acceptanceObservation(placed, { supplierStatus: 'complete', wbStatus: 'waiting', supplyScannedAt: new Date(+placed + 14 * 3600000) }, now);
    expect(row).toMatchObject({ state: 'shipped', receipt: 'waiting', basis: 'supply-scan', elapsedMs: 14 * 3600000 });
  });
  it('never uses electronic handover as a physical scan', () => {
    expect(acceptanceObservation(placed, { supplierStatus: 'complete', wbStatus: 'waiting' }, now)).toMatchObject({ state: 'pending', receipt: 'waiting', basis: null });
    expect(acceptanceObservation(placed, { wbStatus: 'sorted' }, now)).toMatchObject({ state: 'unknown', receipt: 'confirmed' });
  });
  it('prioritizes an exact scan and keeps reshipment out of successful timing zones', () => {
    const facts = { wbStatus: 'sorted', orderScannedAt: new Date(+placed + 18 * 3600000), supplyScannedAt: new Date(+placed + 14 * 3600000) };
    expect(acceptanceObservation(placed, facts, now)).toMatchObject({ receipt: 'confirmed', basis: 'order-scan', elapsedMs: 18 * 3600000 });
    expect(acceptanceObservation(placed, { ...facts, requiresReshipment: true }, now)).toMatchObject({ state: 'unknown', receipt: 'reshipment', basis: null });
  });
  it('excludes cancelled orders and rejects impossible scan dates', () => {
    expect(acceptanceObservation(placed, { wbStatus: 'canceled_by_client', supplyScannedAt: now }, now)).toMatchObject({ state: 'cancelled', receipt: 'cancelled' });
    expect(acceptanceObservation(placed, { wbStatus: 'sorted', supplyScannedAt: new Date(+placed - 1) }, now)).toMatchObject({ state: 'unknown', basis: null });
    expect(acceptanceObservation(placed, { wbStatus: 'sorted', supplyScannedAt: new Date(+now + 1) }, now)).toMatchObject({ state: 'unknown' });
  });
});
