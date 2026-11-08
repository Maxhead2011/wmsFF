import { expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { pdfSeries } from '../src/modules/print/pdf-series';
// TEST: real renderer preserves every page and produces agent-compatible media.
it('renders all pages to 58x40 without dropping labels', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([164.4, 113.4]).drawRectangle({ x: 10 + i * 10, y: 10, width: 20, height: 30, color: rgb(0, 0, 0) });
  const pages = await pdfSeries(Buffer.from(await pdf.save()).toString('base64'), 58, 40);
  expect(pages.map(p => p.value)).toEqual(['WB_1', 'WB_2', 'WB_3']);
  expect(new Set(pages.map(p => p.imageBase64)).size).toBe(3);
  for (const page of pages) { const png = Buffer.from(page.imageBase64, 'base64'); expect(png.readUInt32BE(16)).toBe(464); expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(319); }
}, 20000);
it('rejects non-PDF and oversized inputs', async () => {
  await expect(pdfSeries('bad', 58, 40)).rejects.toThrow();
  await expect(pdfSeries('A'.repeat(8_000_001), 58, 40)).rejects.toThrow();
});
