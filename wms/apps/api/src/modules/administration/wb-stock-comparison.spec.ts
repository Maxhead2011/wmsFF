import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseWbStockFile } from './wb-stock-comparison';

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'stocks');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWbStockFile', () => {
  it('reads the standard WB columns and aggregates duplicate barcodes', () => {
    const result = parseWbStockFile(workbookBuffer([
      ['Баркод', 'Количество', 'Предмет', 'Бренд', 'Наименование', 'Размер', 'Артикул продавца'],
      ['2049156013036', 19, 'Костюмы', 'LOOK.IN', 'Костюм', 'S', 'Корея_2бежевый'],
      ['2049156013036', 2, 'Костюмы', 'LOOK.IN', 'Костюм', 'S', 'Корея_2бежевый'],
      ['2049156013555', 0, 'Костюмы', 'LOOK.IN', 'Костюм', 'M', 'Корея_2голубой'],
    ]));

    expect(result.sourceRows).toBe(3);
    expect(result.duplicateRows).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ barcode: '2049156013036', quantity: 21, size: 'S' });
  });

  it('rejects a file without barcode and quantity headers', () => {
    expect(() => parseWbStockFile(workbookBuffer([['Товар', 'Остаток WB'], ['A', 2]])))
      .toThrow('Баркод');
  });
});
