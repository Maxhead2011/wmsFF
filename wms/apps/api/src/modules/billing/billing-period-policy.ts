import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { COMPLETED_WORK_POLICY } from './completed-fbs-billing';

// ADDED: shared registry/generation policy. No tariff calculation or stock writes.
export const BILLING_CATEGORIES = ['FBS', 'PROCESSING', 'PRR', 'STORAGE', 'OTHER'] as const;
export type BillingServiceCategory = typeof BILLING_CATEGORIES[number];
export type PeriodInput = { clientId?: string; periodFrom: string; periodTo: string; categories: BillingServiceCategory[]; excludeLukin?: boolean };
type Money = { toString(): string } | number | string;
type Client = { id: string; code: string; name: string; legalName?: string | null };
type CategorySource = { source?: string | null; metadata?: unknown; service?: { code: string } | null };
export type PeriodCharge = CategorySource & {
  id: string; clientId: string; client: Client; status: string; quantity: Money; unitPriceRub: Money; totalRub: Money;
  description: string; unit: string; serviceDate: Date; updatedAt: Date;
  request?: { warehouseId: string | null } | null;
  invoiceItems: Array<{ invoice: { id: string; status: string } }>;
};
export type PeriodInvoice = {
  id: string; number: string; clientId: string; client: Client; warehouseId: string | null;
  sourceKey?: string | null;
  request?: { warehouseId: string | null } | null; periodFrom: Date; periodTo: Date;
  status: string; paidRub: Money; totalRub: Money; payments: unknown[]; updatedAt: Date;
  items: Array<{ id: string; chargeId: string | null; charge?: CategorySource | null; description: string; unit: string;
    quantity: Money; unitPriceRub: Money; totalRub: Money; serviceDate: Date }>;
};
export type PeriodPreviewLine = {
  sourceType: 'CHARGE' | 'INVOICE'; sourceId: string; sourceNumber?: string;
  invoiceItemId?: string; chargeId?: string; description: string; serviceDate: string;
  unit: string; quantity: string; unitPriceRub: string; totalRub: string;
};
export function classifyBillingCharge(charge?: CategorySource | null): BillingServiceCategory {
  if (!charge) return 'OTHER';
  const kind = record(charge.metadata).kind;
  if (charge.source === 'STORAGE' || charge.service?.code === 'STORAGE_LITER_DAY') return 'STORAGE';
  if (kind === 'FBS_PRIMARY_PROCESSING') return 'PROCESSING';
  if (['PPR_BOXES', 'PPR_BAGS'].includes(charge.service?.code ?? '')) return 'PRR';
  if (kind === 'FBS' || kind === 'FBS_DAILY_LOGISTICS' || charge.service?.code === 'FBS_PROCESSING') return 'FBS';
  return 'OTHER';
}
export function classifyBillingInvoice(invoice: { items: Array<{ charge?: CategorySource | null }> }): BillingServiceCategory {
  const categories = new Set(invoice.items.map(item => classifyBillingCharge(item.charge)));
  return categories.size === 1 ? [...categories][0] : 'OTHER';
}
// FIX: recovery invoices may contain FBS processing and its primary/additional services.
// The period planner applies all financial/date/duplicate guards after this classification.
export function classifyBillingRegistryInvoice(invoice: {
  clientId: string; sourceKey?: string | null; items: Array<{ charge?: CategorySource | null }>;
}): BillingServiceCategory {
  const category = classifyBillingInvoice(invoice);
  if (category !== 'OTHER' || invoice.clientId !== 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9') return category;
  // FIX: preserve classification after consolidation, so a repeated preview reuses the result.
  const recoveredInvoice = invoice.sourceKey?.startsWith(`fbs-invoice:${invoice.clientId}:completed-work:`);
  const generatedPeriod = new RegExp(`^billing-period:[a-f0-9]{64}:FBS:${invoice.clientId}$`).test(invoice.sourceKey ?? '');
  if (!recoveredInvoice && !generatedPeriod) return category;
  const charges = invoice.items.map(item => ({ category: classifyBillingCharge(item.charge), metadata: record(item.charge?.metadata) }));
  const onlyFbsServices = charges.every(charge =>
    ((charge.metadata.kind === 'FBS' || generatedPeriod) && charge.category === 'FBS') ||
    (charge.metadata.kind === 'FBS_PRIMARY_PROCESSING' && charge.category === 'PROCESSING'));
  // Persisted provenance, not today's rollout flag: disabling creation must not hide existing invoices.
  const recoveredWork = charges.some(charge => charge.metadata.billingPolicy === COMPLETED_WORK_POLICY && charge.metadata.processingOnly === true);
  return onlyFbsServices && recoveredWork && charges.some(charge => charge.category === 'FBS') ? 'FBS' : category;
}
export function parseBillingPeriod(start: string, end: string) {
  const date = (value: string, endOfDay: boolean) => {
    const calendarDate = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Укажите существующие календарные даты в формате ГГГГ-ММ-ДД.');
    }
    // FIX: billing service dates are historical calendar values encoded in UTC.
    // Existing writers and the invoice editor preserve these date components.
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  };
  const from = date(start, false), to = date(end, true);
  if (from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Выберите период от одного дня до года.');
  return { from, to };
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function buildPeriodPlan(input: PeriodInput, charges: PeriodCharge[], invoices: PeriodInvoice[], warehouseId: string) {
  const { from, to } = parseBillingPeriod(input.periodFrom, input.periodTo);
  const groups = new Map<string, { key: string; clientId: string; clientName: string; warehouseId: string;
    category: BillingServiceCategory; chargeIds: string[]; invoiceIds: string[]; totalRub: number; itemCount: number;
    action: 'CREATE' | 'EXISTING'; existingInvoiceId?: string; lines: PeriodPreviewLine[] }>();
  const issues: Array<{ id: string; clientName: string; message: string }> = [];
  let alreadyBilledCount = 0, zeroCount = 0;
  const eligibleClient = (c: Client) => (!input.clientId || input.clientId === c.id) &&
    !(input.excludeLukin && /лукин/i.test(`${c.name} ${c.legalName ?? ''}`));
  const issue = (id: string, c: Client, message: string) => issues.push({ id, clientName: c.name, message });
  const add = (c: Client, category: BillingServiceCategory, total: number, count: number, id: string, invoice: boolean, lines: PeriodPreviewLine[]) => {
    const key = `${c.id}:${warehouseId}:${category}`;
    const group: NonNullable<ReturnType<typeof groups.get>> = groups.get(key) ?? { key, clientId: c.id, clientName: c.name, warehouseId, category, chargeIds: [], invoiceIds: [], totalRub: 0, itemCount: 0, action: 'CREATE', lines: [] };
    group[invoice ? 'invoiceIds' : 'chargeIds'].push(id);
    group.totalRub = Math.round((group.totalRub + total) * 100) / 100;
    group.itemCount += count;
    group.lines.push(...lines);
    groups.set(key, group);
  };
  const sourceCounts = new Map<string, number>();
  for (const invoice of invoices.filter(i => i.status !== 'CANCELLED')) {
    for (const item of invoice.items) if (item.chargeId) sourceCounts.set(item.chargeId, (sourceCounts.get(item.chargeId) ?? 0) + 1);
  }
  for (const c of charges) {
    if (!eligibleClient(c.client) || c.serviceDate < from || c.serviceDate > to || c.status === 'CANCELLED') continue;
    if (c.invoiceItems.some(i => i.invoice.status !== 'CANCELLED')) continue;
    const branch = c.request?.warehouseId ?? record(c.metadata).warehouseId;
    if (branch && branch !== warehouseId) continue;
    const category = classifyBillingCharge(c);
    if (category !== 'OTHER' && !input.categories.includes(category)) continue;
    if (!branch) { issue(c.id, c.client, 'Не определён филиал начисления. Уточните источник; текущий филиал не подставляется автоматически.'); continue; }
    if (category === 'OTHER') { issue(c.id, c.client, `Не определён вид услуги: ${c.description}.`); continue; }
    if (c.status !== 'APPROVED') { issue(c.id, c.client, `Не утверждено начисление: ${c.description}.`); continue; }
    const total = Number(c.totalRub);
    if (!Number.isFinite(total) || total < 0 || (total === 0 && Number(c.quantity) > 0)) {
      issue(c.id, c.client, `Требуется проверка суммы/нулевого тарифа: ${c.description}.`); continue;
    }
    if (total === 0) { zeroCount++; continue; }
    const meta = record(c.metadata);
    if (category === 'STORAGE' && (typeof meta.periodFrom !== 'string' || typeof meta.periodTo !== 'string' ||
      meta.periodFrom < input.periodFrom || meta.periodTo > input.periodTo)) {
      issue(c.id, c.client, 'Проверьте период начисления хранения: нельзя включить целый период в его часть.'); continue;
    }
    add(c.client, category, total, 1, c.id, false, [{ sourceType: 'CHARGE', sourceId: c.id, chargeId: c.id,
      description: c.description, serviceDate: c.serviceDate.toISOString().slice(0, 10), unit: c.unit,
      quantity: c.quantity.toString(), unitPriceRub: c.unitPriceRub.toString(), totalRub: c.totalRub.toString() }]);
  }
  for (const inv of invoices) {
    if (!eligibleClient(inv.client) || inv.status === 'CANCELLED') continue;
    const branch = inv.warehouseId ?? inv.request?.warehouseId;
    if (branch && branch !== warehouseId) continue;
    // FIX: include proven recovered FBS bundles without recalculation or new charge creation.
    const category = classifyBillingRegistryInvoice(inv);
    if (category !== 'OTHER' && !input.categories.includes(category)) continue;
    if (inv.status !== 'DRAFT' || Number(inv.paidRub) !== 0 || inv.payments.length) { alreadyBilledCount++; continue; }
    if (!branch || category === 'OTHER' || !inv.items.length) { issue(inv.id, inv.client, `Счёт ${inv.number}: не определён филиал или смешанные/неопределённые услуги.`); continue; }
    if (inv.periodFrom < from || inv.periodTo > to || inv.items.some(i => i.serviceDate < from || i.serviceDate > to)) {
      issue(inv.id, inv.client, `Счёт ${inv.number} выходит за выбранный период. Автоматическое разделение запрещено.`); continue;
    }
    if (inv.items.some(i => i.chargeId && (sourceCounts.get(i.chargeId) ?? 0) > 1)) {
      issue(inv.id, inv.client, `Счёт ${inv.number}: источник начисления повторяется в нескольких строках/счетах.`); continue;
    }
    // FIX: the invoice total cannot establish a tariff for each performed service.
    // No explicit free-service evidence exists in this snapshot contract; flag for review.
    const unresolvedTariffs = inv.items.filter(item => Number(item.quantity) > 0 &&
      (Number(item.unitPriceRub) <= 0 || Number(item.totalRub) <= 0));
    if (unresolvedTariffs.length) {
      for (const item of unresolvedTariffs) issue(inv.id, inv.client, `Счёт ${inv.number}: требуется проверка суммы/нулевого тарифа: ${item.description}.`);
      continue;
    }
    const total = Number(inv.totalRub);
    const rowTotal = Math.round(inv.items.reduce((n, i) => n + Number(i.totalRub), 0) * 100) / 100;
    if (!Number.isFinite(total) || total < 0 || Math.abs(total - rowTotal) > 0.005) { issue(inv.id, inv.client, `Счёт ${inv.number}: сумма не совпадает со строками.`); continue; }
    if (total === 0) { zeroCount++; continue; }
    add(inv.client, category, total, inv.items.length, inv.id, true, inv.items.map(item => ({
      sourceType: 'INVOICE', sourceId: inv.id, sourceNumber: inv.number, invoiceItemId: item.id,
      chargeId: item.chargeId ?? undefined, description: item.description, serviceDate: item.serviceDate.toISOString().slice(0, 10),
      unit: item.unit, quantity: item.quantity.toString(), unitPriceRub: item.unitPriceRub.toString(), totalRub: item.totalRub.toString(),
    })));
  }
  const result = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const g of result) {
    g.chargeIds.sort(); g.invoiceIds.sort();
    g.lines.sort((a, b) => `${a.sourceId}:${a.invoiceItemId ?? ''}`.localeCompare(`${b.sourceId}:${b.invoiceItemId ?? ''}`));
    const onlyInvoice = g.invoiceIds.length === 1 && !g.chargeIds.length ? invoices.find(invoice => invoice.id === g.invoiceIds[0]) : undefined;
    if (onlyInvoice && onlyInvoice.periodFrom.toISOString().slice(0, 10) === input.periodFrom && onlyInvoice.periodTo.toISOString().slice(0, 10) === input.periodTo) {
      g.action = 'EXISTING'; g.existingInvoiceId = onlyInvoice.id;
    }
  }
  // FIX: bind confirmation to source snapshots as well as visible totals.
  const fingerprint = { input: { ...input, categories: [...input.categories].sort() }, warehouseId,
    charges: [...charges].sort((a, b) => a.id.localeCompare(b.id)).map(charge => ({ ...charge, invoiceItems: [...charge.invoiceItems].sort((a, b) => a.invoice.id.localeCompare(b.invoice.id)) })),
    invoices: [...invoices].sort((a, b) => a.id.localeCompare(b.id)).map(invoice => ({ ...invoice, items: [...invoice.items].sort((a, b) => a.id.localeCompare(b.id)) })), groups: result };
  return { periodFrom: input.periodFrom, periodTo: input.periodTo, groups: result, issues, alreadyBilledCount, zeroCount,
    previewHash: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex') };
}
