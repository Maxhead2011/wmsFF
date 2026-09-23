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
};

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
  const pageHeight = input.height * 8;
  if (input.numberY < 0 || input.numberY + 24 + (input.bottomText ? 28 : 0) > pageHeight ||
      (hasQr && (input.qrX < 0 || input.qrY < 0 || input.qrY + input.qrModule * 25 > pageHeight)) ||
      (hasBarcode && (input.barcodeX < 0 || input.barcodeY < 0 || input.barcodeY + input.barcodeHeight > pageHeight))) {
    throw new Error('Код или текст выходит за границы этикетки. Измените положение элементов.');
  }
  const lines = [`SIZE ${input.width} mm,${input.height} mm`, 'GAP 2 mm,0', 'CLS',
    `TEXT 20,16,"${input.font}",0,1,1,"{{clientName}}"`];
  if (input.topText) lines.push(`TEXT 20,48,"${input.font}",0,1,1,"{{topText}}"`);
  if (hasQr) lines.push(`QRCODE ${input.qrX},${input.qrY},${input.qrLevel},${input.qrModule},A,0,"{{qrValue}}"`);
  if (hasBarcode) lines.push(`BARCODE ${input.barcodeX},${input.barcodeY},"128",${input.barcodeHeight},1,0,2,2,"{{barcodeValue}}"`);
  lines.push(`TEXT 20,${input.numberY},"${input.font}",0,1,1,"{{barcodeValue}}"`);
  if (input.bottomText) lines.push(`TEXT 20,${input.numberY + 28},"${input.font}",0,1,1,"{{bottomText}}"`);
  lines.push('PRINT 1');
  return lines.join('\n');
}
