import * as XLSX from 'xlsx';
import type { TurnoverKizReportDocument } from './turnover.service';

type CellValue = string | number | Date;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildTurnoverKizReportWorkbook(document: TurnoverKizReportDocument) {
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet(summaryRows(document), { cellDates: true });
  summary['!cols'] = [{ wch: 28 }, { wch: 54 }];
  for (const address of ['B4', 'B5', 'B9']) {
    if (summary[address]?.t === 'd') summary[address].z = 'dd.mm.yyyy hh:mm';
  }
  XLSX.utils.book_append_sheet(workbook, summary, 'Сводка');

  const rows = reportRows(document);
  const report = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  report['!cols'] = [
    { wch: 7 }, { wch: 19 }, { wch: 19 }, { wch: 24 }, { wch: 20 }, { wch: 14 },
    { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 24 },
    { wch: 36 }, { wch: 18 }, { wch: 16 }, { wch: 46 }, { wch: 18 }, { wch: 28 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 20 },
  ];
  report['!freeze'] = { xSplit: 0, ySplit: 1 };
  report['!autofilter'] = { ref: `A1:W${Math.max(1, rows.length)}` };
  for (let rowIndex = 2; rowIndex <= rows.length; rowIndex += 1) {
    for (const column of ['B', 'C', 'W']) {
      const cell = report[`${column}${rowIndex}`];
      if (cell?.t === 'd') cell.z = 'dd.mm.yyyy hh:mm';
    }
  }
  XLSX.utils.book_append_sheet(workbook, report, 'КИЗы');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

export function turnoverKizReportXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

function summaryRows(document: TurnoverKizReportDocument): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Отчёт', 'Отчёт по отгруженным КИЗам'],
    ['Клиент', `${document.client.code} · ${document.client.name}`],
    ['Период с', document.filters.dateFrom ? new Date(`${document.filters.dateFrom}T00:00:00`) : 'весь период'],
    ['Период по', document.filters.dateTo ? new Date(`${document.filters.dateTo}T23:59:59`) : 'весь период'],
    ['Поиск', document.filters.search || 'без фильтра'],
    ['Строк', document.rows.length],
    ['Без сохранённых 4 цифр WB', document.rows.filter((row) => !row.stickerPartB).length],
    ['Сформировано', new Date(document.generatedAt)],
  ];
}

function reportRows(document: TurnoverKizReportDocument): CellValue[][] {
  const rows: CellValue[][] = [[
    '№',
    'Дата приёмки КИЗа',
    'Дата отгрузки',
    'Клиент',
    'Поставка WB',
    'Заявка WMS',
    'Название заявки',
    'Заказ WB',
    'ШК товара',
    'Артикул',
    'SKU WMS',
    'Наименование костюма',
    'Цвет',
    'Размер',
    'Короб',
    'КИЗ',
    'WB стикер — большие 4 цифры',
    'ШК стикера WB',
    'Категория WB',
    'Статус поставщика WB',
    'Статус WB',
    'Статус сборки WMS',
    'Статус WB обновлён',
  ]];

  document.rows.forEach((row, index) => {
    rows.push([
      index + 1,
      row.arrivalAt ? new Date(row.arrivalAt) : '',
      new Date(row.shippedAt),
      row.clientName,
      row.supplyId || '',
      row.requestNumber,
      row.requestTitle,
      row.orderId || '',
      row.barcode || '',
      row.article || '',
      row.internalSku,
      row.productName,
      row.color || '',
      row.size || '',
      row.sourceBoxCode || 'Без короба',
      row.kiz,
      row.stickerPartB || '',
      row.stickerBarcode || '',
      row.wbCategory || '',
      row.wbSupplierStatus || '',
      row.wbStatus || '',
      row.assemblyStatus || '',
      row.wbStatusUpdatedAt ? new Date(row.wbStatusUpdatedAt) : '',
    ]);
  });

  if (document.rows.length === 0) {
    rows.push(['', '', '', '', '', '', 'За выбранный период отгруженные КИЗы не найдены', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  }

  return rows;
}
