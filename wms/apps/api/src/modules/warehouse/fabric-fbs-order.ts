import { FabricDemand, FabricLedger, reserveFabric, confirmFabricCut, releaseUncutFabric } from './fabric-fbs-ledger';

export interface FabricOrderIdentity {
  marketplace: string; connectionId: string; orderId: string; requestId: string;
}
export type FabricOrderLine = Omit<FabricDemand, 'key'> & { lineId: string };
type SavedOrder = { identity: FabricOrderIdentity; lines: FabricOrderLine[] };
export interface FabricOrderLedger extends FabricLedger { fbsOrders?: Record<string, SavedOrder> }

// FIX: structured keys cannot collide when marketplace identifiers contain punctuation.
export function fabricOrderKey(identity: FabricOrderIdentity): string {
  const values = [identity.marketplace, identity.connectionId, identity.orderId, identity.requestId];
  if (values.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Incomplete fabric order identity');
  return JSON.stringify(values);
}
function lineKey(owner: FabricOrderIdentity, lineId: string) { return JSON.stringify([fabricOrderKey(owner), lineId]); }
function composition(lines: FabricOrderLine[]): string {
  return JSON.stringify([...lines].sort((a, b) => a.lineId.localeCompare(b.lineId)).map(l =>
    [l.lineId, l.skuId, l.warehouseId, l.material, l.color, l.lengthMm, l.units]));
}
// FIX: all lines reserve atomically in memory; the caller persists once under the client lock.
export function reserveFabricOrder(input: FabricOrderLedger, owner: FabricOrderIdentity, lines: FabricOrderLine[]): FabricOrderLedger {
  const key = fabricOrderKey(owner);
  if (!lines.length || lines.some(l => typeof l.lineId !== 'string' || !l.lineId.trim())) throw new Error('Missing fabric order lines');
  if (new Set(lines.map(l => l.lineId)).size !== lines.length) throw new Error('Duplicate fabric order line');
  const saved = input.fbsOrders?.[key];
  if (saved && composition(saved.lines) !== composition(lines)) throw new Error('Fabric order composition changed');
  let next: FabricOrderLedger = structuredClone(input);
  for (const line of lines) next = reserveFabric(next, { ...line, key: lineKey(owner, line.lineId) });
  (next.fbsOrders ??= {})[key] = { identity: structuredClone(owner), lines: structuredClone(lines) };
  return next;
}
export function confirmFabricOrderCut(input: FabricOrderLedger, owner: FabricOrderIdentity, lineId: string, units: number, operationId: string) {
  const saved = input.fbsOrders?.[fabricOrderKey(owner)];
  if (!saved?.lines.some(l => l.lineId === lineId)) throw new Error('Fabric order line missing');
  // FIX: replay may not redirect the same operation to another product line.
  const other = saved.lines.filter(l => l.lineId !== lineId).map(l => lineKey(owner, l.lineId));
  if (input.fbsReservations?.some(r => other.includes(r.key) && r.operations.some(op => op.id === operationId))) {
    throw new Error('Operation payload conflict');
  }
  return confirmFabricCut(input, lineKey(owner, lineId), units, operationId);
}
export function releaseFabricOrder(input: FabricOrderLedger, owner: FabricOrderIdentity): FabricOrderLedger {
  const saved = input.fbsOrders?.[fabricOrderKey(owner)];
  if (!saved) throw new Error('Fabric order missing');
  let next: FabricOrderLedger = structuredClone(input);
  for (const line of saved.lines) next = releaseUncutFabric(next, lineKey(owner, line.lineId));
  return next;
}
