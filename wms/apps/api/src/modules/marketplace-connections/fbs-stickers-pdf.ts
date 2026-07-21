import pdfMake = require('pdfmake');
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { configurePdfMake } from '../../common/pdf/pdfmake';

export type FbsStickerImage = {
  orderId: string;
  barcode: string;
  file: string;
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
