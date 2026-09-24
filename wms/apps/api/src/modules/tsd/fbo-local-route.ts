export type FboRouteContext = { sourceBoxCode?: string; palletCode?: string };
export const fboLocalRouteEnabled = () => process.env.WMS_FBO_LOCAL_ROUTE_ENABLED === 'true';

// FIX: location is a preference among already authorized, non-busy boxes, never a reservation.
export function prioritizeFboLocation<T extends {
  code: string;
  balances: Array<{ skuId: string; status: string; quantity: number }>;
  storagePlacement?: { pallet: { code: string } } | null;
  pallet?: { code: string } | null;
}>(boxes: T[], demand: Record<string, number>, context: FboRouteContext,
  wholeOrder: (boxes: T[], demand: Record<string, number>) => T[]): T[] {
  const pallet = context.palletCode?.trim();
  if (!pallet) return wholeOrder(boxes, demand);
  const remaining = { ...demand };
  const here = boxes.filter(b => (b.storagePlacement?.pallet.code ?? b.pallet?.code) === pallet);
  const selected = here.filter(b => b.code === context.sourceBoxCode);
  const result: T[] = [];
  const consume = (group: T[]) => {
    for (const box of group) {
      result.push(box);
      for (const b of box.balances) if (b.status === 'AVAILABLE' && b.quantity > 0)
        remaining[b.skuId] = Math.max(0, (remaining[b.skuId] ?? 0) - b.quantity);
    }
  };
  consume(selected);
  consume(wholeOrder(here.filter(b => !selected.includes(b)), remaining));
  consume(wholeOrder(boxes.filter(b => !here.includes(b)), remaining));
  return result;
}
