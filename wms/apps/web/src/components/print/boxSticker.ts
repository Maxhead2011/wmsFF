import type { BrowserSticker } from './niimbotBrowser';
import type { StickerBoxes, StickerCodeKind, StickerLayout } from '../../lib/stickerLayout';

export const BOX_LABEL_WIDTH_MM = 60;
export const BOX_LABEL_HEIGHT_MM = 40;

// FIX: use the loaded 60 × 40 stock and reserve about 3 mm on each side for printer tolerance.
export function boxLabelBoxes(kind: StickerCodeKind): StickerBoxes {
  const common = {
    client: { x: 24, y: 16, width: 432, height: 42 },
    top: { x: 24, y: 16, width: 432, height: 1 },
    number: { x: 24, y: 220, width: 432, height: 50 },
    bottom: { x: 24, y: 280, width: 432, height: 1 },
  };
  if (kind === 'both') return { ...common, qr: { x: 28, y: 76, width: 124, height: 124 }, barcode: { x: 172, y: 80, width: 284, height: 110 } };
  return { ...common, qr: { x: 174, y: 68, width: 132, height: 132 }, barcode: { x: 24, y: 75, width: 432, height: 120 } };
}

export function boxSticker(clientName: string, boxCode: string, kind: StickerCodeKind, boxes: StickerBoxes): BrowserSticker {
  return {
    clientName,
    value: boxCode,
    topText: '',
    bottomText: '',
    fontSize: 4,
    qrEnabled: kind !== 'code128',
    barcodeEnabled: kind !== 'qr',
    qrX: boxes.qr.x,
    qrY: boxes.qr.y,
    barcodeX: boxes.barcode.x,
    barcodeY: boxes.barcode.y,
    numberY: boxes.number.y,
    boxes,
  };
}

export function boxStickerLayout(kind: StickerCodeKind, boxes: StickerBoxes, code: string): StickerLayout {
  // Code 128 worst-case module count (without digit-pair compression) stays inside the edited box.
  const modules = 11 * (code.length + 2) + 13;
  const barcodeModule = Math.min(4, Math.floor(boxes.barcode.width / modules));
  if (kind !== 'qr' && barcodeModule < 1) throw new Error('Код FFL слишком длинный для поля штрихкода. Увеличьте поле или выберите QR.');
  return {
    width: BOX_LABEL_WIDTH_MM, height: BOX_LABEL_HEIGHT_MM, font: 4,
    codeKind: kind, barcodeHumanReadable: false, barcodeModule: Math.max(1, barcodeModule), qrLevel: 'M', qrModule: 5, barcodeHeight: boxes.barcode.height,
    topText: '', bottomText: '', qrX: boxes.qr.x, qrY: boxes.qr.y,
    barcodeX: boxes.barcode.x, barcodeY: boxes.barcode.y, numberY: boxes.number.y, boxes,
  };
}
