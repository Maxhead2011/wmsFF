import type { ClientRequestSummary, ClientSummary, StockBalance } from '../../lib/api';
import { formatCabinetDate, formatCabinetNumber, primaryBarcode, stockStatusLabel } from './clientCabinetFormat';

export function downloadClientCabinetStockExcel(
  client: ClientSummary,
  stock: StockBalance[],
  canSeeStoragePlaces: boolean,
  activeRequests: ClientRequestSummary[] = [],
) {
  const stockHeader = ['SKU', 'Наименование', 'Штрихкод', 'Статус', 'Количество', 'Обновлено'];
  const stockRows = aggregateStockRows(stock, activeRequests);
  const stockExportRows = stockRows.map((row) => [
    row.internalSku,
    row.name,
    row.barcode,
    row.status,
    formatCabinetNumber(row.quantity),
    formatCabinetDate(row.updatedAt),
  ]);

  const rows = [
    ['Клиент', client.code, client.name],
    ['Дата выгрузки', new Date().toLocaleString('ru-RU')],
    ['Строк остатков', stockRows.length],
    ['Единиц на остатке', formatCabinetNumber(stockRows.reduce((sum, row) => sum + row.quantity, 0))],
    [],
    stockHeader,
    ...stockExportRows,
  ];
  const headerRowIndex = rows.indexOf(stockHeader);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; mso-number-format:"\\@"; }
    th { background: #f1f5f9; font-weight: 700; }
  </style>
</head>
<body>
  <table>${rows.map((row, index) => rowHtml(row, index === headerRowIndex)).join('')}</table>
</body>
</html>`;

  downloadExcelHtml(stockExcelFileName(client.code), html);
}

type AggregatedStockRow = {
  internalSku: string;
  name: string;
  barcode: string;
  status: string;
  quantity: number;
  updatedAt: string;
  skuIds: Set<string>;
};

function aggregateStockRows(stock: StockBalance[], activeRequests: ClientRequestSummary[]) {
  const byBarcode = new Map<
    string,
    AggregatedStockRow & {
      barcodes: Set<string>;
      internalSkus: Set<string>;
      names: Set<string>;
      statuses: Set<string>;
    }
  >();

  stock.forEach((balance) => {
    const barcode = primaryBarcode(balance) || `SKU:${balance.sku.id}`;
    const existing = byBarcode.get(barcode) ?? {
      internalSku: '',
      name: '',
      barcode: primaryBarcode(balance) || '',
      status: '',
      quantity: 0,
      updatedAt: balance.updatedAt,
      skuIds: new Set<string>(),
      barcodes: new Set<string>(),
      internalSkus: new Set<string>(),
      names: new Set<string>(),
      statuses: new Set<string>(),
    };

    existing.skuIds.add(balance.skuId);
    balance.sku.barcodes.forEach((skuBarcode) => {
      if (skuBarcode.value.trim()) {
        existing.barcodes.add(skuBarcode.value.trim());
      }
    });
    existing.internalSkus.add(balance.sku.internalSku);
    existing.names.add(balance.sku.name);
    existing.statuses.add(stockStatusLabel(balance.status));
    existing.quantity += Number(balance.quantity);
    existing.updatedAt = latestDateString(existing.updatedAt, balance.updatedAt);
    existing.internalSku = [...existing.internalSkus].sort((left, right) => left.localeCompare(right, 'ru')).join(', ');
    existing.name = [...existing.names].sort((left, right) => left.localeCompare(right, 'ru')).join(', ');
    existing.status = [...existing.statuses].sort((left, right) => left.localeCompare(right, 'ru')).join(', ');

    byBarcode.set(barcode, existing);
  });

  applyActiveRequestReservations(byBarcode, activeRequests);

  return [...byBarcode.values()]
    .filter((row) => row.quantity > 0)
    .map(({ barcodes, internalSkus, names, statuses, skuIds, ...row }) => row)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru') || left.barcode.localeCompare(right.barcode, 'ru'));
}

function applyActiveRequestReservations(
  rows: Map<
    string,
    AggregatedStockRow & {
      barcodes: Set<string>;
      internalSkus: Set<string>;
      names: Set<string>;
      statuses: Set<string>;
    }
  >,
  requests: ClientRequestSummary[],
) {
  const orderedRows = [...rows.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

  requests
    .filter((request) => request.type === 'OUTBOUND' && activeRequestStatuses.has(request.status))
    .flatMap((request) => request.items)
    .forEach((item) => {
      let remaining = Number(item.quantity);
      if (remaining <= 0) {
        return;
      }

      if (item.skuId) {
        for (const row of orderedRows.filter((candidate) => candidate.skuIds.has(item.skuId as string))) {
          remaining = deductFromRow(row, remaining);
          if (remaining <= 0) {
            return;
          }
        }
      }

      const barcode = item.barcode?.trim();
      if (!barcode) {
        return;
      }

      for (const row of orderedRows.filter((candidate) => candidate.barcode === barcode || candidate.barcodes.has(barcode))) {
        remaining = deductFromRow(row, remaining);
        if (remaining <= 0) {
          return;
        }
      }
    });
}

function deductFromRow(row: AggregatedStockRow, quantity: number) {
  const taken = Math.min(row.quantity, quantity);
  row.quantity -= taken;
  return quantity - taken;
}

const activeRequestStatuses = new Set<ClientRequestSummary['status']>([
  'IN_WORK',
]);

function latestDateString(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function rowHtml(row: Array<string | number>, isHeader: boolean) {
  const tag = isHeader ? 'th' : 'td';
  return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(String(cell))}</${tag}>`).join('')}</tr>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stockExcelFileName(clientCode: string) {
  const safeClient = clientCode.replace(/[\\/:*?"<>|]/g, '_') || 'client';
  return `ostatki-${safeClient}-${new Date().toISOString().slice(0, 10)}.xls`;
}

function downloadExcelHtml(fileName: string, html: string) {
  const blob = new Blob([`\uFEFF${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
