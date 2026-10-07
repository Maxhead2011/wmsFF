import type { AuthSession } from './api';

export type SettlementLine = { id: string; kind: string; description: string; date: string; requestId?: string | null;
  requestNumber?: number; orderIds: string[]; marketplace?: string; connectionId?: string; billingAttemptId?: string;
  quantity?: string; unitPriceRub?: string; totalRub: number | null; buckets: string[];
  invoices: Array<{ id: string; number: string; status: string }>;
  payments?: Array<{ id: string; date: string; amountRub: number }> };
export type SettlementRow = { client: { id: string; code: string; name: string }; warehouseId: string | null; warehouseName: string;
  unbilledRub: number; draftRub: number; reviewRub: number; debtRub: number; overdueRub: number; clientAdvanceRub: number;
  clientCreditRub?: number;
  missingWorkCount: number; lines: SettlementLine[] };
export type SettlementIssue = { id: string; clientId: string; clientName: string; warehouseId: string | null;
  code: string; reason: string; action: string; line: SettlementLine };
export type SettlementReport = { enabled: true; periodFrom: string; periodTo: string; warehouseId: string; warehouseName: string;
  calculatedAt: string; workCoverage: 'FBS_CONFIRMED_OPERATIONS'; rows: SettlementRow[]; issues: SettlementIssue[] };

// FIX: server is authoritative; browser does not calculate balances from a filtered invoice list.
export async function fetchSettlements(session: AuthSession, filter: { periodFrom: string; periodTo: string; clientId?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ periodFrom: filter.periodFrom, periodTo: filter.periodTo });
  if (filter.clientId) query.set('clientId', filter.clientId);
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/billing/settlements?${query}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }, signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
    throw new Error(body?.message ? [body.message].flat().join('; ') : `Не удалось получить расчёты (${response.status}).`);
  }
  return await response.json() as SettlementReport | { enabled: false };
}
