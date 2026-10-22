import { expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';
import { receiptDateFromBoxCode } from '../src/common/receipt-batches';

// TEST: a large receipt must not construct one Intl formatter per stock movement.
it('reuses date formatting for a receipt list without changing quantities or date boundaries', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    quantity: 1, createdAt: new Date(i % 2 ? '2025-12-31T21:01:00Z' : '2025-12-31T20:59:00Z'),
    box: { code: i % 2 ? 'FFL_LKB0101_1' : 'FFL_LKB_invalid' },
    _count: { productMarks: 1 },
  }));
  const findMany = vi.fn(async () => rows);
  const formatter = vi.spyOn(Intl, 'DateTimeFormat');
  try {
    const result = await WarehouseService.prototype.listReceiptBatches.call({
      prisma: { stockMovement: { findMany } },
      clientScopes: { requireClientAccess: vi.fn() },
      resolveReadWarehouseId: () => 'warehouse',
      boxCodes: { getPolicy: async () => ({ receiptPrefix: 'FFL_LKB' }) },
    } as any, { clientId: 'client' }, {} as any);
    expect(result.map(r => [r.date, r.quantity, r.kizCount])).toEqual([
      ['2026-01-01', 100, 100], ['2025-12-31', 100, 100],
    ]);
    expect(findMany.mock.calls).toHaveLength(1);
    expect(formatter.mock.calls.length).toBeLessThanOrEqual(3);
  } finally { formatter.mockRestore(); }
});

// TEST: supplied reusable formatter preserves invalid dates, explicit years and fallback timezone.
it('keeps the same date decisions with a reusable formatter', () => {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const code of ['FFL_LKB2902_1', 'FFL_LKB3102_1', 'FFL_LKB180725_1', 'FFL_LKB0101_1', 'other']) {
    for (const date of ['2024-02-29T21:00:00Z', '2025-12-31T21:00:00Z', '2025-12-31T20:59:00Z']) {
      const fallback = new Date(date);
      expect(receiptDateFromBoxCode(code, fallback, 'FFL_LKB', value => formatter.format(value)))
        .toBe(receiptDateFromBoxCode(code, fallback, 'FFL_LKB'));
    }
  }
});
