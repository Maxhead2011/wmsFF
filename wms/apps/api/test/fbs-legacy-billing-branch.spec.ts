import { afterEach, expect, it, vi } from 'vitest';
import { loadFbsDateBillingBranches, branchScopedFbsDateKey } from '../src/modules/marketplace-connections/fbs-billing-shipment-key';
afterEach(() => vi.unstubAllEnvs());
const key = 'WILDBERRIES:account:date:2026-09-12';
function fixture(requests = [{ id: '877', warehouseId: 'moscow' }, { id: '878', warehouseId: 'moscow' }]) {
  vi.stubEnv('WMS_FBS_DATE_BRANCH_BILLING_ENABLED', 'true');
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  const charge = { sourceKey: `fbs-calculator:client:${key}`, request: null, invoiceItems: [],
    metadata: { kind: 'FBS', requestIds: ['877', '878'], orderIds: ['order-1'] } };
  const db: any = { billingInvoice: { findMany: vi.fn(async () => []) },
    billingCharge: { findMany: vi.fn(async () => [charge]) },
    clientRequest: { findMany: vi.fn(async () => requests) } };
  const order = { id: 'order-1', createdAt: '2026-09-12', request: { warehouseId: 'moscow' } };
  return { db, charge, order, run: () => loadFbsDateBillingBranches(db, 'client', [order], () => key) };
}
// TEST: reproduce the five-order legacy draft whose requests 877 and 878 are stored only in metadata.
it('recovers one client-scoped branch and preserves the original charge identity', async () => {
  const f = fixture(), before = JSON.stringify(f.charge), branches = await f.run();
  expect(branches?.get(key)).toBe('moscow');
  expect(branchScopedFbsDateKey(key, f.order, branches)).toBe(key);
  expect(JSON.stringify(f.charge)).toBe(before);
  expect(f.db.billingCharge.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ metadata: true }) }));
  expect(f.db.clientRequest.findMany).toHaveBeenCalledWith({ where: { clientId: 'client', id: { in: ['877', '878'] } }, select: { id: true, warehouseId: true } });
});
// TEST: never turn partial evidence or a different client's request into a financial branch guess.
it.each([
  { requests: [{ id: '877', warehouseId: 'moscow' }] },
  { requests: [{ id: '877', warehouseId: 'moscow' }, { id: '878', warehouseId: null }] },
  { requests: [{ id: '877', warehouseId: 'moscow' }, { id: '878', warehouseId: 'kazan' }] },
])('rejects missing, unassigned or conflicting saved requests', async ({ requests }) => {
  const f = fixture(requests as any);
  await expect(f.run()).rejects.toThrow('филиал старого начисления');
});
it('rejects conflict with an existing invoice instead of producing a new source key', async () => {
  const f = fixture();f.db.billingInvoice.findMany.mockResolvedValue([{ sourceKey: `fbs-invoice:client:${key}`, warehouseId: 'kazan' }]);
  await expect(f.run()).rejects.toThrow('филиал старого начисления');
});
it('does not perform fallback reads when disabled on the sold WMS', async () => {
  const f = fixture();vi.stubEnv('WMS_FBS_DATE_BRANCH_BILLING_ENABLED', 'false');
  expect(await f.run()).toBeUndefined();expect(f.db.clientRequest.findMany).not.toHaveBeenCalled();
});
