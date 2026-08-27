import * as XLSX from 'xlsx';

export const WMS_AI_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildWmsAiWorkbook(input: {
  title: string;
  warehouse: { code: string; name: string; city: string };
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  generatedAt: string;
}) {
  const resultRows = [
    input.columns.map((column) => column.label),
    ...input.rows.map((row) => input.columns.map((column) => row[column.key] ?? '')),
  ];
  const resultSheet = XLSX.utils.aoa_to_sheet(resultRows);
  resultSheet['!cols'] = input.columns.map((column) => ({
    wch: Math.min(
      48,
      Math.max(
        column.label.length + 2,
        ...input.rows.slice(0, 500).map((row) => String(row[column.key] ?? '').length + 2),
      ),
    ),
  }));
  resultSheet['!autofilter'] = { ref: resultSheet['!ref'] || 'A1:A1' };

  const paramsSheet = XLSX.utils.aoa_to_sheet([
    ['Отчёт', input.title],
    ['Склад', input.warehouse.name],
    ['Город', input.warehouse.city],
    ['Код склада', input.warehouse.code],
    ['Сформирован', input.generatedAt],
    ['Строк', input.rows.length],
  ]);
  paramsSheet['!cols'] = [{ wch: 20 }, { wch: 54 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, resultSheet, 'Результат');
  XLSX.utils.book_append_sheet(workbook, paramsSheet, 'Параметры');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
