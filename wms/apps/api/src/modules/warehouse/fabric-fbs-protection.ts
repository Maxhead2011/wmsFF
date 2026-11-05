import { FabricLedger, reservedFabricMm, validateFabricLedger } from './fabric-fbs-ledger';

// FIX: persisted commitments remain protected even when new assignment is disabled.
export function freeFabricMm(state: FabricLedger, rollId: string): number {
  validateFabricLedger(state);
  const roll = state.rolls.find(r => r.id === rollId);
  if (!roll || roll.writtenOffAt) return 0;
  return Math.max(0, roll.remainingMm - reservedFabricMm(state, rollId));
}

export function assertFabricMutationPreservesReservations(before: FabricLedger, after: FabricLedger): void {
  validateFabricLedger(before); validateFabricLedger(after);
  if (JSON.stringify(before.fbsReservations ?? []) !== JSON.stringify(after.fbsReservations ?? [])) {
    throw new Error('Резервы ткани изменились вне операции ФБС.');
  }
  for (const roll of before.rolls) {
    const reserved = reservedFabricMm(before, roll.id);
    if (!reserved) continue;
    const updated = after.rolls.find(r => r.id === roll.id);
    if (!updated || updated.writtenOffAt || updated.warehouseId !== roll.warehouseId ||
        updated.material !== roll.material || updated.color !== roll.color || updated.remainingMm < reserved) {
      throw new Error('Метры зарезервированы под заказы ФБС. Сначала разберите резерв.');
    }
  }
}

export interface FabricCutCredit {
  key: string; skuId: string; warehouseId: string; mm: number;
  marketplace: string; connectionId: string; orderId: string;
  taskId: string; requestId: string;
}
export interface FabricShipmentIdentity {
  skuId: string; warehouseId: string; marketplace: string; connectionId: string; orderId: string;
  taskId: string; requestId: string;
}
// FIX: an old shipment of the same SKU cannot consume a new order's cut proof.
export function fabricCreditMatches(credit: FabricCutCredit, shipment: FabricShipmentIdentity): boolean {
  return ['skuId', 'warehouseId', 'marketplace', 'connectionId', 'orderId', 'taskId', 'requestId'].every(key => {
    const field = key as keyof FabricShipmentIdentity;
    return typeof shipment[field] === 'string' && !!shipment[field].trim() && credit[field] === shipment[field];
  }) && Number.isSafeInteger(credit.mm) && credit.mm > 0;
}
