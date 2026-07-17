import * as XLSX from 'xlsx';
import type { PickInstructionDocument, PickInstructionRow } from './pick-instruction.types';

type CellValue = string | number;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildPickInstructionWorkbook(document: PickInstructionDocument) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheetFromRows(searchBoxRows(document), [24]), 'Короба для поиска');
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(warehouseRows(document), [18, 20, 18, 28, 18, 12, 12, 28, 28, 42]), 'Поиск коробов');
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(markRows(document), [18, 18, 20, 18, 18, 34, 28, 16, 16, 12, 18, 18]), 'Перемаркировка');
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(balanceMoveRows(document), [20, 20, 18, 18, 28, 18, 12, 12, 48]), 'Перемещения');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function searchBoxRows(document: PickInstructionDocument): CellValue[][] {
  const movementTargetBoxes = new Set(document.warehouseBalanceMoves.map((row) => row.newBox.trim()).filter(Boolean));
  const boxCodes = [
    ...new Set(
      [
        ...document.warehouseRows.map((row) => row.sourceBox),
        ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
        ...document.warehouseWholeBoxes.map((row) => row.box),
      ]
        .map((value) => value.trim())
        .filter((value) => value && !movementTargetBoxes.has(value)),
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));

  const rows: CellValue[][] = [['Короб']];
  boxCodes.forEach((boxCode) => rows.push([boxCode]));

  if (rows.length === 1) {
    rows.push(['Коробов для поиска нет.']);
  }

  return rows;
}

function warehouseRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    [
      'Город',
      'Исходный короб',
      'Палета',
      'Артикул продавца',
      'Баркод',
      'Размер',
      'Количество',
      'Комментарий',
      'Перемаркировка',
      'Примечание',
    ],
  ];

  document.warehouseRows.filter((row) => row.sourceBox.trim()).forEach((row) => {
    rows.push([
      row.city,
      row.sourceBox,
      row.pallet,
      row.artOnBox,
      row.barcodeOnBox,
      row.size,
      row.quantity,
      row.comment,
      row.rebrandNote,
      row.note,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', '', '', 'Нет строк для складской инструкции.']);
  }

  return rows;
}

function wholeBoxRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [['Короб', 'Статус', 'Город', 'Палета']];
  document.warehouseWholeBoxes.forEach((row) => rows.push([row.box, row.status, row.city, row.pallet]));
  if (rows.length === 1) {
    rows.push(['', '', '', 'Целых коробов нет.']);
  }
  return rows;
}

function balanceMoveRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['Исходный короб', 'Новый короб', 'Тип', 'Палета', 'Артикул', 'Баркод', 'Размер', 'Количество', 'Примечание'],
  ];

  document.warehouseBalanceMoves.forEach((row) => {
    rows.push([
      row.sourceBox,
      row.newBox,
      row.purpose === 'SHIPMENT' ? 'В поставку' : 'На баланс',
      row.pallet,
      row.artOnBox,
      row.barcodeOnBox,
      row.size,
      row.quantity,
      row.note,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', '', 'Перемещений нет.']);
  }

  return rows;
}

function balanceLabelRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [['Новый короб', 'Исходный короб', 'TSPL для TSC']];

  document.warehouseBalanceLabels.forEach((row) => {
    rows.push([row.newBox, row.sourceBox, row.tspl]);
  });

  if (rows.length === 1) {
    rows.push(['', '', 'Нет новых коробов для печати.']);
  }

  return rows;
}

function markRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['Комментарий', 'Город', 'Исходный короб', 'Бренд', 'ИП', 'Наименование', 'Артикул', 'Артикул WB', 'Цвет', 'Размер', 'ШК/баркод', 'Количество в коробе'],
  ];

  document.warehouseMarkRows.forEach((row) => {
    rows.push([
      row.comment,
      row.city,
      row.sourceBox,
      row.brand,
      row.ip,
      row.name,
      row.article,
      row.wbArticle,
      row.color,
      row.size,
      row.barcode,
      row.quantity,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', '', '', '', '', 'Переклейки нет.']);
  }

  return rows;
}

export function pickInstructionXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

function summaryRows(document: PickInstructionDocument): CellValue[][] {
  return [
    ['Параметр', 'Значение'],
    ['Заявка', document.requestTitle],
    ['Клиент', `${document.client.code} · ${document.client.name}`],
    ['Статус заявки', document.requestStatusLabel],
    ['Приоритет', document.priorityLabel],
    ['Желаемая дата', document.desiredDate ? formatDate(document.desiredDate) : '-'],
    ['Город поставки', document.destinationCity ?? '-'],
    ['Адрес', document.deliveryAddress ?? '-'],
    ['Строк', document.rowsCount],
    ['К сборке', document.totalRequested],
    ['В плане', document.totalAllocated],
    ['Дефицит', document.totalShortage],
    ['Коробов в плане', document.boxesCount],
    ['Целых коробов', document.fullBoxesCount],
    ['Новых коробов остатка', document.warehouseBalanceLabels.length],
    ['Сформировано', formatDateTime(document.generatedAt)],
  ];
}

function instructionRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['✓', '№', 'Короб', 'Паллета', 'SKU', 'Баркод', 'Товар', 'Нужно', 'Взять', 'Дефицит', 'Статус', 'Комментарий'],
  ];

  for (const row of document.rows) {
    const allocations = row.allocations.length ? row.allocations : [null];
    allocations.forEach((allocation, index) => {
      rows.push([
        '',
        index === 0 ? row.position : '',
        allocation?.boxCode ?? '',
        allocation?.palletCode ?? '',
        row.internalSku ?? '',
        row.barcode ?? '',
        row.name ?? '',
        index === 0 ? row.requestedQuantity : '',
        allocation?.quantity ?? 0,
        index === 0 && row.shortageQuantity > 0 ? row.shortageQuantity : '',
        row.statusLabel,
        index === 0 ? row.comment ?? rowInstructionComment(row) : '',
      ]);
    });
  }

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', 'В заявке нет строк для сборки.', '', '', '', '', '']);
  }

  return rows;
}

function boxRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['Короб', 'Паллета', 'В плане', 'Доступно в коробе', 'Строк', 'Целый короб', 'Комментарий'],
  ];

  document.boxes.forEach((box) => {
    rows.push([
      box.boxCode,
      box.palletCode ?? '',
      box.allocatedQuantity,
      box.availableQuantity,
      box.linesCount,
      box.isFullBox ? 'Да' : 'Нет',
      box.comment,
    ]);
  });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', 'Нет коробов в плане.']);
  }

  return rows;
}

function shortageRows(document: PickInstructionDocument): CellValue[][] {
  const rows: CellValue[][] = [
    ['№', 'SKU', 'Баркод', 'Товар', 'Нужно', 'В плане', 'Дефицит', 'Статус', 'Комментарий'],
  ];

  document.rows
    .filter((row) => row.status !== 'READY')
    .forEach((row) => {
      rows.push([
        row.position,
        row.internalSku ?? '',
        row.barcode ?? '',
        row.name ?? '',
        row.requestedQuantity,
        row.allocatedQuantity,
        row.shortageQuantity,
        row.statusLabel,
        row.comment ?? '',
      ]);
    });

  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', 'Дефицита нет', '']);
  }

  return rows;
}

function sheetFromRows(rows: CellValue[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((width) => ({ wch: width }));
  return sheet;
}

function rowInstructionComment(row: PickInstructionRow) {
  if (row.allocations.length === 0) {
    return row.status === 'READY' ? '' : 'Нет доступного остатка в коробах.';
  }

  return row.allocations.length > 1 ? 'Отбор из нескольких коробов.' : '';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
