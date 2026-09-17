import { describe, expect, it } from 'vitest';
import type { FbsOrderSummary } from '../../lib/api';
import { groupFbsOrdersBySupplyOnly } from './FbsPanel';

const order = (id: string, supplyId: string, requestId = 'request-1099') => ({
  id, supplyId, connectionId: 'connection', marketplace: 'WILDBERRIES', itemCount: 1,
  request: { id: requestId, number: 1099, title: 'logoff нет на складе', status: 'IN_WORK' },
} as FbsOrderSummary);

describe('no-stock request display', () => {
  // TEST: a consolidated WMS request must not be split by its retained WB supplies.
  it('shows one request group while preserving each real supply', () => {
    const orders = [order('1', 'supply-a'), order('2', 'supply-b')];
    const groups = groupFbsOrdersBySupplyOnly(orders, true);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'request', supplyId: '', requestNumber: 1099 });
    expect(groups[0].orders.map(o => o.supplyId)).toEqual(['supply-a', 'supply-b']);
  });
  it('preserves supply grouping when the feature is disabled', () => {
    expect(groupFbsOrdersBySupplyOnly([order('1', 'a'), order('2', 'b')], false)).toHaveLength(2);
  });
  it('does not merge different requests, accounts or ordinary requests', () => {
    const orders = [order('1', 'a'), order('2', 'b', 'another'),
      { ...order('3', 'c'), connectionId: 'other-account' },
      { ...order('4', 'd'), request: { ...order('4', 'd').request!, title: 'Обычная сборка' } }];
    const groups = groupFbsOrdersBySupplyOnly(orders, true);
    expect(groups).toHaveLength(4);
    expect(groups[3].kind).toBe('supply');
  });
});
