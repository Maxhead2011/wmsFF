import bwipjs = require('bwip-js');
import pdfMake = require('pdfmake');
import type { Content } from 'pdfmake/interfaces';
import { PDFParse } from 'pdf-parse';
import { configurePdfMake } from '../../common/pdf/pdfmake';

const MM = 72 / 25.4;

export type RelabelProduct = {
  name: string;
  article: string | null;
  color: string | null;
  size: string | null;
  brand: string | null;
};

export async function buildTsdRelabelLabel(barcode: string, product: RelabelProduct, clientName: string) {
  configurePdfMake();
  const clean = (value: string | null | undefined) => (value ?? '').replace(/[\x00-\x1f]/g, ' ').trim();
  const line = (value: string, y: number, fontSize: number, bold = false): Content => ({
    absolutePosition: { x: 2 * MM, y: y * MM },
    columns: [{ width: 54 * MM, text: value, fontSize, bold, noWrap: true, margin: 0 }],
  });
  const fit = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
  const name = clean(product.name);
  const nameCut = name.length > 31 ? name.lastIndexOf(' ', 31) : -1;
  const nameLines = nameCut > 15 ? `${name.slice(0, nameCut)}\n${fit(name.slice(nameCut + 1), 34)}` : fit(name, 60);
  // FIX: the same barcode is rendered twice by the existing quiet-print agent.
  // Keep every field inside the 58 × 40 mm paper configured on station 2409.
  const barcodeSvg = bwipjs.toSVG({ bcid: 'code128', text: barcode, scale: 2, height: 12, includetext: false });
  const content: Content[] = [
    { svg: barcodeSvg, width: 40 * MM, height: 11 * MM, absolutePosition: { x: 2 * MM, y: 1 * MM } },
    { text: 'EAC', bold: true, fontSize: 13, absolutePosition: { x: 44 * MM, y: 3 * MM } },
    line(barcode, 12, 8, true),
    { absolutePosition: { x: 2 * MM, y: 17 * MM }, columns: [{
      width: 54 * MM, text: nameLines, fontSize: 7, bold: true, lineHeight: 0.9, margin: 0,
    }] },
    ...(product.article ? [line(`Артикул: ${fit(clean(product.article), 41)}`, 25, 6.5)] : []),
    ...(product.color ? [line(`Цвет: ${fit(clean(product.color), 44)}`, 29, 6.5)] : []),
    ...(product.size ? [line(`Размер: ${fit(clean(product.size), 43)}`, 33, 6.5, true)] : []),
    ...(product.brand ? [line(`Бренд: ${fit(clean(product.brand), 29)}`, 36, 6, true)] : []),
    { absolutePosition: { x: 28 * MM, y: 36 * MM }, columns: [{
      width: 28 * MM, text: fit(clean(clientName), 24), fontSize: 5.5, alignment: 'right', margin: 0,
    }] },
  ];
  const pdf = await pdfMake.createPdf({
    pageSize: { width: 58 * MM, height: 40 * MM }, pageMargins: 0,
    defaultStyle: { font: 'DejaVuSans' }, content,
  }).getBuffer();
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getScreenshot({ desiredWidth: 696, imageDataUrl: false, imageBuffer: true });
    if (result.pages.length !== 1 || !result.pages[0]?.data?.length) throw new Error('Этикетка не поместилась на одну страницу.');
    return Buffer.from(result.pages[0].data).toString('base64');
  } finally {
    await parser.destroy();
  }
}
