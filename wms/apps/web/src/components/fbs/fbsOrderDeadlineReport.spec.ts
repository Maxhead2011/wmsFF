import { describe, expect, it } from 'vitest';
import {
  FBS_AUTO_CANCEL_HOURS,
  fbsActiveOrderAgeTone,
  fbsDeadlineSnapshot,
  fbsDeadlineStockSnapshot,
  filterFbsDeadlineOrders,
  type FbsDeadlineFilters,
  type FbsDeadlineOrder,
} from './fbsOrderDeadlineReport';

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-27T12:00:00.000Z');

function order(
  id: string,
  ageHours: number,
  overrides: Partial<FbsDeadlineOrder> = {},
): FbsDeadlineOrder {
  return {
    id,
    category: 'active',
    marketplace: 'WILDBERRIES',
    createdAt: new Date(NOW - ageHours * HOUR_MS).toISOString(),
    sellerDate: null,
    supplyId: 'WB-GI-100',
    request: { number: 250 },
    ...overrides,
  };
}

const FILTERS: FbsDeadlineFilters = {
  tone: 'all',
  dateFrom: '',
  dateTo: '',
  orderNumber: '',
  requestNumber: '',
  supplyId: '',
  stock: 'all',
};

describe('FBS auto-cancel deadline report', () => {
  // TEST: the report must preserve the existing FBS green/yellow/red boundaries.
  it('uses the existing 12/19 hour colour zones', () => {
    expect(fbsActiveOrderAgeTone(11 * HOUR_MS)).toBe('normal');
    expect(fbsActiveOrderAgeTone(12 * HOUR_MS)).toBe('warning');
    expect(fbsActiveOrderAgeTone(19 * HOUR_MS)).toBe('critical');
  });

  // TEST: a 230-hour-old order has exactly 10 hours before the 240-hour limit.
  it('calculates remaining and overdue time from the 240-hour limit', () => {
    expect(FBS_AUTO_CANCEL_HOURS).toBe(240);
    expect(fbsDeadlineSnapshot(order('5500000001', 230), NOW)).toMatchObject({
      remainingMilliseconds: 10 * HOUR_MS,
      tone: 'critical',
      overdue: false,
    });
    expect(fbsDeadlineSnapshot(order('5500000002', 241), NOW)).toMatchObject({
      remainingMilliseconds: -1 * HOUR_MS,
      tone: 'critical',
      overdue: true,
    });
  });

  // TEST: all filters apply to the full active WB list, not a displayed page.
  it('filters by red zone, period, WMS request and WB supply', () => {
    const rows = [
      order('5500000001', 230, { supplyId: 'WB-GI-777', request: { number: 345 } }),
      order('5500000002', 18, { supplyId: 'WB-GI-777', request: { number: 345 } }),
      order('5500000003', 230, { supplyId: 'WB-GI-888', request: { number: 351 } }),
      order('5500000004', 230, { category: 'shipped', supplyId: 'WB-GI-777', request: { number: 345 } }),
      order('5500000005', 230, { marketplace: 'OZON', supplyId: 'WB-GI-777', request: { number: 345 } }),
    ];

    expect(
      filterFbsDeadlineOrders(
        rows,
        {
          ...FILTERS,
          tone: 'critical',
          dateFrom: '2026-08-17',
          dateTo: '2026-08-18',
          requestNumber: '345',
          supplyId: 'gi-777',
        },
        NOW,
      ).map((row) => row.id),
    ).toEqual(['5500000001']);
  });

  // TEST: stock availability follows the same reservation and free-box data as FBS assembly.
  it('filters by current WMS stock and gives WAITING_STOCK priority over stale boxes', () => {
    const available = order('5500000010', 25, {
      storageBoxes: [{ code: 'FFL_LKB_1', quantity: 3, status: 'AVAILABLE' }],
    });
    const zero = order('5500000011', 25, {
      storageBoxes: [{ code: 'FFL_LKB_2', quantity: 0, status: 'AVAILABLE' }],
    });
    const waitingWithStaleBox = order('5500000012', 25, {
      storageBoxes: [{ code: 'FFL_LKB_3', quantity: 6, status: 'AVAILABLE' }],
      reservation: { status: 'WAITING_STOCK' },
    });
    const reservedWithoutBox = order('5500000013', 25, {
      storageBoxes: [],
      reservation: { status: 'RESERVED' },
    });
    const quarantined = order('5500000014', 25, {
      storageBoxes: [{ code: 'FFL_LKB_4', quantity: 8, status: 'QUARANTINE' }],
    });

    expect(fbsDeadlineStockSnapshot(waitingWithStaleBox)).toEqual({
      available: false,
      quantity: 0,
      boxes: [],
    });
    expect(
      filterFbsDeadlineOrders(
        [available, zero, waitingWithStaleBox, reservedWithoutBox, quarantined],
        { ...FILTERS, stock: 'available' },
        NOW,
      ).map((row) => row.id),
    ).toEqual(['5500000010', '5500000013']);
    expect(
      filterFbsDeadlineOrders(
        [available, zero, waitingWithStaleBox, reservedWithoutBox, quarantined],
        { ...FILTERS, stock: 'missing' },
        NOW,
      ).map((row) => row.id),
    ).toEqual(['5500000011', '5500000012', '5500000014']);
  });
});
