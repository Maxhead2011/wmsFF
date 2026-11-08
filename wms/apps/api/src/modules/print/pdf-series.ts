import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

// FIX: one ordered bitmap series for the existing agent; fit without cropping codes.
export async function pdfSeries(base64: unknown, widthMm: number, heightMm: number) {
  if (typeof base64 !== 'string' || base64.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new BadRequestException('Неверный PDF или файл больше 6 МБ. Скачайте PDF и печатайте из просмотрщика.');
  const data = Buffer.from(base64, 'base64');
  if (data.subarray(0, 5).toString() !== '%PDF-') throw new BadRequestException('Ожидается PDF.');
  const pdf = await PDFDocument.load(data);
  const count = pdf.getPageCount(), width = Math.round(widthMm / 25.4 * 203), height = Math.round(heightMm / 25.4 * 203);
  if (!count || count > 500 || count * width * height > 60_000_000)
    throw new BadRequestException('Лента слишком велика для одного задания. Выберите меньше заказов.');
  const output = await PDFDocument.create();
  const w = widthMm / 25.4 * 72, h = heightMm / 25.4 * 72;
  for (const page of pdf.getPages()) {
    const embedded = await output.embedPage(page);
    const scale = Math.min(w / embedded.width, h / embedded.height);
    output.addPage([w, h]).drawPage(embedded, { x: (w - embedded.width * scale) / 2,
      y: (h - embedded.height * scale) / 2, width: embedded.width * scale, height: embedded.height * scale });
  }
  const parser = new PDFParse({ data: Buffer.from(await output.save()) });
  try {
    const result = await parser.getScreenshot({ desiredWidth: width, imageDataUrl: false, imageBuffer: true });
    if (result.pages.length !== count) throw new BadRequestException('Не удалось подготовить все страницы. Задание не отправлено.');
    return result.pages.map((page, i) => ({ value: `WB_${i + 1}`, imageBase64: Buffer.from(page.data).toString('base64') }));
  } finally { await parser.destroy(); }
}
