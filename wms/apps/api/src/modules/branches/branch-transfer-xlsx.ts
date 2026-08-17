import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export const MAX_BRANCH_TRANSFER_BOXES = 5000;

export type ParsedBranchTransferBox = {
  code: string;
  row: number;
};

export type BranchTransferBoxWorkbook = {
  sheetName: string;
  rows: number;
  boxes: ParsedBranchTransferBox[];
  duplicateCodes: string[];
};

const headerAliases = new Set([
  'box',
  'boxcode',
  'кодкороба',
  'короб',
  'короба',
  'номеркороба',
  'шккороба',
  'штрихкодкороба',
]);

export function parseBranchTransferBoxWorkbook(
  buffer: Buffer,
): BranchTransferBoxWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new BadRequestException(
      'Не удалось прочитать файл. Используйте XLSX, XLS или CSV.',
    );
  }

  if (!workbook.SheetNames.length) {
    throw new BadRequestException('В файле нет листов.');
  }

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      },
    );
    const parsed = parseSheet(matrix);
    if (parsed.boxes.length) {
      return { sheetName, ...parsed };
    }
  }

  throw new BadRequestException(
    'В файле не найдены коды коробов. Добавьте колонку «Код короба» или одноколоночный список.',
  );
}

function parseSheet(matrix: unknown[][]) {
  const header = findHeader(matrix);
  const columnIndex = header?.columnIndex ?? bestBoxColumn(matrix);
  if (columnIndex < 0) {
    return { rows: 0, boxes: [], duplicateCodes: [] };
  }

  const startRow = header ? header.rowIndex + 1 : 0;
  const boxes: ParsedBranchTransferBox[] = [];
  const duplicateCodes: string[] = [];
  const seen = new Set<string>();
  let rows = 0;

  for (let rowIndex = startRow; rowIndex < matrix.length; rowIndex += 1) {
    const values = boxCodesFromCell(matrix[rowIndex]?.[columnIndex]);
    if (!values.length) continue;
    rows += 1;

    for (const value of values) {
      const normalized = value.toUpperCase();
      if (headerAliases.has(normalizeHeader(value))) continue;
      if (seen.has(normalized)) {
        if (!duplicateCodes.includes(value)) duplicateCodes.push(value);
        continue;
      }
      seen.add(normalized);
      boxes.push({ code: value, row: rowIndex + 1 });
      if (boxes.length > MAX_BRANCH_TRANSFER_BOXES) {
        throw new BadRequestException(
          `В одном файле можно загрузить не больше ${MAX_BRANCH_TRANSFER_BOXES} уникальных коробов.`,
        );
      }
    }
  }

  return { rows, boxes, duplicateCodes };
}

function findHeader(matrix: unknown[][]) {
  const rowLimit = Math.min(matrix.length, 25);
  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const columnLimit = Math.min(row.length, 80);
    for (let columnIndex = 0; columnIndex < columnLimit; columnIndex += 1) {
      if (headerAliases.has(normalizeHeader(row[columnIndex]))) {
        return { rowIndex, columnIndex };
      }
    }
  }
  return null;
}

function bestBoxColumn(matrix: unknown[][]) {
  const scores = new Map<number, number>();
  const rowLimit = Math.min(matrix.length, 250);

  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const columnLimit = Math.min(row.length, 80);
    for (let columnIndex = 0; columnIndex < columnLimit; columnIndex += 1) {
      const codes = boxCodesFromCell(row[columnIndex]);
      const score = codes.reduce(
        (sum, code) => sum + (looksLikeBoxCode(code) ? 3 : 0),
        0,
      );
      if (score) scores.set(columnIndex, (scores.get(columnIndex) ?? 0) + score);
    }
  }

  let bestColumn = -1;
  let bestScore = 0;
  for (const [columnIndex, score] of scores) {
    if (score > bestScore) {
      bestColumn = columnIndex;
      bestScore = score;
    }
  }
  return bestColumn;
}

function boxCodesFromCell(value: unknown) {
  const source = String(value ?? '').trim();
  if (!source) return [];
  return source
    .split(/[\r\n,;]+/)
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function looksLikeBoxCode(value: string) {
  const normalized = value.trim();
  if (normalized.length < 4 || normalized.length > 120) return false;
  return /[A-Za-zА-Яа-я]/.test(normalized) &&
    /[_-]/.test(normalized) &&
    /^[A-Za-zА-Яа-я0-9._/-]+$/.test(normalized);
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}
