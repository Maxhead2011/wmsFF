import { describe, expect, it, vi } from 'vitest';
import { runWbAccountingBatch, type WbAccountingOrder } from './fbs-wb-accounting-batch';

const orders: WbAccountingOrder[] = ['first', 'second', 'third'].map((id, index) => ({ id, orderId: String(100 + index), productName: id, wbStatus: 'complete/sorted' }));
const success = (order: WbAccountingOrder) => ({ accounted: true, assemblyId: order.id, orderId: order.orderId });

describe('WB common manager decision', () => {
  // TEST: partial failures cannot resend successful stock commands or hide later results.
  it('processes unique tasks sequentially with one comment and per-order results', async () => {
    let active = 0; let maxActive = 0;
    const account = vi.fn(async (order: WbAccountingOrder) => {
      active++; maxActive = Math.max(active, maxActive);
      await Promise.resolve(); active--;
      if (order.id === 'second') throw new Error('WB не подтвердил отгрузку');
      return success(order);
    });
    const progress = vi.fn();
    const result = await runWbAccountingBatch([...orders, orders[0]], ' Общее решение 783 ', account, progress);
    expect(maxActive).toBe(1); expect(account).toHaveBeenCalledTimes(3);
    expect(account.mock.calls.map(call => call[0].id)).toEqual(['first', 'second', 'third']);
    expect(account).toHaveBeenNthCalledWith(1, orders[0], 'Общее решение 783');
    expect(result).toEqual([
      { id: 'first', orderId: '100', accounted: true },
      { id: 'second', orderId: '101', accounted: false, error: 'WB не подтвердил отгрузку' },
      { id: 'third', orderId: '102', accounted: true },
    ]);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    const retry = vi.fn(async (order: WbAccountingOrder) => success(order));
    await runWbAccountingBatch(orders.filter(order => result.some(row => row.id === order.id && !row.accounted)), 'Проверено повторно', retry);
    expect(retry).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledWith(orders[1], 'Проверено повторно');
  });
  // TEST: ambiguous or mismatched responses are not displayed as confirmed stock writes.
  it.each(['network', 'wrong-order', 'not-accounted'])('keeps %s unconfirmed without automatic retries', async scenario => {
    const account = vi.fn(async () => {
      if (scenario === 'network') throw new Error('Failed to fetch');
      return { ...success(orders[0]), ...(scenario === 'wrong-order' ? { orderId: 'other' } : { accounted: false }) };
    });
    const result = await runWbAccountingBatch([orders[0]], 'Проверено', account);
    expect(result[0].accounted).toBe(false); expect(result[0].error).toBeTruthy(); expect(account).toHaveBeenCalledTimes(1);
  });
  it.each(['  ', 'ok', 'x'.repeat(1001)])('rejects an invalid common comment before any request', async comment => {
    const account = vi.fn(); await expect(runWbAccountingBatch(orders, comment, account)).rejects.toThrow('комментарий');
    expect(account).not.toHaveBeenCalled();
  });
  it('keeps separate assembly identities even when displayed order numbers coincide', async () => {
    const account = vi.fn(async (order: WbAccountingOrder) => success(order));
    await runWbAccountingBatch([orders[0], { ...orders[1], orderId: orders[0].orderId }], 'Проверено', account);
    expect(account).toHaveBeenCalledTimes(2);
  });
});
