import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FbsOrderSummary } from '../../lib/api';
import {
  openFbsDeadlineOrderDetails,
  openFbsDeadlineRequest,
  selectedFbsDeadlineOrderItems,
  updateFbsDeadlineVisibleSelection,
} from './FbsPanel';

function reportOrder(overrides: Partial<FbsOrderSummary> = {}): FbsOrderSummary {
  return {
    id: '5508811674',
    request: {
      id: 'request-id-345',
      number: 345,
      title: 'Заявка 345',
      status: 'IN_WORK',
      fbsEmergencyAssemblyAt: null,
      fbsEmergencyAssemblyByUserId: null,
      fbsEmergencyAssemblyByName: null,
    },
    ...overrides,
  } as FbsOrderSummary;
}

describe('FBS auto-cancel report UI', () => {
  // TEST: the long report must scroll inside its own viewport and keep headings visible.
  it('allows scrolling the report table and keeps its header sticky', () => {
    const css = readFileSync(new URL('./fbs.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.fbs-deadline-report__table\s*{[^}]*overflow:\s*auto\s*;/s);
    expect(css).toMatch(/\.fbs-deadline-report__table\s+thead\s+th\s*{[^}]*position:\s*sticky\s*;/s);
  });

  // TEST: clicking an order must select that exact order for the details dialog.
  it('opens details for the selected WB order', () => {
    const selectedOrder = vi.fn();
    const order = reportOrder();

    openFbsDeadlineOrderDetails(order, selectedOrder);

    expect(selectedOrder).toHaveBeenCalledOnce();
    expect(selectedOrder).toHaveBeenCalledWith(order);
  });

  // TEST: navigation uses the WMS request UUID, never the WB order id or visible request number.
  it('passes the exact requestId when navigating to the WMS request', () => {
    const openRequest = vi.fn();
    const order = reportOrder();

    expect(openFbsDeadlineRequest(order, openRequest)).toBe(true);
    expect(openRequest).toHaveBeenCalledOnce();
    expect(openRequest).toHaveBeenCalledWith('request-id-345');
  });

  // TEST: an order without a WMS request cannot trigger an invalid navigation.
  it('does not navigate when the order has no WMS request', () => {
    const openRequest = vi.fn();

    expect(openFbsDeadlineRequest(reportOrder({ request: null }), openRequest)).toBe(false);
    expect(openRequest).not.toHaveBeenCalled();
  });

  // TEST: the request action stays disabled when App does not grant access to the request workspace.
  it('does not navigate when the request workspace callback is unavailable', () => {
    expect(openFbsDeadlineRequest(reportOrder(), undefined)).toBe(false);
  });

  // TEST: selecting a visible row exports only its composite cabinet + order key.
  it('builds the Excel payload only from explicitly selected orders', () => {
    const first = reportOrder({ connectionId: 'cabinet-1' });
    const sameNumberOtherCabinet = reportOrder({ connectionId: 'cabinet-2' });
    const selected = updateFbsDeadlineVisibleSelection(new Set(), [first], true);

    expect(selectedFbsDeadlineOrderItems([first, sameNumberOtherCabinet], selected)).toEqual([
      { connectionId: 'cabinet-1', id: '5508811674' },
    ]);
  });

  // TEST: "select all" affects the currently visible rows and keeps an earlier explicit selection.
  it('selects and clears only the currently visible deadline rows', () => {
    const hidden = reportOrder({ id: 'hidden', connectionId: 'cabinet-1' });
    const visible = reportOrder({ id: 'visible', connectionId: 'cabinet-1' });
    const current = new Set(['cabinet-1:hidden']);

    const selected = updateFbsDeadlineVisibleSelection(current, [visible], true);
    expect([...selected].sort()).toEqual(['cabinet-1:hidden', 'cabinet-1:visible']);

    const cleared = updateFbsDeadlineVisibleSelection(selected, [visible], false);
    expect([...cleared]).toEqual(['cabinet-1:hidden']);
  });
});
