import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Ban, CheckCircle2, HandCoins, Landmark, PlusCircle, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { applyBillingAdvance, restoreBillingAdvance, cancelBillingAdvance, createBillingAdvance, } from '../../lib/api';
import { formatCabinetDate, formatCabinetMoney } from './clientCabinetFormat';
function emptyForm() {
    return {
        amountRub: '',
        paidAt: new Date().toISOString().slice(0, 10),
        method: 'Банковский перевод',
        reference: '',
        comment: '',
    };
}
function advanceStatusLabel(entry) {
    if (entry.status === 'RECORDED') {
        return 'Зачислен';
    }
    return entry.comment?.includes('[ADVANCE_APPLIED]') ? 'Погашен' : 'Отменён';
}
export function ClientCabinetAdvanceWidget({ accessToken, client, overview, canManage, onChanged, }) {
    const [form, setForm] = useState(emptyForm);
    const [isSubmitting, setSubmitting] = useState(false);
    const [cancellingId, setCancellingId] = useState('');
    const [applyingId, setApplyingId] = useState('');
    const [restoringId, setRestoringId] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const summary = overview.clients.find((item) => item.client.id === client.id);
    const entries = useMemo(() => overview.entries.filter((entry) => entry.clientId === client.id).slice(0, 20), [client.id, overview.entries]);
    const balanceRub = Number(summary?.balanceRub ?? 0);
    async function submitAdvance(event) {
        event.preventDefault();
        const amountRub = Number(form.amountRub.replace(',', '.'));
        if (!Number.isFinite(amountRub) || amountRub <= 0) {
            setError('Укажите сумму аванса больше нуля.');
            return;
        }
        setSubmitting(true);
        setMessage('');
        setError('');
        try {
            await createBillingAdvance(accessToken, {
                clientId: client.id,
                amountRub,
                paidAt: form.paidAt || undefined,
                method: form.method.trim() || undefined,
                reference: form.reference.trim() || undefined,
                comment: form.comment.trim() || undefined,
            });
            setForm(emptyForm());
            setMessage(`Аванс ${formatCabinetMoney(amountRub)} ₽ зачислен.`);
            await onChanged();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось зачислить аванс.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function cancelAdvance(id) {
        setCancellingId(id);
        setMessage('');
        setError('');
        try {
            await cancelBillingAdvance(accessToken, id);
            setMessage('Ошибочная запись аванса отменена.');
            await onChanged();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось отменить аванс.');
        }
        finally {
            setCancellingId('');
        }
    }
    async function applyAdvance(id) {
        setApplyingId(id);
        setMessage('');
        setError('');
        try {
            await applyBillingAdvance(accessToken, id);
            setMessage('????? ???????. ????? ? ?????? ?????? ?? ??????????.');
            await onChanged();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : '?? ??????? ???????? ?????.');
        }
        finally {
            setApplyingId('');
        }
    }
    async function restoreAdvance(id) {
        setRestoringId(id);
        setMessage('');
        setError('');
        try {
            await restoreBillingAdvance(accessToken, id);
            setMessage('????????? ?????? ????????. ????? ????? ????????, ????? ?? ??????????.');
            await onChanged();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : '?? ??????? ???????? ????????? ??????.');
        }
        finally {
            setRestoringId('');
        }
    }
    return (_jsxs("section", { className: "client-advance-widget", id: "client-cabinet-advance", "aria-label": "\u0410\u0432\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("header", { className: "client-advance-widget__heading", children: [_jsxs("div", { children: [_jsx("span", { children: _jsx(HandCoins, { size: 20, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0424\u0438\u043D\u0430\u043D\u0441\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("h3", { children: "\u0410\u0432\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435" }), _jsx("small", { children: "\u041F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F \u0431\u0435\u0437 \u0441\u0447\u0451\u0442\u0430 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u044E\u0442 \u043E\u0431\u0449\u0438\u0439 \u0434\u043E\u043B\u0433 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] })] }), _jsxs("div", { className: "client-advance-widget__balance", children: [_jsx("span", { children: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0430\u0432\u0430\u043D\u0441" }), _jsxs("strong", { children: [formatCabinetMoney(balanceRub), " \u20BD"] })] })] }), canManage ? (_jsxs("form", { className: "client-advance-form", onSubmit: submitAdvance, children: [_jsxs("label", { children: [_jsx("span", { children: "\u0421\u0443\u043C\u043C\u0430, \u20BD" }), _jsx("input", { min: "0.01", step: "0.01", inputMode: "decimal", value: form.amountRub, onChange: (event) => setForm((current) => ({ ...current, amountRub: event.target.value })), placeholder: "0,00", required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F" }), _jsx("input", { type: "date", value: form.paidAt, onChange: (event) => setForm((current) => ({ ...current, paidAt: event.target.value })), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043F\u043E\u0441\u043E\u0431" }), _jsx("input", { value: form.method, onChange: (event) => setForm((current) => ({ ...current, method: event.target.value })), placeholder: "\u0411\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u043F\u043B\u0430\u0442\u0435\u0436\u0430" }), _jsx("input", { value: form.reference, onChange: (event) => setForm((current) => ({ ...current, reference: event.target.value })), placeholder: "\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E" })] }), _jsxs("label", { className: "client-advance-form__comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: form.comment, onChange: (event) => setForm((current) => ({ ...current, comment: event.target.value })), placeholder: "\u041D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0430 \u0438\u043B\u0438 \u043F\u0440\u0438\u043C\u0435\u0447\u0430\u043D\u0438\u0435" })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: isSubmitting, children: [_jsx(PlusCircle, { size: 16, "aria-hidden": "true" }), isSubmitting ? 'Зачисляю' : 'Зачислить аванс'] })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, _jsxs("div", { className: "client-advance-history", children: [_jsxs("div", { className: "client-advance-history__title", children: [_jsx(Landmark, { size: 17, "aria-hidden": "true" }), _jsx("strong", { children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0439" }), _jsx("span", { children: entries.length })] }), entries.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u0410\u0432\u0430\u043D\u0441\u043E\u0432\u044B\u0445 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." })) : (_jsx("div", { className: "client-advance-history__list", children: entries.map((entry) => (_jsxs("article", { className: entry.status === 'CANCELLED' ? 'is-cancelled' : undefined, children: [_jsxs("div", { children: [_jsxs("strong", { children: [formatCabinetMoney(Number(entry.amountRub)), " \u20BD"] }), _jsxs("span", { children: [formatCabinetDate(entry.paidAt), " \u00B7 ", entry.method || 'Способ не указан'] }), entry.reference ? _jsxs("small", { children: ["\u041F\u043B\u0430\u0442\u0451\u0436: ", entry.reference] }) : null, entry.comment ? _jsx("small", { children: entry.comment }) : null] }), _jsxs("div", { children: [_jsx("span", { className: `status status--${entry.status === 'RECORDED' ? 'done' : 'cancelled'}`, children: advanceStatusLabel(entry) }), canManage && entry.status === 'RECORDED' ? (_jsxs("div", { className: "client-advance-history__actions", children: [_jsxs("button", { className: "icon-text-button client-advance-apply", type: "button", disabled: applyingId === entry.id, onClick: () => void applyAdvance(entry.id), children: [_jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }), applyingId === entry.id ? 'Погашаю' : 'Погасить аванс'] }), _jsxs("button", { className: "icon-text-button client-advance-cancel", type: "button", disabled: cancellingId === entry.id || applyingId === entry.id, onClick: () => void cancelAdvance(entry.id), children: [_jsx(Ban, { size: 14, "aria-hidden": "true" }), cancellingId === entry.id ? 'Отменяю' : 'Отменить запись'] })] })) : canManage && entry.status === 'CANCELLED' && entry.comment?.includes('[ADVANCE_REDEEMED]') ? (_jsx("div", { className: "client-advance-history__actions", children: _jsxs("button", { className: "icon-text-button client-advance-cancel", type: "button", disabled: restoringId === entry.id, onClick: () => void restoreAdvance(entry.id), children: [_jsx(Undo2, { size: 14, "aria-hidden": "true" }), restoringId === entry.id ? '???????' : '???????? ?????????'] }) })) : null] })] }, entry.id))) }))] })] }));
}
