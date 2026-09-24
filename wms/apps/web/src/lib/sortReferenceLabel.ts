import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export type SortReferenceKind = 'box' | 'pallet';
export type SortReferenceTextField = { text: string; x: number; y: number; width: number; height: number; align?: 'left' | 'center' | 'right'; bold?: boolean };
export type SortReferenceText = { left: SortReferenceTextField; right: SortReferenceTextField };
export const SORT_REFERENCE_WIDTH_MM = 60;
export const SORT_REFERENCE_HEIGHT_MM = 40;

// FIX: both visible captions start with the complete, scannable WMS code.
export function defaultSortReferenceText(code: string): SortReferenceText {
  return { left: { text: code, x: 91, y: 255, width: 210, height: 26 }, right: { text: code, x: 376, y: 255, width: 210, height: 26 } };
}

function cleanField(field: SortReferenceTextField) {
  const text = field.text.trim();
  if (text.length > 24 || /["\r\n\t]/.test(text)) throw new Error('Текст на этикетке должен быть не длиннее 24 символов и без кавычек.');
  if (![field.x, field.y, field.width, field.height].every(Number.isInteger) ||
      field.x < 8 || field.x + field.height > 472 || field.y < 20 || field.y > 310 ||
      field.width < 40 || field.width > 290 || field.height < 18 || field.height > 60 || field.y < field.width + 8) {
    throw new Error('Подпись выходит за границы этикетки. Передвиньте её на макете.');
  }
  if (text && text.length * 11 > field.width) throw new Error('Текст не помещается в поле. Увеличьте ширину поля или сократите надпись.');
  return { ...field, text };
}

export function sortReferenceTextScale(field: SortReferenceTextField) {
  return Math.max(1, Math.min(3, Math.floor(field.width / Math.max(1, field.text.length * 11)), Math.floor(field.height / 20)));
}

function textPosition(field: SortReferenceTextField) {
  const remaining = Math.max(0, field.width - field.text.length * 11 * sortReferenceTextScale(field));
  return field.y - Math.round(field.align === 'center' ? remaining / 2 : field.align === 'right' ? remaining : 0);
}

function cleanCode(code: string) {
  const value = code.trim();
  if (!value || value.length > 24 || /["\r\n\t]/.test(value)) throw new Error('Укажите корректный код короба или палет-сорта (до 24 символов).');
  return value;
}

// FIX: every scan symbol on the reference-inspired label carries the actual WMS object code.
export function sortReferenceTspl(code: string, kind: SortReferenceKind, textFields: SortReferenceText = defaultSortReferenceText(code)) {
  const value = cleanCode(code);
  void kind;
  const left = cleanField(textFields.left);
  const right = cleanField(textFields.right);
  return [
    'SIZE 60 mm,40 mm', 'GAP 2 mm,0', 'CLS',
    `BARCODE 118,12,"128",37,0,0,1,1,"${value}"`,
    `BARCODE 118,270,"128",37,0,0,1,1,"${value}"`,
    `QRCODE 156,65,M,6,A,0,"${value}"`,
    `QRCODE 20,65,M,2,A,0,"${value}"`,
    `QRCODE 20,225,M,2,A,0,"${value}"`,
    `QRCODE 420,65,M,2,A,0,"${value}"`,
    `QRCODE 420,225,M,2,A,0,"${value}"`,
    ...[left, right].flatMap(field => !field.text ? [] : [
      `TEXT ${field.x},${textPosition(field)},"2",270,${sortReferenceTextScale(field)},${sortReferenceTextScale(field)},"${field.text}"`,
      ...(field.bold ? [`TEXT ${field.x + 1},${textPosition(field)},"2",270,${sortReferenceTextScale(field)},${sortReferenceTextScale(field)},"${field.text}"`] : []),
    ]),
    'PRINT 1',
  ].join('\n');
}

export async function renderSortReferencePng(code: string, kind: SortReferenceKind, textFields: SortReferenceText = defaultSortReferenceText(code), includeText = true) {
  const value = cleanCode(code);
  void kind;
  const left = includeText ? cleanField(textFields.left) : textFields.left;
  const right = includeText ? cleanField(textFields.right) : textFields.right;
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
  if (includeText) {
    context.fillStyle = '#111'; context.font = 'bold 20px Arial'; context.textBaseline = 'top';
    for (const field of [left, right]) {
      context.save(); context.translate(field.x, field.y); context.rotate(-Math.PI / 2);
      context.font = `${field.bold ? '900' : '500'} ${20 * sortReferenceTextScale(field)}px Arial`;
      const textWidth = Math.min(field.width, context.measureText(field.text).width);
      const offset = field.align === 'center' ? (field.width - textWidth) / 2 : field.align === 'right' ? field.width - textWidth : 0;
      context.fillText(field.text, offset, 0, field.width); context.restore();
    }
  }
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
