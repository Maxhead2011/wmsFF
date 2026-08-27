import { describe, expect, it } from 'vitest';
import {
  evaluateFbsStockMonitorWb,
  evaluateFbsStockMonitorWms,
  fbsStockMonitorEventKey,
  fbsStockMonitorExpectedAfter,
  fbsStockMonitorOverallStatus,
} from '../src/modules/marketplace-connections/fbs-stock-monitoring.rules';

const activeWindow = {
  nowMs: 1_000,
  deadlineMs: 10_000,
  attempt: 1,
  maxAttempts: 5,
};

describe('FBS WB/WMS stock monitoring rules', () => {
  it('1. confirms a sale when both systems show the correlated decrement', () => {
    const wb = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 9,
      exactOrderMatched: true, ...activeWindow,
    });
    const wms = evaluateFbsStockMonitorWms({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 9,
      exactOrderMatched: true, exactReservationMatched: true, ...activeWindow,
    });
    expect(wb.status).toBe('SUCCESS');
    expect(wms.status).toBe('SUCCESS');
    expect(fbsStockMonitorOverallStatus(wb.status, wms.status)).toBe('SUCCESS');
  });

  it('2. reports WMS error independently when only WB decremented', () => {
    const wb = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 9,
      exactOrderMatched: true, nowMs: 11_000, deadlineMs: 10_000, attempt: 5, maxAttempts: 5,
    });
    const wms = evaluateFbsStockMonitorWms({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 10,
      exactOrderMatched: true, exactReservationMatched: false,
      nowMs: 11_000, deadlineMs: 10_000, attempt: 5, maxAttempts: 5,
    });
    expect(wb.status).toBe('SUCCESS');
    expect(wms.status).toBe('ERROR');
    expect(fbsStockMonitorOverallStatus(wb.status, wms.status)).toBe('ERROR');
  });

  it('3. reports WB error independently when only WMS reserved', () => {
    const wb = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 10,
      exactOrderMatched: true, nowMs: 11_000, deadlineMs: 10_000, attempt: 5, maxAttempts: 5,
    });
    const wms = evaluateFbsStockMonitorWms({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 10,
      exactOrderMatched: true, exactReservationMatched: true,
      nowMs: 11_000, deadlineMs: 10_000, attempt: 5, maxAttempts: 5,
    });
    expect(wb.status).toBe('ERROR');
    expect(wms.status).toBe('SUCCESS');
  });

  it('4. keeps a delayed update pending and confirms it on a later attempt', () => {
    const pending = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 10,
      exactOrderMatched: true, ...activeWindow,
    });
    const completed = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 9,
      exactOrderMatched: true, ...activeWindow, nowMs: 5_000, attempt: 2,
    });
    expect(pending.status).toBe('PENDING');
    expect(completed.status).toBe('SUCCESS');
  });

  it('5. generates the same idempotency key for a repeated event', () => {
    const input = { connectionId: 'c-1', orderId: '5500', skuId: 'sku-1', eventType: 'SALE' as const };
    expect(fbsStockMonitorEventKey(input)).toBe(fbsStockMonitorEventKey({ ...input }));
  });

  it('6. verifies simultaneous units against cumulative expected quantities', () => {
    const firstExpected = fbsStockMonitorExpectedAfter(10, 1, 'SALE');
    const secondExpected = fbsStockMonitorExpectedAfter(firstExpected, 1, 'SALE');
    const first = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, expectedAfterAmount: firstExpected,
      currentAmount: 8, exactOrderMatched: true, ...activeWindow,
    });
    const second = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: firstExpected, expectedAfterAmount: secondExpected,
      currentAmount: 8, exactOrderMatched: true, ...activeWindow,
    });
    expect(first.status).toBe('SUCCESS');
    expect(second.status).toBe('SUCCESS');
    expect(secondExpected).toBe(8);
  });

  it('7. confirms cancellation when stock is restored and reservation released', () => {
    const wb = evaluateFbsStockMonitorWb({
      eventType: 'CANCEL', quantity: 1, beforeAmount: 9, currentAmount: 10,
      exactOrderMatched: true, ...activeWindow,
    });
    const wms = evaluateFbsStockMonitorWms({
      eventType: 'CANCEL', quantity: 1, beforeAmount: 9, currentAmount: 10,
      exactOrderMatched: true, exactReservationReleased: true, ...activeWindow,
    });
    expect(wb.status).toBe('SUCCESS');
    expect(wms.status).toBe('SUCCESS');
  });

  it('8. keeps one API outage gray without hiding success in the other system', () => {
    const wb = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: null,
      exactOrderMatched: true, temporarilyUnavailable: true,
      unavailableMessage: 'HTTP 429', ...activeWindow,
    });
    const wms = evaluateFbsStockMonitorWms({
      eventType: 'SALE', quantity: 1, beforeAmount: 10, currentAmount: 9,
      exactOrderMatched: true, exactReservationMatched: true, ...activeWindow,
    });
    expect(wb.status).toBe('UNAVAILABLE');
    expect(wb.message).toBe('HTTP 429');
    expect(wms.status).toBe('SUCCESS');
    expect(fbsStockMonitorOverallStatus(wb.status, wms.status)).toBe('UNAVAILABLE');
  });

  it('9. rejects a partial decrement after the deadline', () => {
    const result = evaluateFbsStockMonitorWb({
      eventType: 'SALE', quantity: 3, beforeAmount: 10, currentAmount: 8,
      exactOrderMatched: true, nowMs: 11_000, deadlineMs: 10_000, attempt: 5, maxAttempts: 5,
    });
    expect(result.status).toBe('ERROR');
    expect(result.message).toContain('2 из 3');
  });
});
