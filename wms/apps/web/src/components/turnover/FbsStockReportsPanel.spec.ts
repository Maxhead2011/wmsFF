import { describe, expect, it } from 'vitest';
import { freshnessLabel, reportPeriod, reportValue } from './FbsStockReportsPanel';

describe('FBS report quick periods', () => {
  // TEST: Moscow calendar boundaries must not drift when the host uses UTC.
  it('returns inclusive 7-day and current-month ranges', () => {
    const now = new Date('2026-08-21T22:30:00.000Z');
    expect(reportPeriod('7days', now)).toEqual({ dateFrom: '2026-08-16', dateTo: '2026-08-22' });
    expect(reportPeriod('month', now)).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-22' });
  });

  // TEST: refresh status must identify all three independently loaded datasets.
  it('shows freshness for WMS, FBS and box datasets', () => {
    const generatedAt = '2026-08-21T10:15:00.000Z';
    const label = freshnessLabel(
      { totals: { total: 10, reserved: 3, available: 7, barcodes: 1 }, missingBarcodeCount: 0, generatedAt },
      { period: { dateFrom: '2026-08-21', dateTo: '2026-08-21' }, summary: { orders: 1, units: 2 }, daily: [], items: [], pagination: { page: 1, pageSize: 20, total: 0, pages: 1 }, generatedAt },
      { withoutPallet: { summary: { boxes: 0, units: 0, rows: 0 }, items: [], pagination: { page: 1, pageSize: 50, total: 0, pages: 1 } }, onPallet: { summary: { boxes: 0, units: 0, barcodes: 0, pallets: 0 }, items: [], pagination: { page: 1, pageSize: 50, total: 0, pages: 1 } }, generatedAt },
    );

    expect(label).toContain('WMS:');
    expect(label).toContain('FBS:');
    expect(label).toContain('короба:');
    expect(label).not.toContain('—');
  });

  // TEST: loading is unknown, while a completed response may truthfully contain zero.
  it('does not present loading data as a factual zero', () => {
    expect(reportValue(true, 0)).toBe('—');
    expect(reportValue(false, undefined)).toBe('—');
    expect(reportValue(false, 0)).toBe('0');
  });
});

