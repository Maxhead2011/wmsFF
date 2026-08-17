export const logisticsDeliveryStatusOptions = [
    { value: 'REQUESTED', label: 'Запрошена' },
    { value: 'QUOTED', label: 'Рассчитана' },
    { value: 'PLANNED', label: 'Запланирована' },
    { value: 'IN_TRANSIT', label: 'В пути' },
    { value: 'DELIVERED', label: 'Доставлена' },
    { value: 'CANCELLED', label: 'Отменена' },
];
export function logisticsDeliveryStatusLabel(value) {
    return logisticsDeliveryStatusOptions.find((option) => option.value === value)?.label ?? value;
}
export function logisticsDeliveryStatusTone(status) {
    if (status === 'DELIVERED' || status === 'QUOTED') {
        return 'ready';
    }
    if (status === 'PLANNED' || status === 'IN_TRANSIT') {
        return 'in-progress';
    }
    return 'planned';
}
export const logisticsTripStatusOptions = [
    { value: 'PLANNED', label: 'Запланирован' },
    { value: 'LOADING', label: 'Погрузка' },
    { value: 'IN_TRANSIT', label: 'В пути' },
    { value: 'COMPLETED', label: 'Завершен' },
    { value: 'CANCELLED', label: 'Отменен' },
];
export function logisticsTripStatusLabel(value) {
    return logisticsTripStatusOptions.find((option) => option.value === value)?.label ?? value;
}
export function logisticsTripStatusTone(status) {
    if (status === 'COMPLETED') {
        return 'ready';
    }
    if (status === 'LOADING' || status === 'IN_TRANSIT') {
        return 'in-progress';
    }
    return 'planned';
}
