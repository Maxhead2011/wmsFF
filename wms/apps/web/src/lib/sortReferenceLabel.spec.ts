import { describe, expect, it } from 'vitest';
import { defaultSortReferenceText, sortReferenceTspl } from './sortReferenceLabel';

describe('reference-style warehouse labels', () => {
  it('centers and bolds only the selected side caption', () => {
    // TEST: each caption can have its own alignment and weight.
    const fields = defaultSortReferenceText('PALET_SORT_47');
    const tspl = sortReferenceTspl('PALET_SORT_47', 'pallet', { ...fields, left: { ...fields.left, text: '47', align: 'center', bold: true } });
    expect(tspl).toContain('TEXT 91,161');
    expect(tspl).toContain('TEXT 92,161');
    expect(tspl).toContain('TEXT 376,255');
  });
  it('encodes the same pallet-sort code in every QR and barcode', () => {
    // TEST: no barcode may retain a marketplace number or a box code.
    const tspl = sortReferenceTspl('PALET_SORT_102', 'pallet');
    expect(tspl).toContain('SIZE 60 mm,40 mm');
    expect(tspl.match(/QRCODE /g)).toHaveLength(5);
    expect(tspl.match(/BARCODE /g)).toHaveLength(2);
    expect(tspl.match(/PALET_SORT_102/g)).toHaveLength(9);
    expect(tspl).not.toContain('palet_sort_');
  });
  it('encodes the box FFL code instead of the pallet-sort code', () => {
    const tspl = sortReferenceTspl('FFL_LKB2409_001', 'box');
    expect(tspl.match(/FFL_LKB2409_001/g)).toHaveLength(9);
    expect(tspl).not.toContain('PALET_SORT_102');
  });
  it('prints edited left and right text at the selected positions without changing scan codes', () => {
    // TEST: custom visible text and movement must affect print data, while QR and barcode still encode the real pallet.
    const fields = defaultSortReferenceText('PALET_SORT_47');
    expect(fields.left.text).toBe('PALET_SORT_47');
    expect(fields.right.text).toBe('PALET_SORT_47');
    expect(fields.left).toMatchObject({ width: 210, height: 26 });
    const tspl = sortReferenceTspl('PALET_SORT_47', 'pallet', {
      left: { text: 'Паллета 47', x: 103, y: 245, width: 180, height: 26 },
      right: { text: 'Правая подпись', x: 372, y: 251, width: 190, height: 26 },
    });
    expect(tspl).toContain('TEXT 103,245');
    expect(tspl).toContain('Паллета 47');
    expect(tspl).toContain('TEXT 372,251');
    expect(tspl.match(/PALET_SORT_47/g)).toHaveLength(7);
  });
  it('rejects a text box that is too short for the complete label', () => {
    const fields = defaultSortReferenceText('PALET_SORT_47');
    expect(() => sortReferenceTspl('PALET_SORT_47', 'pallet', { ...fields, left: { ...fields.left, width: 40 } })).toThrow('не помещается');
  });
  it('scales visible text when its field is enlarged', () => {
    const fields = defaultSortReferenceText('PALET_SORT_47');
    const tspl = sortReferenceTspl('PALET_SORT_47', 'pallet', { ...fields, left: { text: '47', x: 91, y: 180, width: 100, height: 45 } });
    expect(tspl).toContain('TEXT 91,180,"2",270,2,2,"47"');
  });
});
