import * as XLSX from 'xlsx';

export const FBS_DEADLINE_REPORT_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HOUR_MS = 60 * 60 * 1_000;
const FBS_AUTO_CANCEL_HOURS = 240;
const FBS_WARNING_AGE_HOURS = 12;
const FBS_CRITICAL_AGE_HOURS = 19;

export type FbsDeadlineExportOrder = {
  id: string;
  orderUid: string | null;
  accountName: string | null;
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
  storageBoxes: Array<{ code: string; quantity: number; status: string }>;
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
  reservation?: {
    status: string;
    palletCode: string | null;
    problem: string | null;
  } | null;
  shipmentPlan: {
    requiresCargoPlaces: boolean;
    cargoPlaceCount: number;
  } | null;
};

const headers: string[] = [
  'Критичность',
  'Заказ WB',
  'UID заказа',
  'Создан',
  'Возраст, ч',
  'Осталось до автоотмены, ч',
  'Автоотмена в',
  'Заявка WMS',
  'Статус заявки',
  'Товар',
  'Артикул',
  'Размер',
  'ШК',
  'Количество',
  'Наличие WMS',
  'Доступно, шт',
  'Короба WMS',
  'Паллетсорт',
  'Направление',
  'Склад WB',
  'Поставка WB',
  'Кабинет WB',
  'Статус WB',
  'Комментарий',
];

export function buildFbsDeadlineReportXlsx(
  orders: FbsDeadlineExportOrder[],
  fallbackRequiresCargoPlaces: boolean,
  now = Date.now(),
) {
  // FIX: the server rebuilds every row from the current scoped FBS snapshot;
  // the browser supplies identifiers only and cannot forge report values.
  const rows = orders.map((order) => {
    const createdAt = validDate(order.createdAt) ?? validDate(order.sellerDate);
    const ageHours = createdAt ? Math.max(0, now - createdAt.getTime()) / HOUR_MS : null;
    const remainingHours = ageHours === null ? null : FBS_AUTO_CANCEL_HOURS - ageHours;
    const deadlineAt = createdAt
      ? new Date(createdAt.getTime() + FBS_AUTO_CANCEL_HOURS * HOUR_MS)
      : null;
    const availableBoxes = order.storageBoxes
      .filter((box) => box.status === 'AVAILABLE')
      .map((box) => ({
        code: box.code,
        quantity: Math.max(0, Number(box.quantity) || 0),
      }))
      .filter((box) => box.quantity > 0);
    const availableQuantity = order.reservation?.status === 'WAITING_STOCK'
      ? 0
      : availableBoxes.reduce((sum, box) => sum + box.quantity, 0);
    const available = order.reservation?.status !== 'WAITING_STOCK' &&
      (order.reservation?.status === 'RESERVED' || availableQuantity > 0);

    return [
      deadlineTone(ageHours),
      order.id,
      order.orderUid ?? '',
      createdAt,
      ageHours,
      remainingHours,
      deadlineAt,
      order.request ? String(order.request.number) : '',
      order.request?.status ?? '',
      order.product?.name ?? '',
      order.product?.internalSku || order.product?.clientSku || order.product?.article || order.article || '',
      order.product?.size ?? '',
      order.barcodes.join(', '),
      Math.max(0, Number(order.itemCount) || 0),
      available ? 'Есть на складе' : 'Нет на складе',
      availableQuantity,
      availableBoxes.map((box) => `${box.code} — ${box.quantity} шт.`).join(', '),
      order.reservation?.palletCode ?? '',
      shipmentDestination(order, fallbackRequiresCargoPlaces),
      order.warehouseName || (order.warehouseId ? `Склад WB ${order.warehouseId}` : ''),
      order.supplyId ?? '',
      order.accountName ?? '',
      `${order.statusLabel || ''}${order.supplierStatus || order.wbStatus ? ` · ${order.supplierStatus || '—'} / ${order.wbStatus || '—'}` : ''}`,
      order.comment ?? '',
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows], { cellDates: true });
  sheet['!autofilter'] = { ref: `A1:X${Math.max(1, rows.length + 1)}` };
  sheet['!cols'] = [
    { wch: 14 }, { wch: 18 }, { wch: 38 }, { wch: 20 }, { wch: 13 }, { wch: 27 },
    { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 38 }, { wch: 22 }, { wch: 14 },
    { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 42 }, { wch: 20 },
    { wch: 28 }, { wch: 28 }, { wch: 26 }, { wch: 24 }, { wch: 32 }, { wch: 42 },
  ];

  // FIX: WB order IDs, UIDs, request numbers, articles, barcodes and supply IDs
  // are identifiers. Explicit text formatting preserves leading zeroes and long values.
  const textColumns = ['B', 'C', 'H', 'K', 'M', 'Q', 'R', 'T', 'U'];
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const column of textColumns) {
      const cell = sheet[`${column}${row}`];
      if (cell) {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
        cell.z = '@';
      }
    }
    for (const column of ['D', 'G']) {
      const cell = sheet[`${column}${row}`];
      if (cell) cell.z = 'dd.mm.yyyy hh:mm';
    }
    for (const column of ['E', 'F']) {
      const cell = sheet[`${column}${row}`];
      if (cell) cell.z = '0.00';
    }
    for (const column of ['N', 'P']) {
      const cell = sheet[`${column}${row}`];
      if (cell) cell.z = '#,##0';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Заказы FBS');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

function deadlineTone(ageHours: number | null) {
  if (ageHours === null) return 'Не рассчитано';
  if (ageHours >= FBS_CRITICAL_AGE_HOURS) return 'Красный';
  if (ageHours >= FBS_WARNING_AGE_HOURS) return 'Жёлтый';
  return 'Зелёный';
}

function shipmentDestination(order: FbsDeadlineExportOrder, fallbackRequiresCargoPlaces: boolean) {
  const requiresCargoPlaces = order.shipmentPlan?.requiresCargoPlaces ?? fallbackRequiresCargoPlaces;
  if (!requiresCargoPlaces) return 'Сортировочный центр WB';
  const cargoPlaceCount = order.shipmentPlan?.cargoPlaceCount ?? 0;
  return `ПВЗ${cargoPlaceCount > 0 ? ` · ${cargoPlaceCount} грузомест` : ''}`;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
