// FIX: normalize deeply nested TSD request/response data into human-readable warehouse facts.
const labels: Record<string, string> = {
  palletCode: 'Паллет',
  palletSortCode: 'Паллет-сорт',
  sourcePalletCode: 'Исходный паллет',
  targetPalletCode: 'Целевой паллет',
  boxCode: 'Короб',
  fromBoxCode: 'Из короба',
  toBoxCode: 'В короб',
  inventoryBoxCode: 'Проверяемый короб',
  productName: 'Товар',
  article: 'Артикул',
  productSize: 'Размер',
  size: 'Размер',
  productColor: 'Цвет',
  color: 'Цвет',
  barcode: 'ШК',
  sourceBarcode: 'Исходный ШК',
  kiz: 'КИЗ',
  orderId: 'Заказ',
  requestId: 'ID заявки',
  requestNumber: 'Заявка WMS',
  supplyId: 'Поставка',
  clientName: 'Клиент',
  warehouseName: 'Склад',
  screenLabel: 'Экран ТСД',
  stage: 'Этап',
};

const operationLabels: Record<string, string> = {
  monitor_error: 'Ошибка на ТСД',
  tsd_api_action: 'Действие на ТСД',
  receipt_scan: 'Приёмка товара',
  move_scan: 'Перемещение товара',
  inventory_scan: 'Инвентаризация',
  assembly_stage: 'Этап сборки',
  monitor_heartbeat: 'Состояние ТСД',
};

export function operationPrimaryTitle(operationType: string, payload: Record<string, unknown>) {
  const request = asObject(payload.request);
  const path = String(request.path ?? request.route ?? '');
  if (operationType === 'tsd_api_action' && path) return actionFromPath(path);
  return operationLabels[operationType] ?? operationType;
}

export function operationContextEntries(payload: Record<string, unknown>) {
  const found = new Map<string, string>();
  visit(payload, found, 0);
  return [...found.entries()].map(([key, value]) => [labels[key] ?? key, value] as [string, string]);
}

export function operationMatchesSearch(payload: Record<string, unknown>, search: string) {
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return JSON.stringify(payload).toLocaleLowerCase('ru-RU').includes(needle);
}

function visit(value: unknown, found: Map<string, string>, depth: number) {
  if (!value || typeof value !== 'object' || depth > 7) return;
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item) => visit(item, found, depth + 1));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    if (labels[key] && isDisplayValue(nested)) {
      const text = String(nested).trim();
      if (text && !found.has(key)) found.set(key, text);
    }
    visit(nested, found, depth + 1);
  });
}

function actionFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.includes('scan')) return 'Сканирование';
  if (lower.includes('inventory')) return 'Инвентаризация';
  if (lower.includes('storage-pallet')) return 'Работа с паллетом';
  if (lower.includes('fbs')) return 'Сборка FBS';
  if (lower.includes('receipt')) return 'Приёмка товара';
  if (lower.includes('transfer')) return 'Перемещение товара';
  if (lower.includes('close') || lower.includes('complete')) return 'Завершение операции';
  return 'Действие на ТСД';
}

function isDisplayValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number';
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
