import { BadRequestException } from '@nestjs/common';

export type RepeatStockBucket = { id: string; skuId: string; boxId: string; quantity: number };

// FIX: augmenting-path matching avoids spending the only matching unit of a
// constrained order on another order that could use a relabel alternative.
export function allocateRepeatStock(
  demands: Array<{ id: string; candidateSkuIds: string[] }>,
  buckets: RepeatStockBucket[],
) {
  const slots = buckets.flatMap(bucket => Array.from({ length: Math.min(demands.length, Math.max(0, bucket.quantity)) }, () => bucket));
  const owners = new Map<number, string>();
  const demandById = new Map(demands.map(demand => [demand.id, demand]));
  if (demandById.size !== demands.length) throw new BadRequestException('Повторяющиеся заказы в плане.');
  function match(id: string, visited: Set<number>): boolean {
    for (let slot = 0; slot < slots.length; slot++) {
      if (visited.has(slot) || !demandById.get(id)!.candidateSkuIds.includes(slots[slot].skuId)) continue;
      visited.add(slot);
      const previous = owners.get(slot);
      if (!previous || match(previous, visited)) {
        owners.set(slot, id);
        return true;
      }
    }
    return false;
  }
  for (const demand of demands) {
    if (!match(demand.id, new Set())) throw new BadRequestException(`Недостаточно свободных остатков для заказа ${demand.id}. Заявка не создана.`);
  }
  return new Map([...owners].map(([slot, id]) => [id, slots[slot]]));
}
