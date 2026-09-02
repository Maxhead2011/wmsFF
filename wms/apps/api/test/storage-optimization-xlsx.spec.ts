import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildStorageOptimizationWorkbook } from '../src/modules/service/storage-optimization-xlsx';

describe('buildStorageOptimizationWorkbook', () => {
  it('creates a real workbook with summary, movement route and target boxes', () => {
    // TEST: the downloaded file is an auditable XLSX, not a renamed CSV.
    const content = buildStorageOptimizationWorkbook({
      client: { id: 'client-lukin', code: 'LUKIN', name: 'Лукин Илья Ильич' },
      generatedAt: '2026-09-02T08:00:00.000Z',
      summary: {
        totalUnits: 18,
        excludedUnits: 2,
        sourceBoxes: 2,
        targetBoxes: 1,
        sourcePalletSorts: 2,
        targetPalletSorts: 1,
        idealTargetPalletSorts: 0,
        movementUnits: 8,
        idealTargetBoxes: 1,
      },
      targetBoxes: [{
        id: 'warehouse-moscow:BOX:1',
        label: 'Короб 001 · BOX-1',
        physicalBoxCode: 'BOX-1',
        warehouseId: 'warehouse-moscow',
        warehouseName: 'Москва',
        strategy: 'BARCODE',
        article: 'M31',
        colors: ['Чёрный'],
        sizes: ['M'],
        barcodes: ['04680000000001'],
        plannedQuantity: 18,
        targetPalletSort: 'Паллетсорт 001 · M31',
      }],
      rows: [{
        warehouseId: 'warehouse-moscow',
        warehouseName: 'Москва',
        skuId: 'sku-1',
        barcode: '04680000000001',
        article: 'M31',
        productName: 'Костюм M31',
        color: 'Чёрный',
        size: 'M',
        sourcePalletSort: 'PALET_SORT_001',
        sourceBox: 'BOX-2',
        quantity: 8,
        destinationBox: 'Короб 001 · BOX-1',
        destinationPhysicalBox: 'BOX-1',
        destinationPalletSort: 'Паллетсорт 001 · M31',
        strategy: 'BARCODE',
        action: 'MOVE',
      }],
    });

    const workbook = XLSX.read(content, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Сводка', 'Маршрут', 'Целевые короба']);
    const route = workbook.Sheets['Маршрут'];
    expect(route?.['A1']?.v).toBe('№');
    expect(route?.['G1']?.v).toBe('ШК');
    expect(route?.['G2']).toMatchObject({ t: 's', v: '04680000000001' });
    expect(route?.['J1']?.v).toBe('Исходный короб');
    expect(route?.['M1']?.v).toBe('Предложенный короб');
    expect(route?.['O1']?.v).toBe('Предложенный паллетсорт');
  });
});
