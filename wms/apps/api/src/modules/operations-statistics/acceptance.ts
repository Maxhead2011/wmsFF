import type { TimingObservation } from './order-timing';

export type AcceptanceFacts = {
  supplierStatus?: string | null; wbStatus?: string | null; requiresReshipment?: boolean | null;
  supplyScannedAt?: Date | null; orderScannedAt?: Date | null;
};
// FIX: marketplace acceptance and the supply-level timing proxy are independent measurements.
export function acceptanceObservation(placed: Date, fact: AcceptanceFacts, now: Date): TimingObservation {
  const status = fact.wbStatus?.toLowerCase();
  if (fact.supplierStatus === 'cancel' || ['canceled', 'cancelled', 'canceled_by_client', 'declined_by_client', 'defect'].includes(status ?? '')) {
    return { state: 'cancelled', elapsedMs: null, receipt: 'cancelled', basis: null };
  }
  if (fact.requiresReshipment) return { state: 'unknown', elapsedMs: null, receipt: 'reshipment', basis: null };
  const receipt = ['sorted', 'sold', 'ready_for_pickup'].includes(status ?? '') ? 'confirmed'
    : status === 'waiting' ? 'waiting' : 'unknown';
  const at = fact.orderScannedAt ?? fact.supplyScannedAt;
  if (!Number.isFinite(+placed) || +placed > +now || (at && (!Number.isFinite(+at) || +at < +placed || +at > +now))) {
    return { state: 'unknown', elapsedMs: null, receipt, basis: null };
  }
  if (at) return { state: 'shipped', elapsedMs: +at - +placed, receipt, basis: fact.orderScannedAt ? 'order-scan' : 'supply-scan' };
  return { state: receipt === 'waiting' ? 'pending' : 'unknown', elapsedMs: receipt === 'waiting' ? +now - +placed : null, receipt, basis: null };
}
