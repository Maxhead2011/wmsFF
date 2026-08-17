import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchClients, fetchShippedKizHistory, syncShippedKizHistory, } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ShipmentHistoryPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [periodFrom, setPeriodFrom] = useState(dateInput(daysAgo(90)));
    const [periodTo, setPeriodTo] = useState(dateInput(new Date()));
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        let active = true;
        fetchClients(session.accessToken)
            .then((items) => {
            if (active)
                setClients(items);
        })
            .catch((caught) => {
            if (active)
                setMessage(errorMessage(caught));
        });
        void load();
        return () => {
            active = false;
        };
    }, [session.accessToken]);
    async function load() {
        setBusy(true);
        setMessage('');
        try {
            const nextRows = await fetchShippedKizHistory(session.accessToken, {
                clientId: clientId || undefined,
                periodFrom,
                periodTo,
                search: search || undefined,
            });
            setRows(nextRows);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function sync() {
        setBusy(true);
        setMessage('');
        try {
            const result = await syncShippedKizHistory(session.accessToken, clientId || undefined);
            const nextRows = await fetchShippedKizHistory(session.accessToken, {
                clientId: clientId || undefined,
                periodFrom,
                periodTo,
                search: search || undefined,
            });
            setRows(nextRows);
            setMessage(`История обновлена: добавлено ${result.added}, проверено заявок ${result.checkedRequests}.`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "shipment-history", children: [_jsxs("div", { className: "shipment-history__filters", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("label", { className: "shipment-history__search", children: [_jsx("span", { children: "\u041A\u0418\u0417, \u0437\u0430\u043A\u0430\u0437, \u0428\u041A, \u0442\u043E\u0432\u0430\u0440 \u0438\u043B\u0438 \u043A\u043E\u0440\u043E\u0431" }), _jsxs("span", { children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041F\u043E\u0438\u0441\u043A" })] })] }), _jsx("button", { className: "secondary-button", type: "button", onClick: () => void load(), disabled: busy, children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void sync(), disabled: busy, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), busy ? 'Обновляю…' : 'Обновить историю'] })] }), message ? _jsx("p", { className: "warehouse-inline", children: message }) : null, _jsxs("div", { className: "shipment-history__summary", children: [_jsx("strong", { children: rows.length }), _jsx("span", { children: "\u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0435\u0434\u0438\u043D\u0438\u0446 \u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C \u043F\u0435\u0440\u0438\u043E\u0434\u0435" })] }), _jsx("div", { className: "shipment-history__table-wrap", children: _jsxs("table", { className: "shipment-history__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041E\u0442\u0433\u0440\u0443\u0437\u043A\u0430 / \u043F\u0440\u0438\u0445\u043E\u0434" }), _jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 / \u0437\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A / \u0430\u0440\u0442\u0438\u043A\u0443\u043B" }), _jsx("th", { children: "\u0426\u0432\u0435\u0442 / \u0440\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" })] }) }), _jsxs("tbody", { children: [rows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: formatDateTime(row.shippedAt) }), _jsxs("span", { children: ["\u043F\u0440\u0438\u0445\u043E\u0434: ", formatDateTime(row.arrivalAt)] })] }), _jsxs("td", { children: [_jsxs("strong", { children: ["WMS \u2116", String(row.requestNumber).padStart(6, '0')] }), _jsx("span", { children: row.orderId ? `WB №${row.orderId}` : row.requestTitle }), row.supplyId ? _jsxs("span", { children: ["\u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 ", row.supplyId] }) : null] }), _jsxs("td", { children: [_jsx("strong", { children: row.productName }), _jsx("span", { children: row.internalSku })] }), _jsxs("td", { children: [_jsx("strong", { children: row.barcode ?? '—' }), _jsx("span", { children: row.article ?? '—' })] }), _jsx("td", { children: [row.color, row.size].filter(Boolean).join(' / ') || '—' }), _jsx("td", { children: _jsx("code", { children: row.kiz }) }), _jsx("td", { children: row.sourceBoxCode ?? 'Без короба' })] }, row.id))), !busy && rows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u041A\u0418\u0417 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }) })) : null] })] }) })] }));
}
function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}
function dateInput(value) {
    return value.toISOString().slice(0, 10);
}
function formatDateTime(value) {
    return value ? new Date(value).toLocaleString('ru-RU') : 'нет данных';
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось загрузить историю.';
}
