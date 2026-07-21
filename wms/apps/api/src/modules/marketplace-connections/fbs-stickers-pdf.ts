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
      title: `FBS WB stickers (${stickers.length})`,
      subject: 'Штрихкоды заказов FBS Wildberries',
      author: 'LOGOFF WMS',
      creator: 'LOGOFF WMS',
    },
    defaultStyle: { font: 'DejaVuSans' },
    content,
  };

  return pdfMake.createPdf(definition).getBuffer();
}
