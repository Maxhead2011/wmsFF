// ADDED: one source of truth for FBS age colours and the 240-hour deadline report.
export const FBS_AUTO_CANCEL_HOURS = 240;
export const FBS_WARNING_AGE_HOURS = 12;
export const FBS_CRITICAL_AGE_HOURS = 19;

const HOUR_MS = 60 * 60 * 1000;

export type FbsDeadlineTone = 'normal' | 'warning' | 'critical';
export type FbsDeadlineToneFilter = 'all' | FbsDeadlineTone;
export type FbsDeadlineStockFilter = 'all' | 'available' | 'missing';

export type FbsDeadlineOrder = {
  id: string;
  orderUid?: string | null;
  category: string;
  marketplace: string;
  createdAt?: string | null;
  sellerDate?: string | null;
  supplyId?: string | null;
  request?: { number: number } | null;
  storageBoxes?: Array<{ code: string; quantity: number; status: string }>;
  reservation?: { status: string } | null;
};

export type FbsDeadlineFilters = {
  tone: FbsDeadlineToneFilter;
  dateFrom: string;
  dateTo: string;
  orderNumber: string;
  requestNumber: string;
  supplyId: string;
  stock: FbsDeadlineStockFilter;
};

export type FbsDeadlineSnapshot = {
  createdAt: number;
  ageMilliseconds: number;
  remainingMilliseconds: number;
  tone: FbsDeadlineTone;
  overdue: boolean;
};

export type FbsDeadlineStockSnapshot = {
  available: boolean;
  quantity: number;
  boxes: Array<{ code: string; quantity: number }>;
};

export function fbsActiveOrderAgeTone(milliseconds: number): FbsDeadlineTone {
  const hours = Math.max(0, milliseconds) / HOUR_MS;
  if (hours >= FBS_CRITICAL_AGE_HOURS) return 'critical';
  if (hours >= FBS_WARNING_AGE_HOURS) return 'warning';
  return 'normal';
}

export function fbsDeadlineCreatedAt(order: Pick<FbsDeadlineOrder, 'createdAt' | 'sellerDate'>) {
  return validTimestamp(order.createdAt) ?? validTimestamp(order.sellerDate);
}

export function fbsDeadlineSnapshot(
  order: Pick<FbsDeadlineOrder, 'createdAt' | 'sellerDate'>,
  now: number,
): FbsDeadlineSnapshot | null {
  const createdAt = fbsDeadlineCreatedAt(order);
  if (createdAt === null) return null;
  const ageMilliseconds = Math.max(0, now - createdAt);
  const remainingMilliseconds = FBS_AUTO_CANCEL_HOURS * HOUR_MS - ageMilliseconds;
  return {
    createdAt,
    ageMilliseconds,
    remainingMilliseconds,
    tone: fbsActiveOrderAgeTone(ageMilliseconds),
    overdue: remainingMilliseconds <= 0,
  };
}

export function fbsDeadlineStockSnapshot(
  order: Pick<FbsDeadlineOrder, 'storageBoxes' | 'reservation'>,
): FbsDeadlineStockSnapshot {
  const boxes = (order.storageBoxes ?? [])
    .filter((box) => box.status === 'AVAILABLE')
    .map((box) => ({ code: box.code, quantity: Math.max(0, Number(box.quantity) || 0) }))
    .filter((box) => box.quantity > 0);
  const quantity = boxes.reduce((sum, box) => sum + box.quantity, 0);
  // FIX: WAITING_STOCK is authoritative even when an old cached box list is still attached.
  if (order.reservation?.status === 'WAITING_STOCK') {
    return { available: false, quantity: 0, boxes: [] };
  }
  return {
    available: order.reservation?.status === 'RESERVED' || quantity > 0,
    quantity,
    boxes,
  };
}

export function filterFbsDeadlineOrders<T extends FbsDeadlineOrder>(
  orders: T[],
  filters: FbsDeadlineFilters,
  now: number,
) {
  const dateFrom = startOfLocalDay(filters.dateFrom);
  const dateTo = endOfLocalDay(filters.dateTo);
  const orderNumber = normalize(filters.orderNumber);
  const requestNumber = normalize(filters.requestNumber);
  const supplyId = normalize(filters.supplyId);

  return orders
    .filter((order) => order.category === 'active' && order.marketplace === 'WILDBERRIES')
    .filter((order) => {
      const snapshot = fbsDeadlineSnapshot(order, now);
      if (!snapshot) return filters.tone === 'all' && dateFrom === null && dateTo === null;
      if (filters.tone !== 'all' && snapshot.tone !== filters.tone) return false;
      if (dateFrom !== null && snapshot.createdAt < dateFrom) return false;
      if (dateTo !== null && snapshot.createdAt > dateTo) return false;
      return true;
    })
    .filter((order) => {
      if (filters.stock === 'all') return true;
      const available = fbsDeadlineStockSnapshot(order).available;
      return filters.stock === 'available' ? available : !available;
    })
    .filter((order) => {
      if (orderNumber && ![order.id, order.orderUid].some((value) => normalize(value).includes(orderNumber))) {
        return false;
      }
      if (requestNumber && !normalize(order.request?.number).includes(requestNumber)) return false;
      if (supplyId && !normalize(order.supplyId).includes(supplyId)) return false;
      return true;
    })
    .sort((left, right) => {
      const leftRemaining = fbsDeadlineSnapshot(left, now)?.remainingMilliseconds ?? Number.POSITIVE_INFINITY;
      const rightRemaining = fbsDeadlineSnapshot(right, now)?.remainingMilliseconds ?? Number.POSITIVE_INFINITY;
      return leftRemaining - rightRemaining || left.id.localeCompare(right.id, 'ru-RU', { numeric: true });
    });
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function startOfLocalDay(value: string) {
  if (!value) return null;
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function endOfLocalDay(value: string) {
  if (!value) return null;
  const timestamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
