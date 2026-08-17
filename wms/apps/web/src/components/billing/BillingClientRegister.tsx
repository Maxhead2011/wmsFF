import { MoreHorizontal, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BillingInvoiceSummary, ClientSummary } from '../../lib/api';

type BillingClientRegisterProps = {
  clients: ClientSummary[];
  invoices: BillingInvoiceSummary[];
  selectedClientId: string;
  onSelect: (clientId: string) => void;
  onOpenSettings: (client: ClientSummary) => void;
};

type ClientRegisterRow = {
  client: ClientSummary;
  invoicesCount: number;
  issuedCount: number;
  draftCount: number;
  issuedRub: number;
  paidRub: number;
  debtRub: number;
  lastInvoiceDate: string | null;
};

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function BillingClientRegister({
  clients,
  invoices,
  selectedClientId,
  onSelect,
  onOpenSettings,
}: BillingClientRegisterProps) {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => buildRows(clients, invoices), [clients, invoices]);
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!normalizedSearch) {
          return true;
        }
        return `${row.client.code} ${row.client.name}`
          .toLocaleLowerCase('ru-RU')
          .includes(normalizedSearch);
      }),
    [normalizedSearch, rows],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (result, row) => ({
          invoices: result.invoices + row.invoicesCount,
          issuedRub: result.issuedRub + row.issuedRub,
          debtRub: result.debtRub + row.debtRub,
        }),
        { invoices: 0, issuedRub: 0, debtRub: 0 },
      ),
    [rows],
  );

  return (
    <section className="billing-client-register" aria-label="Реестр клиентов биллинга">
      <header className="billing-client-register__header">
        <div>
          <span>Контрагенты</span>
          <h3>Клиенты и счета</h3>
        </div>
        <label className="billing-client-register__search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Код или название клиента"
          />
        </label>
      </header>

      <div className="billing-client-register__totals">
        <RegisterMetric label="Клиентов" value={formatInteger(rows.length)} />
        <RegisterMetric label="Счетов" value={formatInteger(totals.invoices)} />
        <RegisterMetric label="Выставлено" value={`${formatMoney(totals.issuedRub)} ₽`} />
        <RegisterMetric label="Долг" value={`${formatMoney(totals.debtRub)} ₽`} tone="danger" />
      </div>

      <div className="billing-client-register__table-wrap">
        <table className="billing-client-register__table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Клиент</th>
              <th>Счета</th>
              <th>Выставлено</th>
              <th>Оплачено</th>
              <th>Долг</th>
              <th>Черновики</th>
              <th>Последний счет</th>
              <th aria-label="Настройки" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isSelected = row.client.id === selectedClientId;
              return (
                <tr
                  aria-selected={isSelected}
                  className={isSelected ? 'is-selected' : undefined}
                  key={row.client.id}
                  onClick={() => onSelect(row.client.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(row.client.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td><strong>{row.client.code}</strong></td>
                  <td><strong>{row.client.name}</strong></td>
                  <td>
                    <strong>{formatInteger(row.invoicesCount)}</strong>
                    <span>выставлено {formatInteger(row.issuedCount)}</span>
                  </td>
                  <td><strong>{formatMoney(row.issuedRub)} ₽</strong></td>
                  <td><strong>{formatMoney(row.paidRub)} ₽</strong></td>
                  <td>
                    <strong className={row.debtRub > 0 ? 'billing-client-register__debt' : undefined}>
                      {formatMoney(row.debtRub)} ₽
                    </strong>
                  </td>
                  <td><strong>{formatInteger(row.draftCount)}</strong></td>
                  <td>{row.lastInvoiceDate ? <strong>{formatDate(row.lastInvoiceDate)}</strong> : <span>нет счетов</span>}</td>
                  <td>
                    <button
                      className="billing-client-register__menu"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenSettings(row.client);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      aria-label={`Настройки услуг ${row.client.name}`}
                      title="Услуги и цены клиента"
                    >
                      <MoreHorizontal size={19} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="billing-client-register__empty">
                    <UsersRound size={20} aria-hidden="true" />
                    Клиенты по запросу не найдены.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RegisterMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className={tone ? `billing-client-register__metric billing-client-register__metric--${tone}` : 'billing-client-register__metric'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildRows(clients: ClientSummary[], invoices: BillingInvoiceSummary[]) {
  const invoicesByClient = new Map<string, BillingInvoiceSummary[]>();
  invoices.forEach((invoice) => {
    if (invoice.status === 'CANCELLED') {
      return;
    }
    const current = invoicesByClient.get(invoice.client.id) ?? [];
    current.push(invoice);
    invoicesByClient.set(invoice.client.id, current);
  });

  return clients
    .map((client): ClientRegisterRow => {
      const clientInvoices = invoicesByClient.get(client.id) ?? [];
      const issuedInvoices = clientInvoices.filter((invoice) => invoice.status !== 'DRAFT');
      const issuedRub = issuedInvoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0);
      const paidRub = issuedInvoices.reduce((sum, invoice) => sum + Number(invoice.paidRub), 0);
      const lastInvoiceDate = clientInvoices.reduce<string | null>(
        (latest, invoice) => (!latest || invoice.periodFrom > latest ? invoice.periodFrom : latest),
        null,
      );

      return {
        client,
        invoicesCount: clientInvoices.length,
        issuedCount: issuedInvoices.length,
        draftCount: clientInvoices.filter((invoice) => invoice.status === 'DRAFT').length,
        issuedRub,
        paidRub,
        debtRub: Math.max(0, issuedRub - paidRub),
        lastInvoiceDate,
      };
    })
    .filter((row) => row.invoicesCount > 0)
    .sort((left, right) => left.client.name.localeCompare(right.client.name, 'ru-RU'));
}

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}
