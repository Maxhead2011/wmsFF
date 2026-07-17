import { useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Download, FileText, ListChecks, Printer, ReceiptText, WalletCards } from 'lucide-react';
import { downloadBillingInvoiceActPdf, type BillingChargeSource, type BillingChargeSummary, type BillingInvoiceSummary } from '../../lib/api';
import { billingSourceLabel, formatCabinetDate, formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';

type ClientCabinetPeriodSummaryProps = {
  accessToken: string;
  invoices: BillingInvoiceSummary[];
  charges: BillingChargeSummary[];
};

type PeriodGroup = {
  key: string;
  label: string;
  chargesCount: number;
  invoicesCount: number;
  paymentsCount: number;
  chargesRub: number;
  invoicesRub: number;
  paidRub: number;
  debtRub: number;
  documentsCount: number;
  charges: BillingChargeSummary[];
  invoices: BillingInvoiceSummary[];
  payments: PeriodPayment[];
  services: PeriodServiceGroup[];
};

type PeriodPayment = {
  id: string;
  invoiceNumber: string;
  paidAt: string;
  amountRub: string | number;
  method: string | null;
  reference: string | null;
};

type PeriodServiceGroup = {
  key: string;
  title: string;
  source: BillingChargeSource;
  chargesCount: number;
  quantity: number;
  totalRub: number;
};

type OperationFilter = 'all' | 'services' | 'invoices' | 'acts' | 'payments';

const periodFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

const operationFilters: Array<{ key: OperationFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'services', label: 'Услуги' },
  { key: 'invoices', label: 'Счета' },
  { key: 'acts', label: 'Акты' },
  { key: 'payments', label: 'Оплаты' },
];

export function ClientCabinetPeriodSummary({ accessToken, invoices, charges }: ClientCabinetPeriodSummaryProps) {
  const periods = useMemo(() => buildPeriodGroups(invoices, charges), [invoices, charges]);
  const [selectedKey, setSelectedKey] = useState('');
  const selectedPeriod = periods.find((period) => period.key === selectedKey) ?? periods[0] ?? null;

  return (
    <section className="client-period-summary" aria-label="Периоды клиента">
      <div className="client-cabinet-section__heading">
        <h3>Периоды</h3>
        <span className="status status--planned">{periods.length} периодов</span>
      </div>

      {periods.length === 0 ? (
        <p className="panel-message">Периодной детализации пока нет.</p>
      ) : (
        <>
          <div className="client-period-summary-list">
            {periods.slice(0, 10).map((period) => (
              <button
                className={`client-period-summary-item${period.key === selectedPeriod?.key ? ' is-active' : ''}`}
                key={period.key}
                type="button"
                onClick={() => setSelectedKey(period.key)}
              >
                <CalendarDays size={18} aria-hidden="true" />
                <div className="client-period-summary-item__title">
                  <strong>{period.label}</strong>
                  <span>
                    {period.chargesCount} начисл. · {period.invoicesCount} счетов · {period.paymentsCount} оплат
                  </span>
                </div>
                <div className="client-period-summary-item__money">
                  <span>Услуги</span>
                  <strong>{formatCabinetMoney(period.chargesRub)} ₽</strong>
                </div>
                <div className="client-period-summary-item__money">
                  <span>Счета</span>
                  <strong>{formatCabinetMoney(period.invoicesRub)} ₽</strong>
                  <small>оплачено {formatCabinetMoney(period.paidRub)} ₽</small>
                </div>
                <div className="client-period-summary-item__money">
                  <span>Долг</span>
                  <strong>{formatCabinetMoney(period.debtRub)} ₽</strong>
                  <small>{formatCabinetNumber(period.documentsCount)} док.</small>
                </div>
                <FileText size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
          {selectedPeriod ? <ClientCabinetPeriodDetails accessToken={accessToken} period={selectedPeriod} /> : null}
        </>
      )}
    </section>
  );
}

function ClientCabinetPeriodDetails({ accessToken, period }: { accessToken: string; period: PeriodGroup }) {
  const [operationFilter, setOperationFilter] = useState<OperationFilter>('all');
  const [downloadingActId, setDownloadingActId] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const showServices = operationFilter === 'all' || operationFilter === 'services';
  const showInvoices = operationFilter === 'all' || operationFilter === 'invoices';
  const showActs = operationFilter === 'all' || operationFilter === 'acts';
  const showPayments = operationFilter === 'all' || operationFilter === 'payments';
  const filteredRowsCount = useMemo(
    () => buildPeriodExportRows(period, operationFilter).length - 1,
    [period, operationFilter],
  );

  async function downloadAct(invoice: BillingInvoiceSummary) {
    setDownloadError('');
    if (!isInvoicePaid(invoice)) {
      setDownloadError(`Акт по счету № ${invoice.number} будет доступен после оплаты.`);
      return;
    }

    setDownloadingActId(invoice.id);
    try {
      const blob = await downloadBillingInvoiceActPdf(accessToken, invoice.id);
      downloadBlobFile(blob, `Акт_${safeFileName(actNumber(invoice.number))}.pdf`);
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать акт.');
    } finally {
      setDownloadingActId('');
    }
  }

  return (
    <div className="client-period-detail" aria-label={`Детализация ${period.label}`}>
      <div className="client-period-detail__heading">
        <div>
          <span>Выбранный период</span>
          <strong>{period.label}</strong>
        </div>
        <div>
          <span>Документы и операции</span>
          <strong>{formatCabinetNumber(period.documentsCount)}</strong>
        </div>
      </div>

      <div className="client-period-detail-actions" aria-label="Действия периода">
        <div className="client-period-filter" role="group" aria-label="Фильтр операций периода">
          {operationFilters.map((filter) => (
            <button
              className={filter.key === operationFilter ? 'is-active' : ''}
              key={filter.key}
              type="button"
              onClick={() => setOperationFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="client-period-detail-buttons">
          <button
            type="button"
            onClick={() => downloadPeriodCsv(period, operationFilter)}
            disabled={filteredRowsCount === 0}
          >
            <Download size={16} aria-hidden="true" />
            CSV периода
          </button>
          <button
            type="button"
            onClick={() => downloadPeriodPackage(period, operationFilter)}
            disabled={filteredRowsCount === 0}
          >
            <Printer size={16} aria-hidden="true" />
            Пакет периода
          </button>
        </div>
      </div>
      {downloadError ? <p className="form-error">{downloadError}</p> : null}

      <div className="client-period-detail-grid">
        {showServices ? (
          <PeriodDetailColumn
            icon={<ListChecks size={17} aria-hidden="true" />}
            title="Оказанные услуги"
            emptyText="Начислений за период нет."
          >
            {period.services.map((service) => (
              <div className="client-period-detail-row" key={service.key}>
                <div>
                  <strong>{service.title}</strong>
                  <span>
                    {service.chargesCount} начисл. · {billingSourceLabel(service.source)} · кол-во {formatCabinetNumber(service.quantity)}
                  </span>
                </div>
                <strong>{formatCabinetMoney(service.totalRub)} ₽</strong>
              </div>
            ))}
          </PeriodDetailColumn>
        ) : null}

        {showInvoices ? (
          <PeriodDetailColumn
            icon={<ReceiptText size={17} aria-hidden="true" />}
            title="Счета"
            emptyText="Счетов за период нет."
          >
            {period.invoices.map((invoice) => (
              <div className="client-period-detail-row" key={invoice.id}>
                <div>
                  <strong>Счет № {invoice.number}</strong>
                  <span>
                    {formatCabinetDate(invoice.periodFrom)} - {formatCabinetDate(invoice.periodTo)} · {invoice.items.length} поз.
                  </span>
                </div>
                <strong>{formatCabinetMoney(invoice.totalRub)} ₽</strong>
              </div>
            ))}
          </PeriodDetailColumn>
        ) : null}

        {showActs ? (
          <PeriodDetailColumn
            icon={<FileText size={17} aria-hidden="true" />}
            title="Акты"
            emptyText="Актов за период нет."
          >
            {period.invoices.map((invoice) => {
              const isPaid = isInvoicePaid(invoice);

              return (
                <div className="client-period-detail-row client-period-detail-row--action" key={invoice.id}>
                  <div>
                    <strong>Акт № {actNumber(invoice.number)}</strong>
                    <span>
                      счет № {invoice.number} · {isPaid ? 'доступен для скачивания' : 'доступен после оплаты'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void downloadAct(invoice)}
                    disabled={!isPaid || downloadingActId === invoice.id}
                    title={isPaid ? 'Скачать акт PDF' : 'Оплатите счет, чтобы скачать акт'}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>{downloadingActId === invoice.id ? 'Скачиваю' : 'Скачать'}</span>
                  </button>
                </div>
              );
            })}
          </PeriodDetailColumn>
        ) : null}

        {showPayments ? (
          <PeriodDetailColumn
            icon={<WalletCards size={17} aria-hidden="true" />}
            title="Оплаты и долг"
            emptyText="Оплат за период нет."
          >
            {period.payments.map((payment) => (
              <div className="client-period-detail-row" key={payment.id}>
                <div>
                  <strong>{formatCabinetDate(payment.paidAt)}</strong>
                  <span>
                    счет № {payment.invoiceNumber}
                    {payment.method ? ` · ${payment.method}` : ''}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                </div>
                <strong>{formatCabinetMoney(payment.amountRub)} ₽</strong>
              </div>
            ))}
            <div className="client-period-detail-row client-period-detail-row--total">
              <div>
                <strong>Остаток долга</strong>
                <span>после учтенных оплат</span>
              </div>
              <strong>{formatCabinetMoney(period.debtRub)} ₽</strong>
            </div>
          </PeriodDetailColumn>
        ) : null}
      </div>
    </div>
  );
}

function PeriodDetailColumn({
  icon,
  title,
  emptyText,
  children,
}: {
  icon: ReactNode;
  title: string;
  emptyText: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];

  return (
    <div className="client-period-detail-column">
      <div className="client-period-detail-column__title">
        {icon}
        <strong>{title}</strong>
      </div>
      {items.length > 0 ? children : <p className="client-period-detail-empty">{emptyText}</p>}
    </div>
  );
}

function buildPeriodGroups(invoices: BillingInvoiceSummary[], charges: BillingChargeSummary[]) {
  const groups = new Map<string, PeriodGroup>();

  charges.forEach((charge) => {
    const group = ensurePeriod(groups, charge.serviceDate);
    group.chargesCount += 1;
    group.chargesRub += Number(charge.totalRub);
    group.documentsCount += 1;
    group.charges.push(charge);
  });

  invoices.forEach((invoice) => {
    const group = ensurePeriod(groups, invoice.periodFrom);
    group.invoicesCount += 1;
    group.paymentsCount += invoice.payments.length;
    group.invoicesRub += Number(invoice.totalRub);
    group.paidRub += Number(invoice.paidRub);
    group.debtRub += Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
    group.documentsCount += 2 + invoice.payments.length;
    group.invoices.push(invoice);
    invoice.payments.forEach((payment) => {
      group.payments.push({
        id: payment.id,
        invoiceNumber: invoice.number,
        paidAt: payment.paidAt,
        amountRub: payment.amountRub,
        method: payment.method,
        reference: payment.reference,
      });
    });
  });

  groups.forEach((group) => {
    group.services = buildServiceGroups(group.charges);
    group.invoices.sort((left, right) => right.periodFrom.localeCompare(left.periodFrom));
    group.payments.sort((left, right) => right.paidAt.localeCompare(left.paidAt));
  });

  return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}

function ensurePeriod(groups: Map<string, PeriodGroup>, dateValue: string) {
  const key = periodKey(dateValue);
  const current = groups.get(key);
  if (current) {
    return current;
  }

  const created: PeriodGroup = {
    key,
    label: periodFormatter.format(new Date(`${key}-01T00:00:00.000Z`)),
    chargesCount: 0,
    invoicesCount: 0,
    paymentsCount: 0,
    chargesRub: 0,
    invoicesRub: 0,
    paidRub: 0,
    debtRub: 0,
    documentsCount: 0,
    charges: [],
    invoices: [],
    payments: [],
    services: [],
  };
  groups.set(key, created);
  return created;
}

function buildServiceGroups(charges: BillingChargeSummary[]) {
  const services = new Map<string, PeriodServiceGroup>();

  charges.forEach((charge) => {
    const serviceKey = `${charge.service?.id ?? charge.serviceId ?? charge.source}:${charge.source}:${charge.unit}`;
    const current = services.get(serviceKey);
    const quantity = Number(charge.quantity);
    const totalRub = Number(charge.totalRub);

    if (!current) {
      services.set(serviceKey, {
        key: serviceKey,
        title: charge.service?.name ?? charge.description,
        source: charge.source,
        chargesCount: 1,
        quantity,
        totalRub,
      });
      return;
    }

    current.chargesCount += 1;
    current.quantity += quantity;
    current.totalRub += totalRub;
  });

  return [...services.values()].sort((left, right) => right.totalRub - left.totalRub);
}

function periodKey(dateValue: string) {
  return dateValue.slice(0, 7);
}

function downloadPeriodCsv(period: PeriodGroup, filter: OperationFilter) {
  const rows = buildPeriodExportRows(period, filter);
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\n');
  downloadTextFile(`period-${period.key}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

function downloadPeriodPackage(period: PeriodGroup, filter: OperationFilter) {
  const rows = buildPeriodExportRows(period, filter);
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Пакет периода ${escapeHtml(period.label)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 24px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p { margin: 0 0 16px; color: #667085; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d7dde8; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f4f6f9; }
    .total { margin-top: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Пакет документов за период: ${escapeHtml(period.label)}</h1>
  <p>Счета, акты, услуги и оплаты по выбранному фильтру.</p>
  <table>
    <thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>
    <tbody>${rows
      .slice(1)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table>
  <div class="total">Итого услуг: ${formatCabinetMoney(period.chargesRub)} ₽ · Счета: ${formatCabinetMoney(
    period.invoicesRub,
  )} ₽ · Оплачено: ${formatCabinetMoney(period.paidRub)} ₽ · Долг: ${formatCabinetMoney(period.debtRub)} ₽</div>
</body>
</html>`;
  downloadTextFile(`period-${period.key}-${filter}.html`, html, 'text/html;charset=utf-8');
}

function buildPeriodExportRows(period: PeriodGroup, filter: OperationFilter) {
  const rows = [['Тип', 'Дата', 'Документ', 'Описание', 'Количество', 'Сумма, ₽']];

  if (filter === 'all' || filter === 'services') {
    period.charges.forEach((charge) => {
      rows.push([
        'Услуга',
        formatCabinetDate(charge.serviceDate),
        charge.service?.name ?? charge.description,
        charge.comment ?? charge.description,
        formatCabinetNumber(Number(charge.quantity)),
        formatCabinetMoney(charge.totalRub),
      ]);
    });
  }

  if (filter === 'all' || filter === 'invoices') {
    period.invoices.forEach((invoice) => {
      rows.push([
        'Счет',
        `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`,
        `Счет № ${invoice.number}`,
        `${invoice.items.length} позиций`,
        String(invoice.items.length),
        formatCabinetMoney(invoice.totalRub),
      ]);
    });
  }

  if (filter === 'all' || filter === 'acts') {
    period.invoices.forEach((invoice) => {
      rows.push([
        'Акт',
        `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`,
        `Акт № ${actNumber(invoice.number)}`,
        isInvoicePaid(invoice) ? 'Доступен для скачивания' : 'Доступен после оплаты счета',
        String(invoice.items.length),
        formatCabinetMoney(invoice.totalRub),
      ]);
    });
  }

  if (filter === 'all' || filter === 'payments') {
    period.payments.forEach((payment) => {
      rows.push([
        'Оплата',
        formatCabinetDate(payment.paidAt),
        `Счет № ${payment.invoiceNumber}`,
        [payment.method, payment.reference].filter(Boolean).join(' · ') || 'Оплата по счету',
        '',
        formatCabinetMoney(payment.amountRub),
      ]);
    });
  }

  return rows;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  downloadBlobFile(blob, fileName);
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function isInvoicePaid(invoice: BillingInvoiceSummary) {
  return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}

function actNumber(invoiceNumber: string) {
  return invoiceNumber.startsWith('INV-') ? `ACT-${invoiceNumber.slice(4)}` : `ACT-${invoiceNumber}`;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
