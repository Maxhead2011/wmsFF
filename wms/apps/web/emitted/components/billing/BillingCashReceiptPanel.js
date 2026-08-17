import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowDownToLine, CheckCircle2, CircleDollarSign, Eraser, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { createIncomingPayment, } from '../../lib/api';
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
});
export function BillingCashReceiptPanel({ clients, invoices, session, onPaid }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [statusFilter, setStatusFilter] = useState('all');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [totalRub, setTotalRub] = useState('');
    const [allocations, setAllocations] = useState({});
    const [paidAt, setPaidAt] = useState(today());
    const [method, setMethod] = useState('Банк');
    const [reference, setReference] = useState('');
    const [comment, setComment] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const selectedClient = clients.find((client) => client.id === clientId) ?? null;
    const clientPayableInvoices = useMemo(() => invoices
        .filter((invoice) => invoice.clientId === clientId &&
        invoice.status !== 'CANCELLED' &&
        invoice.status !== 'PAID' &&
        !isMergedSourceInvoice(invoice) &&
        remainingRub(invoice) > 0)
        .sort((left, right) => new Date(left.dueDate ?? left.periodTo).getTime() - new Date(right.dueDate ?? right.periodTo).getTime() ||
        left.number.localeCompare(right.number, 'ru-RU', { numeric: true })), [clientId, invoices]);
    const payableInvoices = useMemo(() => clientPayableInvoices.filter((invoice) => {
        if (statusFilter === 'OVERDUE' && !isInvoiceOverdue(invoice))
            return false;
        if (statusFilter !== 'all' && statusFilter !== 'OVERDUE' && invoice.status !== statusFilter)
            return false;
        const paidRub = Number(invoice.paidRub);
        if (paymentFilter === 'unpaid' && paidRub > 0.009)
            return false;
        if (paymentFilter === 'partial' && paidRub <= 0.009)
            return false;
        return true;
    }), [clientPayableInvoices, paymentFilter, statusFilter]);
    const clientDebt = clientPayableInvoices.reduce((sum, invoice) => sum + remainingRub(invoice), 0);
    const allocatedRub = roundMoney(Object.values(allocations).reduce((sum, value) => sum + positiveNumber(value), 0));
    const incomingRub = positiveNumber(totalRub);
    const undistributedRub = roundMoney(incomingRub - allocatedRub);
    const isBalanced = incomingRub > 0 && Math.abs(undistributedRub) < 0.01;
    function selectClient(nextClientId) {
        setClientId(nextClientId);
        setTotalRub('');
        setAllocations({});
        clearFeedback();
    }
    function distributeAutomatically() {
        clearFeedback();
        if (!clientId) {
            setError('Сначала выберите клиента.');
            return;
        }
        if (incomingRub <= 0) {
            setError('Укажите сумму поступления.');
            return;
        }
        if (incomingRub > clientDebt + 0.009) {
            setError(`Сумма поступления превышает долг по счетам на ${money(incomingRub - clientDebt)}.`);
            return;
        }
        let left = incomingRub;
        const next = {};
        for (const invoice of payableInvoices) {
            if (left <= 0.009)
                break;
            const amount = roundMoney(Math.min(left, remainingRub(invoice)));
            if (amount > 0) {
                next[invoice.id] = amount.toFixed(2);
                left = roundMoney(left - amount);
            }
        }
        setAllocations(next);
    }
    function toggleInvoice(invoice) {
        clearFeedback();
        setAllocations((current) => {
            const next = { ...current };
            if (next[invoice.id] !== undefined) {
                delete next[invoice.id];
            }
            else {
                next[invoice.id] = remainingRub(invoice).toFixed(2);
            }
            setTotalRub(roundMoney(Object.values(next).reduce((sum, value) => sum + positiveNumber(value), 0)).toFixed(2));
            return next;
        });
    }
    async function submit(event) {
        event.preventDefault();
        clearFeedback();
        if (!clientId || !selectedClient) {
            setError('Выберите клиента.');
            return;
        }
        if (!isBalanced) {
            setError('Распределите всю сумму поступления по счетам клиента.');
            return;
        }
        const paymentAllocations = payableInvoices
            .map((invoice) => ({ invoiceId: invoice.id, amountRub: positiveNumber(allocations[invoice.id] ?? '') }))
            .filter((allocation) => allocation.amountRub > 0);
        if (paymentAllocations.length === 0) {
            setError('Выберите хотя бы один счёт для оплаты.');
            return;
        }
        setSubmitting(true);
        try {
            const result = await createIncomingPayment(session.accessToken, {
                clientId,
                totalRub: incomingRub,
                allocations: paymentAllocations,
                paidAt,
                method: method || undefined,
                reference: reference || undefined,
                comment: comment || undefined,
            });
            onPaid(result.invoices);
            setMessage(`Приход ${money(result.totalRub)} проведён по ${result.invoices.length} счёт(ам).`);
            setTotalRub('');
            setAllocations({});
            setReference('');
            setComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось провести приход денежных средств.');
        }
        finally {
            setSubmitting(false);
        }
    }
    function clearFeedback() {
        setError('');
        setMessage('');
    }
    return (_jsxs("form", { className: "billing-cash-receipt", onSubmit: (event) => void submit(event), children: [_jsxs("header", { className: "billing-cash-receipt__heading", children: [_jsx("div", { className: "billing-cash-receipt__icon", children: _jsx(ArrowDownToLine, { size: 22 }) }), _jsxs("div", { children: [_jsx("span", { children: "\u0411\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u0438\u0435 \u0438 \u043F\u0440\u043E\u0447\u0438\u0435 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F" }), _jsx("h3", { children: "\u041F\u0440\u0438\u0445\u043E\u0434 \u0434\u0435\u043D\u0435\u0436\u043D\u044B\u0445 \u0441\u0440\u0435\u0434\u0441\u0442\u0432" }), _jsx("p", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u0435 \u043F\u043E\u0441\u0442\u0443\u043F\u0438\u0432\u0448\u0443\u044E \u0441\u0443\u043C\u043C\u0443 \u043F\u043E \u0435\u0433\u043E \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u043C \u0441\u0447\u0435\u0442\u0430\u043C." })] })] }), _jsxs("div", { className: "billing-cash-receipt__fields", children: [_jsxs("label", { className: "billing-cash-receipt__client", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => selectClient(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0443\u043C\u043C\u0430 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F" }), _jsx("input", { min: "0.01", step: "0.01", type: "number", value: totalRub, onChange: (event) => { setTotalRub(event.target.value); clearFeedback(); }, placeholder: "0,00" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F" }), _jsx("input", { type: "date", value: paidAt, onChange: (event) => setPaidAt(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043F\u043E\u0441\u043E\u0431" }), _jsxs("select", { value: method, onChange: (event) => setMethod(event.target.value), children: [_jsx("option", { value: "\u0411\u0430\u043D\u043A", children: "\u0411\u0430\u043D\u043A" }), _jsx("option", { value: "\u0421\u0411\u041F", children: "\u0421\u0411\u041F" }), _jsx("option", { value: "\u041A\u0430\u0441\u0441\u0430", children: "\u041A\u0430\u0441\u0441\u0430" }), _jsx("option", { value: "\u0412\u0437\u0430\u0438\u043C\u043E\u0437\u0430\u0447\u0451\u0442", children: "\u0412\u0437\u0430\u0438\u043C\u043E\u0437\u0430\u0447\u0451\u0442" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u043F\u043B\u0430\u0442\u0435\u0436\u0430" }), _jsx("input", { value: reference, onChange: (event) => setReference(event.target.value), placeholder: "\u041F\u043B\u0430\u0442\u0451\u0436\u043D\u043E\u0435 \u043F\u043E\u0440\u0443\u0447\u0435\u043D\u0438\u0435" })] }), _jsxs("label", { className: "billing-cash-receipt__comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E" })] })] }), selectedClient ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "billing-cash-receipt__filters", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 \u0441\u0447\u0451\u0442\u0430" }), _jsxs("select", { value: statusFilter, onChange: (event) => { setStatusFilter(event.target.value); setAllocations({}); }, children: [_jsx("option", { value: "all", children: "\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B" }), _jsx("option", { value: "DRAFT", children: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438" }), _jsx("option", { value: "ISSUED", children: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435" }), _jsx("option", { value: "OVERDUE", children: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043E\u043F\u043B\u0430\u0442\u044B" }), _jsxs("select", { value: paymentFilter, onChange: (event) => { setPaymentFilter(event.target.value); setAllocations({}); }, children: [_jsx("option", { value: "all", children: "\u0412\u0441\u0435 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u0435" }), _jsx("option", { value: "unpaid", children: "\u041E\u043F\u043B\u0430\u0442 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E" }), _jsx("option", { value: "partial", children: "\u0427\u0430\u0441\u0442\u0438\u0447\u043D\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u0435" })] })] }), _jsxs("small", { children: ["\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0441\u0447\u0435\u0442\u043E\u0432: ", _jsx("strong", { children: payableInvoices.length }), " \u0438\u0437 ", clientPayableInvoices.length, ". \u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430, \u0443\u0436\u0435 \u0432\u043E\u0448\u0435\u0434\u0448\u0438\u0435 \u0432 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0451\u043D\u043D\u044B\u0439, \u0441\u043A\u0440\u044B\u0442\u044B."] })] }), _jsxs("div", { className: "billing-cash-receipt__summary", children: [_jsxs("article", { children: [_jsx("small", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("strong", { children: selectedClient.name }), _jsx("span", { children: selectedClient.code })] }), _jsxs("article", { children: [_jsx("small", { children: "\u0414\u043E\u043B\u0433 \u043F\u043E \u0441\u0447\u0435\u0442\u0430\u043C" }), _jsx("strong", { children: money(clientDebt) }), _jsxs("span", { children: [payableInvoices.length, " \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u0445"] })] }), _jsxs("article", { children: [_jsx("small", { children: "\u0421\u0443\u043C\u043C\u0430 \u043F\u0440\u0438\u0445\u043E\u0434\u0430" }), _jsx("strong", { children: money(incomingRub) }), _jsx("span", { children: "\u043F\u043E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0443" })] }), _jsxs("article", { className: isBalanced ? 'is-ok' : undistributedRub < 0 ? 'is-error' : '', children: [_jsx("small", { children: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u043E" }), _jsx("strong", { children: money(allocatedRub) }), _jsx("span", { children: isBalanced ? 'суммы совпадают' : `осталось ${money(undistributedRub)}` })] })] }), _jsxs("div", { className: "billing-cash-receipt__toolbar", children: [_jsxs("button", { className: "secondary-button", type: "button", onClick: distributeAutomatically, disabled: incomingRub <= 0 || payableInvoices.length === 0, children: [_jsx(WandSparkles, { size: 16 }), _jsx("span", { children: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => { setAllocations({}); setTotalRub(''); clearFeedback(); }, disabled: allocatedRub === 0 && incomingRub === 0, children: [_jsx(Eraser, { size: 16 }), _jsx("span", { children: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C" })] })] }), _jsx("div", { className: "billing-cash-receipt__table-wrap", children: _jsxs("table", { className: "billing-cash-receipt__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { "aria-label": "\u0412\u044B\u0431\u043E\u0440" }), _jsx("th", { children: "\u0421\u0447\u0451\u0442" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041E\u043F\u043B\u0430\u0442\u0438\u0442\u044C \u0434\u043E" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { children: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u0417\u0430\u0447\u0435\u0441\u0442\u044C" })] }) }), _jsxs("tbody", { children: [payableInvoices.map((invoice) => {
                                            const selected = allocations[invoice.id] !== undefined;
                                            return (_jsxs("tr", { className: selected ? 'is-selected' : '', children: [_jsx("td", { children: _jsx("input", { "aria-label": `Выбрать счёт ${invoice.number}`, checked: selected, type: "checkbox", onChange: () => toggleInvoice(invoice) }) }), _jsxs("td", { children: [_jsx("strong", { children: invoice.number }), _jsxs("small", { children: [formatDate(invoice.periodFrom), " \u2014 ", formatDate(invoice.periodTo)] })] }), _jsx("td", { children: _jsx("span", { className: `billing-cash-receipt__status is-${invoice.status.toLowerCase()}`, children: invoice.status === 'DRAFT' ? 'Черновик' : 'Выставлен' }) }), _jsx("td", { children: invoice.dueDate ? formatDate(invoice.dueDate) : 'не указан' }), _jsx("td", { children: money(Number(invoice.totalRub)) }), _jsx("td", { children: money(Number(invoice.paidRub)) }), _jsx("td", { children: _jsx("strong", { children: money(remainingRub(invoice)) }) }), _jsx("td", { children: _jsx("input", { "aria-label": `Сумма оплаты счета ${invoice.number}`, disabled: !selected, max: remainingRub(invoice), min: "0.01", step: "0.01", type: "number", value: allocations[invoice.id] ?? '', onChange: (event) => setAllocations((current) => ({ ...current, [invoice.id]: event.target.value })) }) })] }, invoice.id));
                                        }), payableInvoices.length === 0 ? _jsx("tr", { children: _jsx("td", { colSpan: 8, className: "billing-cash-receipt__empty", children: "\u0423 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043D\u0435\u0442 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u0445 \u0441\u0447\u0435\u0442\u043E\u0432." }) }) : null] })] }) })] })) : (_jsxs("div", { className: "billing-cash-receipt__prompt", children: [_jsx(CircleDollarSign, { size: 24 }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u2014 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0435\u0433\u043E \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430." })] })), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsxs("p", { className: "billing-cash-receipt__message", children: [_jsx(CheckCircle2, { size: 17 }), message] }) : null, _jsxs("button", { className: "primary-button billing-cash-receipt__submit", disabled: isSubmitting || !selectedClient || !isBalanced, type: "submit", children: [_jsx(ArrowDownToLine, { size: 17 }), _jsx("span", { children: isSubmitting ? 'Провожу…' : `Провести приход ${incomingRub > 0 ? money(incomingRub) : ''}` })] })] }));
}
function remainingRub(invoice) {
    return roundMoney(Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub)));
}
function isMergedSourceInvoice(invoice) {
    const comment = invoice.comment?.trim() ?? '';
    return comment.startsWith('Объединено в FBS-счёт') || comment.startsWith('Объединено в счёт');
}
function isInvoiceOverdue(invoice) {
    if (!invoice.dueDate || invoice.status !== 'ISSUED')
        return false;
    const dueAt = new Date(invoice.dueDate);
    dueAt.setHours(23, 59, 59, 999);
    return dueAt.getTime() < Date.now();
}
function positiveNumber(value) {
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : 0;
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function money(value) {
    return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}
function formatDate(value) {
    return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
