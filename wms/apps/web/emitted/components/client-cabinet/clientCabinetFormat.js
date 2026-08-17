export const cabinetDateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
export const cabinetMoneyFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});
export function formatCabinetDate(value) {
    if (!value) {
        return '-';
    }
    return cabinetDateFormatter.format(new Date(value));
}
export function formatCabinetMoney(value) {
    return cabinetMoneyFormatter.format(Number(value));
}
export function primaryBarcode(balance) {
    return balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value ?? '-';
}
export function formatCabinetNumber(value) {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}
const stockStatusLabels = {
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
const clientStatusLabels = {
    ACTIVE: 'Активен',
    PAUSED: 'Приостановлен',
    ARCHIVED: 'В архиве',
};
const requestTypeLabels = {
    INBOUND: 'Поставка',
    OUTBOUND: 'Отгрузка',
    RETURN: 'Возврат',
    DELIVERY: 'Доставка',
    SERVICE: 'Услуга',
    OTHER: 'Другое',
};
const requestStatusLabels = {
    SUBMITTED: 'Создана',
    IN_REVIEW: 'На проверке',
    APPROVED: 'Подтверждена',
    IN_WORK: 'В работе',
    PACKED: 'Упакована',
    DONE: 'Завершена',
    CANCELLED: 'Отменена',
    REJECTED: 'Отклонена',
};
const billingStatusLabels = {
    DRAFT: 'Черновик',
    APPROVED: 'Подтверждено',
    CANCELLED: 'Отменено',
};
const billingInvoiceStatusLabels = {
    DRAFT: 'Черновик',
    ISSUED: 'Выставлен',
    PAID: 'Оплачен',
    CANCELLED: 'Отменен',
};
const billingUnitLabels = {
    SERVICE: 'усл.',
    PIECE: 'шт.',
    BOX: 'кор.',
    PALLET: 'пал.',
    LITER: 'л',
    LITER_DAY: 'л-дн.',
    DAY: 'дн.',
    HOUR: 'ч',
};
const billingSourceLabels = {
    MANUAL: 'ручная услуга',
    STORAGE: 'хранение',
    LOGISTICS: 'логистика',
};
export function stockStatusLabel(status) {
    if (!status) {
        return '-';
    }
    return stockStatusLabels[status] ?? status;
}
export function clientStatusLabel(status) {
    return clientStatusLabels[status] ?? status;
}
export function requestTypeLabel(type) {
    return requestTypeLabels[type] ?? type;
}
export function requestStatusLabel(status) {
    return requestStatusLabels[status] ?? status;
}
export function billingStatusLabel(status) {
    return billingStatusLabels[status] ?? status;
}
export function billingInvoiceStatusLabel(status) {
    return billingInvoiceStatusLabels[status] ?? status;
}
export function billingUnitLabel(unit) {
    return billingUnitLabels[unit] ?? unit;
}
export function billingSourceLabel(source) {
    return billingSourceLabels[source] ?? source;
}
