import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FilePlus2, ReceiptText, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { billGoodsArrivals, createGoodsArrival, deleteGoodsArrival, fetchClients, fetchGoodsArrivalEstimate, fetchGoodsArrivals, } from '../../lib/api';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function GoodsArrivalPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [arrivalDate, setArrivalDate] = useState(today());
    const [bagCount, setBagCount] = useState('0');
    const [boxCount, setBoxCount] = useState('0');
    const [comment, setComment] = useState('');
    const [periodFrom, setPeriodFrom] = useState(monthStart());
    const [periodTo, setPeriodTo] = useState(today());
    const [rows, setRows] = useState([]);
    const [estimate, setEstimate] = useState(null);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        void fetchClients(session.accessToken).then((items) => {
            setClients(items);
            setClientId((current) => validRememberedClientId(current, items));
        }).catch((error) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов.'));
    }, [session.accessToken]);
    useEffect(() => {
        if (clientId)
            void load();
    }, [clientId, periodFrom, periodTo]);
    async function load() {
        setLoading(true);
        setMessage('');
        try {
            const [nextRows, nextEstimate] = await Promise.all([
                fetchGoodsArrivals(session.accessToken, { clientId, periodFrom, periodTo }),
                fetchGoodsArrivalEstimate(session.accessToken, clientId),
            ]);
            setRows(nextRows);
            setEstimate(nextEstimate);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось загрузить приходы товара.');
        }
        finally {
            setLoading(false);
        }
    }
    async function submit(event) {
        event.preventDefault();
        setMessage('');
        try {
            await createGoodsArrival(session.accessToken, {
                clientId,
                arrivalDate,
                bagCount: Number(bagCount) || 0,
                boxCount: Number(boxCount) || 0,
                comment: comment.trim() || undefined,
            });
            setBagCount('0');
            setBoxCount('0');
            setComment('');
            setMessage('Приход товара записан.');
            await load();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось записать приход.');
        }
    }
    async function bill() {
        setMessage('');
        try {
            const invoice = await billGoodsArrivals(session.accessToken, { clientId, periodFrom, periodTo });
            setMessage(`Черновик счета ${invoice.number} создан в биллинге.`);
            await load();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось сформировать счет ППР.');
        }
    }
    async function remove(id) {
        setMessage('');
        try {
            await deleteGoodsArrival(session.accessToken, id);
            await load();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось удалить приход.');
        }
    }
    const totals = rows.reduce((sum, row) => ({ bags: sum.bags + row.bagCount, boxes: sum.boxes + row.boxCount }), { bags: 0, boxes: 0 });
    return (_jsxs("div", { className: "goods-arrivals", children: [_jsxs("form", { className: "goods-arrivals__form", onSubmit: submit, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => _jsx("option", { value: client.id, children: client.name }, client.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u043F\u0440\u0438\u0445\u043E\u0434\u0430" }), _jsx("input", { type: "date", value: arrivalDate, onChange: (event) => setArrivalDate(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u0448\u043A\u0438" }), _jsx("input", { type: "number", min: "0", value: bagCount, onChange: (event) => setBagCount(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("input", { type: "number", min: "0", value: boxCount, onChange: (event) => setBoxCount(event.target.value) })] }), _jsxs("label", { className: "goods-arrivals__comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value) })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !clientId, children: [_jsx(FilePlus2, { size: 16 }), _jsx("span", { children: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u043F\u0440\u0438\u0445\u043E\u0434" })] })] }), _jsxs("div", { className: "goods-arrivals__billing", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0417\u0430 \u043F\u0435\u0440\u0438\u043E\u0434" }), _jsxs("strong", { children: [totals.bags, " \u043C\u0435\u0448\u043A\u043E\u0432 \u00B7 ", totals.boxes, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041E\u0440\u0438\u0435\u043D\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u043E" }), _jsxs("strong", { children: [money(estimate?.estimatedRub ?? 0), " \u20BD"] })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void bill(), disabled: !clientId || rows.every((row) => Boolean(row.billingInvoiceId)), children: [_jsx(ReceiptText, { size: 16 }), _jsx("span", { children: "\u0421\u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0447\u0435\u0442 \u041F\u041F\u0420" })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void load(), disabled: loading, children: [_jsx(RefreshCw, { size: 16 }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), message ? _jsx("p", { className: message.includes('создан') || message.includes('записан') ? 'form-success' : 'form-error', children: message }) : null, _jsx("div", { className: "online-receipts__table-wrap", children: _jsxs("table", { className: "warehouse-drafts__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041C\u0435\u0448\u043A\u0438" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("th", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("th", { children: "\u0421\u0447\u0435\u0442" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [rows.map((row) => _jsxs("tr", { children: [_jsx("td", { children: date(row.arrivalDate) }), _jsx("td", { children: clients.find((client) => client.id === row.clientId)?.name ?? '-' }), _jsx("td", { children: row.bagCount }), _jsx("td", { children: row.boxCount }), _jsx("td", { children: row.comment || '-' }), _jsx("td", { children: row.billingInvoiceId ? 'Включен' : 'Не выставлен' }), _jsx("td", { children: !row.billingInvoiceId ? _jsx("button", { className: "icon-button danger-icon", type: "button", onClick: () => void remove(row.id), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", children: _jsx(Trash2, { size: 15 }) }) : null })] }, row.id)), !rows.length ? _jsx("tr", { children: _jsx("td", { colSpan: 7, children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043F\u0440\u0438\u0445\u043E\u0434\u043E\u0432 \u043D\u0435\u0442." }) }) : null] })] }) })] }));
}
function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); }
function date(value) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function money(value) { return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
