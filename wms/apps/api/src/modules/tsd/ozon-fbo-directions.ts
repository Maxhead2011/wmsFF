import { ConflictException } from '@nestjs/common';
export type OzonDirection = { name: string; items: Array<{ skuId: string; barcode: string; quantity: number }> };
type Unit = { skuId: string; state: string; targetBoxId: string | null };
type Parcel = { boxId: string; direction?: string | null };
// FIX: one shared pick pool; only physical target boxes assign units to destinations.
export function directionProgress(directions: OzonDirection[], boxes: Parcel[], units: Unit[]) {
  return directions.map(d => {
    const ids = new Set(boxes.filter(b => b.direction === d.name).map(b => b.boxId));
    const items = d.items.map(i => ({ ...i, packed: units.filter(u => u.state === 'PACKED' && u.skuId === i.skuId && !!u.targetBoxId && ids.has(u.targetBoxId)).length }));
    return { name: d.name, needed: items.reduce((s, i) => s + i.quantity, 0), packed: items.reduce((s, i) => s + i.packed, 0), items };
  });
}
export function assertDirectionCapacity(directions: OzonDirection[], boxes: Parcel[], units: Unit[], name: string | undefined | null, added: Array<{ skuId: string }>) {
  const d = directionProgress(directions, boxes, units).find(d => d.name === name);
  if (!d) throw new ConflictException('Выберите направление поставки для короба.');
  const counts = new Map<string, number>();
  for (const u of added) counts.set(u.skuId, (counts.get(u.skuId) ?? 0) + 1);
  for (const [sku, n] of counts) {
    const item = d.items.find(i => i.skuId === sku);
    if (!item || item.packed + n > item.quantity) throw new ConflictException(`Товар не требуется или превышено количество для направления «${name}».`);
  }
}
