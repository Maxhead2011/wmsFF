import pdfMake = require('pdfmake');
import type { Content } from 'pdfmake/interfaces';
import { PDFParse } from 'pdf-parse';
import { configurePdfMake } from '../../common/pdf/pdfmake';

type SortingLabelInput = { requestNumber: number | null; orderId: string; warehouseName: string };
const MM = 72 / 25.4;

// FIX: reserve enough height for every line, including long destination names.
export function fitSortingWarehouse(value: string, width: number, height: number) {
  for (let fontSize = 13; fontSize >= 1; fontSize -= 0.25) {
    const capacity = Math.max(1, Math.floor(width / (fontSize * 1.1)));
    const lines: string[] = [];
    let current = '';
    for (const word of value.trim().split(/\s+/)) {
      if (current && current.length + word.length + 1 > capacity) { lines.push(current); current = ''; }
      let rest = word;
      while (rest.length > capacity) { lines.push(rest.slice(0, capacity)); rest = rest.slice(capacity); }
      current = current ? `${current} ${rest}` : rest;
    }
    if (current) lines.push(current);
    if (lines.length * fontSize * 1.3 <= height) return { text: lines.join('\n'), fontSize };
  }
  throw new Error('Название склада слишком длинное для сортировочной наклейки.');
}

// FIX: a single server-rendered label is consumed by both WMS and the Windows/TSD print station.
export async function buildFbsSortingLabel(input: SortingLabelInput) {
  configurePdfMake();
  const width = 58 * MM, height = 40 * MM, margin = 2 * MM, textWidth = width - margin * 2;
  const warehouse = (input.warehouseName || 'СКЛАД НЕ УКАЗАН').trim().toUpperCase();
  const line = (text: string, y: number, fontSize: number, bold = false): Content => ({
    absolutePosition: { x: margin, y: y * MM },
    columns: [{ width: textWidth, text, alignment: 'center', fontSize, bold, margin: 0 }],
  });
  // Fit long destinations within the last 10 mm instead of overflowing onto another label.
  const fittedWarehouse = fitSortingWarehouse(warehouse, textWidth, 10 * MM);
  const pdf = await pdfMake.createPdf({
    pageSize: { width, height }, pageMargins: 0,
    defaultStyle: { font: 'DejaVuSans' },
    content: [
      { canvas: [{ type: 'rect', x: 0.5, y: 0.5, w: width - 1, h: height - 1, lineWidth: 0.5 }] },
      line('ЗАЯВКА WMS', 2, 8),
      line(input.requestNumber === null ? '№—' : `№${String(input.requestNumber).padStart(6, '0')}`, 5.5, 17, true),
      line('ЗАКАЗ WB', 13, 8), line(input.orderId, 16.5, input.orderId.length > 15 ? 11 : 17, true),
      line('СКЛАД', 24, 8), line(fittedWarehouse.text, 28, fittedWarehouse.fontSize, true),
    ],
  }).getBuffer();
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getScreenshot({ desiredWidth: 685, first: 1, imageDataUrl: false, imageBuffer: true });
    const page = result.pages[0];
    if (!page?.data?.length) throw new Error('Не удалось подготовить сортировочную наклейку.');
    return { contentType: 'image/png' as const, imageBase64: Buffer.from(page.data).toString('base64'), widthMm: 58, heightMm: 40, templateVersion: 'wms-sorting-v1' };
  } finally { await parser.destroy(); }
}
