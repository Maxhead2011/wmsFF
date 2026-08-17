import { ArrowLeft, Calculator, ChevronRight, Files, ReceiptText, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  downloadCombinedBillingInvoicesPdf,
  downloadBillingInvoiceActPdf,
  downloadBillingInvoicePdf,
  fetchBillingCharges,
  fetchBillingInvoiceActDocument,
  fetchBillingInvoiceDocument,
  fetchBillingInvoices,
  fetchFbsInvoiceMergePreview,
  fetchBillingReconciliation,
  fetchBillingServices,
  fetchClientRequests,
  fetchClients,
  mergeBillingInvoices,
  mergeFbsInvoices,
  updateBillingChargeStatus,
  updateFbsBillingLogisticsTrip,
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
  type FbsInvoiceMergePreview,
} from '../../lib/api';
import { BillingChargeForm } from './BillingChargeForm';
import { BillingCashReceiptPanel } from './BillingCashReceiptPanel';
import { BillingChargesTable } from './BillingChargesTable';
import './billing.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
import { BillingClientSettingsDialog } from './BillingClientSettingsDialog';
import { BillingInvoiceDocumentPreview } from './BillingInvoiceDocumentPreview';
import { BillingInvoiceForm } from './BillingInvoiceForm';
import { BillingInvoicesTable } from './BillingInvoicesTable';
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
  { id: 'cash-receipt', label: 'Приход ДС' },
  { id: 'charges', label: 'Начисления' },
  { id: 'create', label: 'Создать счет' },
] as const;

type BillingTab = 'home' | (typeof billingTabs)[number]['id'];
type InvoiceKindFilter = 'ALL' | 'FBS' | 'PRIMARY_PROCESSING' | 'OTHER';
type InvoiceView = 'topics' | 'list';

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
  const [settingsClient, setSettingsClient] = useState<ClientSummary | null>(null);
  const [activeTab, setActiveTab] = useState<BillingTab>('home');
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
  const [invoiceClientId, setInvoiceClientId] = useRememberedClientId(session.user.id);
  const [isCombiningInvoices, setIsCombiningInvoices] = useState(false);
  const [fbsMergePreview, setFbsMergePreview] = useState<FbsInvoiceMergePreview | null>(null);
  const [fbsLogisticsAmounts, setFbsLogisticsAmounts] = useState<Record<string, string>>({});
  const [includeFbsPrimaryProcessing, setIncludeFbsPrimaryProcessing] = useState(false);
  const [isLoadingFbsMerge, setIsLoadingFbsMerge] = useState(false);
  const [isSavingFbsMerge, setIsSavingFbsMerge] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());
  const [fbsMergeInvoiceIds, setFbsMergeInvoiceIds] = useState<string[]>([]);
  const [genericMergeInvoices, setGenericMergeInvoices] = useState<BillingInvoiceSummary[] | null>(null);
  const [isSavingGenericMerge, setIsSavingGenericMerge] = useState(false);
  const [mergeAggregateSameItems, setMergeAggregateSameItems] = useState(true);
  const [mergeExcludeZeroTotalItems, setMergeExcludeZeroTotalItems] = useState(true);
  const [invoiceKindFilter, setInvoiceKindFilter] = useState<InvoiceKindFilter>('ALL');
  const [invoiceView, setInvoiceView] = useState<InvoiceView>('topics');
  const [invoicePeriodFrom, setInvoicePeriodFrom] = useState(currentMonthStart());
  const [invoicePeriodTo, setInvoicePeriodTo] = useState(todayDate());

  const activeServices = useMemo(() => services.data.filter((service) => service.isActive), [services.data]);
  const overviewInvoices = useMemo(
    () => selectedClientId
      ? invoices.data.filter((invoice) => invoice.client.id === selectedClientId)
      : invoices.data,
    [invoices.data, selectedClientId],
  );
  const selectedClientInvoices = useMemo(
    () => invoiceClientId
      ? invoices.data.filter((invoice) => invoice.client.id === invoiceClientId)
      : [],
    [invoiceClientId, invoices.data],
  );
  const invoiceRegisterSourceInvoices = useMemo(
    () => (invoiceClientId ? selectedClientInvoices : invoices.data),
    [invoiceClientId, invoices.data, selectedClientInvoices],
  );
  const invoiceRegisterInvoices = useMemo(() => {
    return invoiceRegisterSourceInvoices.filter(
      (invoice) =>
        matchesInvoiceKind(invoice, invoiceKindFilter) &&
        matchesInvoicePeriod(invoice, invoicePeriodFrom, invoicePeriodTo),
    );
  }, [invoiceKindFilter, invoicePeriodFrom, invoicePeriodTo, invoiceRegisterSourceInvoices]);
  const invoiceKindTiles = useMemo(
    () => (['ALL', 'FBS', 'PRIMARY_PROCESSING', 'OTHER'] as InvoiceKindFilter[]).map((kind) => {
      const items = invoiceRegisterSourceInvoices.filter(
        (invoice) =>
          matchesInvoiceKind(invoice, kind) &&
          matchesInvoicePeriod(invoice, invoicePeriodFrom, invoicePeriodTo),
      );
      return {
        kind,
        count: items.length,
        totalRub: items.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0),
      };
    }),
    [invoicePeriodFrom, invoicePeriodTo, invoiceRegisterSourceInvoices],
  );
  const unpaidIssuedInvoices = useMemo(
    () => selectedClientInvoices.filter(
      (invoice) =>
        invoice.status === 'ISSUED' &&
        Number(invoice.totalRub) - Number(invoice.paidRub) > 0.005,
    ),
    [selectedClientInvoices],
  );
  const selectedInvoiceClient = clients.data.find((client) => client.id === invoiceClientId);
  const selectableInvoiceIds = useMemo(
    () => new Set(selectedClientInvoices.filter(isSelectableDraft).map((invoice) => invoice.id)),
    [selectedClientInvoices],
  );
  const combinedInvoicesClientId =
    invoiceClientId || (clients.status === 'ready' && clients.data.length === 1 ? clients.data[0].id : '');
  const combinedInvoicesClient = clients.data.find((client) => client.id === combinedInvoicesClientId);
  const genericMergeStats = useMemo(
    () => calculateGenericMergeStats(
      genericMergeInvoices ?? [],
      mergeAggregateSameItems,
      mergeExcludeZeroTotalItems,
    ),
    [genericMergeInvoices, mergeAggregateSameItems, mergeExcludeZeroTotalItems],
  );

  useEffect(() => {
    if (canRead) {
      void loadData();
    }
  }, [canRead, selectedClientId]);

  useEffect(() => {
    setSelectedInvoiceIds(new Set());
  }, [invoiceClientId]);

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
        fetchBillingCharges(session.accessToken, { clientId: selectedClientId || undefined }),
        fetchBillingInvoices(session.accessToken),
        fetchBillingServices(session.accessToken),
        fetchClients(session.accessToken),
        fetchClientRequests(session.accessToken),
        fetchBillingReconciliation(session.accessToken, { clientId: selectedClientId || undefined }),
      ]);
      setCharges({ status: 'ready', data: nextCharges });
      setInvoices({ status: 'ready', data: nextInvoices });
      setServices({ status: 'ready', data: nextServices });
      setClients({ status: 'ready', data: nextClients });
      setSelectedClientId((current) => validRememberedClientId(current, nextClients));
      setInvoiceClientId((current) => validRememberedClientId(current, nextClients));
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
      setReconciliation({
        status: 'ready',
        data: await fetchBillingReconciliation(session.accessToken, {
          clientId: selectedClientId || undefined,
        }),
      });
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
    setInvoiceClientId(invoice.client.id);
    setInvoices((current) => ({
      status: 'ready',
      data: [invoice, ...current.data.filter((item) => item.id !== invoice.id)],
    }));
    setActiveTab('invoices');
    setInvoiceView('list');
    setInvoiceKindFilter('ALL');
    void loadData();
    void refreshReconciliation();
  }

  function acceptEditedInvoice(invoice: BillingInvoiceSummary) {
    acceptInvoice(invoice);
    setEditingInvoice(null);
  }

  function acceptMutatedInvoice(invoice: BillingInvoiceSummary) {
    setInvoices((current) => ({
      status: 'ready',
      data: [invoice, ...current.data.filter((item) => item.id !== invoice.id)],
    }));
    setEditingInvoice(invoice);
    void refreshReconciliation();
  }

  function acceptIncomingPayments(updatedInvoices: BillingInvoiceSummary[]) {
    const updatedById = new Map(updatedInvoices.map((invoice) => [invoice.id, invoice]));
    setInvoices((current) => ({
      status: 'ready',
      data: current.data.map((invoice) => updatedById.get(invoice.id) ?? invoice),
    }));
    void refreshReconciliation();
  }

  function acceptCharge(charge: BillingChargeSummary) {
    if (selectedClientId && charge.client.id !== selectedClientId) {
      return;
    }
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

  async function changeFbsLogisticsTrip(chargeId: string, extraTrip: boolean) {
    setError(null);
    try {
      const updated = await updateFbsBillingLogisticsTrip(
        session.accessToken,
        chargeId,
        { extraTrip },
      );
      setCharges((current) => ({
        ...current,
        data: current.data.map((charge) => (charge.id === updated.id ? updated : charge)),
      }));
      void loadData();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadCombinedInvoicesPdf() {
    if (!combinedInvoicesClientId) {
      setError('Выберите клиента, неоплаченные счета которого нужно скачать.');
      return;
    }
    if (unpaidIssuedInvoices.length === 0) {
      setError('У выбранного клиента нет выставленных счетов с остатком к оплате.');
      return;
    }

    setError(null);
    setIsCombiningInvoices(true);

    try {
      const blob = await downloadCombinedBillingInvoicesPdf(session.accessToken, {
        clientId: combinedInvoicesClientId,
        status: 'ISSUED',
        unpaidOnly: true,
      });
      const clientCode = combinedInvoicesClient?.code ?? 'client';
      downloadBlob(blob, `Неоплаченные_счета_${safeFileName(clientCode)}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsCombiningInvoices(false);
    }
  }

  async function openFbsMerge() {
    if (!combinedInvoicesClientId) {
      setError('Сначала выберите клиента.');
      return;
    }
    const invoiceIds = [...selectedInvoiceIds].filter((id) => selectableInvoiceIds.has(id));
    if (invoiceIds.length === 1) {
      setError('Для объединения выберите минимум два FBS-черновика.');
      return;
    }
    const selectedInvoices = selectedClientInvoices.filter((invoice) => invoiceIds.includes(invoice.id));
    const useSpecialFbsMerge =
      invoiceIds.length === 0 ||
      (selectedInvoices.some((invoice) => invoice.sourceKey?.startsWith('fbs-invoice:') === true) &&
        selectedInvoices.every(isSelectableFbsDraft));
    if (!useSpecialFbsMerge) {
      setError(null);
      setMergeAggregateSameItems(true);
      setMergeExcludeZeroTotalItems(true);
      setGenericMergeInvoices(selectedInvoices);
      return;
    }
    setError(null);
    setIsLoadingFbsMerge(true);
    try {
      const preview = await fetchFbsInvoiceMergePreview(
        session.accessToken,
        combinedInvoicesClientId,
        invoiceIds.length ? invoiceIds : undefined,
      );
      setFbsMergePreview(preview);
      setFbsMergeInvoiceIds(invoiceIds);
      setMergeAggregateSameItems(true);
      setMergeExcludeZeroTotalItems(true);
      setIncludeFbsPrimaryProcessing(
        preview.primaryProcessing.included || (invoiceIds.length > 0 && preview.primaryProcessing.invoices > 0),
      );
      setFbsLogisticsAmounts(
        Object.fromEntries(
          preview.logisticsDays.map((day) => [
            day.date,
            String(day.currentAmountRub ?? day.suggestedAmountRub),
          ]),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoadingFbsMerge(false);
    }
  }

  async function submitFbsMerge() {
    if (!fbsMergePreview) {
      return;
    }
    setError(null);
    setIsSavingFbsMerge(true);
    try {
      const invoice = await mergeFbsInvoices(session.accessToken, {
        clientId: fbsMergePreview.client.id,
        invoiceIds: fbsMergeInvoiceIds.length ? fbsMergeInvoiceIds : undefined,
        includePrimaryProcessing: includeFbsPrimaryProcessing,
        aggregateSameItems: mergeAggregateSameItems,
        excludeZeroTotalItems: mergeExcludeZeroTotalItems,
        logisticsDays: fbsMergePreview.logisticsDays.map((day) => ({
          date: day.date,
          amountRub: nonNegativeMoney(fbsLogisticsAmounts[day.date]),
        })),
      });
      setFbsMergePreview(null);
      setFbsMergeInvoiceIds([]);
      setSelectedInvoiceIds(new Set());
      acceptInvoice(invoice);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingFbsMerge(false);
    }
  }

  async function submitGenericMerge() {
    if (!genericMergeInvoices || genericMergeInvoices.length < 2) {
      return;
    }
    setError(null);
    setIsSavingGenericMerge(true);
    try {
      const invoice = await mergeBillingInvoices(session.accessToken, {
        invoiceIds: genericMergeInvoices.map((item) => item.id),
        aggregateSameItems: mergeAggregateSameItems,
        excludeZeroTotalItems: mergeExcludeZeroTotalItems,
      });
      setGenericMergeInvoices(null);
      setSelectedInvoiceIds(new Set());
      acceptInvoice(invoice);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingGenericMerge(false);
    }
  }

  function openBillingSection(tab: Exclude<BillingTab, 'home'>) {
    setActiveTab(tab);
    if (tab === 'invoices') {
      setInvoiceView('topics');
      if (!invoiceClientId && selectedClientId) {
        setInvoiceClientId(selectedClientId);
      }
    }
  }

  return (
    <section className="billing-panel" aria-label="Биллинг">
      <div className="section-heading billing-panel__heading">
        <div>
          <p className="eyebrow">Биллинг</p>
          <h2>Финансы и начисления</h2>
        </div>
        <div className="billing-panel__heading-actions">
          {activeTab === 'invoices' || activeTab === 'overview' ? <label className="billing-client-filter">
            <span>{activeTab === 'invoices' ? 'Клиент для счетов' : 'Клиент'}</span>
            <select
              value={activeTab === 'invoices' ? invoiceClientId : selectedClientId}
              onChange={(event) => {
                if (activeTab === 'invoices') {
                  setInvoiceClientId(event.target.value);
                } else {
                  setSelectedClientId(event.target.value);
                }
              }}
              disabled={clients.status === 'loading' && clients.data.length === 0}
            >
              <option value="">Все клиенты</option>
              {clients.data.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.code})
                </option>
              ))}
            </select>
          </label> : null}
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

      {activeTab !== 'home' ? <div className="billing-tabs" role="tablist" aria-label="Раздел биллинга">
        <button
          className="billing-tabs__back"
          type="button"
          onClick={() => setActiveTab('home')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Разделы</span>
        </button>
        {billingTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => openBillingSection(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div> : null}

      {error ? <p className="form-error">{error}</p> : null}

      {activeTab === 'home' ? (
        <section className="billing-topic-grid" aria-label="Разделы биллинга">
          {billingTopics(canWrite).map((topic) => (
            <button
              className={`billing-topic-tile billing-topic-tile--${topic.id}`}
              key={topic.id}
              type="button"
              onClick={() => openBillingSection(topic.id)}
            >
              <span className="billing-topic-tile__mark">{topic.mark}</span>
              <span className="billing-topic-tile__content">
                <small>{topic.eyebrow}</small>
                <strong>{topic.title}</strong>
                <span>{topic.description}</span>
              </span>
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          ))}
        </section>
      ) : null}

      {activeTab === 'overview' ? (
        <>
          <div className="billing-panel__list">{renderReconciliation(reconciliation)}</div>

          {charges.status === 'ready' && invoices.status === 'ready' ? (
            <>
              <div className="billing-panel__subheading">
                <h3>Периоды</h3>
              </div>
              <div className="billing-panel__list">
                <BillingPeriodSummary charges={charges.data} invoices={overviewInvoices} />
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {activeTab === 'invoices' ? (
        <div className="billing-invoice-register">
          {invoiceView === 'topics' ? (
            <section className="billing-invoice-topic-picker" aria-label="Темы счетов">
              <div className="billing-panel__subheading">
                <div>
                  <h3>Счета</h3>
                  <span className="billing-invoice-register__detail-meta">
                    Сначала выберите тему счета, затем откроется список и действия.
                  </span>
                </div>
              </div>

              <div className="billing-invoice-period" aria-label="Период счетов">
                <div className="billing-invoice-period__presets">
                  <button type="button" onClick={() => { setInvoicePeriodFrom(''); setInvoicePeriodTo(''); }}>Весь период</button>
                  <button type="button" onClick={() => { setInvoicePeriodFrom(currentMonthStart()); setInvoicePeriodTo(todayDate()); }}>Текущий месяц</button>
                  <button type="button" onClick={() => { const period = previousMonthPeriod(); setInvoicePeriodFrom(period.from); setInvoicePeriodTo(period.to); }}>Предыдущий месяц</button>
                </div>
                <label>
                  <span>С</span>
                  <input type="date" value={invoicePeriodFrom} onChange={(event) => setInvoicePeriodFrom(event.target.value)} />
                </label>
                <label>
                  <span>По</span>
                  <input type="date" value={invoicePeriodTo} onChange={(event) => setInvoicePeriodTo(event.target.value)} />
                </label>
              </div>

              <div className="billing-invoice-kind-tiles" role="group" aria-label="Виды счетов">
                {invoiceKindTiles.map((tile, index) => (
                  <button
                    className={`billing-invoice-kind-tile billing-invoice-kind-tile--${tile.kind.toLowerCase()}`}
                    type="button"
                    key={tile.kind}
                    onClick={() => {
                      setInvoiceKindFilter(tile.kind);
                      setInvoiceView('list');
                    }}
                  >
                    <span className="billing-invoice-kind-tile__index">{index + 1}</span>
                    <span className="billing-invoice-kind-tile__brand">{invoiceKindMark(tile.kind)}</span>
                    <span className="billing-invoice-kind-tile__content">
                      <small>{invoiceKindFilterLabel(tile.kind)}</small>
                      <strong>{invoiceKindTitle(tile.kind)}</strong>
                      <span>{invoiceKindDescription(tile.kind)}</span>
                    </span>
                    <span className="billing-invoice-kind-tile__metric">
                      <b>{tile.count}</b>
                      <small>{formatMoney(tile.totalRub)} ₽</small>
                    </span>
                    <ChevronRight size={22} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
          <section className="billing-invoice-register__detail" aria-label="Счета выбранного клиента">
            <div className="billing-panel__subheading billing-panel__subheading--toolbar">
              <div>
                <div className="billing-invoice-register__title-row">
                  <button
                    className="secondary-button billing-invoice-register__back"
                    type="button"
                    onClick={() => setInvoiceView('topics')}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    <span>Темы счетов</span>
                  </button>
                  <h3>{selectedInvoiceClient ? `Счета: ${selectedInvoiceClient.name}` : 'Все счета'}</h3>
                </div>
                <span className="billing-invoice-register__detail-meta">
                  {selectedInvoiceClient
                    ? `${selectedInvoiceClient.code} · счетов: ${invoiceRegisterInvoices.length}`
                    : `Все клиенты · счетов: ${invoiceRegisterInvoices.length}`}
                </span>
              </div>
            <div className="billing-panel__actions">
              {canWrite ? (
                <button className="primary-button" type="button" onClick={() => setActiveTab('create')}>
                  <ReceiptText size={17} aria-hidden="true" />
                  <span>Создать счет</span>
                </button>
              ) : null}
              {canWrite ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void openFbsMerge()}
                  disabled={
                    !combinedInvoicesClientId ||
                    selectedInvoiceIds.size === 1 ||
                    isLoadingFbsMerge ||
                    isSavingFbsMerge
                  }
                  title={
                    !combinedInvoicesClientId
                      ? 'Сначала выберите клиента'
                      : selectedInvoiceIds.size === 1
                        ? 'Выберите ещё один черновик'
                        : selectedInvoiceIds.size > 1
                          ? 'Объединить только отмеченные черновики'
                          : 'Собрать все FBS-черновики клиента в один счёт'
                  }
                >
                  <Files size={17} aria-hidden="true" />
                  <span>
                    {isLoadingFbsMerge
                      ? 'Проверяю FBS-счета…'
                      : selectedInvoiceIds.size > 0
                        ? `Объединить выбранные (${selectedInvoiceIds.size})`
                        : 'Объединить счета FBS'}
                  </span>
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                onClick={() => void downloadCombinedInvoicesPdf()}
                disabled={!combinedInvoicesClientId || invoices.status !== 'ready' || unpaidIssuedInvoices.length === 0 || isCombiningInvoices}
                title={combinedInvoicesClientId ? 'Скачать все выставленные и неоплаченные счета клиента одним PDF-файлом' : 'Сначала выберите клиента'}
              >
                <Files size={17} aria-hidden="true" />
                <span>
                  {isCombiningInvoices
                    ? 'Формирую PDF…'
                    : `Неоплаченные счета PDF (${unpaidIssuedInvoices.length})`}
                </span>
              </button>
              </div>
            </div>
            <div className="billing-panel__list">
              {renderInvoices(
                { ...invoices, data: invoiceRegisterInvoices },
                canWrite,
                (invoice, kind) => void openInvoiceDocument(invoice, kind),
                (invoice, kind) => void downloadInvoicePdf(invoice, kind),
                changeInvoiceStatus,
                setEditingInvoice,
                !invoiceClientId,
                selectableInvoiceIds,
                selectedInvoiceIds,
                invoiceClientId ? setSelectedInvoiceIds : undefined,
              )}
            </div>
          </section>
          )}
        </div>
      ) : null}

      {activeTab === 'cash-receipt' && canWrite && clients.status === 'ready' && invoices.status === 'ready' ? (
        <BillingCashReceiptPanel
          clients={clients.data}
          invoices={invoices.data}
          session={session}
          onPaid={acceptIncomingPayments}
        />
      ) : null}

      {activeTab === 'charges' ? (
        <>
          <div className="billing-panel__subheading">
            <h3>Начисления</h3>
          </div>
          <div className="billing-panel__list">
            {renderCharges(
              session.accessToken,
              charges,
              canWrite,
              changeChargeStatus,
              changeFbsLogisticsTrip,
            )}
          </div>
        </>
      ) : null}

      {activeTab === 'create' && canWrite ? (
        <div className="billing-create-stack">
          {clients.status === 'ready' ? (
            <BillingInvoiceForm
              clients={clients.data}
              session={session}
              initialClientId={invoiceClientId || selectedClientId}
              initialPeriodFrom={invoicePeriodFrom || undefined}
              initialPeriodTo={invoicePeriodTo || undefined}
              onCreated={acceptInvoice}
            />
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

      {settingsClient ? (
        <BillingClientSettingsDialog
          client={settingsClient}
          session={session}
          onClose={() => setSettingsClient(null)}
        />
      ) : null}

      {genericMergeInvoices ? (
        <div className="billing-invoice-edit-modal" role="dialog" aria-modal="true" aria-label="Объединение выбранных счетов">
          <section className="billing-invoice-edit-modal__panel billing-generic-merge">
            <header className="billing-invoice-edit-modal__header">
              <div>
                <span>Новый объединённый черновик</span>
                <h3>{genericMergeInvoices[0]?.client?.name ?? 'Выбранный клиент'}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setGenericMergeInvoices(null)}
                title="Закрыть"
                aria-label="Закрыть"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="billing-invoice-edit-modal__body billing-generic-merge__body">
              <p className="billing-generic-merge__summary">
                Выбрано счетов: <strong>{genericMergeInvoices.length}</strong> · строк:{' '}
                <strong>{genericMergeStats.sourceRows}</strong> → <strong>{genericMergeStats.resultRows}</strong> · сумма:{' '}
                <strong>{formatMoney(genericMergeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0))} ₽</strong>
              </p>
              <div className="billing-merge-options" aria-label="Параметры объединения">
                <label className={mergeAggregateSameItems ? 'is-checked' : ''}>
                  <input
                    checked={mergeAggregateSameItems}
                    type="checkbox"
                    onChange={(event) => setMergeAggregateSameItems(event.target.checked)}
                  />
                  <span>
                    <strong>Суммировать одинаковые строки</strong>
                    <small>Одинаковая услуга, единица и цена станут одной строкой с общим количеством и суммой.</small>
                  </span>
                </label>
                <label className={mergeExcludeZeroTotalItems ? 'is-checked' : ''}>
                  <input
                    checked={mergeExcludeZeroTotalItems}
                    type="checkbox"
                    onChange={(event) => setMergeExcludeZeroTotalItems(event.target.checked)}
                  />
                  <span>
                    <strong>Не включать строки с суммой 0 ₽</strong>
                    <small>Будет исключено строк: {genericMergeStats.zeroRows}.</small>
                  </span>
                </label>
              </div>
              <div className="billing-generic-merge__list">
                {genericMergeInvoices.map((invoice) => (
                  <div key={invoice.id}>
                    <span>
                      <strong>{invoice.number}</strong>
                      <small>{formatShortDate(invoice.periodFrom)}–{formatShortDate(invoice.periodTo)} · {invoice.items?.length ?? 0} поз.</small>
                    </span>
                    <strong>{formatMoney(Number(invoice.totalRub))} ₽</strong>
                  </div>
                ))}
              </div>
              <p className="billing-generic-merge__hint">
                Будет создан один новый черновик со всеми строками выбранных счетов. Исходные черновики будут закрыты как объединённые.
              </p>
              <div className="billing-generic-merge__footer">
                <button className="secondary-button" type="button" onClick={() => setGenericMergeInvoices(null)}>
                  Отмена
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSavingGenericMerge}
                  onClick={() => void submitGenericMerge()}
                >
                  {isSavingGenericMerge ? 'Объединяю…' : `Объединить ${genericMergeInvoices.length} сч.`}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {fbsMergePreview ? (
        <div className="billing-invoice-edit-modal" role="dialog" aria-modal="true" aria-label="Объединение FBS-счетов">
          <section className="billing-invoice-edit-modal__panel billing-fbs-merge">
            <header className="billing-invoice-edit-modal__header">
              <div>
                <span>Единый черновик FBS</span>
                <h3>{fbsMergePreview.client.name}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setFbsMergePreview(null)} title="Закрыть" aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="billing-invoice-edit-modal__body billing-fbs-merge__body">
              <p className="billing-fbs-merge__summary">
                Будет объединено счетов: <strong>{fbsMergePreview.draftInvoices}</strong>.
                FBS-заказов: <strong>{fbsMergePreview.orders.length}</strong>.
                Товаров: <strong>{fbsMergePreview.orders.reduce((sum, order) => sum + order.itemCount, 0)}</strong>.
              </p>
              <p className="billing-fbs-merge__hint">
                В готовом счёте каждый FBS-заказ будет указан отдельной строкой с количеством товаров.
                Логистика считается одним выездом за день — укажите стоимость каждого дня отдельно.
              </p>
              <label
                className={`billing-fbs-merge__primary${includeFbsPrimaryProcessing ? ' is-checked' : ''}`}
              >
                <input
                  checked={includeFbsPrimaryProcessing}
                  disabled={
                    !fbsMergePreview.primaryProcessing.available ||
                    fbsMergePreview.primaryProcessing.included
                  }
                  type="checkbox"
                  onChange={(event) => setIncludeFbsPrimaryProcessing(event.target.checked)}
                />
                <span>
                  <strong>Добавить первичную обработку</strong>
                  <small>
                    Обработка товара клиента без коробов и паллет ·{' '}
                    {fbsMergePreview.primaryProcessing.itemCount} шт. ·{' '}
                    {formatMoney(fbsMergePreview.primaryProcessing.totalRub)} ₽
                  </small>
                  {!fbsMergePreview.primaryProcessing.available ? (
                    <em>Нет готовых начислений первичной обработки для этих FBS-поставок.</em>
                  ) : fbsMergePreview.primaryProcessing.included ? (
                    <em>Первичная обработка уже включена в этот объединённый счёт.</em>
                  ) : null}
                </span>
              </label>
              <div className="billing-merge-options" aria-label="Параметры строк объединённого FBS-счёта">
                <label className={mergeAggregateSameItems ? 'is-checked' : ''}>
                  <input
                    checked={mergeAggregateSameItems}
                    type="checkbox"
                    onChange={(event) => setMergeAggregateSameItems(event.target.checked)}
                  />
                  <span>
                    <strong>Суммировать одинаковые строки</strong>
                    <small>Одинаковая услуга, единица и цена станут одной строкой.</small>
                  </span>
                </label>
                <label className={mergeExcludeZeroTotalItems ? 'is-checked' : ''}>
                  <input
                    checked={mergeExcludeZeroTotalItems}
                    type="checkbox"
                    onChange={(event) => setMergeExcludeZeroTotalItems(event.target.checked)}
                  />
                  <span>
                    <strong>Не включать строки с суммой 0 ₽</strong>
                    <small>В счёт попадут только строки с ненулевой стоимостью.</small>
                  </span>
                </label>
              </div>
              <div className="billing-fbs-merge__days">
                {fbsMergePreview.logisticsDays.map((day) => (
                  <label className="billing-fbs-merge__day" key={day.date}>
                    <span>
                      <strong>{formatShortDate(day.date)}</strong>
                      <small>
                        поставок: {day.shipments}; заказов: {day.orders}; товаров: {day.itemCount}
                      </small>
                    </span>
                    <span className="billing-fbs-merge__amount">
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={fbsLogisticsAmounts[day.date] ?? '0'}
                        onChange={(event) =>
                          setFbsLogisticsAmounts((current) => ({
                            ...current,
                            [day.date]: event.target.value,
                          }))
                        }
                      />
                      <span>₽</span>
                    </span>
                  </label>
                ))}
              </div>
              <details className="billing-fbs-merge__orders">
                <summary>FBS-заказы в счёте</summary>
                <div>
                  {fbsMergePreview.orders.map((order) => (
                    <span key={order.orderId}>
                      №{order.orderId} — {order.itemCount} шт.
                    </span>
                  ))}
                </div>
              </details>
              <div className="billing-fbs-merge__footer">
                <span>
                  Итого без логистики:{' '}
                  {formatMoney(
                    fbsMergePreview.processingTotalRub +
                      (includeFbsPrimaryProcessing
                        ? fbsMergePreview.primaryProcessing.totalRub
                        : 0),
                  )}{' '}
                  ₽
                </span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSavingFbsMerge}
                  onClick={() => void submitFbsMerge()}
                >
                  {isSavingFbsMerge ? 'Объединяю…' : 'Создать единый FBS-счёт'}
                </button>
              </div>
            </div>
          </section>
        </div>
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
                onMutated={acceptMutatedInvoice}
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
  showClientColumn = true,
  selectableInvoiceIds = new Set<string>(),
  selectedInvoiceIds = new Set<string>(),
  onInvoiceSelectionChange?: (invoiceIds: Set<string>) => void,
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
        showClientColumn={showClientColumn}
        selectableInvoiceIds={selectableInvoiceIds}
        selectedInvoiceIds={selectedInvoiceIds}
        onInvoiceSelectionChange={onInvoiceSelectionChange}
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
  onFbsLogisticsTripChange: (chargeId: string, extraTrip: boolean) => Promise<void>,
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
        onFbsLogisticsTripChange={onFbsLogisticsTripChange}
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

function billingTopics(canWrite: boolean): Array<{
  id: Exclude<BillingTab, 'home'>;
  eyebrow: string;
  title: string;
  description: string;
  mark: string;
}> {
  const topics: Array<{
    id: Exclude<BillingTab, 'home'>;
    eyebrow: string;
    title: string;
    description: string;
    mark: string;
  }> = [
    {
      id: 'invoices',
      eyebrow: 'Документы и оплаты',
      title: 'Счета',
      description: 'FBS, первичная обработка, логистика и прочие счета по клиентам.',
      mark: '₽',
    },
    {
      id: 'charges',
      eyebrow: 'Расчёт услуг',
      title: 'Начисления',
      description: 'Проверьте услуги до формирования счета и исправьте расчёт.',
      mark: 'Σ',
    },
    {
      id: 'overview',
      eyebrow: 'Контроль денег',
      title: 'Сверка',
      description: 'Долг, оплаты, авансы и состояние расчётов по клиентам.',
      mark: '✓',
    },
  ];
  if (canWrite) {
    topics.splice(1, 0, {
      id: 'cash-receipt',
      eyebrow: 'Поступления',
      title: 'Приход ДС',
      description: 'Зачислите оплату в счета или оставьте её авансом клиента.',
      mark: '+',
    });
    topics.push({
      id: 'create',
      eyebrow: 'Новый документ',
      title: 'Создать счет',
      description: 'Выберите клиента, период и услуги для нового счета.',
      mark: '↗',
    });
  }
  return topics;
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

function isSelectableFbsDraft(invoice: BillingInvoiceSummary) {
  return (
    invoice.status === 'DRAFT' &&
    (invoice.sourceKey?.startsWith('fbs-invoice:') === true ||
      invoice.sourceKey?.startsWith('fbs-primary-invoice:') === true)
  );
}

function isSelectableDraft(invoice: BillingInvoiceSummary) {
  return (
    invoice.status === 'DRAFT' &&
    Number(invoice.paidRub) <= 0 &&
    invoice.payments.length === 0
  );
}

function matchesInvoiceKind(invoice: BillingInvoiceSummary, filter: InvoiceKindFilter) {
  if (filter === 'ALL') {
    return true;
  }

  const kinds = invoiceKinds(invoice);
  if (filter === 'FBS') {
    return kinds.has('FBS');
  }
  if (filter === 'PRIMARY_PROCESSING') {
    return kinds.has('PRIMARY_PROCESSING');
  }
  return kinds.size === 0;
}

function invoiceKindFilterLabel(filter: InvoiceKindFilter) {
  if (filter === 'FBS') {
    return 'FBS и логистика';
  }
  if (filter === 'PRIMARY_PROCESSING') {
    return 'Первичная обработка';
  }
  if (filter === 'OTHER') {
    return 'Другие услуги';
  }
  return 'Все счета';
}

function invoiceKindTitle(filter: InvoiceKindFilter) {
  if (filter === 'FBS') {
    return 'FBS';
  }
  if (filter === 'PRIMARY_PROCESSING') {
    return 'Первичка';
  }
  if (filter === 'OTHER') {
    return 'Услуги';
  }
  return 'Все счета';
}

function invoiceKindDescription(filter: InvoiceKindFilter) {
  if (filter === 'FBS') {
    return 'Сборка, отгрузка и логистика по FBS.';
  }
  if (filter === 'PRIMARY_PROCESSING') {
    return 'Отдельные строки первичной обработки товара.';
  }
  if (filter === 'OTHER') {
    return 'Хранение, приёмка, ручные и другие услуги.';
  }
  return 'Полный реестр счетов выбранного клиента или всех клиентов.';
}

function invoiceKindMark(filter: InvoiceKindFilter) {
  if (filter === 'FBS') {
    return 'FBS';
  }
  if (filter === 'PRIMARY_PROCESSING') {
    return 'ПР';
  }
  if (filter === 'OTHER') {
    return 'УСЛ';
  }
  return 'Σ';
}

function matchesInvoicePeriod(invoice: BillingInvoiceSummary, from: string, to: string) {
  const invoiceFrom = invoice.periodFrom.slice(0, 10);
  const invoiceTo = invoice.periodTo.slice(0, 10);
  return (!from || invoiceTo >= from) && (!to || invoiceFrom <= to);
}

function dateKey(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function todayDate() {
  return dateKey(new Date());
}

function currentMonthStart() {
  const value = new Date();
  return dateKey(new Date(value.getFullYear(), value.getMonth(), 1));
}

function previousMonthPeriod() {
  const value = new Date();
  return {
    from: dateKey(new Date(value.getFullYear(), value.getMonth() - 1, 1)),
    to: dateKey(new Date(value.getFullYear(), value.getMonth(), 0)),
  };
}

function invoiceKinds(invoice: BillingInvoiceSummary) {
  const kinds = new Set<'FBS' | 'PRIMARY_PROCESSING'>();
  if (invoice.sourceKey?.startsWith('fbs-')) {
    kinds.add('FBS');
  }
  if (invoice.sourceKey?.startsWith('fbs-primary-invoice:')) {
    kinds.add('PRIMARY_PROCESSING');
  }
  invoice.items.forEach((item) => {
    const metadata = item.charge?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return;
    }
    const kind = (metadata as { kind?: unknown }).kind;
    if (kind === 'FBS' || kind === 'FBS_DAILY_LOGISTICS') {
      kinds.add('FBS');
    }
    if (kind === 'FBS_PRIMARY_PROCESSING') {
      kinds.add('PRIMARY_PROCESSING');
      kinds.add('FBS');
    }
  });
  return kinds;
}

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_') || 'client';
}

function nonNegativeMoney(value: string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

function formatShortDate(value: string) {
  const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const parsed = new Date(datePart ? `${datePart}T00:00:00` : value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU').format(parsed);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function calculateGenericMergeStats(
  invoices: BillingInvoiceSummary[],
  aggregateSameItems: boolean,
  excludeZeroTotalItems: boolean,
) {
  const uniqueItems = new Map<string, BillingInvoiceSummary['items'][number]>();
  invoices.forEach((invoice) => {
    (invoice.items ?? []).forEach((item) => {
      const key = item.chargeId ? `charge:${item.chargeId}` : `item:${item.id}`;
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, item);
      }
    });
  });

  const sourceItems = [...uniqueItems.values()];
  const zeroRows = sourceItems.filter((item) => roundPreviewMoney(Number(item.totalRub)) === 0).length;
  const resultItems = excludeZeroTotalItems
    ? sourceItems.filter((item) => roundPreviewMoney(Number(item.totalRub)) !== 0)
    : sourceItems;
  const resultRows = aggregateSameItems
    ? new Set(resultItems.map((item) => [
        item.description.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU'),
        item.unit,
        roundPreviewMoney(Number(item.unitPriceRub)).toFixed(2),
      ].join('|'))).size
    : resultItems.length;

  return {
    sourceRows: sourceItems.length,
    resultRows,
    zeroRows,
  };
}

function roundPreviewMoney(value: number) {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
}
