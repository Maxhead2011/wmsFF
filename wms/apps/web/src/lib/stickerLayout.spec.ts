import { describe, expect, it } from 'vitest';
import { buildStickerTspl, type StickerLayout } from './stickerLayout';

const base: StickerLayout = { width: 40, height: 60, font: 3, codeKind: 'qr', qrLevel: 'M', qrModule: 4, barcodeHeight: 70, topText: '', bottomText: '', qrX: 20, qrY: 82, barcodeX: 16, barcodeY: 180, numberY: 320 };
// TEST: printer templates reflect the selected code kind and NiceLabel-style settings.
describe('sticker layout', () => {
  it('creates QR only with selected correction and module', () => {
    const tspl = buildStickerTspl({ ...base, qrLevel: 'H', qrModule: 5 });
    expect(tspl).toContain('QRCODE 20,82,H,5');
    expect(tspl).not.toContain('BARCODE ');
  });
  it('creates Code 128 only or both', () => {
    expect(buildStickerTspl({ ...base, codeKind: 'code128' })).not.toContain('QRCODE ');
    expect(buildStickerTspl({ ...base, codeKind: 'both' })).toContain('BARCODE ');
  });
  it('rejects invalid physical dimensions', () => expect(() => buildStickerTspl({ ...base, width: 0 })).toThrow());
  it('rejects text below the printable area', () => expect(() => buildStickerTspl({ ...base, height: 30, numberY: 230 })).toThrow('за границы'));
});
