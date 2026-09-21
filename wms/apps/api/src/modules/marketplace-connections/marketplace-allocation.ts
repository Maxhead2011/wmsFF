export type AllocationConnection = { id: string; marketplace: string; isActive: boolean };
export type AllocationDraft = { wbConnectionId: string; ozonConnectionId: string; wbPercent: number };
export type AllocationProduct = { productId: string; offerId: string; article?: string; name: string; size: string; color: string; barcodes: string[] };

// FIX: eligibility is based on actual active connections, never a customer-name list.
export function allocationEligibility(connections: AllocationConnection[]) {
  const active = connections.filter(row => row.isActive && ['WILDBERRIES', 'OZON'].includes(row.marketplace));
  const available = active.some(row => row.marketplace === 'WILDBERRIES') && active.some(row => row.marketplace === 'OZON');
  return { available, count: active.length, message: available ? '' : active.length === 0
    ? 'Нет подключённых кабинетов' : active.length === 1 ? 'Подключён только 1 кабинет'
      : 'Для распределения нужны кабинеты Wildberries и Ozon' };
}

export function validateAllocationDraft(value: unknown, connections: AllocationConnection[]): AllocationDraft {
  const row = value as Partial<AllocationDraft> | null;
  if (!row || !Number.isInteger(row.wbPercent) || row.wbPercent! < 0 || row.wbPercent! > 100
    || !connections.some(c => c.isActive && c.id === row.wbConnectionId && c.marketplace === 'WILDBERRIES')
    || !connections.some(c => c.isActive && c.id === row.ozonConnectionId && c.marketplace === 'OZON')) {
    throw new Error('Выберите активные кабинеты WB и Ozon этого клиента и целую долю WB от 0 до 100%.');
  }
  return { wbConnectionId: row.wbConnectionId!, ozonConnectionId: row.ozonConnectionId!, wbPercent: row.wbPercent! };
}

// FIX: largest remainder conserves each barcode's stock; an exact tie goes to WB.
export function splitMarketplaceStock(available: number, wbPercent: number) {
  if (!Number.isSafeInteger(available) || available < 0 || !Number.isInteger(wbPercent) || wbPercent < 0 || wbPercent > 100) {
    throw new Error('Остаток и доля должны быть неотрицательными целыми числами.');
  }
  const wb = Number((BigInt(available) * BigInt(wbPercent) + 50n) / 100n);
  return { wb, ozon: available - wb };
}
