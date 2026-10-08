import 'reflect-metadata';
import { beforeEach, expect, it, vi } from 'vitest';
const policy = vi.hoisted(() => ({ rules: vi.fn(), missing: vi.fn() }));
vi.mock('../src/modules/warehouse/receipt-channel-policy', async importOriginal => ({
  ...await importOriginal<typeof import('../src/modules/warehouse/receipt-channel-policy')>(),
  receiptRules: policy.rules, receiptUnassignedOrders: policy.missing,
}));
import { loadFboFbsAvailability } from '../src/modules/tsd/fbo-fbs-reservations';
beforeEach(() => { vi.clearAllMocks(); policy.rules.mockResolvedValue(new Map()); policy.missing.mockResolvedValue([]); });
function db(balances: unknown[]) {
  return { stockBalance: { findMany: vi.fn().mockResolvedValue(balances) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([{ id: 'request' }]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
    stockMovement: { findMany: vi.fn().mockResolvedValue([]) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) } };
}
// TEST: an FBO plan must not load approval history for unrelated warehouse boxes.
it.each([{ balances: [] }, { balances: [{ boxId: 'box', skuId: 'sku', quantity: 3 }, { boxId: 'box', skuId: 'other', quantity: 1 }] }])(
  'bounds approval lookup to unique available box IDs: %j', async ({ balances }) => {
    const tx = db(balances);
    await loadFboFbsAvailability(tx as any, { clientId: 'client', warehouseId: 'warehouse' }, ['sku', 'other']);
    expect(policy.rules).toHaveBeenCalledWith(tx, 'client', 'warehouse', balances.length ? ['box'] : []);
  });
// TEST: restricting receipt reads must not release client approval or FBS reservations.
it('keeps pending receipts unavailable and protects FBS stock in approved boxes', async () => {
  const tx = db(['pending', 'approved'].map(boxId => ({ boxId, skuId: 'sku', quantity: 3 })));
  policy.rules.mockResolvedValue(new Map([
    ['pending', { fbs: true, fbo: true, stockAvailable: false, protectedOrders: [] }],
    ['approved', { fbs: true, fbo: true, stockAvailable: true, protectedOrders: [] }],
  ]));
  tx.fbsTsdAssembly.findMany.mockResolvedValue([{ id: 'task', requestId: 'request',
    connectionId: 'connection', orderId: 'order', status: 'RESERVED', skuId: 'sku',
    sourceSkuId: null, relabelConfirmedAt: null, itemCount: 1, boxId: null, reservedBoxId: 'approved' }] as any);
  const result = await loadFboFbsAvailability(tx as any, { clientId: 'client', warehouseId: 'warehouse' }, ['sku']);
  expect(result.free('pending', 'sku')).toBe(0);
  expect(result.free('approved', 'sku')).toBe(2);
  expect(policy.rules).toHaveBeenCalledWith(tx, 'client', 'warehouse', ['pending', 'approved']);
});
