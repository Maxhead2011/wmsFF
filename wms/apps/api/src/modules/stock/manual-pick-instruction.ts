import * as XLSX from 'xlsx';

export const manualPickInstructionSourceFilePrefix = '__wms_manual_pick_instruction_source__';
export const manualPickInstructionPlanFilePrefix = '__wms_manual_pick_instruction_plan__';
export const manualPickInstructionDisplayFilePrefix = 'Ручная инструкция - ';

export type ManualInstructionKind = 'WHOLE' | 'SHIPMENT' | 'BALANCE' | 'SHORTAGE';

export type ManualInstructionRow = {
  sourceRow: number;
  city: string;
  sourceBox: string;
  pallet: string;
  article: string;
  barcode: string;
  size: string;
  quantity: number;
  kind: ManualInstructionKind;
  comment: string;
  relabelNote: string;
  note: string;
};

export type ManualWholeBoxRow = {
  sourceRow: number;
  box: string;
  status: string;
  city: string;
  pallet: string;
};

export type ManualMarkRow = {
  sourceRow: number;
  comment: string;
  city: string;
  sourceBox: string;
  brand: string;
  ip: string;
  name: string;
  article: string;
  wbArticle: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
};

export type ParsedManualPickInstruction = {
  rows: ManualInstructionRow[];
  wholeBoxes: ManualWholeBoxRow[];
  markRows: ManualMarkRow[];
  outboundQuantity: number;
  balanceQuantity: number;
  shortageQuantity: number;
};

export class ManualPickInstructionParseError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('\n'));
    this.name = 'ManualPickInstructionParseError';
  }
}

type Matrix = Array<Array<unknown>>;

export function isManualPickInstructionFileName(fileName: string) {
  return (
    fileName.startsWith(manualPickInstructionSourceFilePrefix) ||
    fileName.startsWith(manualPickInstructionPlanFilePrefix) ||
    fileName.startsWith(manualPickInstructionDisplayFilePrefix)
  );
}

export function parseManualPickInstructionWorkbook(buffer: Buffer): ParsedManualPickInstruction {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new ManualPickInstructionParseError(['Не удалось прочитать Excel-файл. Проверьте, что файл имеет формат XLSX.']);
  }

  const instructionSheet = findSheet(workbook, 'Инструкция');
  if (!instructionSheet) {
    throw new ManualPickInstructionParseError(['В файле нет обязательного листа «Инструкция».']);
  }

  const issues: string[] = [];
  const rows = parseInstructionRows(sheetMatrix(instructionSheet), issues);
  const wholeBoxesSheet = findSheet(workbook, 'Целые короба');
  const markSheet = findSheet(workbook, 'МАРК');
  const wholeBoxes = wholeBoxesSheet ? parseWholeBoxes(sheetMatrix(wholeBoxesSheet), issues) : [];
  const markRows = markSheet ? parseMarkRows(sheetMatrix(markSheet), issues) : [];

  if (rows.length === 0) {
    issues.push('На листе «Инструкция» нет строк для перестроения заявки.');
  }

  if (issues.length > 0) {
    throw new ManualPickInstructionParseError(issues.slice(0, 20));
  }

  return {
    rows,
    wholeBoxes,
    markRows,
    outboundQuantity: rows
      .filter((row) => row.kind === 'WHOLE' || row.kind === 'SHIPMENT')
      .reduce((sum, row) => sum + row.quantity, 0),
    balanceQuantity: rows.filter((row) => row.kind === 'BALANCE').reduce((sum, row) => sum + row.quantity, 0),
    shortageQuantity: rows.filter((row) => row.kind === 'SHORTAGE').reduce((sum, row) => sum + row.quantity, 0),
  };
}

function parseInstructionRows(matrix: Matrix, issues: string[]) {
  const columns = requireColumns(
    matrix,
    'Инструкция',
    {
      city: 'Город',
      sourceBox: 'Исходный короб',
      pallet: 'Палета',
      article: 'Артикул продавца',
      barcode: 'Баркод',
      size: 'Размер',
      quantity: 'Количество',
      comment: 'Комментарий',
      relabelNote: 'Переклейка',
      note: 'Примечание',
    },
    issues,
  );
  if (!columns) {
    return [];
  }

  const rows: ManualInstructionRow[] = [];
  matrix.slice(1).forEach((source, index) => {
    const sourceRow = index + 2;
    if (isBlankRow(source)) {
      return;
    }

    const sourceBox = textCell(source[columns.sourceBox]);
    const barcode = normalizeIdentifier(source[columns.barcode]);
    const note = textCell(source[columns.note]);
    const comment = textCell(source[columns.comment]);
    const kind = instructionKind(comment, note, sourceBox);
    const quantity = positiveInteger(source[columns.quantity]);

    if (!kind) {
      issues.push(`Лист «Инструкция», строка ${sourceRow}: укажите «ЦЕЛЫЙ», «ПОСТАВКА», «БАЛАНС» или примечание «нет на складе».`);
    }
    if (quantity === null) {
      issues.push(`Лист «Инструкция», строка ${sourceRow}: количество должно быть целым числом больше нуля.`);
    }
    if (!barcode) {
      issues.push(`Лист «Инструкция», строка ${sourceRow}: не указан баркод товара.`);
    }
    if (kind !== 'SHORTAGE' && !sourceBox) {
      issues.push(`Лист «Инструкция», строка ${sourceRow}: не указан исходный короб.`);
    }
    if (sourceBox && !isFflBox(sourceBox)) {
      issues.push(`Лист «Инструкция», строка ${sourceRow}: номер короба должен начинаться с FFL.`);
    }
    if (!kind || quantity === null || !barcode || (kind !== 'SHORTAGE' && !sourceBox) || (sourceBox && !isFflBox(sourceBox))) {
      return;
    }

    rows.push({
      sourceRow,
      city: textCell(source[columns.city]),
      sourceBox,
      pallet: textCell(source[columns.pallet]),
      article: textCell(source[columns.article]),
      barcode,
      size: textCell(source[columns.size]),
      quantity,
      kind,
      comment: canonicalComment(kind, comment),
      relabelNote: normalizeRelabelNote(source[columns.relabelNote]),
      note,
    });
  });

  return rows;
}

function parseWholeBoxes(matrix: Matrix, issues: string[]) {
  if (matrix.length <= 1 || matrix.slice(1).every(isBlankRow)) {
    return [];
  }
  const columns = requireColumns(
    matrix,
    'Целые короба',
    { box: 'Короб', status: 'Статус', city: 'Город', pallet: 'Палета' },
    issues,
  );
  if (!columns) {
    return [];
  }

  const rows: ManualWholeBoxRow[] = [];
  matrix.slice(1).forEach((source, index) => {
    const sourceRow = index + 2;
    if (isBlankRow(source)) {
      return;
    }
    const box = textCell(source[columns.box]);
    if (!box || !isFflBox(box)) {
      issues.push(`Лист «Целые короба», строка ${sourceRow}: номер короба должен начинаться с FFL.`);
      return;
    }
    rows.push({
      sourceRow,
      box,
      status: textCell(source[columns.status]) || 'ЦЕЛЫЙ',
      city: textCell(source[columns.city]),
      pallet: textCell(source[columns.pallet]),
    });
  });
  return rows;
}

function parseMarkRows(matrix: Matrix, issues: string[]) {
  if (matrix.length <= 1 || matrix.slice(1).every(isBlankRow)) {
    return [];
  }
  const columns = requireColumns(
    matrix,
    'МАРК',
    {
      comment: 'Комментарий',
      city: 'Город',
      sourceBox: 'Исходный короб',
      brand: 'Бренд',
      ip: 'ИП',
      name: 'Наименование',
      article: 'Артикул',
      wbArticle: 'Артикул WB',
      color: 'Цвет',
      size: 'Размер',
      barcode: 'ШК/баркод',
      quantity: 'Количество в коробе',
    },
    issues,
  );
  if (!columns) {
    return [];
  }

  const rows: ManualMarkRow[] = [];
  matrix.slice(1).forEach((source, index) => {
    const sourceRow = index + 2;
    if (isBlankRow(source)) {
      return;
    }
    const sourceBox = textCell(source[columns.sourceBox]);
    const barcode = normalizeIdentifier(source[columns.barcode]);
    const quantity = positiveInteger(source[columns.quantity]);
    if (!sourceBox || !isFflBox(sourceBox)) {
      issues.push(`Лист «МАРК», строка ${sourceRow}: номер короба должен начинаться с FFL.`);
    }
    if (!barcode) {
      issues.push(`Лист «МАРК», строка ${sourceRow}: не указан ШК/баркод.`);
    }
    if (quantity === null) {
      issues.push(`Лист «МАРК», строка ${sourceRow}: количество должно быть целым числом больше нуля.`);
    }
    if (!sourceBox || !isFflBox(sourceBox) || !barcode || quantity === null) {
      return;
    }
    rows.push({
      sourceRow,
      comment: textCell(source[columns.comment]),
      city: textCell(source[columns.city]),
      sourceBox,
      brand: textCell(source[columns.brand]),
      ip: textCell(source[columns.ip]),
      name: textCell(source[columns.name]),
      article: textCell(source[columns.article]),
      wbArticle: textCell(source[columns.wbArticle]),
      color: textCell(source[columns.color]),
      size: textCell(source[columns.size]),
      barcode,
      quantity,
    });
  });
  return rows;
}

function requireColumns<T extends Record<string, string>>(
  matrix: Matrix,
  sheetName: string,
  expected: T,
  issues: string[],
): { [K in keyof T]: number } | null {
  const headers = matrix[0] ?? [];
  const normalized = headers.map(normalizeHeader);
  const result = {} as { [K in keyof T]: number };
  const missing: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof T>) {
    const index = normalized.indexOf(normalizeHeader(expected[key]));
    if (index < 0) {
      missing.push(expected[key]);
    } else {
      result[key] = index;
    }
  }
  if (missing.length > 0) {
    issues.push(`Лист «${sheetName}»: отсутствуют колонки ${missing.join(', ')}.`);
    return null;
  }
  return result;
}

function findSheet(workbook: XLSX.WorkBook, expectedName: string) {
  const expected = normalizeHeader(expectedName);
  const sheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === expected);
  return sheetName ? workbook.Sheets[sheetName] : null;
}

function sheetMatrix(sheet: XLSX.WorkSheet): Matrix {
  return XLSX.utils.sheet_to_json<Array<unknown>>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
}

function instructionKind(comment: string, note: string, sourceBox: string): ManualInstructionKind | null {
  const status = normalizeHeader(comment).toUpperCase();
  const normalizedNote = normalizeHeader(note);
  if (!sourceBox && normalizedNote.includes('нет на складе')) {
    return 'SHORTAGE';
  }
  if (status.includes('БАЛАНС')) {
    return 'BALANCE';
  }
  if (status.includes('ЦЕЛЫЙ')) {
    return 'WHOLE';
  }
  if (status.includes('ПОСТАВК')) {
    return 'SHIPMENT';
  }
  return null;
}

function canonicalComment(kind: ManualInstructionKind, original: string) {
  if (kind === 'WHOLE') {
    return normalizeHeader(original).includes('марк') ? 'МАРК ЦЕЛЫЙ' : 'ЦЕЛЫЙ';
  }
  if (kind === 'SHIPMENT') {
    return normalizeHeader(original).includes('марк') ? 'МАРК ПОСТАВКА' : 'ПОСТАВКА';
  }
  return kind === 'BALANCE' ? 'БАЛАНС' : '';
}

function normalizeRelabelNote(value: unknown) {
  const text = textCell(value);
  if (['', '-', 'нет', 'no', 'false', '0'].includes(text.toLowerCase())) {
    return '';
  }
  return isNumericIdentifier(text) ? normalizeIdentifier(text) : text;
}

function positiveInteger(value: unknown) {
  const normalized = textCell(value).replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(?:\.0+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeIdentifier(value: unknown) {
  const normalized = textCell(value).replace(/\s+/g, '').replace(',', '.').replace(/\.0$/, '');
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) {
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) ? numeric.toFixed(0) : normalized;
  }
  return normalized;
}

function isNumericIdentifier(value: string) {
  return /^\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i.test(value.replace(/\s+/g, ''));
}

function normalizeHeader(value: unknown) {
  return textCell(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function textCell(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function isBlankRow(row: Array<unknown>) {
  return row.every((value) => !textCell(value));
}

function isFflBox(value: string) {
  return value.trim().toUpperCase().startsWith('FFL');
}
