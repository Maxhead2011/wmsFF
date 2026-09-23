export type StickerCodeKind = 'qr' | 'code128' | 'both';

export type StickerLayout = {
  width: number;
  height: number;
  font: number;
  codeKind: StickerCodeKind;
  qrLevel: 'L' | 'M' | 'Q' | 'H';
  qrModule: number;
  barcodeHeight: number;
  topText: string;
  bottomText: string;
  qrX: number;
  qrY: number;
  barcodeX: number;
  barcodeY: number;
  numberY: number;
  boxes?: StickerBoxes;
};

export type StickerBox = { x: number; y: number; width: number; height: number };
export type StickerBoxes = Record<'client' | 'top' | 'qr' | 'barcode' | 'number' | 'bottom', StickerBox>;
export const MIN_TEXT_DOTS = 16;

// FIX: the editor, validation and printer template share one coordinate system (8 dots/mm).
export function defaultStickerBoxes(input: StickerLayout): StickerBoxes {
  const pageWidth = input.width * 8;
  const pageHeight = input.height * 8;
  return {
    client: { x: 16, y: 12, width: pageWidth - 32, height: 30 },
    top: { x: 16, y: 45, width: pageWidth - 32, height: 30 },
    qr: { x: input.qrX, y: input.qrY, width: input.qrModule * 25, height: input.qrModule * 25 },
    barcode: { x: input.barcodeX, y: input.barcodeY, width: Math.min(180, pageWidth - input.barcodeX), height: input.barcodeHeight },
    number: { x: 16, y: input.numberY, width: pageWidth - 32, height: 30 },
    bottom: { x: 16, y: Math.min(pageHeight - 38, input.numberY + 32), width: pageWidth - 32, height: 28 },
  };
}

export function moveStickerBox(box: StickerBox, dx: number, dy: number, pageWidth: number, pageHeight: number, resize = false): StickerBox {
  if (resize) return { ...box, width: clamp(Math.round(box.width + dx), 24, pageWidth - box.x), height: clamp(Math.round(box.height + dy), 18, pageHeight - box.y) };
  return { ...box, x: clamp(Math.round(box.x + dx), 0, pageWidth - box.width), y: clamp(Math.round(box.y + dy), 0, pageHeight - box.height) };
}

export function fitStickerText(text: string, box: StickerBox, maxSize: number, measure: (value: string, size: number) => number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let size = maxSize; size >= MIN_TEXT_DOTS; size--) {
    const lines: string[] = [];
    for (const word of words) {
      const candidate = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length && measure(candidate, size) > box.width) lines.push(word);
      else if (lines.length) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    }
    if (lines.every((line) => measure(line, size) <= box.width) && lines.length * size * 1.2 <= box.height) return { size, lines };
  }
  throw new Error(`Текст «${text}» не помещается в поле. Увеличьте поле или размер этикетки.`);
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

// FIX: use the same code kind and physical dimensions for the saved template and its preview.
export function buildStickerTspl(input: StickerLayout) {
  if (!Number.isInteger(input.width) || input.width < 20 || input.width > 150 ||
      !Number.isInteger(input.height) || input.height < 20 || input.height > 150) {
    throw new Error('Размер этикетки должен быть от 20 до 150 мм.');
  }
  if (!Number.isInteger(input.qrModule) || input.qrModule < 1 || input.qrModule > 10 ||
      !Number.isInteger(input.barcodeHeight) || input.barcodeHeight < 20 || input.barcodeHeight > 150) {
    throw new Error('Проверьте размер QR или высоту штрихкода.');
  }
  const hasQr = input.codeKind !== 'code128';
  const hasBarcode = input.codeKind !== 'qr';
  const pageWidth = input.width * 8;
  const pageHeight = input.height * 8;
  const boxes = input.boxes ?? defaultStickerBoxes(input);
  const visible: (keyof StickerBoxes)[] = ['client', 'number'];
  if (input.topText) visible.push('top');
  if (input.bottomText) visible.push('bottom');
  if (hasQr) visible.push('qr');
  if (hasBarcode) visible.push('barcode');
  if (visible.some((key) => { const box = boxes[key]; return box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > pageWidth || box.y + box.height > pageHeight; })) {
    throw new Error('Код или текст выходит за границы этикетки. Измените положение элементов.');
  }
  const lines = [`SIZE ${input.width} mm,${input.height} mm`, 'GAP 2 mm,0', 'CLS'];
  // TSPL BLOCK fit=1 scales text to its box. The editor also checks a readable minimum.
  const block = (box: StickerBox, variable: string) => `BLOCK ${box.x},${box.y},${box.width},${box.height},"0",0,${input.font * 6},${input.font * 6},0,0,1,"{{${variable}}}"`;
  lines.push(block(boxes.client, 'clientName'));
  if (input.topText) lines.push(block(boxes.top, 'topText'));
  if (hasQr) lines.push(`QRCODE ${boxes.qr.x},${boxes.qr.y},${input.qrLevel},${clamp(Math.round(boxes.qr.width / 25), 1, 10)},A,0,"{{qrValue}}"`);
  if (hasBarcode) lines.push(`BARCODE ${boxes.barcode.x},${boxes.barcode.y},"128",${boxes.barcode.height},1,0,${clamp(Math.round(boxes.barcode.width / 100), 1, 4)},${clamp(Math.round(boxes.barcode.width / 100), 1, 4)},"{{barcodeValue}}"`);
  lines.push(block(boxes.number, 'barcodeValue'));
  if (input.bottomText) lines.push(block(boxes.bottom, 'bottomText'));
  lines.push('PRINT 1');
  return lines.join('\n');
}
