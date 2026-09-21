export type StockConfirmationRow = { id: string; warehouseId: string; skuId: string | null; chrtId: string; article: string | null; name: string | null; size: string | null; barcode: string | null; phase: string; status: string; calculatedAmount: number; sentAmount: number | null; observedAmount: number | null; difference: number | null; sentAt: string | null; checkedAt: string | null; updatedAt: string; error: string | null };
export type StockConfirmationResult = { summary: { total: number; confirmed: number; mismatches: number; unconfirmed: number; pending: number; lastCheckedAt: string | null }; total: number; page: number; pageSize: number; generatedAt: string; accountName: string | null; warehouses: Array<{id: string; name: string; total: number}>; rows: StockConfirmationRow[] };
export function confirmationAmount(value: number | null) { return value === null ? '—' : String(value); }
export function confirmationStatus(status: string) {
  return ({CONFIRMED:'Подтверждено',MISMATCH:'Расхождение',UNCONFIRMED:'Нет подтверждения',PLANNED:'Рассчитано',SENDING:'Отправляется',SENT:'Ожидает проверки'} as Record<string,string>)[status] ?? 'Нет подтверждения';
}
