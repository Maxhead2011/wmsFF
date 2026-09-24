import { describe, expect, it } from 'vitest';
import { sortReferenceTspl } from './sortReferenceLabel';

describe('reference-style warehouse labels', () => {
  it('encodes the same pallet-sort code in every QR and barcode', () => {
    // TEST: no barcode may retain a marketplace number or a box code.
    const tspl = sortReferenceTspl('PALET_SORT_102', 'pallet');
    expect(tspl).toContain('SIZE 60 mm,40 mm');
    expect(tspl.match(/QRCODE /g)).toHaveLength(5);
    expect(tspl.match(/BARCODE /g)).toHaveLength(2);
    expect(tspl.match(/PALET_SORT_102/g)).toHaveLength(8);
    expect(tspl).toContain('palet_sort_');
  });
  it('encodes the box FFL code instead of the pallet-sort code', () => {
    const tspl = sortReferenceTspl('FFL_LKB2409_001', 'box');
    expect(tspl.match(/FFL_LKB2409_001/g)).toHaveLength(8);
    expect(tspl).not.toContain('PALET_SORT_102');
  });
});
