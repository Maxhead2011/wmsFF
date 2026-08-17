import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export type ParsedOzonFboItem = {
  offerId: string;
  quantity: number;
  sourceRow: number;
};

export type ParsedOzonFboDestination = {
  sourceName: string;
  sourceColumn: string;
  items: ParsedOzonFboItem[];
};

export type ParsedOzonFboWorkbook = {
  sheetName: string;
  destinations: ParsedOzonFboDestination[];
  offerIds: string[];
  totalUnits: number;
  warnings: string[];
};

export function parseOzonFboWorkbook(buffer: Buffer): ParsedOzonFboWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new BadRequestException('Не удалось прочитать Excel-файл. Загрузите XLSX или XLS.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestException('В Excel-файле нет листов.');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => normalize(cell).includes('артикул продавца')));
  if (headerIndex < 0) {
    throw new BadRequestException('Не найдена колонка «Артикул продавца».');
  }

  const header = matrix[headerIndex] ?? [];
  const offerColumn = header.findIndex((cell) => normalize(cell).includes('артикул продавца'));
  const ordersMarker = header.findIndex((cell) => normalize(cell) === 'заказы');
  const distributionStart = ordersMarker >= 0 ? ordersMarker + 1 : offerColumn + 1;
  const destinationColumns = header
    .map((cell, index) => ({ index, name: clean(cell), normalized: normalize(cell) }))
    .filter((column) => column.index >= distributionStart && column.name && !ignoredHeaders.has(column.normalized));

  if (destinationColumns.length === 0) {
    throw new BadRequestException('Не найдены колонки с распределением по кластерам Ozon.');
  }

  const byDestination = new Map<string, Map<string, ParsedOzonFboItem>>();
  const warnings: string[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const offerId = clean(row[offerColumn]);
    if (!offerId) continue;

    for (const column of destinationColumns) {
      const quantity = positiveInteger(row[column.index]);
      if (quantity === null) {
        if (clean(row[column.index])) {
          warnings.push(`Строка ${rowIndex + 1}, ${column.name}: количество не распознано.`);
        }
        continue;
      }
      if (quantity === 0) continue;

      const destination = byDestination.get(column.name) ?? new Map<string, ParsedOzonFboItem>();
      const existing = destination.get(offerId);
      destination.set(offerId, {
        offerId,
        quantity: (existing?.quantity ?? 0) + quantity,
        sourceRow: existing?.sourceRow ?? rowIndex + 1,
      });
      byDestination.set(column.name, destination);
    }
  }

  const destinations = destinationColumns
    .filter((column) => byDestination.has(column.name))
    .map((column) => ({
      sourceName: column.name,
      sourceColumn: XLSX.utils.encode_col(column.index),
      items: Array.from(byDestination.get(column.name)!.values()),
    }));

  if (destinations.length === 0) {
    throw new BadRequestException('В распределении нет положительного количества товаров.');
  }

  const offerIds = Array.from(new Set(destinations.flatMap((destination) => destination.items.map((item) => item.offerId))));
  const totalUnits = destinations.reduce(
    (total, destination) => total + destination.items.reduce((sum, item) => sum + item.quantity, 0),
    0,
  );

  return { sheetName, destinations, offerIds, totalUnits, warnings };
}

export function buildOzonFboAssemblyWorkbook(plan: {
  title: string;
  boxes: Array<{
    boxCode: string;
    ozonCargoId: string | null;
    ozonBarcode: string | null;
    status: string;
    cluster: { clusterName: string | null; sourceName: string; storageWarehouseName: string | null; supplyId: string | null };
    items: Array<{
      quantity: number;
      assembledQuantity: number;
      planItem: { offerId: string; ozonSku: string | null; productName: string | null };
    }>;
  }>;
}) {
  const rows = [
    ['Поставка', plan.title],
    [],
    ['Кластер', 'Склад Ozon', 'Supply ID', 'Короб WMS', 'Cargo ID Ozon', 'ШК Ozon', 'Артикул продавца', 'SKU Ozon', 'Товар', 'План', 'Собрано', 'Статус'],
    ...plan.boxes.flatMap((box) =>
      box.items.map((item) => [
        box.cluster.clusterName || box.cluster.sourceName,
        box.cluster.storageWarehouseName || '',
        box.cluster.supplyId || '',
        box.boxCode,
        box.ozonCargoId || '',
        box.ozonBarcode || '',
        item.planItem.offerId,
        item.planItem.ozonSku || '',
        item.planItem.productName || '',
        item.quantity,
        item.assembledQuantity,
        box.status,
      ]),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [18, 28, 16, 22, 18, 22, 28, 16, 36, 10, 10, 16].map((wch) => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Сборка FBO Ozon');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const ignoredHeaders = new Set(['вб', 'итого озон', 'заказ и склад', 'заказы']);

function clean(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[._–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function positiveInteger(value: unknown) {
  const text = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!text) return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}
