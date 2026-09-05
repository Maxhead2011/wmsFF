// FIX: opt-in for our WMS only. Read-side exclusion never reverses physical stock.
export function fbsTerminalQueueFilterEnabled() {
  return process.env.WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED === 'true';
}

type WbQueueSnapshot = {
  marketplace?: string | null;
  lastCategory?: string | null;
  lastSupplierStatus?: string | null;
  lastWbStatus?: string | null;
};
const terminalSupplierStatuses = new Set(['cancel', 'cancelled', 'canceled', 'cancel_carrier']);
const terminalWbStatuses = new Set([
  'canceled', 'cancelled', 'canceled_by_client', 'declined_by_client', 'canceled_by_carrier', 'sold', 'defect',
]);
const normalized = (value?: string | null) => value?.trim().toLowerCase() ?? '';

export function isFbsTerminalQueueOrder(snapshot?: WbQueueSnapshot | null) {
  if (!fbsTerminalQueueFilterEnabled() || snapshot?.marketplace !== 'WILDBERRIES') return false;
  // complete/waiting is intentionally NOT terminal: local emergency collection can still be required.
  return normalized(snapshot.lastCategory) === 'cancelled' ||
    terminalSupplierStatuses.has(normalized(snapshot.lastSupplierStatus)) ||
    terminalWbStatuses.has(normalized(snapshot.lastWbStatus));
}
