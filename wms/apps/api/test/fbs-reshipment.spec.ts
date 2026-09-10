import { afterEach, describe, expect, it, vi } from 'vitest';
import { reshipmentEligibility, reshipmentFingerprint, reshipmentCycle, assertReshipmentEnabled, supplyRecoveryAction, reshipmentVisibility } from '../src/modules/marketplace-connections/fbs-reshipment';

// TEST: returned-to-assembly is not synonymous with every WB confirm order.
describe('WB reshipment safety rules', () => {
  const task = { id: 'physical', requestId: 'old-request', supplyId: 'old-supply', status: 'COMPLETED',
    barcode: '123', kiz: 'mark', requiresKiz: true, completedAt: new Date(), itemCount: 1, cargoPackingId: null };
  const link = { lastSupplierStatus: 'complete', lastCategory: 'shipped', lastSupplyId: 'old-supply', syncStatus: 'ACTIVE' };
  afterEach(() => vi.unstubAllEnvs());
  it('is opt-in and default/sold WMS stays disabled', () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', ''); expect(assertReshipmentEnabled).toThrow();
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true'); expect(assertReshipmentEnabled).not.toThrow();
  });
  it('accepts authoritative reship list and preserved shipped-to-confirm evidence', () => {
    expect(reshipmentEligibility(task, link, { supplierStatus: 'complete', wbStatus: 'waiting' }, true)).toBeNull();
    expect(reshipmentEligibility(task, link, { supplierStatus: 'confirm', wbStatus: 'waiting' }, false)).toBeNull();
  });
  it('never treats arbitrary confirm orders as reshipments', () => {
    expect(reshipmentEligibility(task, { ...link, lastSupplierStatus: 'confirm', lastCategory: 'assembly' },
      { supplierStatus: 'confirm', wbStatus: 'waiting' }, false)).toBeTruthy();
  });
  it('excludes cancelled, delivered, missing and on-confirm sold orders', () => {
    for (const status of [null, { supplierStatus: 'cancel', wbStatus: 'canceled' },
      { supplierStatus: 'complete', wbStatus: 'sold' }, { supplierStatus: 'confirm', wbStatus: 'sold' }]) {
      expect(reshipmentEligibility(task, link, status, true)).toBeTruthy();
    }
  });
  it('does not remove unfinished attempts, missing marks or packed goods', () => {
    for (const changes of [{ status: 'IN_PROGRESS' }, { kiz: null }, { completedAt: null }, { itemCount: 2 }, { cargoPackingId: 'cargo' }]) {
      expect(reshipmentEligibility({ ...task, ...changes }, link, { supplierStatus: 'complete', wbStatus: 'waiting' }, true)).toBeTruthy();
    }
  });
  it('deduplicates order selection while isolating warehouse, mode and physical cycle', () => {
    const rows = [{ id: '1', connectionId: 'c', cycle: reshipmentCycle(task) }, { id: '2', connectionId: 'c', cycle: 'second' }];
    const fp = reshipmentFingerprint('client', 'warehouse', 'SAME_ITEM', rows);
    expect(reshipmentFingerprint('client', 'warehouse', 'SAME_ITEM', [...rows].reverse())).toBe(fp);
    expect(reshipmentFingerprint('client', 'warehouse', 'NEW_ITEM', rows)).not.toBe(fp);
    expect(reshipmentFingerprint('client', 'other', 'SAME_ITEM', rows)).not.toBe(fp);
    expect(reshipmentCycle({ ...task, requestId: 'next' })).not.toBe(reshipmentCycle(task));
    expect(reshipmentCycle({ ...task, supplyId: 'sync-changed-supply' })).toBe(reshipmentCycle(task));
  });
  it('never repeats an ambiguous supply-create POST, even after an empty list result', () => {
    expect(supplyRecoveryAction('PLANNED', null)).toBe('CREATE_ONCE');
    expect(supplyRecoveryAction('WB_CREATE_STARTED', null)).toBe('RECONCILE_ONLY');
    expect(supplyRecoveryAction('WB_CREATE_STARTED', { id: 's', done: false })).toBe('USE_EXISTING');
    expect(() => supplyRecoveryAction('PLANNED', { id: 's', done: true })).toThrow();
  });
});

// TEST: list visibility is based on fresh WB evidence, never local completion or error wording.
describe('WB reshipment work-list visibility', () => {
  it.each([
    [null, true, true, 'UNVERIFIED'],
    [{ supplierStatus: 'complete', wbStatus: 'future' }, true, true, 'UNVERIFIED'],
    [{ supplierStatus: 'future', wbStatus: 'waiting' }, true, true, 'UNVERIFIED'],
    [{ supplierStatus: 'future', wbStatus: 'sold' }, true, true, 'HIDDEN'],
    [{ supplierStatus: 'cancel', wbStatus: 'future' }, true, true, 'HIDDEN'],
    [{ supplierStatus: 'complete', wbStatus: 'sorted' }, true, true, 'HIDDEN'],
    [{ supplierStatus: 'complete', wbStatus: 'waiting' }, true, false, 'ACTIONABLE'],
    [{ supplierStatus: 'complete', wbStatus: 'waiting' }, false, true, 'HIDDEN'],
    [{ supplierStatus: 'confirm', wbStatus: 'waiting' }, true, false, 'ACTIONABLE'],
    [{ supplierStatus: 'confirm', wbStatus: 'waiting' }, false, true, 'ACTIONABLE'],
    [{ supplierStatus: 'confirm', wbStatus: 'waiting' }, false, false, 'HIDDEN'],
    [{ supplierStatus: 'new', wbStatus: 'waiting' }, true, true, 'HIDDEN'],
  ] as const)('classifies %j / direct %s / returned %s as %s', (status, direct, returned, expected) => {
    expect(reshipmentVisibility(status, direct, returned)).toBe(expected);
  });
});
