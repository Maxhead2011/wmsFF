import { createHash } from 'node:crypto';
import { parseBillingPeriod, record, type PeriodCharge, type PeriodInvoice, type PeriodPreviewLine } from './billing-period-policy';

export type DoneRequest = { id: string; number: number; clientId: string; warehouseId: string | null; status: string;
  client: PeriodCharge['client']; updatedAt: Date; events: Array<{ id: string; createdAt: Date }> };
export type DoneCharge = PeriodCharge & { requestId: string | null };
export type DoneInvoice = PeriodInvoice & { requestId: string | null };
type Input = { periodFrom: string; periodTo: string; clientId?: string };

// FIX: request events are instants; surrender calendar dates use the warehouse's Moscow timezone.
export function doneRequestDates(input: Input) {
  parseBillingPeriod(input.periodFrom, input.periodTo);
  return { from: new Date(`${input.periodFrom}T00:00:00+03:00`), to: new Date(`${input.periodTo}T23:59:59.999+03:00`) };
}
export function buildDoneRequestsPlan(input: Input, requests: DoneRequest[], charges: DoneCharge[], invoices: DoneInvoice[], warehouseId: string) {
  const { from, to } = doneRequestDates(input);
  const issues: Array<{ id: string; clientName: string; message: string }> = [];
  const issue = (id: string, clientName: string, message: string) => issues.push({ id, clientName, message });
  const selected = requests.filter(r => {
    if (r.status !== 'DONE' || r.warehouseId !== warehouseId || (input.clientId && r.clientId !== input.clientId)) return false;
    const event = [...r.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];
    if (!event) { issue(r.id, r.client.name, `Заявка №${r.number}: дата сдачи не найдена в истории. Требуется проверка.`); return false; }
    return event.createdAt >= from && event.createdAt <= to;
  }).sort((a, b) => a.id.localeCompare(b.id));
  const requestMap = new Map(selected.map(r => [r.id, r]));
  const eligibleCharges = charges.filter(c => c.requestId && requestMap.get(c.requestId)?.clientId === c.clientId && c.status !== 'CANCELLED');
  const chargeMap = new Map(eligibleCharges.map(c => [c.id, c]));
  type Group = { key: string; clientId: string; clientName: string; warehouseId: string; category: 'OTHER'; chargeIds: string[];
    invoiceIds: string[]; requestIds: string[]; totalRub: number; itemCount: number; action: 'CREATE' | 'EXISTING'; existingInvoiceId?: string; lines: PeriodPreviewLine[] };
  const groups = new Map<string, Group>();
  const add = (client: PeriodCharge['client'], id: string, lines: PeriodPreviewLine[], requestIds: string[], isInvoice = false) => {
    const g = groups.get(client.id) ?? { key: `${client.id}:${warehouseId}:DONE_REQUESTS`, clientId: client.id,
      clientName: client.name, warehouseId, category: 'OTHER', chargeIds: [], invoiceIds: [], requestIds: [], totalRub: 0, itemCount: 0, action: 'CREATE', lines: [] };
    g[isInvoice ? 'invoiceIds' : 'chargeIds'].push(id); g.lines.push(...lines); g.itemCount += lines.length;
    g.requestIds = [...new Set([...g.requestIds, ...requestIds])].sort();
    g.totalRub = Math.round((g.totalRub + lines.reduce((sum, l) => sum + Number(l.totalRub), 0)) * 100) / 100;
    groups.set(client.id, g);
  };
  const valid = (row: { quantity: unknown; unitPriceRub: unknown; totalRub: unknown; metadata?: unknown }) =>
    Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0 && Number.isFinite(Number(row.unitPriceRub)) &&
    Number(row.unitPriceRub) > 0 && Number.isFinite(Number(row.totalRub)) && Number(row.totalRub) > 0 &&
    record(row.metadata).priceRequiresConfirmation !== true;
  const line = (row: { description: string; serviceDate: Date; unit: string; quantity: { toString(): string }; unitPriceRub: { toString(): string }; totalRub: { toString(): string } }) => ({
    description: row.description, serviceDate: row.serviceDate.toISOString().slice(0, 10), unit: row.unit,
    quantity: row.quantity.toString(), unitPriceRub: row.unitPriceRub.toString(), totalRub: row.totalRub.toString(),
  });
  // FIX: existing invoices, including DRAFT, are immutable in this workflow.
  // Any overlap closes the selected client period; linked requests are protected across periods.
  const calendar = parseBillingPeriod(input.periodFrom, input.periodTo);
  const selectedClients = new Set(selected.map(r => r.clientId));
  const blockedClients = new Set<string>(), blockedRequests = new Set<string>();
  let alreadyBilledCount = 0;
  for (const i of invoices) {
    if (i.status === 'CANCELLED' || !selectedClients.has(i.clientId)) continue;
    const linked = new Set(i.items.flatMap(row => row.chargeId && chargeMap.get(row.chargeId)?.clientId === i.clientId
      ? [chargeMap.get(row.chargeId)!.requestId!] : []));
    if (i.requestId && requestMap.get(i.requestId)?.clientId === i.clientId) linked.add(i.requestId);
    const branch = i.warehouseId ?? i.request?.warehouseId;
    const overlap = (!branch || branch === warehouseId) && i.periodFrom <= calendar.to && i.periodTo >= calendar.from;
    if (!overlap && !linked.size) continue;
    alreadyBilledCount++;
    if (overlap) blockedClients.add(i.clientId);
    for (const id of linked) blockedRequests.add(id);
    issue(i.id, i.client.name, `Счёт ${i.number} уже сформирован (${i.periodFrom.toISOString().slice(0, 10)} — ${i.periodTo.toISOString().slice(0, 10)}). ${overlap ? 'Период этого клиента исключён из нового расчёта.' : 'Охваченные заявки исключены из нового расчёта.'} Существующий счёт не изменяется.`);
  }
  const chargedRequests = new Set(eligibleCharges.map(c => c.requestId));
  // A link can protect a request even if an inaccessible/inconsistent invoice was not loaded.
  for (const c of eligibleCharges) if (c.invoiceItems.some(link => link.invoice.status !== 'CANCELLED')) blockedRequests.add(c.requestId!);
  for (const r of selected) {
    if (!blockedClients.has(r.clientId) && !blockedRequests.has(r.id) && !chargedRequests.has(r.id))
      issue(r.id, r.client.name, `Заявка №${r.number}: нет начислений или сохранённого расчёта. Нужна проверка выполненных услуг и тарифов.`);
  }
  for (const c of eligibleCharges) {
    if (blockedClients.has(c.clientId) || blockedRequests.has(c.requestId!)) continue;
    if (c.status !== 'APPROVED' || !valid(c)) {
      issue(c.id, c.client.name, `Заявка №${requestMap.get(c.requestId!)!.number}: проверьте утверждение и тариф услуги «${c.description}».`); continue;
    }
    add(c.client, c.id, [{ ...line(c), sourceType: 'CHARGE', sourceId: c.id, chargeId: c.id }], [c.requestId!]);
  }
  const result = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const g of result) {
    g.chargeIds.sort(); g.invoiceIds.sort(); g.lines.sort((a, b) => `${a.sourceId}:${a.invoiceItemId ?? ''}`.localeCompare(`${b.sourceId}:${b.invoiceItemId ?? ''}`));
  }
  return { periodFrom: input.periodFrom, periodTo: input.periodTo, groups: result, issues, alreadyBilledCount, zeroCount: 0,
    requests: selected.map(r => ({ id: r.id, number: r.number, clientName: r.client.name,
      surrenderedAt: [...r.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt.toISOString() })),
    previewHash: createHash('sha256').update(JSON.stringify({ input, warehouseId, requests, charges, invoices, groups: result, issues })).digest('hex') };
}
