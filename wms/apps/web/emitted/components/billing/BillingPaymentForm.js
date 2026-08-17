import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CreditCard } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createBillingPayment } from '../../lib/api';
export function BillingPaymentForm({ invoices, session, onPaid }) {
    const payableInvoices = useMemo(() => invoices.filter((invoice) => invoice.status !== 'CANCELLED' && invoice.status !== 'PAID' && remainingRub(invoice) > 0), [invoices]);
    const [invoiceId, setInvoiceId] = useState(payableInvoices[0]?.id ?? '');
    const selectedInvoice = payableInvoices.find((invoice) => invoice.id === invoiceId) ?? payableInvoices[0];
    const [amountRub, setAmountRub] = useState(selectedInvoice ? String(remainingRub(selectedInvoice)) : '');
    const [paidAt, setPaidAt] = useState(today());
    const [method, setMethod] = useState('Банк');
    const [reference, setReference] = useState('');
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!selectedInvoice) {
            setInvoiceId('');
            setAmountRub('');
            return;
        }
        setInvoiceId(selectedInvoice.id);
        setAmountRub(String(remainingRub(selectedInvoice)));
    }, [selectedInvoice?.id]);
    async function submit(event) {
        event.preventDefault();
        if (!selectedInvoice) {
            setError('Нет счета для оплаты.');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const invoice = await createBillingPayment(session.accessToken, {
                invoiceId: selectedInvoice.id,
                amountRub: Number(amountRub),
                paidAt,
                method: method || undefined,
                reference: reference || undefined,
                comment: comment || undefined,
            });
            onPaid(invoice);
            setReference('');
            setComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось принять оплату.');
        }
        finally {
            setIsSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "billing-form billing-form--payment", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "billing-fields billing-fields--payment", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0421\u0447\u0435\u0442" }), _jsx("select", { value: invoiceId, onChange: (event) => setInvoiceId(event.target.value), children: payableInvoices.map((invoice) => (_jsxs("option", { value: invoice.id, children: [invoice.number, " - ", invoice.client.code] }, invoice.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("input", { min: "0.01", step: "0.01", type: "number", value: amountRub, onChange: (event) => setAmountRub(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u043E\u043F\u043B\u0430\u0442\u044B" }), _jsx("input", { type: "date", value: paidAt, onChange: (event) => setPaidAt(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043F\u043E\u0441\u043E\u0431" }), _jsx("input", { value: method, onChange: (event) => setMethod(event.target.value), placeholder: "\u0411\u0430\u043D\u043A" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u043F\u043B\u0430\u0442\u0435\u0436\u0430" }), _jsx("input", { value: reference, onChange: (event) => setReference(event.target.value), placeholder: "\u043F/\u043F \u0438\u043B\u0438 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F" })] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u043A \u043E\u043F\u043B\u0430\u0442\u0435" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button billing-submit", disabled: isSubmitting || !selectedInvoice, type: "submit", children: [_jsx(CreditCard, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Провожу' : 'Принять оплату' })] })] }));
}
function remainingRub(invoice) {
    return Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
