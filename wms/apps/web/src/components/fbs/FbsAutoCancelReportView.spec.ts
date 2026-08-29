import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FbsDeliveryRecoveryOrder, FbsOrderSummary } from '../../lib/api';
import {
  openFbsDeadlineOrderDetails,
  openFbsDeadlineRequest,
  selectedFbsDeliveryRecoveryOrderItems,
  selectedFbsDeadlineOrderItems,
  updateFbsDeliveryRecoveryVisibleSelection,
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

  // TEST: only explicitly selectable recovery orders may be submitted to the
  // server; a completed or blocked order must never be reset by bulk selection.
  it('builds a delivery-recovery request only from selectable unfinished orders', () => {
    const rows = [
      {
        connectionId: 'cabinet-1',
        orderId: 'assemble-1',
        action: 'ASSEMBLE',
        canSelect: true,
      },
      {
        connectionId: 'cabinet-1',
        orderId: 'complete-1',
        action: 'COMPLETE',
        canSelect: true,
      },
      {
        connectionId: 'cabinet-1',
        orderId: 'blocked-1',
        action: 'REASSEMBLE',
        canSelect: false,
      },
    ] as FbsDeliveryRecoveryOrder[];

    const selected = updateFbsDeliveryRecoveryVisibleSelection(new Set(), rows, true);

    expect([...selected].sort()).toEqual([
      'cabinet-1:assemble-1',
      'cabinet-1:complete-1',
    ]);
    expect(selectedFbsDeliveryRecoveryOrderItems(rows, selected)).toEqual([
      { connectionId: 'cabinet-1', id: 'assemble-1' },
      { connectionId: 'cabinet-1', id: 'complete-1' },
    ]);
  });

  // TEST: the branch audit and recovery table are visible actions inside the
  // existing auto-cancel tile rather than a second disconnected FBS module.
  it('renders branch verification and recovery-request controls in the existing tile', () => {
    const source = readFileSync(new URL('./FbsPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('Проверить поставки филиала');
    expect(source).toContain('Сформировать заявку на довоз');
    expect(source).toContain('FBS ДОВОЗ');
  });

  // TEST: recovery requests must be visually distinguishable without changing
  // the Android application; the web list uses the existing emergency flag.
  it('marks delivery-recovery requests with an orange web-list row', () => {
    const source = readFileSync(
      new URL('../client-requests/ClientRequestsTable.tsx', import.meta.url),
      'utf8',
    );
    const css = readFileSync(
      new URL('../client-requests/client-requests.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('client-request-row--fbs-recovery');
    expect(source).toContain('ДОВОЗ WB');
    expect(css).toMatch(/\.client-request-table tbody tr\.client-request-row--fbs-recovery > td\s*{[^}]*background:/s);
  });
});
