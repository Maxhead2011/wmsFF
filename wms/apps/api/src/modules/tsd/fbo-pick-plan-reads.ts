import type {Prisma} from '@prisma/client';

// FIX: routing needs mark identities and stock states, not full receipt records.
export const routeBoxSelect = {
  id: true, code: true,
  balances: {select: {skuId: true, quantity: true, status: true}},
  productMarks: {where: {status: {not: 'SHIPPING'}}, select: {value: true, skuId: true, status: true}},
  storagePlacement: {select: {pallet: {select: {code: true, zone: {select: {name: true}}}}}},
  pallet: {select: {code: true}}, zone: {select: {name: true}},
} as const satisfies Prisma.BoxSelect;

type PickingBox = {
  code: string;
  storagePlacement: {pallet: {code: string}} | null;
  pallet: {code: string} | null;
  productMarks: Array<{status: string; skuId: string}>;
};

const naturalOrder = new Intl.Collator('ru', {numeric: true});
export function preparePickingBoxes(boxes: PickingBox[], lines: Array<{skuId: string; requiresKiz: boolean}>) {
  const marked = new Set<string>();
  for (const box of boxes) {
    for (const mark of box.productMarks) if (mark.status === 'AVAILABLE') marked.add(mark.skuId);
  }
  for (const line of lines) if (marked.has(line.skuId)) line.requiresKiz = true;
  const palletCode = (box: PickingBox) => box.storagePlacement?.pallet.code ?? box.pallet?.code ?? '';
  boxes.sort((a,b) => naturalOrder.compare(palletCode(a), palletCode(b)) || naturalOrder.compare(a.code,b.code));
}
