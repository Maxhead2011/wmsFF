import { AlertTriangle, CalendarClock, HandCoins, ReceiptText, WalletCards } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BillingReconciliation, BillingReconciliationClient } from '../../lib/api';
import { billingInvoiceStatusLabel, billingInvoiceStatusTone } from './billingMeta';
import './billing.css';

type BillingReconciliationPanelProps = {
  report: BillingReconciliation | null;
  clientId?: string;
  title?: string;
};

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});

export function BillingReconciliationPanel({
  report,
  clientId,
  title = 'Сверка и задолженность',
}: BillingReconciliationPanelProps) {
  const clients = report?.clients.filter((item) => !clientId || item.client.id === clientId) ?? [];
  const totals = buildTotals(clients);

  return (
    <section className="billing-reconciliation" aria-label={title}>
      <div className="billing-reconciliation__heading">
        <div>
          <h3>{title}</h3>
          <span>{report ? `Обновлено ${formatDateTime(report.generatedAt)}` : 'Нет данных'}</span>
        </div>
      </div>

      <div className="billing-reconciliation__metrics">
        <ReconciliationMetric icon={ReceiptText} label="Выставлено" value={`${formatMoney(totals.totalRub)} ₽`} />
        <ReconciliationMetric icon={WalletCards} label="Оплачено" value={`${formatMoney(totals.paidRub)} ₽`} />
        <ReconciliationMetric icon={HandCoins} label="Аванс" value={`${formatMoney(totals.advanceRub)} ₽`} />
        <ReconciliationMetric icon={CalendarClock} label="К оплате" value={`${formatMoney(totals.debtRub)} ₽`} />
        <ReconciliationMetric icon={AlertTriangle} label="Просрочено" value={`${formatMoney(totals.overdueRub)} ₽`} />
      </div>

      {clients.length > 0 ? (
        <div className="billing-reconciliation__clients">
          {clients.map((client) => (
            <ClientDebtCard key={client.client.id} item={client} />
          ))}
        </div>
      ) : (
        <p className="panel-message">Открытой задолженности по выбранным условиям нет.</p>
      )}
    </section>
  );
}

function ReconciliationMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="billing-reconciliation-metric">
      <Icon size={20} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function ClientDebtCard({ item }: { item: BillingReconciliationClient }) {
  const visibleInvoices = item.invoices.filter((invoice) => invoice.remainingRub > 0).slice(0, 3);

  return (
    <article className="billing-reconciliation-client">
      <div className="billing-reconciliation-client__summary">
        <div>
          <span>{item.client.code}</span>
          <strong>{item.client.name}</strong>
        </div>
        <div>
          <strong>{formatMoney(item.debtRub)} ₽</strong>
          <span>долг, {numberFormatter.format(item.openInvoicesCount)} счетов</span>
        </div>
        <div>
          <strong>{formatMoney(item.advanceRub)} ₽</strong>
          <span>{item.creditRub > 0 ? `остаток аванса ${formatMoney(item.creditRub)} ₽` : 'учтено в общем долге'}</span>
        </div>
        <div>
          <strong>{formatMoney(item.overdueRub)} ₽</strong>
          <span>просрочка, {numberFormatter.format(item.overdueInvoicesCount)} счетов</span>
        </div>
        <div>
          <strong>{item.nearestDueDate ? formatDate(item.nearestDueDate) : '-'}</strong>
          <span>ближайший срок</span>
        </div>
      </div>

      {visibleInvoices.length > 0 ? (
        <div className="billing-reconciliation-invoices">
          {visibleInvoices.map((invoice) => (
            <div key={invoice.id} className="billing-reconciliation-invoice">
              <div>
                <strong>{invoice.number}</strong>
                <span>
                  {formatDate(invoice.periodFrom)} - {formatDate(invoice.periodTo)}
                </span>
              </div>
              <div>
                <strong>{formatMoney(invoice.remainingRub)} ₽</strong>
                <span>{invoice.dueDate ? `до ${formatDate(invoice.dueDate)}` : 'без срока'}</span>
              </div>
              <span className={`status status--${billingInvoiceStatusTone(invoice.status)}`}>
                {billingInvoiceStatusLabel(invoice.status)}
              </span>
              {invoice.overdueDays > 0 ? <span className="status status--danger">{invoice.overdueDays} дн.</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="billing-reconciliation-client__empty">Нет открытых счетов.</p>
      )}
    </article>
  );
}

function buildTotals(items: BillingReconciliationClient[]) {
  return items.reduce(
    (totals, item) => ({
      totalRub: roundMoney(totals.totalRub + item.totalRub),
      paidRub: roundMoney(totals.paidRub + item.paidRub),
      advanceRub: roundMoney(totals.advanceRub + item.advanceRub),
      debtRub: roundMoney(totals.debtRub + item.debtRub),
      overdueRub: roundMoney(totals.overdueRub + item.overdueRub),
    }),
    { totalRub: 0, paidRub: 0, advanceRub: 0, debtRub: 0, overdueRub: 0 },
  );
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '-';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
