import { Calculator, ReceiptText, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

  const activeServices = useMemo(() => services.data.filter((service) => service.isActive), [services.data]);

  useEffect(() => {
    if (canRead) {
      void loadData();
    }
  }, [canRead]);

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
    void loadData();
    void refreshReconciliation();
  }

  function acceptEditedInvoice(invoice: BillingInvoiceSummary) {
    acceptInvoice(invoice);
    setEditingInvoice(null);
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
      downloadBlob(blob, kind === 'act' ? actFileName(invoice.number) : `${invoice.number}.pdf`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="billing-panel" aria-label="Биллинг">
      <div className="section-heading billing-panel__heading">
        <div>
          <p className="eyebrow">Биллинг</p>
          <h2>Финансы и начисления</h2>
        </div>
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

      <div className="billing-tabs" role="tablist" aria-label="Раздел биллинга">
        {billingTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {activeTab === 'overview' ? (
        <>
          <div className="billing-panel__subheading">
            <h3>Сверка</h3>
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
          {canWrite && invoices.status === 'ready' ? (
            <BillingPaymentForm invoices={invoices.data} session={session} onPaid={acceptInvoice} />
          ) : null}
          {canWrite ? (
            <div className="billing-panel__actions">
              <button className="primary-button" type="button" onClick={() => setActiveTab('create')}>
                <ReceiptText size={17} aria-hidden="true" />
                <span>Создать счет</span>
              </button>
            </div>
          ) : null}
          <div className="billing-panel__subheading">
            <h3>Счета</h3>
          </div>
          <div className="billing-panel__list">
            {renderInvoices(
              invoices,
              canWrite,
              (invoice, kind) => void openInvoiceDocument(invoice, kind),
              (invoice, kind) => void downloadInvoicePdf(invoice, kind),
              changeInvoiceStatus,
              setEditingInvoice,
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
      ) : null}

      {documentPreview ? (
        <BillingInvoiceDocumentPreview document={documentPreview} onClose={() => setDocumentPreview(null)} />
      ) : null}

      {editingInvoice && clients.status === 'ready' ? (
        <div className="billing-invoice-edit-modal" role="dialog" aria-modal="true" aria-label="Редактирование счета">
          <section className="billing-invoice-edit-modal__panel">
            <header className="billing-invoice-edit-modal__header">
              <div>
                <span>{editingInvoice.status === 'ISSUED' ? 'Редактирование выставленного счета' : 'Редактирование черновика'}</span>
                <h3>{editingInvoice.number}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingInvoice(null)} title="Закрыть" aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="billing-invoice-edit-modal__body">
              <BillingInvoiceForm
                clients={clients.data}
                session={session}
                invoice={editingInvoice}
                onCreated={acceptEditedInvoice}
              />
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function renderInvoices(
  state: LoadState<BillingInvoiceSummary>,
  canWrite: boolean,
  onOpenDocument: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void,
  onDownloadPdf: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void,
  onStatusChange: (invoiceId: string, status: BillingInvoiceStatus) => void,
  onEdit: (invoice: BillingInvoiceSummary) => void,
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
    return <p className="panel-message">Счетов пока нет.</p>;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю счета.</p> : null}
      <BillingInvoicesTable
        invoices={state.data}
        canWrite={canWrite}
        onOpenDocument={onOpenDocument}
        onDownloadPdf={onDownloadPdf}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
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
  return invoiceNumber.startsWith('INV-') ? `ACT-${invoiceNumber.slice(4)}.pdf` : `ACT-${invoiceNumber}.pdf`;
}
