import type {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceStatus,
  BillingUnit,
  ClientRequestStatus,
  ClientRequestType,
  ClientStatus,
  StockBalance,
} from '../../lib/api';

export const cabinetDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export const cabinetMoneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function formatCabinetDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return cabinetDateFormatter.format(new Date(value));
}

export function formatCabinetMoney(value: string | number) {
  return cabinetMoneyFormatter.format(Number(value));
}

export function primaryBarcode(balance: StockBalance) {
  return balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value ?? '-';
}

export function formatCabinetNumber(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

const stockStatusLabels: Record<string, string> = {
  AVAILABLE: 'Доступно',
  IN_TRANSIT: 'В пути между филиалами',
  RESERVED: 'Зарезервировано',
  RECEIVING: 'Приемка',
  PACKING: 'Сборка',
  SHIPPING: 'К отгрузке',
  BLOCKED: 'Заблокировано',
  DEFECT: 'Брак',
  QUARANTINE: 'Карантин',
  UNMARKED: 'Без маркировки',
  NEEDS_LABEL: 'Нужна этикетка',
  NEEDS_RELABEL: 'Нужна перемаркировка',
};

const clientStatusLabels: Record<ClientStatus, string> = {
  ACTIVE: 'Активен',
  PAUSED: 'Приостановлен',
  ARCHIVED: 'В архиве',
};

const requestTypeLabels: Record<ClientRequestType, string> = {
  INBOUND: 'Поставка',
  OUTBOUND: 'Отгрузка',
  RETURN: 'Возврат',
  DELIVERY: 'Доставка',
  SERVICE: 'Услуга',
  OTHER: 'Другое',
};

const requestStatusLabels: Record<ClientRequestStatus, string> = {
  SUBMITTED: 'Создана',
  IN_REVIEW: 'На проверке',
  APPROVED: 'Подтверждена',
  IN_WORK: 'В работе',
  PACKED: 'Упакована',
  DONE: 'Завершена',
  CANCELLED: 'Отменена',
  REJECTED: 'Отклонена',
};

const billingStatusLabels: Record<BillingChargeStatus, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Подтверждено',
  CANCELLED: 'Отменено',
};

const billingInvoiceStatusLabels: Record<BillingInvoiceStatus, string> = {
  DRAFT: 'Черновик',
  ISSUED: 'Выставлен',
  PAID: 'Оплачен',
  CANCELLED: 'Отменен',
};

const billingUnitLabels: Record<BillingUnit, string> = {
  SERVICE: 'усл.',
  PIECE: 'шт.',
  BOX: 'кор.',
  PALLET: 'пал.',
  LITER: 'л',
  LITER_DAY: 'л-дн.',
  DAY: 'дн.',
  HOUR: 'ч',
};

const billingSourceLabels: Record<BillingChargeSource, string> = {
  MANUAL: 'ручная услуга',
  STORAGE: 'хранение',
  LOGISTICS: 'логистика',
};

export function stockStatusLabel(status: string | null | undefined) {
  if (!status) {
    return '-';
  }

  return stockStatusLabels[status] ?? status;
}

export function clientStatusLabel(status: ClientStatus) {
  return clientStatusLabels[status] ?? status;
}

export function requestTypeLabel(type: ClientRequestType) {
  return requestTypeLabels[type] ?? type;
}

export function requestStatusLabel(status: ClientRequestStatus) {
  return requestStatusLabels[status] ?? status;
}

export function billingStatusLabel(status: BillingChargeStatus) {
  return billingStatusLabels[status] ?? status;
}

export function billingInvoiceStatusLabel(status: BillingInvoiceStatus) {
  return billingInvoiceStatusLabels[status] ?? status;
}

export function billingUnitLabel(unit: BillingUnit) {
  return billingUnitLabels[unit] ?? unit;
}

export function billingSourceLabel(source: BillingChargeSource) {
  return billingSourceLabels[source] ?? source;
}
