import { describe, expect, it } from 'vitest';
import { describeStockTransfer } from './fbs-stock-transfer';
import type { RoutedFbsStockTransferResult } from './api';

// TEST: never report an unknown WB outcome as a completed transfer.
describe('stock transfer result', () => {
  it('shows the named supply and the confirmed WMS request', () => {
    expect(describeStockTransfer({ routedTransfer: true, transfers: [{ runId: 'run', status: 'CREATED',
      supplyName: 'logoff нет на складе', supplyId: 'WB-test', requestNumber: 42, errorMessage: null, orderCount: 2 }],
      regularTransfer: null, errors: [], skippedOrders: [] })).toContain('«logoff нет на складе» (WB-test), заявка №000042');
  });
  it('reports partial success, reconciliation handle and skipped orders separately', () => {
    const result: RoutedFbsStockTransferResult = { routedTransfer: true, transfers: [{ runId: 'pending-run', status: 'NEEDS_RECONCILIATION',
      supplyName: 'logoff нет на складе', supplyId: null, requestNumber: null, errorMessage: 'timeout', orderCount: 1 }],
      regularTransfer: null, errors: ['Другая группа не перенесена'], skippedOrders: [{ id: '101', reason: 'Отменён' }] };
    const message = describeStockTransfer(result);
    expect(message).toContain('требует сверки'); expect(message).toContain('pending-run');
    expect(message).toContain('101 — Отменён'); expect(message).toContain('Другая группа не перенесена');
    expect(message).not.toContain('Перенесено 1'); expect(message).not.toContain('заявка №00null');
  });
});
