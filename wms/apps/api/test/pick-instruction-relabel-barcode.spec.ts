import { describe, expect, it } from 'vitest';
import { relabelBarcodeNote } from '../src/modules/stock/pick-instruction.service';

describe('automatic relabel instruction', () => {
  it('passes the exact physical and target barcodes to the TSD instead of the seller article', () => {
    // TEST: the former "переклеить на <article>" note made TSD print the old barcode.
    expect(relabelBarcodeNote('2047945579688', '2053244819783', 'Костюм_спорт')).toBe(
      'перемаркировать 2047945579688 -> 2053244819783',
    );
  });

  it('keeps a human-readable fallback when a barcode is unavailable', () => {
    expect(relabelBarcodeNote('', '', 'Костюм_спорт')).toBe('переклеить на Костюм_спорт');
  });
});
