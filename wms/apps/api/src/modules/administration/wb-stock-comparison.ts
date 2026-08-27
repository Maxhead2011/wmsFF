import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export type WbStockFileRow = {
  barcode: string;
  quantity: number;
  product: string | null;
  brand: string | null;
  name: string | null;
  size: string | null;
  sellerArticle: string | null;
  sourceRows: number[];
};

export type ParsedWbStockFile = {
  sheetName: string;
  sourceRows: number;
  duplicateRows: number;
  rows: WbStockFileRow[];
};

const COLUMN_ALIASES = {
  barcode: new Set(['баркод', 'штрихкод', 'barcode']),
  quantity: new Set(['количество', 'остаток', 'quantity']),
  product: new Set(['предмет']),
  brand: new Set(['бренд']),
  name: new Set(['наименование', 'товар', 'название']),
  size: new Set(['размер']),
  sellerArticle: new Set(['артикулпродавца', 'артикул', 'vendorcode']),
};

export function parseWbStockFile(buffer: Buffer): ParsedWbStockFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new BadRequestException('Не удалось прочитать файл. Загрузите XLSX или XLS с остатками Wildberries.');
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
    const parsed = parseMatrix(matrix);
    if (parsed) return { sheetName, ...parsed };
  }

  throw new BadRequestException(
    'В файле не найдены обязательные колонки «Баркод» и «Количество».',
  );
}

function parseMatrix(matrix: unknown[][]) {
  const header = findHeader(matrix);
  if (!header) return null;

  const aggregated = new Map<string, WbStockFileRow>();
  let sourceRows = 0;
  let duplicateRows = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const values = matrix[rowIndex] ?? [];
    const barcode = normalizeBarcode(values[header.columns.barcode]);
    if (!barcode) continue;
    const quantity = parseQuantity(values[header.columns.quantity], rowIndex + 1);
    sourceRows += 1;

    const existing = aggregated.get(barcode);
    if (existing) {
      existing.quantity += quantity;
      existing.sourceRows.push(rowIndex + 1);
      duplicateRows += 1;
      continue;
    }

    aggregated.set(barcode, {
      barcode,
      quantity,
      product: optionalText(values[header.columns.product]),
      brand: optionalText(values[header.columns.brand]),
      name: optionalText(values[header.columns.name]),
      size: optionalText(values[header.columns.size]),
      sellerArticle: optionalText(values[header.columns.sellerArticle]),
      sourceRows: [rowIndex + 1],
    });
  }

  if (!sourceRows) {
    throw new BadRequestException('В файле нет строк с заполненным баркодом.');
  }
  if (aggregated.size > 50_000) {
    throw new BadRequestException('В одном файле можно проверить не более 50 000 уникальных баркодов.');
  }

  return { sourceRows, duplicateRows, rows: [...aggregated.values()] };
}

function findHeader(matrix: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex += 1) {
    const columns: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
    (matrix[rowIndex] ?? []).forEach((cell, columnIndex) => {
      const normalized = normalizeHeader(cell);
      for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.has(normalized)) columns[key as keyof typeof COLUMN_ALIASES] = columnIndex;
      }
    });
    if (columns.barcode != null && columns.quantity != null) {
      return {
        rowIndex,
        columns: {
          barcode: columns.barcode,
          quantity: columns.quantity,
          product: columns.product ?? -1,
          brand: columns.brand ?? -1,
          name: columns.name ?? -1,
          size: columns.size ?? -1,
          sellerArticle: columns.sellerArticle ?? -1,
        },
      };
    }
  }
  return null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function normalizeBarcode(value: unknown) {
  const text = String(value ?? '').trim().replace(/\s+/g, '');
  if (!text) return '';
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(text)) {
    const number = Number(text.replace(',', '.'));
    if (Number.isSafeInteger(number)) return number.toFixed(0);
  }
  return text;
}

function parseQuantity(value: unknown, row: number) {
  const text = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!text) return 0;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw new BadRequestException(`Некорректное количество в строке ${row}: «${String(value)}».`);
  }
  return number;
}

function optionalText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}
