import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export type SortReferenceKind = 'box' | 'pallet';
export const SORT_REFERENCE_WIDTH_MM = 60;
export const SORT_REFERENCE_HEIGHT_MM = 40;

function cleanCode(code: string) {
  const value = code.trim();
  if (!value || value.length > 24 || /["\r\n\t]/.test(value)) throw new Error('Укажите корректный код короба или палет-сорта (до 24 символов).');
  return value;
}

// FIX: every scan symbol on the reference-inspired label carries the actual WMS object code.
export function sortReferenceTspl(code: string, kind: SortReferenceKind) {
  const value = cleanCode(code);
  const caption = kind === 'pallet' ? 'palet_sort_' : 'FFL';
  return [
    'SIZE 60 mm,40 mm', 'GAP 2 mm,0', 'CLS',
    `BARCODE 118,12,"128",37,0,0,1,1,"${value}"`,
    `BARCODE 118,270,"128",37,0,0,1,1,"${value}"`,
    `QRCODE 156,65,M,6,A,0,"${value}"`,
    `QRCODE 20,65,M,2,A,0,"${value}"`,
    `QRCODE 20,225,M,2,A,0,"${value}"`,
    `QRCODE 420,65,M,2,A,0,"${value}"`,
    `QRCODE 420,225,M,2,A,0,"${value}"`,
    `TEXT 94,258,"2",270,1,1,"${caption}"`,
    `TEXT 378,260,"2",270,1,1,"${value}"`,
    'PRINT 1',
  ].join('\n');
}

export async function renderSortReferencePng(code: string, kind: SortReferenceKind) {
  const value = cleanCode(code);
  const canvas = document.createElement('canvas');
  canvas.width = 709;
  canvas.height = 472;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить изображение этикетки.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 709, 472);
  context.scale(709 / 480, 472 / 320);
  context.imageSmoothingEnabled = false;
  const qr = async (x: number, y: number, size: number) => {
    const layer = document.createElement('canvas');
    await QRCode.toCanvas(layer, value, { width: size, margin: 0, errorCorrectionLevel: 'M' });
    context.drawImage(layer, x, y, size, size);
  };
  await Promise.all([qr(160, 69, 160), qr(20, 65, 48), qr(20, 224, 48), qr(412, 65, 48), qr(412, 224, 48)]);
  const bars = document.createElement('canvas');
  JsBarcode(bars, value, { format: 'CODE128', displayValue: false, margin: 0, width: 1, height: 38 });
  context.drawImage(bars, 116, 12, 248, 38);
  context.drawImage(bars, 116, 270, 248, 38);
  context.fillStyle = '#111'; context.font = 'bold 24px Arial'; context.textBaseline = 'top';
  context.save(); context.translate(89, 265); context.rotate(-Math.PI / 2);
  context.fillText(kind === 'pallet' ? 'palet_sort_' : 'FFL', 0, 0, 180); context.restore();
  context.save(); context.translate(394, 265); context.rotate(-Math.PI / 2);
  context.fillText(value, 0, 0, 205); context.restore();
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
