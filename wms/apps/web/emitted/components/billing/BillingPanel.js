import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowLeft, Calculator, ChevronRight, Files, ReceiptText, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadCombinedBillingInvoicesPdf, downloadBillingInvoiceActPdf, downloadBillingInvoicePdf, fetchBillingCharges, fetchBillingInvoiceActDocument, fetchBillingInvoiceDocument, fetchBillingInvoices, fetchFbsInvoiceMergePreview, fetchBillingReconciliation, fetchBillingServices, fetchClientRequests, fetchClients, mergeBillingInvoices, mergeFbsInvoices, updateBillingChargeStatus, updateFbsBillingLogisticsTrip, updateBillingInvoiceStatus, } from '../../lib/api';
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
const billingTabs = [
    { id: 'overview', label: 'Обзор' },
    { id: 'invoices', label: 'Счета' },
    { id: 'cash-receipt', label: 'Приход ДС' },
    { id: 'charges', label: 'Начисления' },
    { id: 'create', label: 'Создать счет' },
];
export function BillingPanel({ session }) {
    const canRead = canUse(session.user, 'billing:read');
    const canWrite = canUse(session.user, 'billing:write');
    const [charges, setCharges] = useState({ status: 'idle', data: [] });
    const [invoices, setInvoices] = useState({ status: 'idle', data: [] });
    const [services, setServices] = useState({ status: 'idle', data: [] });
    const [clients, setClients] = useState({ status: 'idle', data: [] });
    const [requests, setRequests] = useState({ status: 'idle', data: [] });
    const [reconciliation, setReconciliation] = useState({ status: 'idle', data: null });
    const [error, setError] = useState(null);
    const [documentPreview, setDocumentPreview] = useState(null);
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [settingsClient, setSettingsClient] = useState(null);
    const [activeTab, setActiveTab] = useState('home');
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [invoiceClientId, setInvoiceClientId] = useRememberedClientId(session.user.id);
    const [isCombiningInvoices, setIsCombiningInvoices] = useState(false);
    const [fbsMergePreview, setFbsMergePreview] = useState(null);
    const [fbsLogisticsAmounts, setFbsLogisticsAmounts] = useState({});
    const [includeFbsPrimaryProcessing, setIncludeFbsPrimaryProcessing] = useState(false);
    const [isLoadingFbsMerge, setIsLoadingFbsMerge] = useState(false);
    const [isSavingFbsMerge, setIsSavingFbsMerge] = useState(false);
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(() => new Set());
    const [fbsMergeInvoiceIds, setFbsMergeInvoiceIds] = useState([]);
    const [genericMergeInvoices, setGenericMergeInvoices] = useState(null);
    const [isSavingGenericMerge, setIsSavingGenericMerge] = useState(false);
    const [mergeAggregateSameItems, setMergeAggregateSameItems] = useState(true);
    const [mergeExcludeZeroTotalItems, setMergeExcludeZeroTotalItems] = useState(true);
    const [invoiceKindFilter, setInvoiceKindFilter] = useState('ALL');
    const [invoiceView, setInvoiceView] = useState('topics');
    const [invoicePeriodFrom, setInvoicePeriodFrom] = useState(currentMonthStart());
    const [invoicePeriodTo, setInvoicePeriodTo] = useState(todayDate());
    const activeServices = useMemo(() => services.data.filter((service) => service.isActive), [services.data]);
    const overviewInvoices = useMemo(() => selectedClientId
        ? invoices.data.filter((invoice) => invoice.client.id === selectedClientId)
        : invoices.data, [invoices.data, selectedClientId]);
    const selectedClientInvoices = useMemo(() => invoiceClientId
        ? invoices.data.filter((invoice) => invoice.client.id === invoiceClientId)
        : [], [invoiceClientId, invoices.data]);
    const invoiceRegisterSourceInvoices = useMemo(() => (invoiceClientId ? selectedClientInvoices : invoices.data), [invoiceClientId, invoices.data, selectedClientInvoices]);
    const invoiceRegisterInvoices = useMemo(() => {
        return invoiceRegisterSourceInvoices.filter((invoice) => matchesInvoiceKind(invoice, invoiceKindFilter) &&
            matchesInvoicePeriod(invoice, invoicePeriodFrom, invoicePeriodTo));
    }, [invoiceKindFilter, invoicePeriodFrom, invoicePeriodTo, invoiceRegisterSourceInvoices]);
    const invoiceKindTiles = useMemo(() => ['ALL', 'FBS', 'PRIMARY_PROCESSING', 'OTHER'].map((kind) => {
        const items = invoiceRegisterSourceInvoices.filter((invoice) => matchesInvoiceKind(invoice, kind) &&
            matchesInvoicePeriod(invoice, invoicePeriodFrom, invoicePeriodTo));
        return {
            kind,
            count: items.length,
            totalRub: items.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0),
        };
    }), [invoicePeriodFrom, invoicePeriodTo, invoiceRegisterSourceInvoices]);
    const unpaidIssuedInvoices = useMemo(() => selectedClientInvoices.filter((invoice) => invoice.status === 'ISSUED' &&
        Number(invoice.totalRub) - Number(invoice.paidRub) > 0.005), [selectedClientInvoices]);
    const selectedInvoiceClient = clients.data.find((client) => client.id === invoiceClientId);
    const selectableInvoiceIds = useMemo(() => new Set(selectedClientInvoices.filter(isSelectableDraft).map((invoice) => invoice.id)), [selectedClientInvoices]);
    const combinedInvoicesClientId = invoiceClientId || (clients.status === 'ready' && clients.data.length === 1 ? clients.data[0].id : '');
    const combinedInvoicesClient = clients.data.find((client) => client.id === combinedInvoicesClientId);
    const genericMergeStats = useMemo(() => calculateGenericMergeStats(genericMergeInvoices ?? [], mergeAggregateSameItems, mergeExcludeZeroTotalItems), [genericMergeInvoices, mergeAggregateSameItems, mergeExcludeZeroTotalItems]);
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
        }
        catch (caught) {
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
        }
        catch (caught) {
            setReconciliation((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
        }
    }
    function acceptService(service) {
        setServices((current) => ({
            status: 'ready',
            data: [service, ...current.data],
        }));
    }
    function acceptInvoice(invoice) {
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
    function acceptEditedInvoice(invoice) {
        acceptInvoice(invoice);
        setEditingInvoice(null);
    }
    function acceptMutatedInvoice(invoice) {
        setInvoices((current) => ({
            status: 'ready',
            data: [invoice, ...current.data.filter((item) => item.id !== invoice.id)],
        }));
        setEditingInvoice(invoice);
        void refreshReconciliation();
    }
    function acceptIncomingPayments(updatedInvoices) {
        const updatedById = new Map(updatedInvoices.map((invoice) => [invoice.id, invoice]));
        setInvoices((current) => ({
            status: 'ready',
            data: current.data.map((invoice) => updatedById.get(invoice.id) ?? invoice),
        }));
        void refreshReconciliation();
    }
    function acceptCharge(charge) {
        if (selectedClientId && charge.client.id !== selectedClientId) {
            return;
        }
        setCharges((current) => ({
            status: 'ready',
            data: [charge, ...current.data],
        }));
    }
    async function changeChargeStatus(chargeId, status) {
        setError(null);
        try {
            const updated = await updateBillingChargeStatus(session.accessToken, chargeId, { status });
            setCharges((current) => ({
                ...current,
                data: current.data.map((charge) => (charge.id === updated.id ? updated : charge)),
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function changeInvoiceStatus(invoiceId, status) {
        setError(null);
        try {
            const updated = await updateBillingInvoiceStatus(session.accessToken, invoiceId, { status });
            acceptInvoice(updated);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function openInvoiceDocument(invoice, kind) {
        setError(null);
        try {
            setDocumentPreview(kind === 'act'
                ? await fetchBillingInvoiceActDocument(session.accessToken, invoice.id)
                : await fetchBillingInvoiceDocument(session.accessToken, invoice.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function downloadInvoicePdf(invoice, kind) {
        setError(null);
        try {
            const blob = kind === 'act'
                ? await downloadBillingInvoiceActPdf(session.accessToken, invoice.id)
                : await downloadBillingInvoicePdf(session.accessToken, invoice.id);
            downloadBlob(blob, kind === 'act' ? actFileName(invoice.number) : `${invoice.number}.pdf`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function changeFbsLogisticsTrip(chargeId, extraTrip) {
        setError(null);
        try {
            const updated = await updateFbsBillingLogisticsTrip(session.accessToken, chargeId, { extraTrip });
            setCharges((current) => ({
                ...current,
                data: current.data.map((charge) => (charge.id === updated.id ? updated : charge)),
            }));
            void loadData();
        }
        catch (caught) {
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
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
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
        const useSpecialFbsMerge = invoiceIds.length === 0 ||
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
            const preview = await fetchFbsInvoiceMergePreview(session.accessToken, combinedInvoicesClientId, invoiceIds.length ? invoiceIds : undefined);
            setFbsMergePreview(preview);
            setFbsMergeInvoiceIds(invoiceIds);
            setMergeAggregateSameItems(true);
            setMergeExcludeZeroTotalItems(true);
            setIncludeFbsPrimaryProcessing(preview.primaryProcessing.included || (invoiceIds.length > 0 && preview.primaryProcessing.invoices > 0));
            setFbsLogisticsAmounts(Object.fromEntries(preview.logisticsDays.map((day) => [
                day.date,
                String(day.currentAmountRub ?? day.suggestedAmountRub),
            ])));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
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
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
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
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsSavingGenericMerge(false);
        }
    }
    function openBillingSection(tab) {
        setActiveTab(tab);
        if (tab === 'invoices') {
            setInvoiceView('topics');
            if (!invoiceClientId && selectedClientId) {
                setInvoiceClientId(selectedClientId);
            }
        }
    }
    return (_jsxs("section", { className: "billing-panel", "aria-label": "\u0411\u0438\u043B\u043B\u0438\u043D\u0433", children: [_jsxs("div", { className: "section-heading billing-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0411\u0438\u043B\u043B\u0438\u043D\u0433" }), _jsx("h2", { children: "\u0424\u0438\u043D\u0430\u043D\u0441\u044B \u0438 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F" })] }), _jsxs("div", { className: "billing-panel__heading-actions", children: [activeTab === 'invoices' || activeTab === 'overview' ? _jsxs("label", { className: "billing-client-filter", children: [_jsx("span", { children: activeTab === 'invoices' ? 'Клиент для счетов' : 'Клиент' }), _jsxs("select", { value: activeTab === 'invoices' ? invoiceClientId : selectedClientId, onChange: (event) => {
                                            if (activeTab === 'invoices') {
                                                setInvoiceClientId(event.target.value);
                                            }
                                            else {
                                                setSelectedClientId(event.target.value);
                                            }
                                        }, disabled: clients.status === 'loading' && clients.data.length === 0, children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.data.map((client) => (_jsxs("option", { value: client.id, children: [client.name, " (", client.code, ")"] }, client.id)))] })] }) : null, _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadData(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0431\u0438\u043B\u043B\u0438\u043D\u0433", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] })] }), activeTab !== 'home' ? _jsxs("div", { className: "billing-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u0430", children: [_jsxs("button", { className: "billing-tabs__back", type: "button", onClick: () => setActiveTab('home'), children: [_jsx(ArrowLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B" })] }), billingTabs.map((tab) => (_jsx("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => openBillingSection(tab.id), role: "tab", type: "button", children: tab.label }, tab.id)))] }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, activeTab === 'home' ? (_jsx("section", { className: "billing-topic-grid", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u0430", children: billingTopics(canWrite).map((topic) => (_jsxs("button", { className: `billing-topic-tile billing-topic-tile--${topic.id}`, type: "button", onClick: () => openBillingSection(topic.id), children: [_jsx("span", { className: "billing-topic-tile__mark", children: topic.mark }), _jsxs("span", { className: "billing-topic-tile__content", children: [_jsx("small", { children: topic.eyebrow }), _jsx("strong", { children: topic.title }), _jsx("span", { children: topic.description })] }), _jsx(ChevronRight, { size: 22, "aria-hidden": "true" })] }, topic.id))) })) : null, activeTab === 'overview' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "billing-panel__list", children: renderReconciliation(reconciliation) }), charges.status === 'ready' && invoices.status === 'ready' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "billing-panel__subheading", children: _jsx("h3", { children: "\u041F\u0435\u0440\u0438\u043E\u0434\u044B" }) }), _jsx("div", { className: "billing-panel__list", children: _jsx(BillingPeriodSummary, { charges: charges.data, invoices: overviewInvoices }) })] })) : null] })) : null, activeTab === 'invoices' ? (_jsx("div", { className: "billing-invoice-register", children: invoiceView === 'topics' ? (_jsxs("section", { className: "billing-invoice-topic-picker", "aria-label": "\u0422\u0435\u043C\u044B \u0441\u0447\u0435\u0442\u043E\u0432", children: [_jsx("div", { className: "billing-panel__subheading", children: _jsxs("div", { children: [_jsx("h3", { children: "\u0421\u0447\u0435\u0442\u0430" }), _jsx("span", { className: "billing-invoice-register__detail-meta", children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0435\u043C\u0443 \u0441\u0447\u0435\u0442\u0430, \u0437\u0430\u0442\u0435\u043C \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u0441\u043F\u0438\u0441\u043E\u043A \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F." })] }) }), _jsxs("div", { className: "billing-invoice-period", "aria-label": "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441\u0447\u0435\u0442\u043E\u0432", children: [_jsxs("div", { className: "billing-invoice-period__presets", children: [_jsx("button", { type: "button", onClick: () => { setInvoicePeriodFrom(''); setInvoicePeriodTo(''); }, children: "\u0412\u0435\u0441\u044C \u043F\u0435\u0440\u0438\u043E\u0434" }), _jsx("button", { type: "button", onClick: () => { setInvoicePeriodFrom(currentMonthStart()); setInvoicePeriodTo(todayDate()); }, children: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446" }), _jsx("button", { type: "button", onClick: () => { const period = previousMonthPeriod(); setInvoicePeriodFrom(period.from); setInvoicePeriodTo(period.to); }, children: "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421" }), _jsx("input", { type: "date", value: invoicePeriodFrom, onChange: (event) => setInvoicePeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E" }), _jsx("input", { type: "date", value: invoicePeriodTo, onChange: (event) => setInvoicePeriodTo(event.target.value) })] })] }), _jsx("div", { className: "billing-invoice-kind-tiles", role: "group", "aria-label": "\u0412\u0438\u0434\u044B \u0441\u0447\u0435\u0442\u043E\u0432", children: invoiceKindTiles.map((tile, index) => (_jsxs("button", { className: `billing-invoice-kind-tile billing-invoice-kind-tile--${tile.kind.toLowerCase()}`, type: "button", onClick: () => {
                                    setInvoiceKindFilter(tile.kind);
                                    setInvoiceView('list');
                                }, children: [_jsx("span", { className: "billing-invoice-kind-tile__index", children: index + 1 }), _jsx("span", { className: "billing-invoice-kind-tile__brand", children: invoiceKindMark(tile.kind) }), _jsxs("span", { className: "billing-invoice-kind-tile__content", children: [_jsx("small", { children: invoiceKindFilterLabel(tile.kind) }), _jsx("strong", { children: invoiceKindTitle(tile.kind) }), _jsx("span", { children: invoiceKindDescription(tile.kind) })] }), _jsxs("span", { className: "billing-invoice-kind-tile__metric", children: [_jsx("b", { children: tile.count }), _jsxs("small", { children: [formatMoney(tile.totalRub), " \u20BD"] })] }), _jsx(ChevronRight, { size: 22, "aria-hidden": "true" })] }, tile.kind))) })] })) : (_jsxs("section", { className: "billing-invoice-register__detail", "aria-label": "\u0421\u0447\u0435\u0442\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("div", { className: "billing-panel__subheading billing-panel__subheading--toolbar", children: [_jsxs("div", { children: [_jsxs("div", { className: "billing-invoice-register__title-row", children: [_jsxs("button", { className: "secondary-button billing-invoice-register__back", type: "button", onClick: () => setInvoiceView('topics'), children: [_jsx(ArrowLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0422\u0435\u043C\u044B \u0441\u0447\u0435\u0442\u043E\u0432" })] }), _jsx("h3", { children: selectedInvoiceClient ? `Счета: ${selectedInvoiceClient.name}` : 'Все счета' })] }), _jsx("span", { className: "billing-invoice-register__detail-meta", children: selectedInvoiceClient
                                                ? `${selectedInvoiceClient.code} · счетов: ${invoiceRegisterInvoices.length}`
                                                : `Все клиенты · счетов: ${invoiceRegisterInvoices.length}` })] }), _jsxs("div", { className: "billing-panel__actions", children: [canWrite ? (_jsxs("button", { className: "primary-button", type: "button", onClick: () => setActiveTab('create'), children: [_jsx(ReceiptText, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u0447\u0435\u0442" })] })) : null, canWrite ? (_jsxs("button", { className: "secondary-button", type: "button", onClick: () => void openFbsMerge(), disabled: !combinedInvoicesClientId ||
                                                selectedInvoiceIds.size === 1 ||
                                                isLoadingFbsMerge ||
                                                isSavingFbsMerge, title: !combinedInvoicesClientId
                                                ? 'Сначала выберите клиента'
                                                : selectedInvoiceIds.size === 1
                                                    ? 'Выберите ещё один черновик'
                                                    : selectedInvoiceIds.size > 1
                                                        ? 'Объединить только отмеченные черновики'
                                                        : 'Собрать все FBS-черновики клиента в один счёт', children: [_jsx(Files, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: isLoadingFbsMerge
                                                        ? 'Проверяю FBS-счета…'
                                                        : selectedInvoiceIds.size > 0
                                                            ? `Объединить выбранные (${selectedInvoiceIds.size})`
                                                            : 'Объединить счета FBS' })] })) : null, _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void downloadCombinedInvoicesPdf(), disabled: !combinedInvoicesClientId || invoices.status !== 'ready' || unpaidIssuedInvoices.length === 0 || isCombiningInvoices, title: combinedInvoicesClientId ? 'Скачать все выставленные и неоплаченные счета клиента одним PDF-файлом' : 'Сначала выберите клиента', children: [_jsx(Files, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: isCombiningInvoices
                                                        ? 'Формирую PDF…'
                                                        : `Неоплаченные счета PDF (${unpaidIssuedInvoices.length})` })] })] })] }), _jsx("div", { className: "billing-panel__list", children: renderInvoices({ ...invoices, data: invoiceRegisterInvoices }, canWrite, (invoice, kind) => void openInvoiceDocument(invoice, kind), (invoice, kind) => void downloadInvoicePdf(invoice, kind), changeInvoiceStatus, setEditingInvoice, !invoiceClientId, selectableInvoiceIds, selectedInvoiceIds, invoiceClientId ? setSelectedInvoiceIds : undefined) })] })) })) : null, activeTab === 'cash-receipt' && canWrite && clients.status === 'ready' && invoices.status === 'ready' ? (_jsx(BillingCashReceiptPanel, { clients: clients.data, invoices: invoices.data, session: session, onPaid: acceptIncomingPayments })) : null, activeTab === 'charges' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "billing-panel__subheading", children: _jsx("h3", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F" }) }), _jsx("div", { className: "billing-panel__list", children: renderCharges(session.accessToken, charges, canWrite, changeChargeStatus, changeFbsLogisticsTrip) })] })) : null, activeTab === 'create' && canWrite ? (_jsxs("div", { className: "billing-create-stack", children: [clients.status === 'ready' ? (_jsx(BillingInvoiceForm, { clients: clients.data, session: session, initialClientId: invoiceClientId || selectedClientId, initialPeriodFrom: invoicePeriodFrom || undefined, initialPeriodTo: invoicePeriodTo || undefined, onCreated: acceptInvoice })) : null, services.status === 'ready' ? _jsx(BillingServiceForm, { session: session, onCreated: acceptService }) : null, clients.status === 'ready' && requests.status === 'ready' && services.status === 'ready' ? (_jsx(BillingChargeForm, { clients: clients.data, requests: requests.data, services: activeServices, session: session, onCreated: acceptCharge })) : null] })) : null, documentPreview ? (_jsx(BillingInvoiceDocumentPreview, { document: documentPreview, onClose: () => setDocumentPreview(null) })) : null, settingsClient ? (_jsx(BillingClientSettingsDialog, { client: settingsClient, session: session, onClose: () => setSettingsClient(null) })) : null, genericMergeInvoices ? (_jsx("div", { className: "billing-invoice-edit-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041E\u0431\u044A\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0441\u0447\u0435\u0442\u043E\u0432", children: _jsxs("section", { className: "billing-invoice-edit-modal__panel billing-generic-merge", children: [_jsxs("header", { className: "billing-invoice-edit-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041D\u043E\u0432\u044B\u0439 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0451\u043D\u043D\u044B\u0439 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A" }), _jsx("h3", { children: genericMergeInvoices[0]?.client?.name ?? 'Выбранный клиент' })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setGenericMergeInvoices(null), title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "billing-invoice-edit-modal__body billing-generic-merge__body", children: [_jsxs("p", { className: "billing-generic-merge__summary", children: ["\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0441\u0447\u0435\u0442\u043E\u0432: ", _jsx("strong", { children: genericMergeInvoices.length }), " \u00B7 \u0441\u0442\u0440\u043E\u043A:", ' ', _jsx("strong", { children: genericMergeStats.sourceRows }), " \u2192 ", _jsx("strong", { children: genericMergeStats.resultRows }), " \u00B7 \u0441\u0443\u043C\u043C\u0430:", ' ', _jsxs("strong", { children: [formatMoney(genericMergeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0)), " \u20BD"] })] }), _jsxs("div", { className: "billing-merge-options", "aria-label": "\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F", children: [_jsxs("label", { className: mergeAggregateSameItems ? 'is-checked' : '', children: [_jsx("input", { checked: mergeAggregateSameItems, type: "checkbox", onChange: (event) => setMergeAggregateSameItems(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u0421\u0443\u043C\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438" }), _jsx("small", { children: "\u041E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u0430\u044F \u0443\u0441\u043B\u0443\u0433\u0430, \u0435\u0434\u0438\u043D\u0438\u0446\u0430 \u0438 \u0446\u0435\u043D\u0430 \u0441\u0442\u0430\u043D\u0443\u0442 \u043E\u0434\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u043E\u0439 \u0441 \u043E\u0431\u0449\u0438\u043C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E\u043C \u0438 \u0441\u0443\u043C\u043C\u043E\u0439." })] })] }), _jsxs("label", { className: mergeExcludeZeroTotalItems ? 'is-checked' : '', children: [_jsx("input", { checked: mergeExcludeZeroTotalItems, type: "checkbox", onChange: (event) => setMergeExcludeZeroTotalItems(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0435 \u0432\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u0441\u0443\u043C\u043C\u043E\u0439 0 \u20BD" }), _jsxs("small", { children: ["\u0411\u0443\u0434\u0435\u0442 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A: ", genericMergeStats.zeroRows, "."] })] })] })] }), _jsx("div", { className: "billing-generic-merge__list", children: genericMergeInvoices.map((invoice) => (_jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: invoice.number }), _jsxs("small", { children: [formatShortDate(invoice.periodFrom), "\u2013", formatShortDate(invoice.periodTo), " \u00B7 ", invoice.items?.length ?? 0, " \u043F\u043E\u0437."] })] }), _jsxs("strong", { children: [formatMoney(Number(invoice.totalRub)), " \u20BD"] })] }, invoice.id))) }), _jsx("p", { className: "billing-generic-merge__hint", children: "\u0411\u0443\u0434\u0435\u0442 \u0441\u043E\u0437\u0434\u0430\u043D \u043E\u0434\u0438\u043D \u043D\u043E\u0432\u044B\u0439 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u0441\u043E \u0432\u0441\u0435\u043C\u0438 \u0441\u0442\u0440\u043E\u043A\u0430\u043C\u0438 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0441\u0447\u0435\u0442\u043E\u0432. \u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0435 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438 \u0431\u0443\u0434\u0443\u0442 \u0437\u0430\u043A\u0440\u044B\u0442\u044B \u043A\u0430\u043A \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0451\u043D\u043D\u044B\u0435." }), _jsxs("div", { className: "billing-generic-merge__footer", children: [_jsx("button", { className: "secondary-button", type: "button", onClick: () => setGenericMergeInvoices(null), children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx("button", { className: "primary-button", type: "button", disabled: isSavingGenericMerge, onClick: () => void submitGenericMerge(), children: isSavingGenericMerge ? 'Объединяю…' : `Объединить ${genericMergeInvoices.length} сч.` })] })] })] }) })) : null, fbsMergePreview ? (_jsx("div", { className: "billing-invoice-edit-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041E\u0431\u044A\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 FBS-\u0441\u0447\u0435\u0442\u043E\u0432", children: _jsxs("section", { className: "billing-invoice-edit-modal__panel billing-fbs-merge", children: [_jsxs("header", { className: "billing-invoice-edit-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u044B\u0439 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A FBS" }), _jsx("h3", { children: fbsMergePreview.client.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setFbsMergePreview(null), title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "billing-invoice-edit-modal__body billing-fbs-merge__body", children: [_jsxs("p", { className: "billing-fbs-merge__summary", children: ["\u0411\u0443\u0434\u0435\u0442 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0435\u043D\u043E \u0441\u0447\u0435\u0442\u043E\u0432: ", _jsx("strong", { children: fbsMergePreview.draftInvoices }), ". FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432: ", _jsx("strong", { children: fbsMergePreview.orders.length }), ". \u0422\u043E\u0432\u0430\u0440\u043E\u0432: ", _jsx("strong", { children: fbsMergePreview.orders.reduce((sum, order) => sum + order.itemCount, 0) }), "."] }), _jsx("p", { className: "billing-fbs-merge__hint", children: "\u0412 \u0433\u043E\u0442\u043E\u0432\u043E\u043C \u0441\u0447\u0451\u0442\u0435 \u043A\u0430\u0436\u0434\u044B\u0439 FBS-\u0437\u0430\u043A\u0430\u0437 \u0431\u0443\u0434\u0435\u0442 \u0443\u043A\u0430\u0437\u0430\u043D \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u043E\u0439 \u0441 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E\u043C \u0442\u043E\u0432\u0430\u0440\u043E\u0432. \u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u043D\u0438\u043C \u0432\u044B\u0435\u0437\u0434\u043E\u043C \u0437\u0430 \u0434\u0435\u043D\u044C \u2014 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u0434\u043D\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E." }), _jsxs("label", { className: `billing-fbs-merge__primary${includeFbsPrimaryProcessing ? ' is-checked' : ''}`, children: [_jsx("input", { checked: includeFbsPrimaryProcessing, disabled: !fbsMergePreview.primaryProcessing.available ||
                                                fbsMergePreview.primaryProcessing.included, type: "checkbox", onChange: (event) => setIncludeFbsPrimaryProcessing(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u0443\u044E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443" }), _jsxs("small", { children: ["\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0438 \u043F\u0430\u043B\u043B\u0435\u0442 \u00B7", ' ', fbsMergePreview.primaryProcessing.itemCount, " \u0448\u0442. \u00B7", ' ', formatMoney(fbsMergePreview.primaryProcessing.totalRub), " \u20BD"] }), !fbsMergePreview.primaryProcessing.available ? (_jsx("em", { children: "\u041D\u0435\u0442 \u0433\u043E\u0442\u043E\u0432\u044B\u0445 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0439 \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u043E\u0439 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0434\u043B\u044F \u044D\u0442\u0438\u0445 FBS-\u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A." })) : fbsMergePreview.primaryProcessing.included ? (_jsx("em", { children: "\u041F\u0435\u0440\u0432\u0438\u0447\u043D\u0430\u044F \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0443\u0436\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430 \u0432 \u044D\u0442\u043E\u0442 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0451\u043D\u043D\u044B\u0439 \u0441\u0447\u0451\u0442." })) : null] })] }), _jsxs("div", { className: "billing-merge-options", "aria-label": "\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0441\u0442\u0440\u043E\u043A \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0451\u043D\u043D\u043E\u0433\u043E FBS-\u0441\u0447\u0451\u0442\u0430", children: [_jsxs("label", { className: mergeAggregateSameItems ? 'is-checked' : '', children: [_jsx("input", { checked: mergeAggregateSameItems, type: "checkbox", onChange: (event) => setMergeAggregateSameItems(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u0421\u0443\u043C\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438" }), _jsx("small", { children: "\u041E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u0430\u044F \u0443\u0441\u043B\u0443\u0433\u0430, \u0435\u0434\u0438\u043D\u0438\u0446\u0430 \u0438 \u0446\u0435\u043D\u0430 \u0441\u0442\u0430\u043D\u0443\u0442 \u043E\u0434\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u043E\u0439." })] })] }), _jsxs("label", { className: mergeExcludeZeroTotalItems ? 'is-checked' : '', children: [_jsx("input", { checked: mergeExcludeZeroTotalItems, type: "checkbox", onChange: (event) => setMergeExcludeZeroTotalItems(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0435 \u0432\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u0441\u0443\u043C\u043C\u043E\u0439 0 \u20BD" }), _jsx("small", { children: "\u0412 \u0441\u0447\u0451\u0442 \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u043D\u0435\u043D\u0443\u043B\u0435\u0432\u043E\u0439 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C\u044E." })] })] })] }), _jsx("div", { className: "billing-fbs-merge__days", children: fbsMergePreview.logisticsDays.map((day) => (_jsxs("label", { className: "billing-fbs-merge__day", children: [_jsxs("span", { children: [_jsx("strong", { children: formatShortDate(day.date) }), _jsxs("small", { children: ["\u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A: ", day.shipments, "; \u0437\u0430\u043A\u0430\u0437\u043E\u0432: ", day.orders, "; \u0442\u043E\u0432\u0430\u0440\u043E\u0432: ", day.itemCount] })] }), _jsxs("span", { className: "billing-fbs-merge__amount", children: [_jsx("input", { min: "0", step: "0.01", type: "number", value: fbsLogisticsAmounts[day.date] ?? '0', onChange: (event) => setFbsLogisticsAmounts((current) => ({
                                                            ...current,
                                                            [day.date]: event.target.value,
                                                        })) }), _jsx("span", { children: "\u20BD" })] })] }, day.date))) }), _jsxs("details", { className: "billing-fbs-merge__orders", children: [_jsx("summary", { children: "FBS-\u0437\u0430\u043A\u0430\u0437\u044B \u0432 \u0441\u0447\u0451\u0442\u0435" }), _jsx("div", { children: fbsMergePreview.orders.map((order) => (_jsxs("span", { children: ["\u2116", order.orderId, " \u2014 ", order.itemCount, " \u0448\u0442."] }, order.orderId))) })] }), _jsxs("div", { className: "billing-fbs-merge__footer", children: [_jsxs("span", { children: ["\u0418\u0442\u043E\u0433\u043E \u0431\u0435\u0437 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438:", ' ', formatMoney(fbsMergePreview.processingTotalRub +
                                                    (includeFbsPrimaryProcessing
                                                        ? fbsMergePreview.primaryProcessing.totalRub
                                                        : 0)), ' ', "\u20BD"] }), _jsx("button", { className: "primary-button", type: "button", disabled: isSavingFbsMerge, onClick: () => void submitFbsMerge(), children: isSavingFbsMerge ? 'Объединяю…' : 'Создать единый FBS-счёт' })] })] })] }) })) : null, editingInvoice && clients.status === 'ready' ? (_jsx("div", { className: "billing-invoice-edit-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u0447\u0435\u0442\u0430", children: _jsxs("section", { className: "billing-invoice-edit-modal__panel", children: [_jsxs("header", { className: "billing-invoice-edit-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: editingInvoice.status === 'ISSUED' ? 'Редактирование выставленного счета' : 'Редактирование черновика' }), _jsx("h3", { children: editingInvoice.number })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setEditingInvoice(null), title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsx("div", { className: "billing-invoice-edit-modal__body", children: _jsx(BillingInvoiceForm, { clients: clients.data, session: session, invoice: editingInvoice, onCreated: acceptEditedInvoice, onMutated: acceptMutatedInvoice }) })] }) })) : null] }));
}
function renderInvoices(state, canWrite, onOpenDocument, onDownloadPdf, onStatusChange, onEdit, showClientColumn = true, selectableInvoiceIds = new Set(), selectedInvoiceIds = new Set(), onInvoiceSelectionChange) {
    if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
        return (_jsxs("p", { className: "panel-message", children: [_jsx(Calculator, { size: 22, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u0447\u0435\u0442\u0430." })] }));
    }
    if (state.status === 'error') {
        return _jsx("p", { className: "panel-message panel-message--error", children: state.error ?? 'Не удалось загрузить счета.' });
    }
    if (state.data.length === 0) {
        return _jsx("p", { className: "panel-message", children: "\u0421\u0447\u0435\u0442\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." });
    }
    return (_jsxs(_Fragment, { children: [state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u0447\u0435\u0442\u0430." }) : null, _jsx(BillingInvoicesTable, { invoices: state.data, canWrite: canWrite, showClientColumn: showClientColumn, selectableInvoiceIds: selectableInvoiceIds, selectedInvoiceIds: selectedInvoiceIds, onInvoiceSelectionChange: onInvoiceSelectionChange, onOpenDocument: onOpenDocument, onDownloadPdf: onDownloadPdf, onStatusChange: onStatusChange, onEdit: onEdit })] }));
}
function renderCharges(accessToken, state, canWrite, onStatusChange, onFbsLogisticsTripChange) {
    if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
        return (_jsxs("p", { className: "panel-message", children: [_jsx(Calculator, { size: 22, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F." })] }));
    }
    if (state.status === 'error') {
        return _jsx("p", { className: "panel-message panel-message--error", children: state.error ?? 'Не удалось загрузить биллинг.' });
    }
    if (state.data.length === 0) {
        return _jsx("p", { className: "panel-message", children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." });
    }
    return (_jsxs(_Fragment, { children: [state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F." }) : null, _jsx(BillingChargesTable, { accessToken: accessToken, charges: state.data, canWrite: canWrite, onStatusChange: onStatusChange, onFbsLogisticsTripChange: onFbsLogisticsTripChange })] }));
}
function renderReconciliation(state) {
    if (state.status === 'idle' || (state.status === 'loading' && !state.data)) {
        return (_jsxs("p", { className: "panel-message", children: [_jsx(Calculator, { size: 22, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u0432\u0435\u0440\u043A\u0443." })] }));
    }
    if (state.status === 'error') {
        return _jsx("p", { className: "panel-message panel-message--error", children: state.error ?? 'Не удалось загрузить сверку.' });
    }
    return (_jsxs(_Fragment, { children: [state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u0432\u0435\u0440\u043A\u0443." }) : null, _jsx(BillingReconciliationPanel, { report: state.data })] }));
}
function billingTopics(canWrite) {
    const topics = [
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
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function actFileName(invoiceNumber) {
    return invoiceNumber.startsWith('INV-') ? `ACT-${invoiceNumber.slice(4)}.pdf` : `ACT-${invoiceNumber}.pdf`;
}
function isSelectableFbsDraft(invoice) {
    return (invoice.status === 'DRAFT' &&
        (invoice.sourceKey?.startsWith('fbs-invoice:') === true ||
            invoice.sourceKey?.startsWith('fbs-primary-invoice:') === true));
}
function isSelectableDraft(invoice) {
    return (invoice.status === 'DRAFT' &&
        Number(invoice.paidRub) <= 0 &&
        invoice.payments.length === 0);
}
function matchesInvoiceKind(invoice, filter) {
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
function invoiceKindFilterLabel(filter) {
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
function invoiceKindTitle(filter) {
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
function invoiceKindDescription(filter) {
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
function invoiceKindMark(filter) {
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
function matchesInvoicePeriod(invoice, from, to) {
    const invoiceFrom = invoice.periodFrom.slice(0, 10);
    const invoiceTo = invoice.periodTo.slice(0, 10);
    return (!from || invoiceTo >= from) && (!to || invoiceFrom <= to);
}
function dateKey(value) {
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
function invoiceKinds(invoice) {
    const kinds = new Set();
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
        const kind = metadata.kind;
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
function safeFileName(value) {
    return value.trim().replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_') || 'client';
}
function nonNegativeMoney(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}
function formatShortDate(value) {
    const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
    const parsed = new Date(datePart ? `${datePart}T00:00:00` : value);
    return Number.isNaN(parsed.getTime())
        ? value
        : new Intl.DateTimeFormat('ru-RU').format(parsed);
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function calculateGenericMergeStats(invoices, aggregateSameItems, excludeZeroTotalItems) {
    const uniqueItems = new Map();
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
function roundPreviewMoney(value) {
    return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
}
