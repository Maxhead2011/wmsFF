import type { ClientRequestPriority, ClientRequestStatus, ClientRequestType } from '../../lib/api';

export const requestTypeOptions: Array<{ value: ClientRequestType; label: string }> = [
  { value: 'INBOUND', label: 'Приёмка' },
  { value: 'OUTBOUND', label: 'Отгрузка' },
  { value: 'RETURN', label: 'Возврат' },
  { value: 'DELIVERY', label: 'Доставка' },
  { value: 'SERVICE', label: 'Услуга' },
  { value: 'OTHER', label: 'Другое' },
];

export const requestStatusOptions: Array<{ value: ClientRequestStatus; label: string }> = [
  { value: 'SUBMITTED', label: 'Новая' },
  { value: 'IN_REVIEW', label: 'На проверке' },
  { value: 'APPROVED', label: 'Согласована' },
  { value: 'IN_WORK', label: 'В работе' },
  { value: 'PACKED', label: 'Упакована' },
  { value: 'DONE', label: 'Сдано' },
  { value: 'CANCELLED', label: 'Отменена' },
  { value: 'REJECTED', label: 'Отклонена' },
];

export const requestPriorityOptions: Array<{ value: ClientRequestPriority; label: string }> = [
  { value: 'LOW', label: 'Низкий' },
  { value: 'NORMAL', label: 'Обычный' },
  { value: 'HIGH', label: 'Высокий' },
  { value: 'URGENT', label: 'Срочный' },
];

export function requestTypeLabel(value: ClientRequestType) {
  return requestTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function requestStatusLabel(value: ClientRequestStatus) {
  return requestStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function requestPriorityLabel(value: ClientRequestPriority) {
  return requestPriorityOptions.find((option) => option.value === value)?.label ?? value;
}

export function requestStatusTone(status: ClientRequestStatus) {
  if (status === 'DONE') {
    return 'done';
  }

  if (status === 'CANCELLED' || status === 'REJECTED') {
    return 'cancelled';
  }

  if (status === 'IN_WORK') {
    return 'in-work';
  }

  if (status === 'APPROVED' || status === 'PACKED') {
    return 'ready';
  }

  if (status === 'IN_REVIEW') {
    return 'in-progress';
  }

  return 'planned';
}
