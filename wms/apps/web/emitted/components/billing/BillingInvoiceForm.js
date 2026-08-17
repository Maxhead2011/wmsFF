import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Eye, EyeOff, ListChecks, Plus, ReceiptText, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addBillingInvoicePrimaryProcessing, createBillingInvoice, createManualBillingInvoice, fetchClientBillingServices, fetchClientPaymentAccounts, generateStorageCharge, recheckBillingInvoice, updateBillingInvoicePaymentAccount, updateManualBillingInvoice, upsertClientBillingService, } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
const standardServiceCodes = ['BOX_60_40_40', 'BOX_ASSEMBLY', 'PALLET', 'PALLET_ASSEMBLY'];
export function BillingInvoiceForm({ clients, session, onCreated, onMutated, invoice, initialClientId, initialPeriodFrom, initialPeriodTo, }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: invoice?.clientId ?? initialClientId ?? clients[0]?.id ?? '',
        preferInitialClientId: Boolean(invoice || initialClientId),
    });
    const [periodFrom, setPeriodFrom] = useState(invoice ? dateInput(invoice.periodFrom) : initialPeriodFrom ?? monthStart());
    const [periodTo, setPeriodTo] = useState(invoice ? dateInput(invoice.periodTo) : initialPeriodTo ?? today());
    const [dueDate, setDueDate] = useState(invoice?.dueDate ? dateInput(invoice.dueDate) : '');
    const [comment, setComment] = useState(invoice?.comment ?? '');
    const [isStorageInvoice, setIsStorageInvoice] = useState(false);
    const [isApprovedChargesInvoice, setIsApprovedChargesInvoice] = useState(false);
    const [services, setServices] = useState([]);
    const [paymentAccounts, setPaymentAccounts] = useState([]);
    const [paymentBankAccountId, setPaymentBankAccountId] = useState(invoice?.paymentBankAccountId ?? '');
    const [rows, setRows] = useState([]);
    const [isLoadingServices, setIsLoadingServices] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingPaymentAccount, setIsSavingPaymentAccount] = useState(false);
    const [isSavingPrices, setIsSavingPrices] = useState(false);
    const [isRechecking, setIsRechecking] = useState(false);
    const [isAddingPrimaryProcessing, setIsAddingPrimaryProcessing] = useState(false);
    const [hideZeroCostRows, setHideZeroCostRows] = useState(false);
    const [recheckResult, setRecheckResult] = useState(null);
    const [error, setError] = useState(null);
    const serviceOptions = useMemo(() => services.filter((item) => item.isActive), [services]);
    const invoiceTotal = useMemo(() => rows.reduce((sum, row) => sum + rowTotal(row), 0), [rows]);
    const zeroCostRowsCount = useMemo(() => rows.filter((row) => rowTotal(row) === 0).length, [rows]);
    const visibleRows = useMemo(() => (invoice && hideZeroCostRows ? rows.filter((row) => rowTotal(row) !== 0) : rows), [hideZeroCostRows, invoice, rows]);
    const canChangeInvoiceClient = !invoice ||
        (invoice.source === 'MANUAL' &&
            !invoice.sourceKey &&
            !invoice.requestId &&
            invoice.payments.length === 0 &&
            numberFromInput(invoice.paidRub) === 0);
    const clientChanged = Boolean(invoice && invoice.clientId !== clientId);
    const selectedClient = clients.find((client) => client.id === clientId) ?? null;
    useEffect(() => {
        if (!clientId) {
            setServices([]);
            setRows([]);
            return;
        }
        void loadClientServices(clientId);
        void loadPaymentAccounts(clientId);
    }, [clientId, invoice?.id]);
    useEffect(() => {
        setRecheckResult(null);
        setHideZeroCostRows(false);
    }, [invoice?.id]);
    async function loadClientServices(nextClientId) {
        setIsLoadingServices(true);
        setError(null);
        try {
            const nextServices = await fetchClientBillingServices(session.accessToken, nextClientId);
            setServices(nextServices);
            setRows(invoice ? buildInvoiceRows(invoice, nextServices) : buildInitialRows(nextServices, periodTo));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsLoadingServices(false);
        }
    }
    async function saveClientPrices() {
        if (!clientId) {
            setError('Выберите клиента.');
            return;
        }
        setIsSavingPrices(true);
        setError(null);
        try {
            const pricedRows = rows.filter((row) => row.serviceId);
            await Promise.all(pricedRows.map((row) => upsertClientBillingService(session.accessToken, clientId, {
                serviceId: row.serviceId,
                priceRub: numberFromInput(row.unitPriceRub),
                taxMode: row.taxMode,
                isActive: true,
                comment: row.comment || undefined,
            })));
            const nextServices = await fetchClientBillingServices(session.accessToken, clientId);
            setServices(nextServices);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsSavingPrices(false);
        }
    }
    async function loadPaymentAccounts(nextClientId) {
        try {
            const result = await fetchClientPaymentAccounts(session.accessToken, nextClientId);
            setPaymentAccounts(result.bankAccounts);
            const invoiceAccountId = invoice?.paymentBankAccountId ?? '';
            const selected = result.bankAccounts.find((account) => account.id === invoiceAccountId) ??
                result.bankAccounts.find((account) => account.isDefault) ??
                result.bankAccounts[0];
            setPaymentBankAccountId(selected?.id ?? invoiceAccountId);
        }
        catch (caught) {
            setPaymentAccounts([]);
            setPaymentBankAccountId(invoice?.paymentBankAccountId ?? '');
            setError(errorMessage(caught));
        }
    }
    async function savePaymentAccount() {
        if (!invoice || !paymentAccounts.some((account) => account.id === paymentBankAccountId)) {
            return;
        }
        setIsSavingPaymentAccount(true);
        setError(null);
        try {
            const updated = await updateBillingInvoicePaymentAccount(session.accessToken, invoice.id, paymentBankAccountId);
            onMutated?.(updated);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsSavingPaymentAccount(false);
        }
    }
    async function recheckSavedInvoice() {
        if (!invoice) {
            return;
        }
        setIsRechecking(true);
        setError(null);
        try {
            setRecheckResult(await recheckBillingInvoice(session.accessToken, invoice.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsRechecking(false);
        }
    }
    async function addPrimaryProcessing() {
        if (!invoice) {
            return;
        }
        setIsAddingPrimaryProcessing(true);
        setError(null);
        try {
            const updatedInvoice = await addBillingInvoicePrimaryProcessing(session.accessToken, invoice.id);
            setRows(buildInvoiceRows(updatedInvoice, services));
            setRecheckResult(await recheckBillingInvoice(session.accessToken, updatedInvoice.id));
            onMutated?.(updatedInvoice);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsAddingPrimaryProcessing(false);
        }
    }
    async function submit(event) {
        event.preventDefault();
        if (!clientId) {
            setError('Выберите клиента.');
            return;
        }
        const selectedPaymentAccountId = paymentAccounts.some((account) => account.id === paymentBankAccountId)
            ? paymentBankAccountId
            : undefined;
        if (isApprovedChargesInvoice) {
            setIsSubmitting(true);
            setError(null);
            try {
                const invoice = await createBillingInvoice(session.accessToken, {
                    clientId,
                    periodFrom,
                    periodTo,
                    dueDate: dueDate || undefined,
                    comment: comment || undefined,
                    paymentBankAccountId: selectedPaymentAccountId,
                });
                onCreated(invoice);
                setComment('');
            }
            catch (caught) {
                setError(errorMessage(caught));
            }
            finally {
                setIsSubmitting(false);
            }
            return;
        }
        if (isStorageInvoice) {
            setIsSubmitting(true);
            setError(null);
            try {
                const charge = await generateStorageCharge(session.accessToken, {
                    clientId,
                    periodFrom,
                    periodTo,
                    approve: true,
                    comment: comment || undefined,
                });
                const invoice = await createBillingInvoice(session.accessToken, {
                    clientId,
                    periodFrom,
                    periodTo,
                    dueDate: dueDate || undefined,
                    chargeIds: [charge.id],
                    comment: comment || undefined,
                    paymentBankAccountId: selectedPaymentAccountId,
                });
                onCreated(invoice);
                setComment('');
            }
            catch (caught) {
                setError(errorMessage(caught));
            }
            finally {
                setIsSubmitting(false);
            }
            return;
        }
        const invoiceRows = rows
            .filter((row) => numberFromInput(row.quantity) > 0)
            .map((row) => ({
            invoiceItemId: row.invoiceItemId,
            serviceId: row.serviceId || undefined,
            description: row.description || undefined,
            unit: row.unit,
            quantity: numberFromInput(row.quantity),
            unitPriceRub: numberFromInput(row.unitPriceRub),
            taxMode: row.taxMode,
            serviceDate: row.serviceDate || undefined,
            comment: row.comment || undefined,
        }));
        if (invoiceRows.length === 0) {
            setError('Заполните хотя бы одну строку счета с количеством больше нуля.');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const savedInvoice = await (invoice
                ? updateManualBillingInvoice(session.accessToken, invoice.id, {
                    clientId,
                    periodFrom,
                    periodTo,
                    dueDate: dueDate || undefined,
                    rows: invoiceRows,
                    comment: comment || undefined,
                    paymentBankAccountId: selectedPaymentAccountId,
                })
                : createManualBillingInvoice(session.accessToken, {
                    clientId,
                    periodFrom,
                    periodTo,
                    dueDate: dueDate || undefined,
                    rows: invoiceRows,
                    comment: comment || undefined,
                    paymentBankAccountId: selectedPaymentAccountId,
                }));
            onCreated(savedInvoice);
            if (!invoice) {
                setComment('');
                setRows((current) => current.map((row) => ({ ...row, quantity: '0' })));
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setIsSubmitting(false);
        }
    }
    function updateRow(key, patch) {
        setRows((current) => current.map((row) => {
            if (row.key !== key) {
                return row;
            }
            const next = { ...row, ...patch };
            if (patch.serviceId !== undefined) {
                const selected = services.find((item) => item.service.id === patch.serviceId);
                if (selected) {
                    next.serviceSearch = serviceLabel(selected);
                    next.description = selected.service.name;
                    next.unit = selected.service.unit;
                    next.unitPriceRub = String(numberFromInput(selected.priceRub));
                    next.taxMode = selected.taxMode;
                }
            }
            return next;
        }));
    }
    function updateServiceSearch(key, value) {
        const selected = serviceOptions.find((item) => normalizedServiceLabel(item) === normalizeSearch(value) || normalizeSearch(item.service.code) === normalizeSearch(value));
        if (selected) {
            selectService(key, selected);
            return;
        }
        setRows((current) => current.map((row) => row.key === key
            ? {
                ...row,
                serviceId: '',
                serviceSearch: value,
                description: value,
            }
            : row));
    }
    function selectService(key, item) {
        updateRow(key, {
            serviceId: item.service.id,
            serviceSearch: serviceLabel(item),
            description: item.service.name,
            unit: item.service.unit,
            unitPriceRub: String(numberFromInput(item.priceRub)),
            taxMode: item.taxMode,
        });
    }
    function addRow() {
        setRows((current) => [...current, emptyRow(periodTo)]);
    }
    function deleteRow(key) {
        setRows((current) => current.filter((row) => row.key !== key));
    }
    return (_jsxs("form", { className: "billing-form", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "billing-fields billing-fields--invoice", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { disabled: !canChangeInvoiceClient, value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id))) }), invoice && canChangeInvoiceClient ? (_jsx("small", { children: "\u041E\u0448\u0438\u0431\u043E\u0447\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u0434\u043E \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438 \u043E\u043F\u043B\u0430\u0442\u044B." })) : null] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u043F\u043B\u0430\u0442\u0438\u0442\u044C \u0434\u043E" }), _jsx("input", { type: "date", value: dueDate, onChange: (event) => setDueDate(event.target.value) })] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442 \u0434\u043B\u044F \u043E\u043F\u043B\u0430\u0442\u044B" }), _jsxs("select", { disabled: paymentAccounts.length === 0, value: paymentBankAccountId, onChange: (event) => setPaymentBankAccountId(event.target.value), children: [invoice?.paymentBankAccountId &&
                                        !paymentAccounts.some((account) => account.id === invoice.paymentBankAccountId) ? (_jsxs("option", { value: invoice.paymentBankAccountId, children: ["\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0439 \u0432 \u0441\u0447\u0451\u0442\u0435: ", invoice.paymentBankName || 'банк', " \u00B7 ", maskAccount(invoice.paymentBankAccount)] })) : null, paymentAccounts.length === 0 ? _jsx("option", { value: "", children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u044B" }) : null, paymentAccounts.map((account) => (_jsxs("option", { value: account.id, children: [account.isDefault ? 'Основной · ' : '', account.bankName, " \u00B7 ", maskAccount(account.bankAccount)] }, account.id)))] }), paymentAccounts.length > 0 ? (_jsx("small", { children: "\u042D\u0442\u043E\u0442 \u0441\u0447\u0451\u0442 \u0431\u0443\u0434\u0435\u0442 \u0443\u043A\u0430\u0437\u0430\u043D \u0432 PDF \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0435." })) : null, invoice ? (_jsx("button", { className: "secondary-button billing-payment-account-save", disabled: isSavingPaymentAccount || !paymentAccounts.some((account) => account.id === paymentBankAccountId), type: "button", onClick: () => void savePaymentAccount(), children: isSavingPaymentAccount ? 'Сохраняю…' : 'Сохранить РС в этом счёте' })) : null] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u0434\u043B\u044F \u0441\u0447\u0435\u0442\u0430" })] })] }), clientChanged ? (_jsxs("div", { className: "billing-client-change-warning", role: "status", children: ["\u041F\u043E\u0441\u043B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0441\u0447\u0451\u0442 \u2116", invoice?.number, " \u0438 \u0435\u0433\u043E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0431\u0443\u0434\u0443\u0442 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0443", ' ', _jsx("strong", { children: selectedClient?.name ?? 'из списка' }), ". \u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442 \u0434\u043B\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u0431\u0443\u0434\u0435\u0442 \u0432\u0437\u044F\u0442 \u0438\u0437 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A \u043D\u043E\u0432\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430."] })) : null, !invoice ? _jsxs("label", { className: "billing-checkbox", children: [_jsx("input", { checked: isApprovedChargesInvoice, type: "checkbox", onChange: (event) => {
                            setIsApprovedChargesInvoice(event.target.checked);
                            if (event.target.checked) {
                                setIsStorageInvoice(false);
                            }
                        } }), _jsx("span", { children: "\u0412\u0441\u0435 \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043D\u044B\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434" })] }) : null, !invoice ? _jsxs("label", { className: "billing-checkbox", children: [_jsx("input", { checked: isStorageInvoice, type: "checkbox", onChange: (event) => {
                            setIsStorageInvoice(event.target.checked);
                            if (event.target.checked) {
                                setIsApprovedChargesInvoice(false);
                            }
                        } }), _jsx("span", { children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434" })] }) : null, !isStorageInvoice && !isApprovedChargesInvoice ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "billing-invoice-toolbar", children: [_jsxs("button", { className: "secondary-button", type: "button", onClick: addRow, children: [_jsx(Plus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443" })] }), _jsxs("button", { className: "secondary-button", disabled: isSavingPrices || rows.length === 0, type: "button", onClick: () => void saveClientPrices(), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingPrices ? 'Сохраняю' : 'Сохранить цены клиента' })] }), invoice ? (_jsxs("button", { className: "secondary-button", disabled: isRechecking, type: "button", onClick: () => void recheckSavedInvoice(), children: [_jsx(ListChecks, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isRechecking ? 'Проверяю счёт…' : 'Перепроверить счёт' })] })) : null, invoice ? (_jsxs("button", { "aria-pressed": hideZeroCostRows, className: "secondary-button", disabled: zeroCostRowsCount === 0, type: "button", onClick: () => setHideZeroCostRows((current) => !current), children: [hideZeroCostRows ? _jsx(Eye, { size: 16, "aria-hidden": "true" }) : _jsx(EyeOff, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: hideZeroCostRows ? `Показать нулевые (${zeroCostRowsCount})` : `Скрыть с нулевой стоимостью (${zeroCostRowsCount})` })] })) : null, _jsxs("strong", { children: ["\u0418\u0442\u043E\u0433\u043E: ", formatMoney(invoiceTotal), " \u20BD"] })] }), recheckResult ? (_jsxs("section", { className: `billing-invoice-recheck billing-invoice-recheck--${recheckResult.status.toLowerCase()}`, "aria-label": "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u0435\u0440\u0435\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u0447\u0435\u0442\u0430", children: [_jsxs("header", { children: [_jsxs("span", { children: [_jsx("strong", { children: recheckResult.status === 'OK'
                                                    ? 'Счёт проверен'
                                                    : recheckResult.status === 'WARNING'
                                                        ? 'Нужно обратить внимание'
                                                        : 'Найдены ошибки' }), _jsxs("small", { children: [recheckResult.kind === 'FBS' ? 'FBS-счёт' : 'Обычный счёт', " \u00B7 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F"] })] }), _jsxs("b", { children: [recheckResult.checks.filter((check) => check.status !== 'OK').length, " \u0437\u0430\u043C\u0435\u0447."] })] }), _jsxs("div", { className: "billing-invoice-recheck__metrics", children: [_jsxs("span", { children: [_jsx("b", { children: recheckResult.summary.serviceRows }), _jsx("small", { children: "\u0443\u0441\u043B\u0443\u0433" })] }), _jsxs("span", { children: [_jsx("b", { children: recheckResult.summary.zeroCostRows }), _jsx("small", { children: "\u043D\u0443\u043B\u0435\u0432\u044B\u0445" })] }), _jsxs("span", { children: [_jsx("b", { children: recheckResult.summary.unbilledCharges }), _jsx("small", { children: "\u0432\u043D\u0435 \u0441\u0447\u0435\u0442\u043E\u0432" })] }), recheckResult.kind === 'FBS' ? (_jsxs(_Fragment, { children: [_jsxs("span", { children: [_jsx("b", { children: recheckResult.summary.fbsOrders }), _jsx("small", { children: "\u0437\u0430\u043A\u0430\u0437\u043E\u0432 FBS" })] }), _jsxs("span", { children: [_jsx("b", { children: formatQuantity(recheckResult.summary.fbsItems) }), _jsx("small", { children: "\u0442\u043E\u0432\u0430\u0440\u043E\u0432 FBS" })] })] })) : null] }), _jsx("div", { className: "billing-invoice-recheck__checks", children: recheckResult.checks.map((check) => (_jsxs("article", { className: `is-${check.status.toLowerCase()}`, children: [_jsx("span", { "aria-hidden": "true", children: check.status === 'OK' ? '✓' : check.status === 'WARNING' ? '!' : '×' }), _jsxs("div", { children: [_jsx("strong", { children: check.label }), _jsx("small", { children: check.message }), check.code === 'FBS_PRIMARY_PROCESSING' && check.status === 'ERROR' ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "secondary-button billing-invoice-recheck__action", disabled: isAddingPrimaryProcessing ||
                                                                !recheckResult.actions.addPrimaryProcessing.available, type: "button", onClick: () => void addPrimaryProcessing(), children: [_jsx(Plus, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isAddingPrimaryProcessing
                                                                        ? 'Добавляю первичную обработку…'
                                                                        : 'Добавить первичную обработку' })] }), !recheckResult.actions.addPrimaryProcessing.available &&
                                                            recheckResult.actions.addPrimaryProcessing.reason ? (_jsx("small", { className: "billing-invoice-recheck__action-reason", children: recheckResult.actions.addPrimaryProcessing.reason })) : null] })) : null] })] }, check.code))) }), recheckResult.unbilledServices.length > 0 ? (_jsxs("details", { children: [_jsxs("summary", { children: ["\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0438 \u0432\u043D\u0435 \u0441\u0447\u0435\u0442\u043E\u0432 (", recheckResult.unbilledServices.length, ")"] }), _jsx("div", { className: "billing-invoice-recheck__unbilled", children: recheckResult.unbilledServices.map((service) => (_jsxs("span", { children: [_jsx("strong", { children: service.name }), _jsxs("small", { children: [formatQuantity(service.quantity), " \u00D7 ", formatMoney(service.unitPriceRub), " \u20BD = ", formatMoney(service.totalRub), " \u20BD"] })] }, service.chargeId))) })] })) : null] })) : null, _jsx("div", { className: "billing-table-wrap", children: _jsxs("table", { className: "data-table billing-table billing-table--invoice-form", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0423\u0441\u043B\u0443\u0433\u0430" }), _jsx("th", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0415\u0434." }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0426\u0435\u043D\u0430" }), _jsx("th", { children: "\u041D\u0430\u043B\u043E\u0433" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { "aria-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsxs("tbody", { children: [visibleRows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("div", { className: "billing-service-combobox", children: [_jsx("input", { autoComplete: "off", list: `billing-services-${row.key}`, value: row.serviceSearch, onChange: (event) => updateServiceSearch(row.key, event.target.value), placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443" }), _jsx("datalist", { id: `billing-services-${row.key}`, children: filteredServiceOptions(serviceOptions, row.serviceSearch).map((item) => (_jsx("option", { label: item.service.code, value: item.service.name }, item.service.id))) })] }) }), _jsx("td", { children: _jsx("input", { value: row.description, onChange: (event) => updateRow(row.key, { description: event.target.value }) }) }), _jsx("td", { children: _jsx("select", { value: row.unit, onChange: (event) => updateRow(row.key, { unit: event.target.value }), children: unitOptions.map((unit) => (_jsx("option", { value: unit, children: unitLabel(unit) }, unit))) }) }), _jsx("td", { children: _jsx("input", { min: "0", step: "0.001", type: "number", value: row.quantity, onChange: (event) => updateRow(row.key, { quantity: event.target.value }) }) }), _jsx("td", { children: _jsx("input", { min: "0", step: "0.01", type: "number", value: row.unitPriceRub, onChange: (event) => updateRow(row.key, { unitPriceRub: event.target.value }) }) }), _jsx("td", { children: _jsxs("select", { value: row.taxMode, onChange: (event) => updateRow(row.key, { taxMode: event.target.value }), children: [_jsx("option", { value: "INCLUDED", children: "\u0412 \u0446\u0435\u043D\u0435" }), _jsx("option", { value: "ADD_6_PERCENT", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C 6%" })] }) }), _jsxs("td", { children: [formatMoney(rowTotal(row)), " \u20BD"] }), _jsx("td", { children: _jsx("button", { className: "icon-button", type: "button", onClick: () => deleteRow(row.key), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", "aria-label": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", children: _jsx(Trash2, { size: 16, "aria-hidden": "true" }) }) })] }, row.key))), hideZeroCostRows && visibleRows.length === 0 && !isLoadingServices ? (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "\u0412\u0441\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u043D\u0443\u043B\u0435\u0432\u043E\u0439 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C\u044E \u0441\u043A\u0440\u044B\u0442\u044B." }) })) : null, isLoadingServices ? (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0443\u0441\u043B\u0443\u0433\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." }) })) : null] })] }) })] })) : (_jsx("p", { className: "panel-message", children: isApprovedChargesInvoice
                    ? 'Счет будет заполнен всеми утвержденными начислениями клиента за выбранный период, которые еще не вошли в другие счета.'
                    : 'Счет будет заполнен начислением хранения за выбранный период.' })), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button billing-submit", disabled: isSubmitting || clients.length === 0, type: "submit", children: [_jsx(ReceiptText, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохраняю' : invoice ? 'Сохранить изменения' : 'Сформировать счет' })] })] }));
}
const unitOptions = ['SERVICE', 'PIECE', 'BOX', 'PALLET', 'LITER', 'LITER_DAY', 'DAY', 'HOUR'];
function buildInitialRows(services, serviceDate) {
    const standardRows = standardServiceCodes
        .map((code) => services.find((item) => item.service.code === code))
        .filter((item) => Boolean(item))
        .map((item) => rowFromService(item, serviceDate, true));
    return standardRows.length ? standardRows : [emptyRow(serviceDate)];
}
function buildInvoiceRows(invoice, services) {
    return invoice.items.map((item) => {
        const service = services.find((candidate) => candidate.service.id === item.charge?.serviceId);
        const pricing = invoiceItemPricing(item);
        return {
            key: item.id,
            invoiceItemId: item.id,
            serviceId: service?.service.id ?? item.charge?.serviceId ?? '',
            serviceSearch: service?.service.name ?? item.description,
            description: item.description,
            unit: item.unit,
            quantity: String(item.quantity),
            unitPriceRub: String(pricing.priceBeforeTaxRub),
            taxMode: pricing.taxMode,
            serviceDate: dateInput(item.serviceDate),
            comment: '',
            isStandard: Boolean(service && standardServiceCodes.includes(service.service.code)),
        };
    });
}
function invoiceItemPricing(item) {
    const finalPriceRub = numberFromInput(item.unitPriceRub);
    const metadata = isRecord(item.charge?.metadata) ? item.charge.metadata : null;
    const taxMode = isBillingPriceTaxMode(metadata?.taxMode) ? metadata.taxMode : 'INCLUDED';
    const storedPriceBeforeTaxRub = numberFromUnknown(metadata?.priceBeforeTaxRub);
    if (storedPriceBeforeTaxRub !== null) {
        return { priceBeforeTaxRub: storedPriceBeforeTaxRub, taxMode };
    }
    // Older invoice rows may have the tax mode but no original price saved.
    // Recover the editable base price so saving the draft cannot add the tax twice.
    return {
        priceBeforeTaxRub: taxMode === 'ADD_6_PERCENT' ? roundMoney(finalPriceRub * 0.94) : finalPriceRub,
        taxMode,
    };
}
function isBillingPriceTaxMode(value) {
    return value === 'INCLUDED' || value === 'ADD_6_PERCENT';
}
function numberFromUnknown(value) {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function rowFromService(item, serviceDate, isStandard) {
    return {
        key: `${item.service.id}-${Date.now()}-${Math.random()}`,
        serviceId: item.service.id,
        serviceSearch: serviceLabel(item),
        description: item.service.name,
        unit: item.service.unit,
        quantity: '0',
        unitPriceRub: String(numberFromInput(item.priceRub)),
        taxMode: item.taxMode,
        serviceDate,
        comment: '',
        isStandard,
    };
}
function emptyRow(serviceDate) {
    return {
        key: `manual-${Date.now()}-${Math.random()}`,
        serviceId: '',
        serviceSearch: '',
        description: '',
        unit: 'SERVICE',
        quantity: '0',
        unitPriceRub: '0',
        taxMode: 'INCLUDED',
        serviceDate,
        comment: '',
        isStandard: false,
    };
}
function rowTotal(row) {
    const baseTotal = numberFromInput(row.quantity) * numberFromInput(row.unitPriceRub);
    return applyTaxMode(baseTotal, row.taxMode);
}
function applyTaxMode(value, taxMode) {
    return taxMode === 'ADD_6_PERCENT' ? roundMoney((value / 94) * 100) : value;
}
function numberFromInput(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function filteredServiceOptions(options, query) {
    const normalized = normalizeSearch(query);
    const filtered = normalized
        ? options.filter((item) => normalizeSearch(item.service.name).startsWith(normalized) ||
            normalizeSearch(item.service.code).startsWith(normalized))
        : options;
    return filtered.slice(0, 8);
}
function serviceLabel(item) {
    return item.service.name;
}
function normalizedServiceLabel(item) {
    return normalizeSearch(serviceLabel(item));
}
function normalizeSearch(value) {
    return value.trim().toLocaleLowerCase('ru-RU');
}
function today() {
    return formatDateInput(new Date());
}
function monthStart() {
    const date = new Date();
    date.setDate(1);
    return formatDateInput(date);
}
function formatDateInput(date) {
    return date.toISOString().slice(0, 10);
}
function dateInput(value) {
    return new Date(value).toISOString().slice(0, 10);
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}
function formatQuantity(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}
function unitLabel(unit) {
    const labels = {
        SERVICE: 'услуга',
        PIECE: 'шт',
        BOX: 'короб',
        PALLET: 'паллет',
        LITER: 'литр',
        LITER_DAY: 'литро-день',
        DAY: 'день',
        HOUR: 'час',
    };
    return labels[unit];
}
function maskAccount(value) {
    const normalized = value?.replace(/\s+/g, '') ?? '';
    return normalized ? `•••• ${normalized.slice(-4)}` : 'счёт не указан';
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
