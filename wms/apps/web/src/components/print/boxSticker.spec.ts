import { describe, expect, it } from 'vitest';
import { boxLabelBoxes, boxSticker, boxStickerLayout } from './boxSticker';
import { buildStickerTspl } from '../../lib/stickerLayout';

describe('box label layout', () => {
  // TEST: box labels fit the 60 × 40 stock and contain only the client, selected code and its movable caption.
  it('keeps every visible element within 60 × 40 mm with a safe edge', () => {
    for (const kind of ['qr', 'code128', 'both'] as const) {
      const boxes = boxLabelBoxes(kind);
      const sticker = boxSticker('ИП Лукин', 'FFL_LKB0707_006', kind, boxes);
      expect(sticker.qrEnabled).toBe(kind !== 'code128');
      expect(sticker.barcodeEnabled).toBe(kind !== 'qr');
      expect(sticker.bottomText).toBe('');
      for (const key of ['client', 'number', ...(sticker.qrEnabled ? ['qr'] : []), ...(sticker.barcodeEnabled ? ['barcode'] : [])] as (keyof typeof boxes)[]) {
        const box = boxes[key];
        expect(box.x).toBeGreaterThanOrEqual(24);
        expect(box.y).toBeGreaterThanOrEqual(16);
        expect(box.x + box.width).toBeLessThanOrEqual(456);
        expect(box.y + box.height).toBeLessThanOrEqual(304);
      }
    }
  });
  it('fits the FFL Code 128 and prints the movable caption only once', () => {
    const boxes = boxLabelBoxes('code128');
    const tspl = buildStickerTspl(boxStickerLayout('code128', boxes, 'FFL_LKB0707_006'));
    expect(tspl).toContain('SIZE 60 mm,40 mm');
    expect(tspl).toContain('BARCODE 24,75,"128",120,0,0,2,2');
    expect(tspl).toContain('BLOCK 24,220,432,50');
    expect(tspl).not.toContain('Кол-во строк');
  });
});
