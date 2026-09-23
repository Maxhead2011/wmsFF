import { describe, expect, it } from 'vitest';
import { buildStickerTspl, fitStickerText, moveStickerBox, type StickerLayout } from './stickerLayout';

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
  // TEST: resizing remains within the label; custom coordinates reach the actual print data.
  it('keeps dragged and resized elements inside the page and prints their positions', () => {
    const qr = moveStickerBox({ x: 20, y: 82, width: 100, height: 100 }, 999, 999, 320, 480);
    expect(qr).toEqual({ x: 220, y: 380, width: 100, height: 100 });
    const number = moveStickerBox({ x: 16, y: 320, width: 288, height: 30 }, 50, 10, 320, 480, true);
    expect(number).toEqual({ x: 16, y: 320, width: 304, height: 40 });
    const boxes = { client: { x: 12, y: 12, width: 280, height: 30 }, top: { x: 12, y: 48, width: 280, height: 30 }, qr, barcode: { x: 16, y: 180, width: 180, height: 70 }, number, bottom: { x: 16, y: 365, width: 288, height: 30 } };
    const tspl = buildStickerTspl({ ...base, boxes });
    expect(tspl).toContain('QRCODE 220,380');
    expect(tspl).toContain('BLOCK 16,320,304,40');
  });
  // TEST: the complete text is wrapped at a readable minimum instead of being truncated.
  it('fits text inside a field or explains why it cannot', () => {
    const measure = (value: string, size: number) => value.length * size * .5;
    expect(fitStickerText('Короб клиента Лукина', { x: 0, y: 0, width: 110, height: 40 }, 18, measure).lines.length).toBe(2);
    expect(() => fitStickerText('Оченьдлинноесловобезразделителей', { x: 0, y: 0, width: 40, height: 20 }, 18, measure)).toThrow('не помещается');
  });
});
