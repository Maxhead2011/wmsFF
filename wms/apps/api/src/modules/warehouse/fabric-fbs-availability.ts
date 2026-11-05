import { FabricLedger, reserveFabric } from './fabric-fbs-ledger';

export interface FabricSkuIdentity { id: string; name: string; internalSku: string | null }
// FIX: use the same exact SKU grammar as existing roll receipt; never infer metres from a title.
export function identifyFabricSku(sku: FabricSkuIdentity) {
  if (!/ткань/i.test(sku.name)) return null;
  const match = /^(gab_)?(black|white|green|red|ivory)_(1|3|5|10|20|30|50)(?:-0)?$/.exec(sku.internalSku ?? '');
  return match ? { skuId: sku.id, material: match[1] ? 'GABARDINE' : 'SATIN', color: match[2], lengthMm: Number(match[3]) * 1000 } : null;
}
type Pending = { warehouseId: string; material: string; color: string; meters: number };
type AvailabilityLedger = FabricLedger & { shipmentPending?: Pending[] };
export function fabricMaterialAvailability(ledger: AvailabilityLedger, sku: FabricSkuIdentity, warehouseId: string, units: number) {
  const identity = identifyFabricSku(sku);
  if (!identity) return { available: false, reason: 'NOT_FABRIC' as const };
  // FIX: unresolved historic consumption must not silently count as freely sellable raw material.
  if (ledger.shipmentPending?.some(p => p.warehouseId === warehouseId && p.material === identity.material && p.color === identity.color && p.meters > 0)) {
    return { available: false, reason: 'RECONCILIATION_REQUIRED' as const };
  }
  try {
    reserveFabric(ledger, { ...identity, warehouseId, units, key: '__preview__:' + JSON.stringify([sku.id, warehouseId]) });
    return { available: true, reason: 'READY_TO_CUT' as const, ...identity, units, totalMm: identity.lengthMm * units };
  } catch (error) {
    if (error instanceof Error && error.message === 'Insufficient continuous fabric') return { available: false, reason: 'INSUFFICIENT_MATERIAL' as const };
    throw error;
  }
}
