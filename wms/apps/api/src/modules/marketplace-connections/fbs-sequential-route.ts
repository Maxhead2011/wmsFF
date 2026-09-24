export const fbsSequentialEnabled = () => process.env.WMS_FBS_SEQUENTIAL_PICK_ENABLED === 'true';
// FIX: an order on the physically selected box precedes other boxes on the pallet.
export function fbsLocationRank(codes: string[], box: string | null | undefined, pallet: Set<string>) {
  return box && codes.includes(box) ? 2 : codes.some(code => pallet.has(code)) ? 1 : 0;
}
// FIX: eligible boxes have already been reduced by reservations; a hint cannot create stock.
export function fbsContinuationBox<T extends { code: string; quantity: number }>(
  eligible: T[], previous: string | null | undefined, required: number,
): T | undefined {
  return fbsSequentialEnabled() ? eligible.find(b => b.code === previous && b.quantity >= required) : undefined;
}
