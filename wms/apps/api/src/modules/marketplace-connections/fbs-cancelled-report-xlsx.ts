import * as XLSX from 'xlsx';

export const FBS_CANCELLED_REPORT_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type FbsCancelledExportOrder = {
  id: string;
  orderUid: string | null;
  accountName: string | null;
  marketplace: string;
  category: 'active' | 'shipped' | 'cancelled' | 'archive';
  supplierStatus: string;
  wbStatus: string;
  statusLabel: string;
  article: string | null;
  barcodes: string[];
  itemCount: number;
  product: {
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    size: string | null;
  } | null;
  createdAt: string | null;
  sellerDate: string | null;
  supplyId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  comment: string | null;
  request: {
    number: number;
    status: string;
  } | null;
};

const HEADERS = [
  'Маркетплейс',
  'Кабинет',
  'Заказ',
  'UID заказа',
  'Дата заказа',
  'Причина отмены',
  'Технические статусы',
  'Заявка WMS',
  'Статус заявки WMS',
  'Поставка',
  'Склад маркетплейса',
  'Товар',
  'Артикул WMS',
  'Артикул маркетплейса',
  'Размер',
  'Штрихкод',
  'Количество',
  'Комментарий',
];

export function buildFbsCancelledReportXlsx(orders: FbsCancelledExportOrder[]) {
  // FIX: all values come from the current server-side marketplace snapshot.
  const rows = orders.map((order) => [
    marketplaceLabel(order.marketplace),
    order.accountName ?? '',
    order.id,
    order.orderUid ?? '',
    validDate(order.createdAt) ?? validDate(order.sellerDate),
    order.statusLabel || 'Причина не передана маркетплейсом',
    [order.supplierStatus, order.wbStatus].filter(Boolean).join(' / '),
    order.request ? String(order.request.number).padStart(6, '0') : '',
    order.request?.status ?? '',
    order.supplyId ?? '',
    order.warehouseName || (order.warehouseId ? `Склад ${order.warehouseId}` : ''),
    order.product?.name ?? '',
    order.product?.internalSku || order.product?.clientSku || '',
    order.product?.article || order.article || '',
    order.product?.size ?? '',
    order.barcodes.join(', '),
    Math.max(0, Math.trunc(Number(order.itemCount) || 0)),
    order.comment ?? '',
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows], { cellDates: true });
  sheet['!autofilter'] = { ref: `A1:R${Math.max(1, rows.length + 1)}` };
  sheet['!cols'] = [
    { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 38 }, { wch: 20 },
    { wch: 28 }, { wch: 28 }, { wch: 15 }, { wch: 20 },
    { wch: 28 }, { wch: 28 }, { wch: 38 }, { wch: 24 }, { wch: 24 },
    { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 42 },
  ];

  // FIX: identifiers are text so Excel cannot round them or remove leading zeroes.
  const textColumns = ['A', 'B', 'C', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R'];
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const column of textColumns) {
      const cell = sheet[`${column}${row}`];
      if (cell) {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
        cell.z = '@';
      }
    }
    const createdAtCell = sheet[`E${row}`];
    if (createdAtCell) createdAtCell.z = 'dd.mm.yyyy hh:mm';
    const quantityCell = sheet[`Q${row}`];
    if (quantityCell) quantityCell.z = '#,##0';
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Отменённые заказы');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

function marketplaceLabel(marketplace: string) {
  if (marketplace === 'WILDBERRIES') return 'Wildberries';
  if (marketplace === 'OZON') return 'Ozon';
  if (marketplace === 'YANDEX_MARKET') return 'Яндекс Маркет';
  return marketplace;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
