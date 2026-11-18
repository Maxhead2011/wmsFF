// FIX: shortage is allowed only for an explicit WB plan; unresolved/relabel rows stay blocked.
export function canUseWbClientPlan(line: {
  skuId?: string | null; requestedQuantity: number; needsRelabel?: boolean;
  relabelTargetBarcode?: string | null;
}) {
  return Boolean(line.skuId) && Number.isSafeInteger(line.requestedQuantity) &&
    line.requestedQuantity > 0 && !line.needsRelabel && !line.relabelTargetBarcode;
}
