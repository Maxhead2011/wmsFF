import { Injectable } from '@nestjs/common';
import pdfMake = require('pdfmake');
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { PDFDocument } from 'pdf-lib';
import { configurePdfMake } from '../../common/pdf/pdfmake';
import type { AuthUser } from '../auth/auth.types';
import { BillingDocumentService, BillingPrintableDocument } from './billing-document.service';
import {
  BILLING_SELLER,
  actDisplayNumber,
  amountInWordsRub,
  billingAssetDataUrl,
  formatDate,
  formatLongDate,
  formatMoney,
  formatNumber,
  invoiceDisplayNumber,
  unitLabel,
} from './billing-printing';

export type BillingPdfFile = {
  fileName: string;
  contentType: 'application/pdf';
  buffer: Buffer;
};

@Injectable()
export class BillingPdfService {
  constructor(private readonly documents: BillingDocumentService) {
    configurePdfMake();
  }

  async getInvoicePdf(invoiceId: string, user: AuthUser) {
    const document = await this.documents.getInvoiceDocument(invoiceId, user);
    return this.renderPdf(document, 'invoice');
  }

  async getInvoiceActPdf(invoiceId: string, user: AuthUser) {
    const document = await this.documents.getInvoiceActDocument(invoiceId, user);
    return this.renderPdf(document, 'act');
  }

  async getCombinedInvoicesPdf(invoiceIds: string[], clientCode: string, user: AuthUser): Promise<BillingPdfFile> {
    const mergedDocument = await PDFDocument.create();

    for (const invoiceId of invoiceIds) {
      const invoice = await this.getInvoicePdf(invoiceId, user);
      const sourceDocument = await PDFDocument.load(invoice.buffer);
      const sourcePages = await mergedDocument.copyPages(sourceDocument, sourceDocument.getPageIndices());
      sourcePages.forEach((page) => mergedDocument.addPage(page));
    }

    const date = new Date().toISOString().slice(0, 10);
    return {
      fileName: `Счета_${safePdfFileName(clientCode)}_${date}.pdf`,
      contentType: 'application/pdf',
      buffer: Buffer.from(await mergedDocument.save()),
    };
  }

  private async renderPdf(document: BillingPrintableDocument, kind: 'invoice' | 'act'): Promise<BillingPdfFile> {
    const pdfDocument = pdfMake.createPdf(kind === 'act' ? actDefinition(document) : invoiceDefinition(document));
    const buffer = await pdfDocument.getBuffer();

    return {
      fileName: document.fileName.replace(/\.html$/i, '.pdf'),
      contentType: 'application/pdf',
      buffer,
    };
  }
}

function safePdfFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_') || 'клиент';
}

function invoiceDefinition(document: BillingPrintableDocument): TDocumentDefinitions {
  const number = invoiceDisplayNumber(document.number);
  const issuedAt = document.issuedAt ?? new Date().toISOString();

  return baseDefinition(document, [
    invoiceTopNotice(document),
    paymentOrderSample(document),
    {
      text: `Счет на оплату № ${number} от ${formatLongDate(issuedAt)}`,
      bold: true,
      fontSize: 15,
      margin: [0, 18, 0, 10],
    },
    horizontalLine(),
    requisitesLine('Поставщик:', sellerRequisites(document)),
    requisitesLine('Покупатель:', clientRequisites(document)),
    positionsTable(document, 'Товары (работы, услуги)'),
    invoiceTotals(document),
    totalInWords(document, 'Всего наименований'),
    horizontalLine([0, 14, 0, 16]),
    invoiceSignaturesBlock(document),
  ]);
}

function actDefinition(document: BillingPrintableDocument): TDocumentDefinitions {
  const number = actDisplayNumber(document.actNumber, document.number);
  const issuedAt = document.issuedAt ?? new Date().toISOString();

  return baseDefinition(document, [
    {
      text: `Акт № ${number} от ${formatLongDate(issuedAt)}`,
      bold: true,
      fontSize: 17,
      margin: [0, 0, 0, 6],
    },
    horizontalLine([0, 0, 0, 12]),
    requisitesLine('Исполнитель:', sellerRequisites(document)),
    requisitesLine('Заказчик:', clientRequisites(document)),
    positionsTable(document, 'Наименование работ, услуг'),
    actTotals(document),
    totalInWords(document, 'Всего оказано услуг'),
    {
      text: 'Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.',
      fontSize: 10,
      margin: [0, 14, 0, 8],
    },
    horizontalLine([0, 0, 0, 22]),
    actSignaturesBlock(document),
  ]);
}

function baseDefinition(document: BillingPrintableDocument, content: Content[]): TDocumentDefinitions {
  const seller = sellerFor(document);
  return {
    pageSize: 'A4',
    pageMargins: [34, 38, 34, 42],
    info: {
      title: document.title,
      subject: document.documentKind === 'act' ? 'Акт оказанных услуг' : 'Счет на оплату',
      author: seller.shortName,
      creator: 'LOGOFF WMS',
    },
    defaultStyle: {
      font: 'DejaVuSans',
      fontSize: 9,
      color: '#111111',
    },
    styles: {
      tableHeader: { bold: true, fontSize: 10 },
      total: { bold: true, fontSize: 10 },
      small: { fontSize: 7 },
      signatureCaption: { fontSize: 7, alignment: 'center' },
    },
    content,
  };
}

function invoiceTopNotice(document: BillingPrintableDocument): Content {
  return {
    columns: [
      {
        stack: [
          {
            text: [
              { text: '■ ', color: '#e30613', fontSize: 10 },
              { text: 'LOGOff', color: '#e30613', bold: true, fontSize: 14, decoration: 'underline' },
            ],
            margin: [0, 24, 0, 0],
          },
        ],
        width: 82,
      },
      {
        stack: [
          { text: `Внимание! Счет действителен до ${formatDate(document.dueDate ?? document.issuedAt)}.`, alignment: 'center' },
          { text: 'Оплата данного счета означает согласие с условиями поставки товара.', alignment: 'center' },
          {
            text: 'Уведомление об оплате обязательно, в противном случае не гарантируется наличие товара на складе. Товар отпускается по факту прихода денег на р/с Поставщика, самовывозом, при наличии доверенности и паспорта.',
            alignment: 'center',
          },
        ],
        width: '*',
      },
      { text: '', width: 82 },
    ],
    margin: [0, 0, 0, 16],
  };
}

function paymentOrderSample(document: BillingPrintableDocument): Content {
  const seller = sellerFor(document);
  return [
    { text: 'Образец заполнения платежного поручения', bold: true, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 1] },
    {
      table: {
        widths: ['22%', '23%', '8%', '16%', '10%', '21%'],
        body: [
          [
            spanCell(seller.bankName, 2, { border: [true, true, false, false] }),
            emptyCell(),
            labelCell('БИК'),
            spanCell(seller.bankBik, 3),
            emptyCell(),
            emptyCell(),
          ],
          [
            spanCell('Банк получателя', 2, { style: 'small', border: [true, false, false, true] }),
            emptyCell(),
            labelCell('Сч. №'),
            spanCell(seller.correspondentAccount, 3),
            emptyCell(),
            emptyCell(),
          ],
          [
            labelValueCell(`ИНН  ${seller.inn}`),
            labelValueCell('КПП'),
            labelCell('Сч. №'),
            spanCell(seller.bankAccount, 3),
            emptyCell(),
            emptyCell(),
          ],
          [
            spanCell(seller.shortName, 2, { border: [true, true, false, false] }),
            emptyCell(),
            labelCell('Вид оп.'),
            labelValueCell('01'),
            labelCell('Срок плат.'),
            labelValueCell(''),
          ],
          [
            spanCell('', 2, { border: [true, false, false, false] }),
            emptyCell(),
            labelCell('Наз. пл.'),
            labelValueCell(''),
            labelCell('Очер. плат.'),
            labelValueCell('5'),
          ],
          [
            spanCell('', 2, { border: [true, false, false, false] }),
            emptyCell(),
            labelCell('Код'),
            labelValueCell(`${seller.paymentPurposeCode}\n${seller.paymentCode}`, 'small'),
            labelCell('Рез. поле'),
            labelValueCell(''),
          ],
          [
            spanCell('Получатель', 2, { style: 'small', border: [true, false, false, true] }),
            emptyCell(),
            emptyCell({ border: [true, false, true, true] }),
            emptyCell(),
            emptyCell(),
            emptyCell({ border: [false, false, true, true] }),
          ],
          [
            spanCell(`Оплата по реализации товаров и услуг №${invoiceDisplayNumber(document.number)}`, 6, { border: [true, true, true, false] }),
            emptyCell(),
            emptyCell(),
            emptyCell(),
            emptyCell(),
            emptyCell(),
          ],
          [spanCell('Назначение платежа', 6, { style: 'small', border: [true, false, true, true] }), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell()],
        ],
      },
      layout: blackLayout(),
      margin: [0, 0, 0, 0],
    },
  ];
}

function positionsTable(document: BillingPrintableDocument, descriptionHeader: string): Content {
  const header = ['№', descriptionHeader, 'Количество', 'Цена', 'Сумма'].map(headerCell);
  const rows = document.rows.map((row) => [
    cell(String(row.position), 'center'),
    cell(row.description),
    cell(`${formatNumber(row.quantity)} ${unitLabel(row.unit)}`, 'right'),
    cell(formatMoney(row.unitPriceRub), 'right'),
    cell(formatMoney(row.totalRub), 'right'),
  ]);

  return {
    table: {
      headerRows: 1,
      widths: [26, '*', 74, 66, 66],
      body: [header, ...rows],
      dontBreakRows: true,
    },
    layout: blackLayout(),
    margin: [0, 12, 0, 0],
  };
}

function invoiceTotals(document: BillingPrintableDocument): Content {
  return totalsColumns([
    ['Итого:', formatMoney(document.totalRub)],
    ['НДС (Без НДС):', '-'],
    ['Итого с НДС:', formatMoney(document.totalRub)],
  ]);
}

function actTotals(document: BillingPrintableDocument): Content {
  return totalsColumns([
    ['Итого:', formatMoney(document.totalRub)],
    ['Сумма НДС:', '-'],
  ]);
}

function totalsColumns(rows: Array<[string, string]>): Content {
  return {
    columns: [
      { text: '', width: '*' },
      {
        table: {
          widths: [100, 86],
          body: rows.map(([label, value]) => [
            { text: label, bold: true, alignment: 'right', border: [false, false, false, false] },
            { text: value, bold: true, alignment: 'right', border: [false, false, false, false] },
          ]),
        },
        layout: 'noBorders',
        width: 200,
      },
    ],
    margin: [0, 7, 0, 0],
  };
}

function totalInWords(document: BillingPrintableDocument, prefix: string): Content {
  return {
    stack: [
      { text: `${prefix} ${document.rows.length}, на сумму ${formatMoney(document.totalRub)} RUB`, margin: [0, 4, 0, 2] },
      { text: amountInWordsRub(document.totalRub), bold: true },
    ],
    margin: [0, 5, 0, 0],
  };
}

function invoiceSignaturesBlock(document: BillingPrintableDocument): Content {
  return {
    stack: [
      signatureRow('Генеральный\nдиректор', true, document),
      signatureRow('Бухгалтер', false, document),
      signatureRow('Менеджер', false, document),
    ],
  };
}

function actSignaturesBlock(document: BillingPrintableDocument): Content {
  return {
    columns: [
      signatureColumn('Исполнитель', true, document),
      signatureColumn('Заказчик', false, document),
    ],
    columnGap: 36,
  };
}

function signatureRow(title: string, withAssets: boolean, document: BillingPrintableDocument): Content {
  return {
    columns: [
      { text: title, bold: true, width: 72, margin: [0, 7, 0, 0] },
      signatureLineStack(withAssets, 156, document),
      { text: '', width: 26 },
      signatureLineStack(false, 204, document),
    ],
    margin: [0, 0, 0, 15],
  };
}

function signatureColumn(title: string, withAssets: boolean, document: BillingPrintableDocument): Content {
  return {
    stack: [
      withAssets ? assetsStampStack(document) : { text: '', margin: [0, 70, 0, 0] },
      {
        columns: [
          { text: title, bold: true, width: 82, margin: [0, 4, 0, 0] },
          signatureLineStack(false, 132, document),
        ],
      },
    ],
  };
}

function signatureLineStack(withAssets: boolean, width: number, document: BillingPrintableDocument): Content {
  return {
    stack: [
      withAssets ? assetsSmallStack(document) : { text: '', margin: [0, 34, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.6 }] },
      { text: 'подпись', style: 'signatureCaption' },
    ],
    width,
  } as unknown as Content;
}

function assetsSmallStack(document: BillingPrintableDocument): Content {
  const signature = sellerAsset(document, 'signature');
  const stamp = sellerAsset(document, 'stamp');
  const stack: Content[] = [];
  if (stamp) {
    stack.push({ image: stamp, width: 70, opacity: 0.78, margin: [18, -8, 0, -58] });
  }
  if (signature) {
    stack.push({ image: signature, width: 110, opacity: 0.9, margin: [4, -6, 0, -4] });
  }
  return stack.length ? { stack } : { text: '', margin: [0, 34, 0, 0] };
}

function assetsStampStack(document: BillingPrintableDocument): Content {
  const signature = sellerAsset(document, 'signature');
  const stamp = sellerAsset(document, 'stamp');
  const stack: Content[] = [];
  if (stamp) {
    stack.push({ image: stamp, width: 112, opacity: 0.82, margin: [90, -6, 0, -92] });
  }
  if (signature) {
    stack.push({ image: signature, width: 124, opacity: 0.9, margin: [76, 6, 0, -4] });
  }
  return stack.length ? { stack, margin: [0, 0, 0, 0] } : { text: '', margin: [0, 70, 0, 0] };
}

function sellerAsset(document: BillingPrintableDocument, kind: 'signature' | 'stamp') {
  const seller = document.seller ?? BILLING_SELLER;
  const selected =
    kind === 'signature'
      ? seller.signatureDataUrl
      : seller.stampDataUrl;
  if (selected) return selected;
  return seller.inn === BILLING_SELLER.inn ? billingAssetDataUrl(kind) : null;
}

function requisitesLine(label: string, value: string): Content {
  return {
    columns: [
      { text: label, width: 84 },
      { text: value, bold: true, width: '*' },
    ],
    margin: [0, 6, 0, 0],
  };
}

function sellerRequisites(document: BillingPrintableDocument) {
  const seller = sellerFor(document);
  return [
    seller.fullName,
    `ИНН ${seller.inn}`,
    seller.address,
    seller.bankName,
    `р/с ${seller.bankAccount}`,
  ]
    .filter(Boolean)
    .join(', ');
}

function sellerFor(document: BillingPrintableDocument) {
  return document.seller ?? BILLING_SELLER;
}

function clientRequisites(document: BillingPrintableDocument) {
  const client = document.client.legalName || document.client.name;
  return [
    client,
    document.client.inn ? `ИНН ${document.client.inn}` : '',
    document.client.kpp ? `КПП ${document.client.kpp}` : '',
    document.client.legalAddress ?? document.client.actualAddress ?? '',
    document.client.bankAccount ? `р/с ${document.client.bankAccount}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function horizontalLine(margin: [number, number, number, number] = [0, 0, 0, 8]): Content {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 527, y2: 0, lineWidth: 1.2 }],
    margin,
  };
}

function blackLayout() {
  return {
    hLineColor: () => '#222222',
    vLineColor: () => '#222222',
    hLineWidth: () => 0.6,
    vLineWidth: () => 0.6,
    paddingLeft: () => 2,
    paddingRight: () => 2,
    paddingTop: () => 2,
    paddingBottom: () => 2,
  };
}

function headerCell(text: string): TableCell {
  return { text, style: 'tableHeader', alignment: text === '№' ? 'center' : text === 'Количество' || text === 'Цена' || text === 'Сумма' ? 'center' : 'left' };
}

function cell(text: string, alignment?: 'left' | 'center' | 'right'): TableCell {
  return { text, alignment };
}

function spanCell(text: string, colSpan: number, extra: Partial<TableCell> = {}): TableCell {
  return { text, colSpan, ...extra } as TableCell;
}

function emptyCell(extra: Partial<TableCell> = {}): TableCell {
  return { text: '', ...extra } as TableCell;
}

function labelCell(text: string): TableCell {
  return { text, bold: true };
}

function labelValueCell(text: string, style?: string): TableCell {
  return { text, style };
}
