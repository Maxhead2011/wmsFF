import pdfMake = require('pdfmake');
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { PDFDocument } from 'pdf-lib';
import { configurePdfMake } from '../../common/pdf/pdfmake';

export type FbsStickerImage = {
  orderId: string;
  barcode: string;
  file: string;
};

export type FbsPickListRow = {
  orderId: string;
  productName: string;
  article: string;
  barcodes: string[];
  quantity: number;
  boxes: Array<{ code: string; quantity: number }>;
  sticker?: FbsStickerImage | null;
};

const LABEL_WIDTH_PT = 58 * 2.8346456693;
const LABEL_HEIGHT_PT = 40 * 2.8346456693;

export async function buildFbsStickersPdf(stickers: FbsStickerImage[]) {
  return buildStickerPdf(stickers, {
    title: `FBS WB order stickers (${stickers.length})`,
    subject: 'Штрихкоды заказов FBS Wildberries',
  });
}

export async function buildFbsCargoPlaceStickersPdf(stickers: FbsStickerImage[]) {
  return buildStickerPdf(stickers, {
    title: `FBS WB cargo place stickers (${stickers.length})`,
    subject: 'QR-коды грузомест FBS Wildberries',
  });
}

export async function buildFbsSupplyStickersPdf(stickers: FbsStickerImage[]) {
  return buildStickerPdf(stickers, {
    title: `FBS WB supply stickers (${stickers.length})`,
    subject: 'QR-коды поставок FBS Wildberries для сортировочного центра',
  });
}

export async function mergeFbsStickerPdfs(buffers: Buffer[]) {
  const documents = buffers.filter((buffer) => buffer.length > 0);
  if (documents.length === 0) {
    throw new Error('Нет PDF-этикеток для объединения.');
  }
  if (documents.length === 1) {
    return documents[0];
  }

  const merged = await PDFDocument.create();
  for (const buffer of documents) {
    const source = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

export async function buildFbsPickListPdf(input: {
  requestNumber: number;
  requestTitle: string;
  clientName: string;
  marketplaceLabel?: string;
  rows: FbsPickListRow[];
}) {
  configurePdfMake();
  const marketplaceLabel = input.marketplaceLabel?.trim() || 'маркетплейс';
  const tableBody: Content[][] = [
    [
      { text: `Заказ ${marketplaceLabel}`, bold: true },
      { text: 'Товар', bold: true },
      { text: 'Короб хранения', bold: true },
      { text: 'Кол-во', bold: true },
      { text: `QR / ШК ${marketplaceLabel}`, bold: true },
    ],
    ...input.rows.map((row) => [
      { text: row.orderId, bold: true },
      {
        stack: [
          { text: row.productName, bold: true },
          { text: `Артикул: ${row.article || '—'}`, fontSize: 8 },
          { text: `ШК товара: ${row.barcodes.join(', ') || '—'}`, fontSize: 8 },
        ],
      },
      {
        text: row.boxes.length
          ? row.boxes.map((box) => `${box.code} — ${box.quantity} шт.`).join('\n')
          : 'Короб не найден',
        fontSize: 8,
      },
      { text: String(row.quantity), bold: true, alignment: 'center' as const },
      row.sticker?.file
        ? {
            image: `data:image/png;base64,${row.sticker.file}`,
            width: LABEL_WIDTH_PT,
            height: LABEL_HEIGHT_PT,
          }
        : {
            text: `Этикетка ${marketplaceLabel} будет доступна после завершения сборки отправления.`,
            fontSize: 8,
            color: '#666666',
          },
    ]),
  ];
  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [18, 18, 18, 18],
    info: {
      title: `FBS pick list ${input.requestNumber}`,
      subject: `Лист подбора FBS ${marketplaceLabel}`,
      author: 'LOGOFF WMS',
      creator: 'LOGOFF WMS',
    },
    defaultStyle: { font: 'DejaVuSans', fontSize: 9 },
    content: [
      { text: `Лист подбора FBS · заявка №${String(input.requestNumber).padStart(6, '0')}`, fontSize: 16, bold: true },
      { text: `${input.clientName} · ${input.requestTitle}`, margin: [0, 3, 0, 10], color: '#555555' },
      {
        table: {
          headerRows: 1,
          widths: [62, '*', 112, 42, LABEL_WIDTH_PT],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };

  return pdfMake.createPdf(definition).getBuffer();
}

async function buildStickerPdf(
  stickers: FbsStickerImage[],
  metadata: { title: string; subject: string },
) {
  configurePdfMake();
  const content: Content[] = stickers.map((sticker, index) => ({
    image: `data:image/png;base64,${sticker.file}`,
    width: LABEL_WIDTH_PT,
    height: LABEL_HEIGHT_PT,
    ...(index < stickers.length - 1 ? { pageBreak: 'after' as const } : {}),
  }));
  const definition: TDocumentDefinitions = {
    pageSize: { width: LABEL_WIDTH_PT, height: LABEL_HEIGHT_PT },
    pageMargins: [0, 0, 0, 0],
    info: {
      title: metadata.title,
      subject: metadata.subject,
      author: 'LOGOFF WMS',
      creator: 'LOGOFF WMS',
    },
    defaultStyle: { font: 'DejaVuSans' },
    content,
  };

  return pdfMake.createPdf(definition).getBuffer();
}
