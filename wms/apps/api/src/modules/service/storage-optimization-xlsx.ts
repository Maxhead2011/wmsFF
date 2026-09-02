import * as XLSX from 'xlsx';
import type { StorageOptimizationReport } from './storage-optimization.service';
import {
  STORAGE_BOX_MAX_QUANTITY,
  STORAGE_BOX_MIN_QUANTITY,
  STORAGE_PALLET_MAX_BOXES,
  STORAGE_PALLET_MIN_BOXES,
} from './storage-optimization-planner';

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildStorageOptimizationWorkbook(report: StorageOptimizationReport) {
  const workbook = XLSX.utils.book_new();
  const palletBoxCounts = countBy(report.targetBoxes, (box) => box.targetPalletSort);
  const targetBoxByLabel = new Map(report.targetBoxes.map((box) => [box.label, box]));

  const summaryRows = [
    ['Параметр', 'Значение'],
    ['Отчёт', 'Оптимизация хранения'],
    ['Клиент', `${report.client.code} · ${report.client.name}`],
    ['Сформировано', new Date(report.generatedAt)],
    ['Единиц в анализе', report.summary.totalUnits],
    ['Исключено из рекомендаций', report.summary.excludedUnits],
    ['Исходных коробов', report.summary.sourceBoxes],
    ['Предложенных коробов', report.summary.targetBoxes],
    ['Коробов с заполнением 16–20', report.summary.idealTargetBoxes],
    ['Исходных паллетсортов', report.summary.sourcePalletSorts],
    ['Предложенных паллетсортов', report.summary.targetPalletSorts],
    ['Паллетсортов с заполнением 16–20 коробов', report.summary.idealTargetPalletSorts],
    ['Единиц к перемещению', report.summary.movementUnits],
    ['Важно', 'Только рекомендации. WMS не выполняет автоматических перемещений.'],
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows, { cellDates: true });
  summary['!cols'] = [{ wch: 42 }, { wch: 74 }];
  if (summary.B4) summary.B4.z = 'dd.mm.yyyy hh:mm';
  summary['!autofilter'] = { ref: `A1:B${summaryRows.length}` };
  summary['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, summary, 'Сводка');

  const routeRows: Array<Array<string | number>> = [[
    '№', 'Приоритет', 'Вид товара', 'Артикул', 'Цвет', 'Размер', 'ШК', 'Количество',
    'Исходный паллетсорт', 'Исходный короб', 'Действие', 'Филиал', 'Предложенный короб',
    'Физический целевой короб', 'Предложенный паллетсорт', 'Заполнение целевого короба',
    'Коробов в целевом паллетсорте', 'Статус короба', 'Статус паллетсорта',
  ]];
  report.rows.forEach((row, index) => {
    const target = targetBoxByLabel.get(row.destinationBox);
    const targetQuantity = target?.plannedQuantity ?? 0;
    const palletBoxes = palletBoxCounts.get(row.destinationPalletSort) ?? 0;
    routeRows.push([
      index + 1,
      row.strategy === 'BARCODE' ? '1 короб = 1 ШК' : '1 короб = 1 артикул',
      row.productName,
      row.article ?? '',
      row.color ?? '',
      row.size ?? '',
      row.barcode ?? '',
      row.quantity,
      row.sourcePalletSort ?? 'Вне паллетсорта',
      row.sourceBox,
      row.action === 'KEEP' ? 'Оставить' : 'Переместить',
      row.warehouseName,
      row.destinationBox,
      row.destinationPhysicalBox ?? 'Новый короб',
      row.destinationPalletSort,
      targetQuantity,
      palletBoxes,
      boxFillStatus(targetQuantity),
      palletFillStatus(palletBoxes),
    ]);
  });
  const route = XLSX.utils.aoa_to_sheet(routeRows);
  route['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 22 },
    { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 18 }, { wch: 31 }, { wch: 25 },
    { wch: 32 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 20 },
  ];
  route['!autofilter'] = { ref: `A1:S${Math.max(1, routeRows.length)}` };
  route['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, route, 'Маршрут');

  const targetRows: Array<Array<string | number>> = [[
    '№', 'Филиал', 'Предложенный паллетсорт', 'Коробов на паллетсорте', 'Статус паллетсорта',
    'Предложенный короб', 'Физический короб', 'Приоритет', 'Артикул', 'Цвета', 'Размеры', 'ШК',
    'Количество', 'Статус короба',
  ]];
  report.targetBoxes.forEach((box, index) => {
    const palletBoxes = palletBoxCounts.get(box.targetPalletSort) ?? 0;
    targetRows.push([
      index + 1,
      box.warehouseName,
      box.targetPalletSort,
      palletBoxes,
      palletFillStatus(palletBoxes),
      box.label,
      box.physicalBoxCode ?? 'Новый короб',
      box.strategy === 'BARCODE' ? '1 короб = 1 ШК' : '1 короб = 1 артикул',
      box.article,
      box.colors.join(', '),
      box.sizes.join(', '),
      box.barcodes.join(', '),
      box.plannedQuantity,
      boxFillStatus(box.plannedQuantity),
    ]);
  });
  const targetBoxes = XLSX.utils.aoa_to_sheet(targetRows);
  targetBoxes['!cols'] = [
    { wch: 6 }, { wch: 18 }, { wch: 32 }, { wch: 20 }, { wch: 20 }, { wch: 31 }, { wch: 25 },
    { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 32 }, { wch: 12 }, { wch: 18 },
  ];
  targetBoxes['!autofilter'] = { ref: `A1:N${Math.max(1, targetRows.length)}` };
  targetBoxes['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, targetBoxes, 'Целевые короба');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

export function storageOptimizationXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

function boxFillStatus(quantity: number) {
  return quantity >= STORAGE_BOX_MIN_QUANTITY && quantity <= STORAGE_BOX_MAX_QUANTITY
    ? 'Оптимально'
    : quantity < STORAGE_BOX_MIN_QUANTITY
      ? 'Неполный короб'
      : 'Переполнение';
}

function palletFillStatus(boxes: number) {
  return boxes >= STORAGE_PALLET_MIN_BOXES && boxes <= STORAGE_PALLET_MAX_BOXES
    ? 'Оптимально'
    : boxes < STORAGE_PALLET_MIN_BOXES
      ? 'Неполный паллетсорт'
      : 'Переполнение';
}

function countBy<T>(values: T[], keyOf: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
