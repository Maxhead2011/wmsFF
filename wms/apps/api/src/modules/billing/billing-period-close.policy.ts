import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { parseBillingPeriod, record, type PeriodCharge, type PeriodInvoice } from './billing-period-policy';

export type PeriodCloseIssue = { code: string; sourceId: string; reason: string };
// FIX: readiness is independent of receivables; closing must never pretend that issued debt has been paid.
export function buildPeriodClosePlan(input: { clientId: string; warehouseId: string; periodFrom: string; periodTo: string },
  charges: PeriodCharge[], invoices: PeriodInvoice[], unresolved: PeriodCloseIssue[] = []) {
  if (!input.clientId || !input.warehouseId) throw new BadRequestException('Выберите клиента и филиал для закрытия периода.');
  const { from, to } = parseBillingPeriod(input.periodFrom, input.periodTo), issues = [...unresolved];
  const intersects = (a: Date, b: Date) => a <= to && b >= from;
  const selectedInvoices = invoices.filter(i => i.clientId === input.clientId && i.status !== 'CANCELLED' &&
    (intersects(i.periodFrom, i.periodTo) || i.items.some(l => intersects(l.serviceDate, l.serviceDate))));
  const ownInvoices = selectedInvoices.filter(i => {
    const branch = i.warehouseId ?? i.request?.warehouseId;
    if (!branch) issues.push({ code: 'UNKNOWN_BRANCH', sourceId: i.id, reason: 'Не определён филиал счёта.' });
    return branch === input.warehouseId;
  });
  const invoiceSources = new Map<string, number>();
  for (const i of ownInvoices) for (const line of i.items) if (line.chargeId)
    invoiceSources.set(line.chargeId, (invoiceSources.get(line.chargeId) ?? 0) + 1);
  for (const i of ownInvoices) {
    if (!['ISSUED', 'PAID'].includes(i.status)) issues.push({ code: 'DRAFT_INVOICE', sourceId: i.id, reason: `Счёт ${i.number} ещё не выставлен.` });
    const amounts = i.items.map(l => minor(l.totalRub));
    if ((minor(i.totalRub) ?? 0) <= 0 || amounts.some(n => n === null) || amounts.reduce<number>((s, n) => s + (n ?? 0), 0) !== minor(i.totalRub) ||
      i.items.some(l => !Number.isFinite(Number(l.quantity)) || Number(l.quantity) <= 0 || (minor(l.unitPriceRub) ?? 0) <= 0))
      issues.push({ code: 'INVALID_INVOICE', sourceId: i.id, reason: `Сумма счёта ${i.number} не совпадает с детализацией.` });
    if (i.items.some(l => l.chargeId && invoiceSources.get(l.chargeId)! > 1))
      issues.push({ code: 'DUPLICATE_CHARGE', sourceId: i.id, reason: `В счёте ${i.number} повторно выставлено одно начисление.` });
  }
  const invoiceMap = new Map(ownInvoices.map(i => [i.id, i]));
  for (const c of charges.filter(c => c.clientId === input.clientId && c.status !== 'CANCELLED' && intersects(c.serviceDate, c.serviceDate))) {
    const branch = c.request?.warehouseId ?? record(c.metadata).warehouseId;
    if (!branch) { issues.push({ code: 'UNKNOWN_BRANCH', sourceId: c.id, reason: 'Не определён филиал начисления.' }); continue; }
    if (branch !== input.warehouseId) continue;
    const links = c.invoiceItems.filter(l => l.invoice.status !== 'CANCELLED');
    if (links.length !== 1 || !['ISSUED', 'PAID'].includes(links[0].invoice.status) || !invoiceMap.get(links[0].invoice.id)?.items.some(l => l.chargeId === c.id))
      issues.push({ code: 'UNFINISHED_CHARGE', sourceId: c.id, reason: 'Услуга не включена однозначно в выставленный счёт.' });
  }
  const snapshots = ownInvoices.filter(i => ['ISSUED', 'PAID'].includes(i.status)).sort((a, b) => a.id.localeCompare(b.id)).map(i => ({
    id: i.id, number: i.number, clientId: i.clientId, warehouseId: input.warehouseId, periodFrom: i.periodFrom.toISOString(), periodTo: i.periodTo.toISOString(),
    totalRub: String(i.totalRub), items: [...i.items].sort((a, b) => a.id.localeCompare(b.id)).map(l => ({ id: l.id, chargeId: l.chargeId,
      description: l.description, unit: l.unit, quantity: String(l.quantity), unitPriceRub: String(l.unitPriceRub), totalRub: String(l.totalRub), serviceDate: l.serviceDate.toISOString() })),
  }));
  issues.sort((a, b) => `${a.sourceId}:${a.code}`.localeCompare(`${b.sourceId}:${b.code}`));
  // Payments are deliberately outside the frozen service snapshot and do not invalidate its confirmation.
  const previewHash = createHash('sha256').update(JSON.stringify({ ...input, snapshots, issues })).digest('hex');
  return { ...input, canClose: issues.length === 0, issues, snapshots, previewHash };
}
function minor(value: { toString(): string } | string | number) {
  const s = String(value); if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.'), n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(n) ? n : null;
}
