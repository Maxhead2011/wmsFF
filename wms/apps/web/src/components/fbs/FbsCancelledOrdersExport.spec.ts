import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FbsOrderSummary } from '../../lib/api';
import { cancelledFbsOrderSelectionItems } from './FbsPanel';

function order(
  id: string,
  connectionId: string,
  category: FbsOrderSummary['category'] = 'cancelled',
) {
  return { id, connectionId, category } as FbsOrderSummary;
}

describe('FBS cancelled-orders export selection', () => {
  // TEST: the browser sends only identifiers from the already filtered cancelled list.
  it('builds a compact payload for the visible cancelled orders', () => {
    expect(
      cancelledFbsOrderSelectionItems([
        order('5508811674', 'cabinet-1'),
        order('5508811674', 'cabinet-2'),
      ]),
    ).toEqual([
      { connectionId: 'cabinet-1', id: '5508811674' },
      { connectionId: 'cabinet-2', id: '5508811674' },
    ]);
  });

  // TEST: a stale non-cancelled row can never be included in the cancelled report payload.
  it('drops orders whose current category is not cancelled', () => {
    expect(
      cancelledFbsOrderSelectionItems([
        order('cancelled', 'cabinet-1'),
        order('active', 'cabinet-1', 'active'),
      ]),
    ).toEqual([{ connectionId: 'cabinet-1', id: 'cancelled' }]);
  });

  // TEST: the UI must prevent duplicate downloads and keep a visible error state.
  it('blocks the export button while busy and renders failures as an alert', () => {
    const source = readFileSync(new URL('./FbsPanel.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/if \(view !== 'cancelled'.*cancelledExportBusy\) return;/);
    expect(source).toContain('disabled={cancelledExportBusy}');
    expect(source).toContain('role="alert"');
    expect(source).toContain('downloadFbsCancelledOrdersXlsx(session.accessToken');
    expect(source).toContain('FBS_CANCELLED_REPORT_MAX_ORDERS = 50_000');
  });
});
