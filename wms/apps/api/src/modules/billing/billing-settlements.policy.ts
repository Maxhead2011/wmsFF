// FIX: read-only financial projection; drafts, issued debt and unbilled work never overlap.
import { correctedInvoiceBalance } from './billing-correction-balance';
type Money = string | number | { toString(): string };
type Client = { id: string; code: string; name: string };
type Request = { id?: string; number?: number; warehouseId: string | null };
type Charge = { id: string; clientId: string; client: Client; requestId?: string | null; request?: Request | null;
  status: string; description: string; quantity: Money; unitPriceRub: Money; totalRub: Money; serviceDate: Date;
  metadata?: unknown; service?: { code: string } | null; invoiceItems: Array<{ invoice: { id: string; status: string } }> };
type Invoice = { id: string; clientId: string; client: Client; warehouseId?: string | null; request?: Request | null;
  number: string; status: string; totalRub: Money; paidRub: Money; dueDate: Date | null;
  payments?: Array<{ id: string; paidAt: Date; amountRub: Money }>;
  items: Array<{ chargeId?: string | null; description: string; quantity: Money; unitPriceRub: Money; totalRub: Money; serviceDate: Date }> };
export type SettlementWork = { id: string; clientId: string; requestId: string; marketplace: string; connectionId: string;
  orderId: string; billingAttemptId?: string; itemCount: number; completedAt: Date };
export type SettlementLine = { id: string; kind: string; description: string; date: string; requestId?: string | null;
  requestNumber?: number; orderIds: string[]; marketplace?: string; connectionId?: string; billingAttemptId?: string;
  quantity?: string; unitPriceRub?: string; totalRub: number | null; invoices: Array<{ id: string; number: string; status: string }>;
  payments?: Array<{ id: string; date: string; amountRub: number }>; buckets: string[] };
type Issue = { id: string; clientId: string; clientName: string; warehouseId: string | null; code: string; reason: string;
  action: string; line: SettlementLine };
type Row = { client: Client; warehouseId: string | null; warehouseName: string; unbilledRub: number; draftRub: number;
  reviewRub: number; debtRub: number; overdueRub: number; clientAdvanceRub: number; clientCreditRub: number; missingWorkCount: number; lines: SettlementLine[] };
export function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []; }
function cents(value: Money) { const n = Math.round(Number(String(value)) * 100); return Number.isSafeInteger(n) ? n : null; }
function identity(clientId: string, marketplace: string, connectionId: string, orderId: string, attempt = '') {
  return JSON.stringify([clientId, marketplace, connectionId, orderId, attempt]);
}
export function buildSettlements(input: { warehouseId: string; warehouseName: string; from: Date; to: Date; now: Date;
  clients: Client[]; charges: Charge[]; invoices: Invoice[];
  coverageCharges?: Array<Pick<Charge, 'id' | 'clientId' | 'metadata' | 'service' | 'status'>>;
  advances: Array<{ id: string; clientId: string; amountRub: Money; paidAt: Date }>;
  work: SettlementWork[]; requests: Array<Request & { id: string }>; corrections?: Array<{ id: string; invoiceId: string; amountRub: unknown; reason: string; createdAt: Date }> }) {
  const rows = new Map<string, Row>(), issues: Issue[] = [];
  const clients = new Map(input.clients.map(c => [c.id, c]));
  const invoiceMap = new Map(input.invoices.map(i => [i.id, i]));
  const requestMap = new Map(input.requests.map(r => [r.id, r]));
  const coverage = new Map<string, Set<string>>(), ambiguous = new Set<string>();
  const row = (client: Client, warehouseId: string | null) => {
    const key = JSON.stringify([client.id, warehouseId]);
    if (!rows.has(key)) rows.set(key, { client, warehouseId, warehouseName: warehouseId ? input.warehouseName : 'Филиал не определён',
      unbilledRub: 0, draftRub: 0, reviewRub: 0, debtRub: 0, overdueRub: 0, clientAdvanceRub: 0, clientCreditRub: 0, missingWorkCount: 0, lines: [] });
    return rows.get(key)!;
  };
  const issue = (r: Row, line: SettlementLine, code: string, reason: string, action: string) => {
    issues.push({ id: `${line.id}:${code}`, clientId: r.client.id, clientName: r.client.name, warehouseId: r.warehouseId, code, reason, action, line });
    if (!line.buckets.includes('review')) line.buckets.push('review');
  };
  for (const client of input.clients) row(client, input.warehouseId);
  // FIX: historical FBS coverage needs identity only, not financial relations or period amounts.
  for (const c of input.coverageCharges ?? input.charges) {
    if (c.status === 'CANCELLED') continue;
    const m = record(c.metadata), ids = strings(Object.hasOwn(m, 'processingOrderIds') ? m.processingOrderIds : m.orderIds);
    const legacyIdentity = typeof m.shipmentKey === 'string' ? /^(WILDBERRIES|OZON):([^:]+):/.exec(m.shipmentKey) : null;
    const marketplace = typeof m.marketplace === 'string' ? m.marketplace : legacyIdentity?.[1];
    const connectionId = typeof m.connectionId === 'string' ? m.connectionId : legacyIdentity?.[2];
    // Only the processing service covers processing; primary/additional services do not.
    if (m.kind === 'FBS' || c.service?.code === 'FBS_PROCESSING') for (const orderId of ids) {
      if (marketplace && connectionId) {
        const key = identity(c.clientId, marketplace, connectionId, orderId, typeof m.billingAttemptId === 'string' ? m.billingAttemptId : '');
        const values = coverage.get(key) ?? new Set<string>(); values.add(c.id); coverage.set(key, values);
      } else ambiguous.add(JSON.stringify([c.clientId, orderId]));
    }
  }
  for (const c of input.charges) {
    if (c.status === 'CANCELLED') continue;
    const m = record(c.metadata);
    const legacyIdentity = typeof m.shipmentKey === 'string' ? /^(WILDBERRIES|OZON):([^:]+):/.exec(m.shipmentKey) : null;
    const marketplace = typeof m.marketplace === 'string' ? m.marketplace : legacyIdentity?.[1];
    const connectionId = typeof m.connectionId === 'string' ? m.connectionId : legacyIdentity?.[2];
    const branch = c.request?.warehouseId ?? (typeof m.warehouseId === 'string' ? m.warehouseId : null);
    if (branch && branch !== input.warehouseId) continue;
    if (c.serviceDate < input.from || c.serviceDate > input.to) continue;
    const r = row(c.client, branch), amount = cents(c.totalRub);
    const links = c.invoiceItems.filter(i => i.invoice.status !== 'CANCELLED');
    const line: SettlementLine = { id: c.id, kind: 'CHARGE', description: c.description, date: c.serviceDate.toISOString(),
      requestId: c.requestId, requestNumber: c.request?.number, orderIds: strings(m.orderIds),
      marketplace, connectionId,
      billingAttemptId: typeof m.billingAttemptId === 'string' ? m.billingAttemptId : undefined,
      quantity: String(c.quantity), unitPriceRub: String(c.unitPriceRub), totalRub: amount === null ? null : amount / 100,
      invoices: links.map(i => ({ ...i.invoice, number: invoiceMap.get(i.invoice.id)?.number ?? 'Счёт вне выбранного филиала' })), buckets: [] };
    r.lines.push(line);
    if (!branch) issue(r, line, 'UNKNOWN_BRANCH', 'Не определён филиал начисления.', 'Проверить заявку и источник начисления');
    if (amount === null || amount < 0 || !Number.isFinite(Number(c.quantity)) || Number(c.quantity) <= 0)
      issue(r, line, 'INVALID_AMOUNT', 'Некорректная сумма или количество.', 'Проверить количество и расчёт');
    if (!Number.isFinite(Number(c.unitPriceRub)) || Number(c.unitPriceRub) <= 0 || amount === 0)
      issue(r, line, 'ZERO_TARIFF', 'Тариф отсутствует или сумма нулевая.', 'Подтвердить тариф или бесплатную услугу');
    if (amount !== null && Math.abs(Math.round(Number(c.quantity) * Number(c.unitPriceRub) * 100) - amount) > 1)
      issue(r, line, 'AMOUNT_MISMATCH', 'Сумма отличается от количества × тарифа.', 'Проверить основание ручной суммы');
    if (links.length > 1) issue(r, line, 'DUPLICATE_INVOICE', 'Начисление включено в несколько активных строк счетов.', 'Проверить расшифровку счетов');
    if (c.status !== 'APPROVED' && !links.length) issue(r, line, 'NOT_APPROVED', 'Начисление не утверждено.', 'Проверить и утвердить в разделе «Начисления»');
    if (!links.length && line.buckets.includes('review')) r.reviewRub += Math.max(0, amount ?? 0);
    else if (!links.length && amount !== null) { r.unbilledRub += amount; line.buckets.push('unbilled'); }
  }
  for (const inv of input.invoices) {
    if (inv.status === 'CANCELLED') continue;
    const branch = inv.warehouseId ?? inv.request?.warehouseId ?? null;
    if (branch && branch !== input.warehouseId) continue;
    const amount = cents(inv.totalRub), paid = cents(inv.paidRub);
    const amendments = (input.corrections ?? []).filter(c => c.invoiceId === inv.id);
    const r = row(inv.client, branch);
    const inPeriod = inv.items.some(i => i.serviceDate >= input.from && i.serviceDate <= input.to);
    if (inv.status === 'DRAFT' && !inPeriod) continue;
    const line: SettlementLine = { id: inv.id, kind: 'INVOICE', description: `Счёт ${inv.number}`, date: inv.items[0]?.serviceDate.toISOString() ?? input.now.toISOString(),
      requestNumber: inv.request?.number, orderIds: [], totalRub: amount === null ? null : amount / 100,
      invoices: [{ id: inv.id, number: inv.number, status: inv.status }],
      payments: (inv.payments ?? []).map(p => ({ id: p.id, date: p.paidAt.toISOString(), amountRub: (cents(p.amountRub) ?? 0) / 100 })), buckets: [] };
    r.lines.push(line);
    if (!branch) { issue(r, line, 'UNKNOWN_BRANCH', 'Не определён филиал счёта.', 'Проверить источник счёта'); continue; }
    if (amount === null || paid === null || amount < 0 || paid < 0 || (!amendments.length && paid > amount)) {
      issue(r, line, 'INVALID_AMOUNT', 'Некорректная сумма счёта или оплаты.', 'Сверить счёт с оплатами'); continue;
    }
    const itemAmounts = inv.items.map(i => cents(i.totalRub));
    if (itemAmounts.some(n => n === null || n < 0) || itemAmounts.reduce<number>((sum, n) => sum + (n ?? 0), 0) !== amount)
      issue(r, line, 'INVOICE_AMOUNT_MISMATCH', 'Сумма счёта не совпадает с его строками.', 'Сверить строки и утверждённую сумму счёта');
    if (inv.payments && inv.payments.reduce((sum, p) => sum + (cents(p.amountRub) ?? 0), 0) !== paid)
      issue(r, line, 'PAYMENT_MISMATCH', 'Оплаченная сумма счёта не подтверждается записями оплат.', 'Сверить приход денег и статус счёта');
    if (inv.status === 'DRAFT') {
      // Count only the selected service dates; do not include an entire multi-period draft.
      const periodAmount = inv.items.filter(i => i.serviceDate >= input.from && i.serviceDate <= input.to).reduce((s, i) => s + (cents(i.totalRub) ?? 0), 0);
      line.date = inv.items.find(i => i.serviceDate >= input.from && i.serviceDate <= input.to)!.serviceDate.toISOString();
      r.draftRub += periodAmount; line.totalRub = periodAmount / 100; line.buckets.push('draft');
    } else if (inv.status !== 'PAID' || amendments.length) {
      const balance = amendments.length ? correctedInvoiceBalance(inv.totalRub, inv.paidRub, amendments.map(c => c.amountRub))
        : { remainingRub: (amount - paid) / 100, overpaymentRub: 0 };
      const remaining = Math.round(balance.remainingRub * 100);
      r.clientCreditRub += Math.round(balance.overpaymentRub * 100);
      if (balance.overpaymentRub > 0) { line.buckets.push('credit'); line.totalRub = balance.overpaymentRub; }
      r.debtRub += remaining; if (!balance.overpaymentRub) line.totalRub = remaining / 100; line.buckets.push('debt');
      const today = input.now.toISOString().slice(0, 10);
      if (remaining > 0 && inv.dueDate && inv.dueDate.toISOString().slice(0, 10) < today) {
        r.overdueRub += remaining; line.buckets.push('overdue');
      }
    }
    for (const c of amendments) r.lines.push({ id: c.id, kind: 'CORRECTION', description: `Корректировка: ${c.reason}`,
      date: c.createdAt.toISOString(), orderIds: [], totalRub: Number(c.amountRub), invoices: line.invoices, buckets: ['correction', 'debt', 'credit'] });
    // Keep invoice details attached to its projection without returning unrestricted metadata.
    for (const item of inv.items) r.lines.push({ id: `${inv.id}:${r.lines.length}`, kind: 'INVOICE_ITEM', description: item.description,
      date: item.serviceDate.toISOString(), orderIds: [], quantity: String(item.quantity), unitPriceRub: String(item.unitPriceRub),
      totalRub: (cents(item.totalRub) ?? 0) / 100, invoices: line.invoices, buckets: ['invoice-item'] });
  }
  const seen = new Set<string>();
  for (const w of input.work) {
    const request = requestMap.get(w.requestId), client = clients.get(w.clientId);
    if (!client || request?.warehouseId !== input.warehouseId || w.completedAt < input.from || w.completedAt > input.to) continue;
    const key = identity(w.clientId, w.marketplace, w.connectionId, w.orderId, w.billingAttemptId);
    if (seen.has(key)) continue; seen.add(key);
    const covered = coverage.get(key);
    if (covered?.size === 1) continue;
    const r = row(client, input.warehouseId);
    const line: SettlementLine = { id: w.id, kind: 'WORK', description: `Выполненная FBS-обработка заказа ${w.orderId}`,
      date: w.completedAt.toISOString(), requestId: w.requestId, requestNumber: request.number, orderIds: [w.orderId],
      marketplace: w.marketplace, connectionId: w.connectionId, billingAttemptId: w.billingAttemptId,
      quantity: String(w.itemCount), totalRub: null, invoices: [], buckets: [] };
    r.lines.push(line);
    if (covered && covered.size > 1) issue(r, line, 'DUPLICATE_WORK_CHARGE', 'Одна обработка указана в нескольких начислениях.', 'Сверить услуги и источники начислений');
    else if (ambiguous.has(JSON.stringify([w.clientId, w.orderId]))) issue(r, line, 'AMBIGUOUS_WORK_COVERAGE', 'Есть начисление без точного кабинета или попытки.', 'Сопоставить обработку с прежним начислением');
    else { r.missingWorkCount++; issue(r, line, 'WORK_WITHOUT_CHARGE', 'Обработка выполнена, начисление не найдено.', 'Проверить тариф и создать начисление после сверки'); }
  }
  for (const advance of input.advances) {
    const client = clients.get(advance.clientId); if (!client) continue;
    const r = row(client, input.warehouseId), amount = cents(advance.amountRub);
    if (amount === null || amount <= 0) continue;
    r.clientAdvanceRub += amount;
    r.lines.push({ id: advance.id, kind: 'ADVANCE', description: 'Аванс клиента — все филиалы', date: advance.paidAt.toISOString(),
      orderIds: [], totalRub: amount / 100, invoices: [], buckets: ['advance'] });
  }
  for (const r of rows.values()) for (const field of ['unbilledRub', 'draftRub', 'reviewRub', 'debtRub', 'overdueRub', 'clientAdvanceRub', 'clientCreditRub'] as const) {
    if (!Number.isSafeInteger(r[field])) throw new Error('Сумма превышает безопасный предел расчёта. Выберите одного клиента.');
    r[field] /= 100;
  }
  // FIX: settled clients, including archived ones, do not inflate the register; advances alone are not client debt.
  const reviewRows = new Set(issues.map(i => JSON.stringify([i.clientId, i.warehouseId])));
  const visibleRows = [...rows.values()].filter(r => r.debtRub > 0 || r.clientCreditRub > 0 || r.unbilledRub > 0 || r.draftRub > 0 ||
    r.reviewRub > 0 || r.missingWorkCount > 0 || reviewRows.has(JSON.stringify([r.client.id, r.warehouseId])));
  return { enabled: true as const, periodFrom: input.from.toISOString().slice(0, 10), periodTo: input.to.toISOString().slice(0, 10),
    warehouseId: input.warehouseId, warehouseName: input.warehouseName, calculatedAt: input.now.toISOString(),
    workCoverage: 'FBS_CONFIRMED_OPERATIONS' as const, rows: visibleRows.sort((a, b) => a.client.name.localeCompare(b.client.name, 'ru')), issues };
}
