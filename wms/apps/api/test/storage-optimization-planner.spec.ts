import { describe, expect, it } from 'vitest';
import {
  buildStorageOptimizationPlan,
  type StorageOptimizationSourceRow,
} from '../src/modules/service/storage-optimization-planner';

function row(
  overrides: Partial<StorageOptimizationSourceRow> & Pick<StorageOptimizationSourceRow, 'skuId' | 'barcode' | 'sourceBox' | 'quantity'>,
): StorageOptimizationSourceRow {
  return {
    warehouseId: 'warehouse-moscow',
    warehouseName: 'Москва',
    skuId: overrides.skuId,
    barcode: overrides.barcode,
    article: 'M31',
    productName: 'Костюм M31',
    color: 'Чёрный',
    size: 'M',
    sourcePalletSort: 'PALET_SORT_001',
    sourceBox: overrides.sourceBox,
    quantity: overrides.quantity,
    ...overrides,
  };
}

describe('buildStorageOptimizationPlan', () => {
  it('packs one barcode into target boxes of 16 to 20 units', () => {
    // TEST: the highest-priority layout is one barcode per box.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'BOX-1', quantity: 12 }),
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'BOX-2', quantity: 13 }),
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'BOX-3', quantity: 15 }),
    ]);

    expect(plan.targetBoxes).toHaveLength(2);
    expect(plan.targetBoxes.map((box) => box.plannedQuantity)).toEqual([20, 20]);
    expect(plan.targetBoxes.every((box) => box.strategy === 'BARCODE')).toBe(true);
    expect(plan.targetBoxes.every((box) => box.barcodes.length === 1)).toBe(true);
  });

  it('combines small quantities only inside one article with different sizes', () => {
    // TEST: the second priority may mix sizes, but never articles.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: 'sku-m31-s', barcode: '200000000010', size: 'S', sourceBox: 'BOX-S', quantity: 8 }),
      row({ skuId: 'sku-m31-l', barcode: '200000000011', size: 'L', sourceBox: 'BOX-L', quantity: 8 }),
    ]);

    expect(plan.targetBoxes).toHaveLength(1);
    expect(plan.targetBoxes[0]).toMatchObject({ strategy: 'ARTICLE', plannedQuantity: 16, article: 'M31' });
    expect(plan.targetBoxes[0]?.barcodes).toEqual(['200000000010', '200000000011']);
    expect(plan.targetBoxes[0]?.sizes).toEqual(['L', 'S']);
  });

  it('keeps colors of one article on one target pallet and separates another article', () => {
    // TEST: pallet sorts are homogeneous by article and may contain its colors.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: 'sku-m31-black', barcode: '3101', color: 'Чёрный', sourceBox: 'BOX-1', quantity: 10 }),
      row({ skuId: 'sku-m31-blue', barcode: '3102', color: 'Синий', sourceBox: 'BOX-2', quantity: 10 }),
      row({ skuId: 'sku-lining', barcode: '4101', article: 'LINING', productName: 'Лининг', sourceBox: 'BOX-3', quantity: 16 }),
    ]);

    const m31Pallets = new Set(plan.targetBoxes.filter((box) => box.article === 'M31').map((box) => box.targetPalletSort));
    const liningPallets = new Set(plan.targetBoxes.filter((box) => box.article === 'LINING').map((box) => box.targetPalletSort));

    expect(m31Pallets.size).toBe(1);
    expect(liningPallets.size).toBe(1);
    expect([...m31Pallets][0]).not.toBe([...liningPallets][0]);
  });

  it('never combines stock from different warehouses', () => {
    // TEST: optimization cannot recommend an inter-warehouse move.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'MSK-1', quantity: 10 }),
      row({
        warehouseId: 'warehouse-noginsk',
        warehouseName: 'Ногинск',
        skuId: 'sku-m31-m',
        barcode: '200000000001',
        sourceBox: 'NOG-1',
        quantity: 10,
      }),
    ]);

    expect(plan.targetBoxes).toHaveLength(2);
    expect(plan.targetBoxes.map((box) => box.plannedQuantity)).toEqual([10, 10]);
    expect(new Set(plan.targetBoxes.map((box) => box.warehouseId)).size).toBe(2);
  });

  it('reuses the source box with the largest overlap to reduce movements', () => {
    // TEST: a well-filled physical box stays the target whenever possible.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'BOX-KEEP', quantity: 16 }),
      row({ skuId: 'sku-m31-m', barcode: '200000000001', sourceBox: 'BOX-MOVE', quantity: 4 }),
    ]);

    expect(plan.targetBoxes[0]?.physicalBoxCode).toBe('BOX-KEEP');
    expect(plan.rows.find((item) => item.sourceBox === 'BOX-KEEP')?.action).toBe('KEEP');
    expect(plan.summary.movementUnits).toBe(4);
  });

  it('limits every proposed pallet sort to twenty boxes', () => {
    // TEST: one article with more than 20 target boxes must be split into several pallet sorts.
    const plan = buildStorageOptimizationPlan(
      Array.from({ length: 21 }, (_, index) =>
        row({
          skuId: `sku-m31-${index}`,
          barcode: `3100000000${String(index).padStart(2, '0')}`,
          sourceBox: `BOX-${String(index + 1).padStart(2, '0')}`,
          quantity: 16,
        }),
      ),
    );

    const boxesPerPallet = new Map<string, number>();
    for (const box of plan.targetBoxes) {
      boxesPerPallet.set(box.targetPalletSort, (boxesPerPallet.get(box.targetPalletSort) ?? 0) + 1);
    }

    expect(plan.summary.targetPalletSorts).toBe(2);
    expect([...boxesPerPallet.values()].sort((left, right) => right - left)).toEqual([20, 1]);
  });

  it('ignores malformed source rows without an SKU identifier', () => {
    // TEST: an incomplete balance cannot produce an unusable movement recommendation.
    const plan = buildStorageOptimizationPlan([
      row({ skuId: '   ', barcode: '200000000099', sourceBox: 'BOX-BROKEN', quantity: 20 }),
    ]);

    expect(plan.rows).toEqual([]);
    expect(plan.summary.totalUnits).toBe(0);
  });
});
