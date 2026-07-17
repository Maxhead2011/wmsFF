import * as XLSX from 'xlsx';
import type { TurnoverReceiptDocument, TurnoverReceiptPeriodDocument, TurnoverStockExportDocument } from './turnover.service';

type CellValue = string | number;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildTurnoverReceiptWorkbook(document: TurnoverReceiptDocument) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(summaryRows(document), [24, 48]), 'Сводка');
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(receiptRows(document), [8, 18, 22, 18, 18, 20, 32, 18, 18, 16, 14, 24, 20, 34]),
    document.typeLabel,
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildTurnoverReceiptPeriodWorkbook(document: TurnoverReceiptPeriodDocument) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(periodSummaryRows(document), [24, 48]), 'Сводка');
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(periodReceiptRows(document), [8, 18, 24, 20, 20, 34, 32, 18, 18, 14, 26]),
    'Приемка',
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildTurnoverStockWorkbook(document: TurnoverStockExportDocument) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(stockSummaryRows(document), [28, 52]), 'Сводка');
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(stockRows(document), [8, 24, 22, 22, 20, 20, 24, 32, 34, 20, 18, 22, 18, 16, 16, 18, 18, 16, 18, 18]),
    'Остатки',
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
    ['№', 'Дата', 'Короб', 'Штрихкод', 'SKU WMS', 'SKU клиента', 'Товар', 'Цвет', 'Размер', 'Артикул', 'Кол-во', 'КИЗ', 'Статус', 'Комментарий'],
  ];

  document.rows.forEach((row) => {
    rows.push([
      row.position,
      formatDateTime(row.date),
      row.boxCode || '',
      row.barcode || '',
      row.internalSku,
      row.clientSku || '',
      row.name,
      row.color || '',
      row.size || '',
      row.article || '',
      row.quantity,
      row.kiz || '',
      row.statusLabel,
      row.comment || '',
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', 'Строк движения нет', '', '', '', 0, '', '', '']);
  }

  return rows;
}

function periodSummaryRows(document: TurnoverReceiptPeriodDocument): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Клиент', `${document.client.code} · ${document.client.name}`],
    ['Период с', formatDateOnly(document.periodFrom)],
    ['Период по', formatDateOnly(document.periodTo)],
    ['Строк', document.rows.length],
    ['Товаров, шт', document.totalQuantity],
    ['SKU', document.skuCount],
    ['Коробов', document.boxesCount],
    ['Сформировано', formatDateTime(document.generatedAt)],
  ];
}

function periodReceiptRows(document: TurnoverReceiptPeriodDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['№', 'Дата приемки', 'Короб', 'ШК товара', 'SKU клиента', 'КИЗ', 'Наименование', 'Цвет', 'Размер', 'Кол-во', 'Документ'],
  ];

  document.rows.forEach((row) => {
    rows.push([
      row.position,
      formatDateTime(row.date),
      row.boxCode || '',
      row.barcode || '',
      row.clientSku || '',
      row.kiz || '',
      row.name,
      row.color || '',
      row.size || '',
      row.quantity,
      row.sourceDocument || '',
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', 'За выбранный период приемки не найдены', '', '', 0, '']);
  }

  return rows;
}

function stockSummaryRows(document: TurnoverStockExportDocument): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Клиент', `${document.client.code} · ${document.client.name}`],
    ['Режим', document.ignoreActiveRequests ? 'Полный остаток' : 'За вычетом активных заявок'],
    ['Сформировано', formatDateTime(document.generatedAt)],
    ['Строк', document.totals.rows],
    ['SKU', document.totals.skuCount],
    ['Коробов', document.totals.boxesCount],
    ['Остаток в WMS, шт', document.totals.physicalQuantity],
    ['В активных заявках, шт', document.totals.reservedQuantity],
    ['К выгрузке, шт', document.totals.exportQuantity],
  ];
}

function stockRows(document: TurnoverStockExportDocument): CellValue[][] {
  const rows: CellValue[][] = [
    [
      '№',
      'Короб',
      'Паллета',
      'SKU WMS',
      'SKU клиента',
      'Артикул',
      'Основной ШК',
      'Все ШК',
      'Наименование',
      'Цвет',
      'Размер',
      'Статус',
      'Остаток WMS',
      'В заявках',
      'К выгрузке',
      'Литров ед.',
      'КИЗ',
      'Дата остатка',
      'ID остатка',
      'ID SKU',
    ],
  ];

  document.rows.forEach((row) => {
    rows.push([
      row.position,
      row.boxCode || '',
      row.palletCode || '',
      row.internalSku,
      row.clientSku || '',
      row.article || '',
      row.barcode || '',
      row.allBarcodes,
      row.name,
      row.color || '',
      row.size || '',
      row.statusLabel,
      row.physicalQuantity,
      row.reservedQuantity,
      row.exportQuantity,
      row.volumeLiters ?? '',
      row.kizCount,
      formatDateTime(row.updatedAt),
      row.balanceId,
      row.skuId,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', '', 'Остатков для выбранного режима нет', '', '', '', 0, 0, 0, '', 0, '', '', '']);
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

function formatDateOnly(value: string | null) {
  if (!value) {
    return 'весь период';
  }

  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}
