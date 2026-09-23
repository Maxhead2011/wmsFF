import JsBarcode from 'jsbarcode';
import type { productLabelVariables } from './productLabel';

// FIX: the existing Windows agent prints PNG via the printer driver, so it can serve TSC and Xprinter.
export function renderProductLabelPng(label: ReturnType<typeof productLabelVariables>) {
  const canvas = document.createElement('canvas');
  canvas.width = 709; // 60 mm at 300 dpi
  canvas.height = 472; // 40 mm at 300 dpi
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить изображение этикетки.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000'; context.textBaseline = 'top';
  context.font = '22px Arial'; context.fillText(label.clientName, 18, 13, 673);
  context.font = 'bold 27px Arial'; context.fillText(label.name, 18, 53, 673);
  context.font = '21px Arial'; context.fillText(label.article, 18, 92, 673);
  context.font = '21px Arial'; context.fillText(label.variant, 18, 126, 673);
  const bars = document.createElement('canvas');
  try {
    JsBarcode(bars, label.barcode, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 200, background: '#ffffff', lineColor: '#000000' });
  } catch {
    throw new Error(`Штрихкод «${label.barcode}» нельзя напечатать как Code 128.`);
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(bars, 18, 172, 673, 200);
  context.font = 'bold 25px Arial'; context.textAlign = 'center';
  context.fillText(label.barcode, canvas.width / 2, 389, 673);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
