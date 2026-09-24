import JsBarcode from 'jsbarcode';
import type { productLabelVariables, productMarketplaceVariables, ProductLabelTemplate } from './productLabel';

// FIX: the existing Windows agent prints PNG via the printer driver, so it can serve TSC and Xprinter.
export function renderProductLabelPng(label: ReturnType<typeof productLabelVariables> | ReturnType<typeof productMarketplaceVariables>, kind: ProductLabelTemplate = 'standard') {
  const canvas = document.createElement('canvas');
  canvas.width = kind === 'wb-compact' ? 472 : 709; // 300 dpi
  canvas.height = kind === 'wb-compact' ? 354 : 472;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить изображение этикетки.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000'; context.textBaseline = 'top';
  if (kind === 'standard') {
    context.font = '22px Arial'; context.fillText(label.clientName, 18, 13, 673);
    context.font = 'bold 27px Arial'; context.fillText(label.name, 18, 53, 673);
    context.font = '21px Arial'; context.fillText(label.article, 18, 92, 673);
    context.font = '21px Arial'; context.fillText(label.variant, 18, 126, 673);
  }
  const bars = document.createElement('canvas');
  try {
    JsBarcode(bars, label.barcode, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 200, background: '#ffffff', lineColor: '#000000' });
  } catch {
    throw new Error(`Штрихкод «${label.barcode}» нельзя напечатать как Code 128.`);
  }
  context.imageSmoothingEnabled = false;
  if (kind === 'standard') {
    context.drawImage(bars, 18, 172, 673, 200);
    context.font = 'bold 25px Arial'; context.textAlign = 'center';
    context.fillText(label.barcode, canvas.width / 2, 389, 673);
  } else {
    const marketplace = label as ReturnType<typeof productMarketplaceVariables>;
    const compact = kind === 'wb-compact';
    context.drawImage(bars, compact ? 14 : 18, 10, compact ? 444 : 470, compact ? 100 : 132);
    if (!compact) { context.font = 'bold 82px Arial'; context.fillText('EAC', 514, 20, 178); }
    context.textAlign = 'center'; context.font = compact ? 'bold 20px Arial' : 'bold 26px Arial';
    context.fillText(label.barcode, compact ? 236 : 253, compact ? 113 : 147);
    context.textAlign = 'left';
    if (compact) {
      drawFit(context, marketplace.clientShort, 14, 142, 444, 19, false);
      drawFit(context, marketplace.name, 14, 168, 444, 23, true);
      if (marketplace.brand) drawFit(context, `Бренд: ${marketplace.brand}`, 14, 229, 444, 18);
      if (marketplace.color) drawFit(context, `Цвет: ${marketplace.color}`, 14, 254, 444, 18);
      if (marketplace.size) drawFit(context, `Размер: ${marketplace.size}`, 14, 279, 444, 18);
      if (marketplace.article) drawFit(context, `Артикул: ${marketplace.article}`, 14, 313, 444, 17);
    } else {
      drawFit(context, marketplace.name, 18, 182, 673, 32, true);
      if (marketplace.secondLine) drawFit(context, marketplace.secondLine, 18, 225, 673, 28);
      drawFit(context, `Артикул: ${marketplace.wbArticle}`, 18, 267, 673, 23);
      if (marketplace.color) drawFit(context, `Цвет: ${marketplace.color}`, 18, 301, 673, 23);
      if (marketplace.size) drawFit(context, `Размер: ${marketplace.size}`, 18, 335, 673, 23);
      if (marketplace.brand) drawFit(context, `Бренд: ${marketplace.brand}`, 18, 384, 355, 24, true);
      drawFit(context, marketplace.clientShort, 382, 386, 305, 23, true);
      drawFit(context, marketplace.date, 550, 436, 140, 19);
    }
  }
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

function drawFit(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, bold = false) {
  if (!value.trim()) return;
  let actual = size;
  do { context.font = `${bold ? 'bold ' : ''}${actual}px Arial`; if (context.measureText(value).width <= width) break; actual--; } while (actual > 15);
  context.fillText(value, x, y, width);
}
