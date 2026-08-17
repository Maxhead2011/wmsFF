export type SheetCell = string | number | boolean | Date | null | undefined;
export type SheetMatrix = SheetCell[][];

export type StockImportItem = {
  clientId: string;
  boxCode: string;
  barcode: string;
  name: string;
  color?: string;
  size?: string;
  quantity: number;
  sourceRow: number;
};

export type StockImportIssue = {
  row: number;
  message: string;
  severity: 'warning' | 'error';
};

export type StockParseOptions = {
  clientId: string;
};

type StockColumnMap = {
  box: number;
  barcode: number;
  name: number;
  color: number;
  size: number;
  quantity: number;
};

const DEFAULT_COLUMNS: StockColumnMap = {
  box: 0,
  barcode: 3,
  name: 4,
  color: 6,
  size: 7,
  quantity: 8,
};

export function parseStockSheet(rows: SheetMatrix, options: StockParseOptions) {
  const items: StockImportItem[] = [];
  const issues: StockImportIssue[] = [];
  let currentBoxCode = '';
  const columns = detectColumns(rows);

  rows.forEach((row, index) => {
    const sourceRow = index + 1;
    const boxCode = text(row[columns.box]);
    const barcode = text(row[columns.barcode]);
    const name = text(row[columns.name]);
    const color = text(row[columns.color]);
    const size = text(row[columns.size]);
    const quantityText = text(row[columns.quantity]);
    const quantity = numberValue(row[columns.quantity]);
    const hasProductData = Boolean(barcode || name || color || size || quantityText);
    const hasProductIdentity = !isMissingImportText(barcode) || !isMissingImportText(name);

    if (looksLikeHeader(row)) {
      return;
    }

    if (boxCode && !hasProductData) {
      // Русский комментарий: в примере короб идёт отдельной строкой-заголовком перед товарами.
      currentBoxCode = boxCode;
      return;
    }

    if (boxCode && !hasProductIdentity && isMissingImportText(color) && isMissingImportText(size)) {
      currentBoxCode = boxCode;
      return;
    }

    const effectiveBox = boxCode || currentBoxCode;
    if (!hasProductData) {
      return;
    }

    if (!effectiveBox) {
      issues.push({ row: sourceRow, message: 'Не найден короб для строки остатка.', severity: 'error' });
      return;
    }

    if (!quantity || quantity < 0) {
      issues.push({ row: sourceRow, message: 'Количество должно быть положительным числом.', severity: 'error' });
      return;
    }

    const safeName = name || `Не задано: ${barcode}`;
    if (!name) {
      // Русский комментарий: для первичного seed не теряем остаток, но явно показываем, что карточку надо дозаполнить.
      issues.push({ row: sourceRow, message: 'Не заполнено наименование, создано временное имя.', severity: 'warning' });
    }

    items.push({
      clientId: options.clientId,
      boxCode: effectiveBox,
      barcode: isMissingImportText(barcode) ? '' : barcode,
      name: safeName,
      color: color || undefined,
      size: size || undefined,
      quantity,
      sourceRow,
    });
  });

  const uniqueBoxes = new Set(items.map((item) => item.boxCode));
  const uniqueBarcodes = new Set(items.map((item) => item.barcode).filter(Boolean));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    items,
    issues,
    summary: {
      rows: items.length,
      boxes: uniqueBoxes.size,
      barcodes: uniqueBarcodes.size,
      totalQuantity,
    },
  };
}

function detectColumns(rows: SheetMatrix): StockColumnMap {
  for (const row of rows) {
    const normalized = Array.from(row, (cell) => text(cell).toLowerCase());
    if (!normalized.some((cell) => cell.includes('штрих'))) {
      continue;
    }

    return {
      box: findColumn(normalized, ['короб']) ?? DEFAULT_COLUMNS.box,
      barcode: findColumn(normalized, ['штрих']) ?? DEFAULT_COLUMNS.barcode,
      name: findColumn(normalized, ['наименование']) ?? DEFAULT_COLUMNS.name,
      color: findColumn(normalized, ['цвет']) ?? DEFAULT_COLUMNS.color,
      size: findColumn(normalized, ['размер']) ?? DEFAULT_COLUMNS.size,
      quantity: findColumn(normalized, ['количество', 'остаток']) ?? DEFAULT_COLUMNS.quantity,
    };
  }

  return DEFAULT_COLUMNS;
}

function findColumn(cells: string[], needles: string[]) {
  const index = cells.findIndex((cell) => needles.some((needle) => (cell ?? '').includes(needle)));
  return index >= 0 ? index : undefined;
}

function looksLikeHeader(row: SheetCell[]) {
  return text(row[0]).toLowerCase() === 'короб' || text(row[3]).toLowerCase().includes('штрих');
}

function text(value: SheetCell) {
  return value == null ? '' : String(value).trim();
}

function isMissingImportText(value: string) {
  const normalized = value.trim().toUpperCase();
  return !normalized || normalized === '#N/A' || normalized === 'N/A';
}

function numberValue(value: SheetCell) {
  if (value == null || value === '') {
    return 0;
  }

  const normalized = String(value).replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
