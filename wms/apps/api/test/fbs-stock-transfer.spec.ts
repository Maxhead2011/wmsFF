import { describe, expect, it } from 'vitest';
import type { FbsTsdAssembly } from '@prisma/client';
import { ordersWithoutTransferStock, stockTransferBlockedReason } from '../src/modules/marketplace-connections/fbs-stock-transfer';

// TEST: stock means an allocatable unit, accounting for the whole selection and reservations.
describe('stock transfer allocation', () => {
  const order = { key: 'connection:101', taskId: 'task', skuId: 'sku', itemCount: 1 };
  it('routes absent stock and a fully reserved box to the shortage supply', () => {
    expect([...ordersWithoutTransferStock([order], [], new Map(), false)]).toEqual([order.key]);
    expect([...ordersWithoutTransferStock([order], [{ skuId: 'sku', boxId: 'box', quantity: 1 }],
      new Map([['sku', [{ taskId: 'other', boxId: 'box', itemCount: 1 }]]]), false)]).toEqual([order.key]);
  });
  it('keeps the order own reservation available and does not count duplicate balance rows twice', () => {
    const balances = [1, 1].map(quantity => ({ skuId: 'sku', boxId: 'box', quantity }));
    const reservations = new Map([['sku', [{ taskId: 'task', boxId: 'box', itemCount: 1 }, { taskId: 'other', boxId: 'box', itemCount: 1 }]]]);
    const other = { ...order, key: 'connection:102', taskId: 'unreserved' };
    expect([...ordersWithoutTransferStock([other, order], balances, reservations, false)]).toEqual([other.key]);
  });
  it('allocates a single unreserved unit to only one of two selected orders', () => {
    expect([...ordersWithoutTransferStock([order, { ...order, key: 'connection:102', taskId: 'other' }],
      [{ skuId: 'sku', boxId: 'box', quantity: 1 }], new Map(), false)]).toEqual(['connection:102']);
  });
  it('does not borrow stock from another SKU and requires the full item count', () => {
    expect([...ordersWithoutTransferStock([{ ...order, itemCount: 2 }], [{ skuId: 'sku', boxId: 'box', quantity: 1 },
      { skuId: 'other-sku', boxId: 'box', quantity: 10 }], new Map(), false)]).toEqual([order.key]);
  });
  it('combines unboxed stock but does not combine separate boxes for a boxed order', () => {
    const balances = ['a', 'b'].map(boxId => ({ skuId: 'sku', boxId, quantity: 1 }));
    expect(ordersWithoutTransferStock([{ ...order, itemCount: 2 }], balances, new Map(), true).size).toBe(0);
    expect(ordersWithoutTransferStock([{ ...order, itemCount: 2 }], balances, new Map(), false).size).toBe(1);
  });
  it('does not let a stale own reservation invent physical stock', () => {
    const reservations = new Map([['sku', [{ taskId: 'task', boxId: 'box', itemCount: 1 }, { taskId: 'other', boxId: 'box', itemCount: 1 }]]]);
    expect(ordersWithoutTransferStock([order], [{ skuId: 'sku', boxId: 'box', quantity: 1 }], reservations, false).size).toBe(1);
  });
});

// TEST: allowing complete/waiting does not relax cancellation, physical-scan or synchronization safeguards.
describe('explicit stock transfer eligibility', () => {
  const task = { status: 'WAITING_STOCK', itemCount: 1 } as FbsTsdAssembly;
  const link = { syncStatus: 'ACTIVE' };
  it.each(['new', 'confirm', 'complete'])('allows untouched %s/waiting', supplierStatus => {
    expect(stockTransferBlockedReason(task, link, { supplierStatus, wbStatus: 'waiting' })).toBeNull();
  });
  it.each(['sold', 'sorted', 'canceled', 'accepted_by_carrier', 'ready_for_pickup'])('blocks WB %s', wbStatus => {
    expect(stockTransferBlockedReason(task, link, { supplierStatus: 'complete', wbStatus })).toBeTruthy();
  });
  it.each(['barcode', 'sourceBarcode', 'boxId', 'kiz', 'cargoPackingId', 'stickerBarcode', 'startedAt', 'completedAt'])('preserves %s evidence', field => {
    expect(stockTransferBlockedReason({ ...task, [field]: 'evidence' }, link, { supplierStatus: 'complete', wbStatus: 'waiting' })).toBeTruthy();
  });
  it.each(['REMOVED', 'MOVING', 'RETURN_REQUIRED'])('blocks %s links', syncStatus => {
    expect(stockTransferBlockedReason(task, { syncStatus }, { supplierStatus: 'complete', wbStatus: 'waiting' })).toBeTruthy();
  });
  it('blocks missing status and completed or multi-unit physical tasks', () => {
    expect(stockTransferBlockedReason(task, link, null)).toBeTruthy();
    expect(stockTransferBlockedReason({ ...task, status: 'COMPLETED' }, link, { supplierStatus: 'complete', wbStatus: 'waiting' })).toBeTruthy();
    expect(stockTransferBlockedReason({ ...task, itemCount: 2 }, link, { supplierStatus: 'complete', wbStatus: 'waiting' })).toBeTruthy();
  });
});
