import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock3,
  FilePlus2,
  ReceiptText,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  downloadBillingInvoiceActPdf,
  downloadBillingInvoicePdf,
  fetchBillingCharges,
  fetchBillingInvoiceActDocument,
  fetchBillingInvoiceDocument,
  fetchBillingInvoices,
  fetchBillingReconciliation,
  fetchBillingServices,
  fetchClientRequests,
  fetchClients,
  updateBillingChargeStatus,
  updateBillingInvoiceStatus,
  type AuthSession,
  type AuthUser,
  type BillingChargeStatus,
  type BillingChargeSummary,
  type BillingInvoiceDocument,
  type BillingInvoiceStatus,
  type BillingInvoiceSummary,
  type BillingReconciliation,
  type BillingServiceSummary,
  type ClientRequestSummary,
  type ClientSummary,
} from '../../lib/api';
import { BillingChargeForm } from './BillingChargeForm';
import { BillingChargesTable } from './BillingChargesTable';
import './billing.css';
import { BillingInvoiceDocumentPreview } from './BillingInvoiceDocumentPreview';
import { BillingInvoiceForm } from './BillingInvoiceForm';
import { BillingInvoicesTable } from './BillingInvoicesTable';
import { BillingPaymentForm } from './BillingPaymentForm';
import { BillingPeriodSummary } from './BillingPeriodSummary';
import { BillingReconciliationPanel } from './BillingReconciliationPanel';
import { BillingServiceForm } from './BillingServiceForm';
import { billingInvoiceStatusLabel } from './billingMeta';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type BillingPanelProps = {
  session: AuthSession;
};

type BillingReportState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: BillingReconciliation | null;
  error?: string;
};

const billingTabs = [
  { id: 'overview', label: 'Обзор' },
  { id: 'invoices', label: 'Счета' },
  { id: 'charges', label: 'Начисления' },
  { id: 'create', label: 'Создать счет' },
] as const;

type BillingTab = (typeof billingTabs)[number]['id'];
type InvoiceFilterStatus = BillingInvoiceStatus | 'OPEN' | 'ALL';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function BillingPanel({ session }: BillingPanelProps) {
  const canRead = canUse(session.user, 'billing:read');
  const canWrite = canUse(session.user, 'billing:write');
  const [charges, setCharges] = useState<LoadState<BillingChargeSummary>>({ status: 'idle', data: [] });
  const [invoices, setInvoices] = useState<LoadState<BillingInvoiceSummary>>({ status: 'idle', data: [] });
  const [services, setServices] = useState<LoadState<BillingServiceSummary>>({ status: 'idle', data: [] });
  const [clients, setClients] = useState<LoadState<ClientSummary>>({ status: 'idle', data: [] });
  const [requests, setRequests] = useState<LoadState<ClientRequestSummary>>({ status: 'idle', data: [] });
  const [reconciliation, setReconciliation] = useState<BillingReportState>({ status: 'idle', data: null });
  const [error, setError] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] = useState<BillingInvoiceDocument | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<BillingInvoiceSummary | null>(null);
  const [activeTab, setActiveTab] = useState<BillingTab>('overview');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceFilterStatus>('OPEN');
  const [invoiceClientFilter, setInvoiceClientFilter] = useState('');
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState('');

  const activeServices = useMemo(() => services.data.filter((service) => service.isActive), [services.data]);
  const visibleBillingTabs = useMemo(
    () => billingTabs.filter((tab) => tab.id !== 'create' || canWrite),
    [canWrite],
  );
  const dashboard = useMemo(() => buildInvoiceDashboard(invoices.data), [invoices.data]);
  const filteredInvoices = useMemo(
    () => filterInvoices(invoices.data, invoiceStatusFilter, invoiceClientFilter, invoiceQuery),
    [invoices.data, invoiceStatusFilter, invoiceClientFilter, invoiceQuery],
  );

  useEffect(() => {
    if (canRead) {
      void loadData();
    }
  }, [canRead]);

  useEffect(() => {
    if (!canWrite && activeTab === 'create') {
      setActiveTab('overview');
    }
  }, [activeTab, canWrite]);

  if (!canRead) {
    return null;
  }

  async function loadData() {
    setError(null);
    setCharges((current) => ({ ...current, status: 'loading', error: undefined }));
    setInvoices((current) => ({ ...current, status: 'loading', error: undefined }));
    setServices((current) => ({ ...current, status: 'loading', error: undefined }));
    setClients((current) => ({ ...current, status: 'loading', error: undefined }));
    setRequests((current) => ({ ...current, status: 'loading', error: undefined }));
    setReconciliation((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const [nextCharges, nextInvoices, nextServices, nextClients, nextRequests, nextReconciliation] = await Promise.all([
        fetchBillingCharges(session.accessToken),
        fetchBillingInvoices(session.accessToken),
        fetchBillingServices(session.accessToken),
        fetchClients(session.accessToken),
        fetchClientRequests(session.accessToken),
        fetchBillingReconciliation(session.accessToken),
      ]);
      setCharges({ status: 'ready', data: nextCharges });
      setInvoices({ status: 'ready', data: nextInvoices });
      setServices({ status: 'ready', data: nextServices });
      setClients({ status: 'ready', data: nextClients });
      setRequests({ status: 'ready', data: nextRequests });
      setReconciliation({ status: 'ready', data: nextReconciliation });
    } catch (caught) {
      const message = errorMessage(caught);
      setCharges((current) => ({ ...current, status: 'error', error: message }));
      setInvoices((current) => ({ ...current, status: 'error', error: message }));
      setServices((current) => ({ ...current, status: 'error', error: message }));
      setClients((current) => ({ ...current, status: 'error', error: message }));
      setRequests((current) => ({ ...current, status: 'error', error: message }));
      setReconciliation((current) => ({ ...current, status: 'error', error: message }));
    }
  }

  async function refreshReconciliation() {
    try {
      setReconciliation((current) => ({ ...current, status: 'loading', error: undefined }));
      setReconciliation({ status: 'ready', data: await fetchBillingReconciliation(session.accessToken) });
    } catch (caught) {
      setReconciliation((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
    }
  }

  function acceptService(service: BillingServiceSummary) {
    setServices((current) => ({
      status: 'ready',
      data: [service, ...current.data],
    }));
  }

  function acceptInvoice(invoice: BillingInvoiceSummary) {
    setInvoices((current) => ({
      status: 'ready',
      data: [invoice, ...current.data.filter((item) => item.id !== invoice.id)],
    }));
    setActiveTab('invoices');
    setPaymentInvoiceId('');
    void loadData();
    void refreshReconciliation();
  }

  function acceptCharge(charge: BillingChargeSummary) {
    setCharges((current) => ({
      status: 'ready',
      data: [charge, ...current.data],
    }));
  }

  async function changeChargeStatus(chargeId: string, status: BillingChargeStatus) {
    setError(null);

    try {
      const updated = await updateBillingChargeStatus(session.accessToken, chargeId, { status });
      setCharges((current) => ({
        ...current,
        data: current.data.map((charge) => (charge.id === updated.id ? updated : charge)),
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function changeInvoiceStatus(invoiceId: string, status: BillingInvoiceStatus) {
    setError(null);

    try {
      const updated = await updateBillingInvoiceStatus(session.accessToken, invoiceId, { status });
      acceptInvoice(updated);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openInvoiceDocument(invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') {
    setError(null);

    try {
      setDocumentPreview(
        kind === 'act'
          ? await fetchBillingInvoiceActDocument(session.accessToken, invoice.id)
          : await fetchBillingInvoiceDocument(session.accessToken, invoice.id),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadInvoicePdf(invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') {
    setError(null);

    try {
      const blob =
        kind === 'act'
          ? await downloadBillingInvoiceActPdf(session.accessToken, invoice.id)
          : await downloadBillingInvoicePdf(session.accessToken, invoice.id);
      downloadBlob(blob, kind === 'act' ? actFileName(invoice.number) : `Счет_${safeFileName(invoice.number)}.pdf`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function openInvoicesWithFilter(status: InvoiceFilterStatus) {
    setInvoiceStatusFilter(status);
    setActiveTab('invoices');
  }

  return (
    <section className="billing-panel" aria-label="Биллинг">
      <div className="section-heading billing-panel__heading">
        <div>
          <p className="eyebrow">Финансы</p>
          <h2>Счета и оплаты</h2>
        </div>
        <div className="billing-panel__top-actions">
          {canWrite ? (
            <button className="secondary-button" type="button" onClick={() => setActiveTab('create')}>
              <FilePlus2 size={17} aria-hidden="true" />
              <span>Создать счет</span>
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadData()}
            title="Обновить"
            aria-label="Обновить биллинг"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="billing-dashboard" aria-label="Состояние счетов">
        <DashboardButton
          icon={<Clock3 size={19} />}
          label="Черновики"
          value={`${dashboard.draftCount} шт.`}
          hint="Нужно проверить и выставить"
          onClick={() => openInvoicesWithFilter('DRAFT')}
        />
        <DashboardButton
          icon={<ReceiptText size={19} />}
          label="Выставлено"
          value={`${formatMoney(dashboard.openRub)} ₽`}
          hint={`${dashboard.openCount} счетов ждут оплату`}
          onClick={() => openInvoicesWithFilter('OPEN')}
        />
        <DashboardButton
          icon={<AlertTriangle size={19} />}
          label="Просрочено"
          value={`${formatMoney(dashboard.overdueRub)} ₽`}
          hint={`${dashboard.overdueCount} счетов с истекшим сроком`}
          tone={dashboard.overdueCount > 0 ? 'danger' : 'neutral'}
          onClick={() => openInvoicesWithFilter('OPEN')}
        />
        <DashboardButton
          icon={<CheckCircle2 size={19} />}
          label="Оплачено"
          value={`${formatMoney(dashboard.paidRub)} ₽`}
          hint={`${dashboard.paidCount} закрытых счетов`}
          tone="ready"
          onClick={() => openInvoicesWithFilter('PAID')}
        />
      </div>

      <div className="billing-tabs" role="tablist" aria-label="Раздел биллинга">
        {visibleBillingTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            {tab.id === 'invoices' ? <strong>{invoices.data.length}</strong> : null}
            {tab.id === 'charges' ? <strong>{charges.data.length}</strong> : null}
          </button>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {activeTab === 'overview' ? (
        <>
          <div className="billing-workflow">
            <WorkflowStep number="1" title="Начисления" text="Проверьте услуги, хранение и логистику." />
            <WorkflowStep number="2" title="Счет" text="Создайте счет вручную или из утвержденных начислений." />
            <WorkflowStep number="3" title="Оплата" text="Отметьте оплату, после этого клиент увидит акт." />
          </div>

          <div className="billing-panel__subheading">
            <h3>Задолженность</h3>
          </div>
          <div className="billing-panel__list">{renderReconciliation(reconciliation)}</div>

          {charges.status === 'ready' && invoices.status === 'ready' ? (
            <>
              <div className="billing-panel__subheading">
                <h3>Периоды</h3>
              </div>
              <div className="billing-panel__list">
                <BillingPeriodSummary charges={charges.data} invoices={invoices.data} />
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {activeTab === 'invoices' ? (
        <>
          <div className="billing-panel__subheading billing-panel__subheading--split">
            <div>
              <h3>Счета</h3>
              <p>Откройте строку счета, чтобы увидеть состав, оплаты, PDF и акт.</p>
            </div>
            {canWrite ? (
              <button className="primary-button" type="button" onClick={() => setActiveTab('create')}>
                <ReceiptText size={17} aria-hidden="true" />
                <span>Создать счет</span>
              </button>
            ) : null}
          </div>

          <div className="billing-filter-panel">
            <label>
              <span>Статус</span>
              <select value={invoiceStatusFilter} onChange={(event) => setInvoiceStatusFilter(event.target.value as InvoiceFilterStatus)}>
                <option value="OPEN">К оплате</option>
                <option value="DRAFT">Черновики</option>
                <option value="ISSUED">Выставлены</option>
                <option value="PAID">Оплачены</option>
                <option value="CANCELLED">Отменены</option>
                <option value="ALL">Все счета</option>
              </select>
            </label>
            <label>
              <span>Клиент</span>
              <select value={invoiceClientFilter} onChange={(event) => setInvoiceClientFilter(event.target.value)}>
                <option value="">Все клиенты</option>
                {clients.data.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="billing-filter-panel__search">
              <span>Поиск</span>
              <input
                value={invoiceQuery}
                onChange={(event) => setInvoiceQuery(event.target.value)}
                placeholder="Номер, клиент, комментарий"
              />
            </label>
          </div>

          {canWrite && invoices.status === 'ready' ? (
            <BillingPaymentForm
              invoices={invoices.data}
              preferredInvoiceId={paymentInvoiceId}
              session={session}
              onPaid={acceptInvoice}
            />
          ) : null}

          <div className="billing-panel__list">
            {renderInvoices(
              { ...invoices, data: filteredInvoices },
              canWrite,
              (invoice, kind) => void openInvoiceDocument(invoice, kind),
              (invoice, kind) => void downloadInvoicePdf(invoice, kind),
              changeInvoiceStatus,
              (invoice) => setPaymentInvoiceId(invoice.id),
              canEditDraftInvoices(session.user) ? setEditingInvoice : undefined,
            )}
          </div>
        </>
      ) : null}

      {activeTab === 'charges' ? (
        <>
          <div className="billing-panel__subheading">
            <h3>Начисления</h3>
          </div>
          <div className="billing-panel__list">{renderCharges(session.accessToken, charges, canWrite, changeChargeStatus)}</div>
        </>
      ) : null}

      {activeTab === 'create' && canWrite ? (
        <div className="billing-create-stack">
          {clients.status === 'ready' ? (
            <BillingInvoiceForm clients={clients.data} session={session} onCreated={acceptInvoice} />
          ) : null}
          <details className="billing-extra-tools">
            <summary>Дополнительные операции</summary>
            <div className="billing-extra-tools__content">
              {services.status === 'ready' ? <BillingServiceForm session={session} onCreated={acceptService} /> : null}
              {clients.status === 'ready' && requests.status === 'ready' && services.status === 'ready' ? (
                <BillingChargeForm
                  clients={clients.data}
                  requests={requests.data}
                  services={activeServices}
                  session={session}
                  onCreated={acceptCharge}
                />
              ) : null}
            </div>
          </details>
        </div>
      ) : null}

      {editingInvoice ? (
        <div className="billing-edit-modal" role="dialog" aria-modal="true" aria-label="Редактирование счета">
          <div className="billing-edit-modal__content">
            <div className="billing-edit-modal__head">
              <div>
                <p className="eyebrow">Редактирование черновика</p>
                <h3>Счет № {editingInvoice.number}</h3>
                <span>{editingInvoice.client.name}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingInvoice(null)} aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <BillingInvoiceForm
              clients={clients.data}
              session={session}
              initialClientId={editingInvoice.clientId}
              initialMode="manual"
              initialPeriodFrom={editingInvoice.periodFrom.slice(0, 10)}
              initialPeriodTo={editingInvoice.periodTo.slice(0, 10)}
              initialComment={editingInvoice.comment ?? ''}
              initialRows={invoiceRowsForForm(editingInvoice)}
              requestId={editingInvoice.requestId ?? undefined}
              editInvoiceId={editingInvoice.id}
              lockClient
              lockMode
              submitButtonLabel="Сохранить изменения"
              onCreated={(invoice) => {
                setEditingInvoice(null);
                acceptInvoice(invoice);
              }}
            />
          </div>
        </div>
      ) : null}

      {documentPreview ? (
        <BillingInvoiceDocumentPreview document={documentPreview} onClose={() => setDocumentPreview(null)} />
      ) : null}
    </section>
  );
}

function DashboardButton({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'ready' | 'danger';
  onClick: () => void;
}) {
  return (
    <button className={`billing-dashboard-card billing-dashboard-card--${tone}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </button>
  );
}

function WorkflowStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="billing-workflow-step">
      <strong>{number}</strong>
      <div>
        <span>{title}</span>
        <p>{text}</p>
      </div>
    </article>
  );
}

function renderInvoices(
  state: LoadState<BillingInvoiceSummary>,
  canWrite: boolean,
  onOpenDocument: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void,
  onDownloadPdf: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void,
  onStatusChange: (invoiceId: string, status: BillingInvoiceStatus) => void,
  onPayInvoice: (invoice: BillingInvoiceSummary) => void,
  onEditInvoice?: (invoice: BillingInvoiceSummary) => void,
) {
  if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
    return (
      <p className="panel-message">
        <Calculator size={22} aria-hidden="true" />
        <span>Загружаю счета.</span>
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="panel-message panel-message--error">{state.error ?? 'Не удалось загрузить счета.'}</p>;
  }

  if (state.data.length === 0) {
    return <p className="panel-message">По выбранным условиям счетов нет.</p>;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю счета.</p> : null}
      <BillingInvoicesTable
        invoices={state.data}
        canWrite={canWrite}
        onOpenDocument={onOpenDocument}
        onDownloadPdf={onDownloadPdf}
        onEditInvoice={onEditInvoice}
        onStatusChange={onStatusChange}
        onPayInvoice={onPayInvoice}
      />
    </>
  );
}

function renderCharges(
  accessToken: string,
  state: LoadState<BillingChargeSummary>,
  canWrite: boolean,
  onStatusChange: (chargeId: string, status: BillingChargeStatus) => void,
) {
  if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
    return (
      <p className="panel-message">
        <Calculator size={22} aria-hidden="true" />
        <span>Загружаю начисления.</span>
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="panel-message panel-message--error">{state.error ?? 'Не удалось загрузить биллинг.'}</p>;
  }

  if (state.data.length === 0) {
    return <p className="panel-message">Начислений пока нет.</p>;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю начисления.</p> : null}
      <BillingChargesTable
        accessToken={accessToken}
        charges={state.data}
        canWrite={canWrite}
        onStatusChange={onStatusChange}
      />
    </>
  );
}

function renderReconciliation(state: BillingReportState) {
  if (state.status === 'idle' || (state.status === 'loading' && !state.data)) {
    return (
      <p className="panel-message">
        <Calculator size={22} aria-hidden="true" />
        <span>Загружаю сверку.</span>
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="panel-message panel-message--error">{state.error ?? 'Не удалось загрузить сверку.'}</p>;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю сверку.</p> : null}
      <BillingReconciliationPanel report={state.data} />
    </>
  );
}

function buildInvoiceDashboard(invoices: BillingInvoiceSummary[]) {
  const now = new Date();

  return invoices.reduce(
    (totals, invoice) => {
      const totalRub = Number(invoice.totalRub);
      const paidRub = Number(invoice.paidRub);
      const remainingRub = Math.max(0, totalRub - paidRub);
      const isOpen = invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && remainingRub > 0;
      const isOverdue = isOpen && invoice.dueDate ? new Date(invoice.dueDate) < now : false;

      return {
        draftCount: totals.draftCount + (invoice.status === 'DRAFT' ? 1 : 0),
        openCount: totals.openCount + (isOpen ? 1 : 0),
        openRub: totals.openRub + (isOpen ? remainingRub : 0),
        overdueCount: totals.overdueCount + (isOverdue ? 1 : 0),
        overdueRub: totals.overdueRub + (isOverdue ? remainingRub : 0),
        paidCount: totals.paidCount + (invoice.status === 'PAID' ? 1 : 0),
        paidRub: totals.paidRub + (invoice.status === 'PAID' ? paidRub : 0),
      };
    },
    {
      draftCount: 0,
      openCount: 0,
      openRub: 0,
      overdueCount: 0,
      overdueRub: 0,
      paidCount: 0,
      paidRub: 0,
    },
  );
}

function filterInvoices(
  invoices: BillingInvoiceSummary[],
  status: InvoiceFilterStatus,
  clientId: string,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');

  return invoices.filter((invoice) => {
    const remainingRub = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
    const matchesStatus =
      status === 'ALL'
        ? true
        : status === 'OPEN'
          ? invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && remainingRub > 0
          : invoice.status === status;
    const matchesClient = clientId ? invoice.clientId === clientId : true;
    const haystack = [invoice.number, invoice.client.name, invoice.client.code, invoice.comment ?? '', billingInvoiceStatusLabel(invoice.status)]
      .join(' ')
      .toLocaleLowerCase('ru-RU');

    return matchesStatus && matchesClient && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
}

function invoiceRowsForForm(invoice: BillingInvoiceSummary) {
  return invoice.items.map((item) => ({
    serviceId: item.charge?.serviceId ?? '',
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    unitPriceRub: item.unitPriceRub,
    serviceDate: item.serviceDate,
  }));
}

function canEditDraftInvoices(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.includes('OWNER') ||
    user.roleCodes.includes('ADMIN')
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function actFileName(invoiceNumber: string) {
  return invoiceNumber.startsWith('INV-')
    ? `Акт_${safeFileName(`ACT-${invoiceNumber.slice(4)}`)}.pdf`
    : `Акт_${safeFileName(`ACT-${invoiceNumber}`)}.pdf`;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_');
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}
