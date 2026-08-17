import * as XLSX from 'xlsx';
import type { StorageOverviewPayload } from './storage-overview.service';

type CellValue = string | number;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildStorageOverviewWorkbook(overview: StorageOverviewPayload) {
  const workbook = XLSX.utils.book_new();
  const tariff = overview.tariffRubPerLiterDay;

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(summaryRows(overview), [28, 46]), 'Сводка');
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(dailyRows(overview, tariff), [14, 16, 16, 16, 16]), 'По дням');
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(dailySkuRows(overview, tariff), [14, 18, 18, 34, 18, 14, 14, 14, 14, 14]),
    'SKU по дням',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(skuTotalRows(overview), [18, 18, 34, 18, 14, 16, 14, 14, 14, 14, 14, 16]),
    'Товары',
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function storageOverviewXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

function summaryRows(overview: StorageOverviewPayload): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Клиент', `${overview.client.code} · ${overview.client.name}`],
    ['Учет хранения', overview.client.storageAccountingEnabled ? 'Включен' : 'Отключен'],
    ['Период с', formatDate(overview.periodFrom)],
    ['Период по', formatDate(overview.periodTo)],
    ['Тариф, ₽ / литр в сутки', overview.tariffRubPerLiterDay],
    ['SKU в отчете', overview.totals.skuCount],
    ['Единиц сейчас', overview.totals.quantity],
    ['Литров сейчас', overview.totals.totalLiters],
    ['Литро-дней за период', overview.totals.literDays],
    ['К оплате, ₽', overview.totals.storageCostRub],
    ['Строк без литража', overview.skippedWithoutVolume],
  ];
}

function dailyRows(overview: StorageOverviewPayload, tariff: number): CellValue[][] {
  const rows: CellValue[][] = [['Дата', 'Позиций', 'Литров на день', 'Литро-дней', 'Стоимость, ₽']];

  overview.daily.forEach((row) => {
    rows.push([row.date, row.positions, row.totalLiters, row.literDays, roundMoney(row.literDays * tariff)]);
  });

  if (rows.length === 1) {
    rows.push(['-', 0, 0, 0, 0]);
  }

  return rows;
}

function dailySkuRows(overview: StorageOverviewPayload, tariff: number): CellValue[][] {
  const rows: CellValue[][] = [
    ['Дата', 'Баркод', 'Артикул МП', 'Наименование', 'SKU', 'Размер', 'Остаток дня', 'Литров ед.', 'Литро-дни', 'Стоимость, ₽'],
  ];

  overview.dailyRows.forEach((row) => {
    rows.push([
      row.date,
      row.barcode || '-',
      row.marketplaceArticle || '-',
      row.name,
      row.internalSku,
      row.size || '-',
      row.quantity,
      row.volumeLiters,
      row.literDays,
      roundMoney(row.literDays * tariff),
    ]);
  });

  if (rows.length === 1) {
    rows.push(['-', '-', '-', 'Нет хранения за период', '-', '-', 0, 0, 0, 0]);
  }

  return rows;
}

function skuTotalRows(overview: StorageOverviewPayload): CellValue[][] {
  const rows: CellValue[][] = [
    [
      'Баркод',
      'Артикул МП',
      'Наименование',
      'SKU',
      'Размер',
      'Габариты',
      'Литров ед.',
      'Остаток сейчас',
      'Литров сейчас',
      'Литро-дни',
      'Короба',
      'Стоимость, ₽',
    ],
  ];

  overview.rows.forEach((row) => {
    rows.push([
      row.barcode || '-',
      row.marketplaceArticle || '-',
      row.name,
      row.internalSku,
      row.size || '-',
      dimensions(row),
      row.volumeLiters,
      row.quantity,
      row.totalLiters,
      row.literDays,
      row.boxesCount,
      row.storageCostRub,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['-', '-', 'Нет хранения за период', '-', '-', '-', 0, 0, 0, 0, 0, 0]);
  }

  return rows;
}

function sheetFromRows(rows: CellValue[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  return sheet;
}

function dimensions(row: { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }) {
  if (!row.lengthCm || !row.widthCm || !row.heightCm) {
    return '-';
  }

  return `${row.lengthCm} x ${row.widthCm} x ${row.heightCm} см`;
}

function formatDate(value: string) {
  return value.slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
