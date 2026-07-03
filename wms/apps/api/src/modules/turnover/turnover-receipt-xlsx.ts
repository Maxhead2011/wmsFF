import * as XLSX from 'xlsx';
import type { TurnoverReceiptDocument } from './turnover.service';

type CellValue = string | number;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildTurnoverReceiptWorkbook(document: TurnoverReceiptDocument) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(summaryRows(document), [24, 48]), 'Сводка');
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(receiptRows(document), [8, 18, 22, 18, 18, 32, 18, 14, 24, 20, 34]),
    document.typeLabel,
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function turnoverReceiptXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

function summaryRows(document: TurnoverReceiptDocument): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Документ', document.sourceDocument || document.movementId],
    ['Клиент', `${document.client.code} · ${document.client.name}`],
    ['Тип', document.typeLabel],
    ['Дата с', formatDateTime(document.periodFrom)],
    ['Дата по', formatDateTime(document.periodTo)],
    ['Строк', document.rows.length],
    ['Товаров, шт', document.totalQuantity],
    ['SKU', document.skuCount],
    ['Коробов', document.boxesCount],
  ];
}

function receiptRows(document: TurnoverReceiptDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['№', 'Дата', 'Короб', 'Штрихкод', 'SKU', 'Товар', 'Артикул', 'Кол-во', 'КИЗ', 'Статус', 'Комментарий'],
  ];

  document.rows.forEach((row) => {
    rows.push([
      row.position,
      formatDateTime(row.date),
      row.boxCode || '',
      row.barcode || '',
      row.internalSku,
      row.name,
      row.article || '',
      row.quantity,
      row.kiz || '',
      row.statusLabel,
      row.comment || '',
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', 'Строк движения нет', '', 0, '', '', '']);
  }

  return rows;
}

function sheetFromRows(rows: CellValue[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  return sheet;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
