import bwipjs = require('bwip-js');
import pdfMake = require('pdfmake');
import type { Content } from 'pdfmake/interfaces';
import { PDFParse } from 'pdf-parse';
import { configurePdfMake } from '../../common/pdf/pdfmake';
import { duplicateBarcodeOptions, parseDuplicateKiz } from './kiz-duplicate-code';

export type DuplicateProduct = { id: string; name: string; article: string | null; size: string | null; color: string | null };
const MM = 72 / 25.4;
export async function buildKizDuplicateLabel(kiz: string, product: DuplicateProduct) {
  configurePdfMake();
  const identity = parseDuplicateKiz(kiz).identity;
  const svg = bwipjs.toSVG(duplicateBarcodeOptions(kiz));
  const clean = (s: string | null) => (s || '—').replace(/[\x00-\x1f]/g, ' ');
  const line = (text: string, x: number, y: number, width: number, fontSize: number, bold = false): Content => ({
    absolutePosition: { x: x * MM, y: y * MM }, columns: [{ width: width * MM, text, fontSize, bold, lineHeight: 1.05 }],
  });
  // FIX: fixed-size, single-label layout; long names are explicitly abbreviated.
  const shorten = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;
  const pdf = await pdfMake.createPdf({ pageSize: { width: 58 * MM, height: 40 * MM }, pageMargins: 0,
    defaultStyle: { font: 'DejaVuSans' }, content: [
      line(identity, 2, 1.5, 54, 5),
      { svg, width: 26 * MM, height: 26 * MM, absolutePosition: { x: 1.5 * MM, y: 6 * MM } },
      line(shorten(clean(product.name), 55), 29, 6, 27, 6, true),
      line(shorten(clean(product.article), 55), 29, 17, 27, 6, true),
      line('Цвет: ' + shorten(clean(product.color), 28), 29, 28, 27, 5.5),
      line('Размер: ' + shorten(clean(product.size), 20), 2, 34, 54, 8, true),
    ],
  }).getBuffer();
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getScreenshot({ desiredWidth: 696, imageDataUrl: false, imageBuffer: true });
    if (result.pages.length !== 1 || !result.pages[0].data?.length) throw new Error('Этикетка не поместилась на одну страницу.');
    return Buffer.from(result.pages[0].data).toString('base64');
  } finally { await parser.destroy(); }
}
