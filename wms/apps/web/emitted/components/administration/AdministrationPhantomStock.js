import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Boxes, CheckCircle2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchAdministrationPhantomStocks, fixAdministrationPhantomStock, fixAllAdministrationPhantomStocks, } from '../../lib/api';
import './phantom-stock.css';
export function AdministrationPhantomStockPanel({ session, onCountChange }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        const load = async (quiet = false) => {
            if (!quiet)
                setLoading(true);
            try {
                const next = await fetchAdministrationPhantomStocks(session.accessToken);
                if (!active)
                    return;
                setData(next);
                onCountChange?.(next.summary.findings);
                setError('');
            }
            catch (caught) {
                if (active)
                    setError(errorMessage(caught));
            }
            finally {
                if (active && !quiet)
                    setLoading(false);
            }
        };
        void load();
        const timer = window.setInterval(() => void load(true), 60_000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [session.accessToken, onCountChange]);
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const next = await fetchAdministrationPhantomStocks(session.accessToken);
            setData(next);
            onCountChange?.(next.summary.findings);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function fixOne(row) {
        if (!window.confirm(`Удалить ${row.suspectQuantity} фантомн. ед. ${row.internalSku} из короба ${row.boxCode}?`))
            return;
        setBusy(row.balanceId);
        setMessage('');
        setError('');
        try {
            const result = await fixAdministrationPhantomStock(session.accessToken, row.balanceId);
            setData(result.overview);
            onCountChange?.(result.overview.summary.findings);
            setMessage(`Фантомный остаток в коробе ${row.boxCode} удалён. Действие записано в журнал.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function fixAll() {
        if (!data?.summary.findings)
            return;
        if (!window.confirm(`Исправить все найденные остатки: ${data.summary.findings} поз., ${data.summary.suspectUnits} ед.?`))
            return;
        setBusy('all');
        setMessage('');
        setError('');
        try {
            const result = await fixAllAdministrationPhantomStocks(session.accessToken);
            setData(result.overview);
            onCountChange?.(result.overview.summary.findings);
            setMessage(`Исправлено ${result.fixed} позиций, удалено ${result.removedUnits} фантомных единиц.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    return (_jsxs("section", { className: "admin-section admin-phantom", children: [_jsxs("div", { className: "admin-section__heading admin-phantom__heading", children: [_jsxs("div", { children: [_jsx("span", { className: "admin-kicker", children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u00B7 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u0430\u0437 \u0432 \u043C\u0438\u043D\u0443\u0442\u0443" }), _jsxs("h3", { children: [_jsx(ShieldCheck, { size: 20 }), " \u0424\u0430\u043D\u0442\u043E\u043C\u043D\u044B\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438"] }), _jsx("p", { children: "\u041D\u0430\u0445\u043E\u0434\u0438\u0442 \u0442\u043E\u0432\u0430\u0440, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u0432 PACKING/SHIPPING \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u0437\u0430\u044F\u0432\u043A\u0438 \u0438\u043B\u0438 \u0438\u043C\u0435\u0435\u0442 \u0443\u0436\u0435 \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0439 \u041A\u0418\u0417." })] }), _jsxs("div", { className: "admin-phantom__toolbar", children: [_jsxs("button", { className: "admin-button admin-button--ghost", type: "button", onClick: () => void reload(), disabled: loading || Boolean(busy), children: [_jsx(RefreshCw, { size: 16, className: loading ? 'spin' : '' }), " \u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0441\u0435\u0439\u0447\u0430\u0441"] }), _jsxs("button", { className: "admin-button admin-button--danger", type: "button", onClick: () => void fixAll(), disabled: !data?.summary.findings || Boolean(busy), children: [_jsx(Trash2, { size: 16 }), " ", busy === 'all' ? 'Исправляю…' : 'Исправить все'] })] })] }), message ? _jsxs("div", { className: "admin-message admin-message--ok", children: [_jsx(CheckCircle2, { size: 18 }), message] }) : null, error ? _jsxs("div", { className: "admin-message admin-message--error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null, _jsxs("div", { className: "admin-phantom__metrics", children: [_jsx(Metric, { label: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u0440\u0435\u0437\u0435\u0440\u0432\u043E\u0432", value: data?.summary.balancesChecked ?? 0 }), _jsx(Metric, { label: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432", value: data?.summary.boxes ?? 0, danger: Boolean(data?.summary.boxes) }), _jsx(Metric, { label: "\u0424\u0430\u043D\u0442\u043E\u043C\u043D\u044B\u0445 \u043F\u043E\u0437\u0438\u0446\u0438\u0439", value: data?.summary.findings ?? 0, danger: Boolean(data?.summary.findings) }), _jsx(Metric, { label: "\u041B\u0438\u0448\u043D\u0438\u0445 \u0435\u0434\u0438\u043D\u0438\u0446", value: data?.summary.suspectUnits ?? 0, danger: Boolean(data?.summary.suspectUnits) })] }), !loading && data?.rows.length === 0 ? (_jsxs("div", { className: "admin-phantom__clean", children: [_jsx(CheckCircle2, { size: 25 }), _jsx("strong", { children: "\u0424\u0430\u043D\u0442\u043E\u043C\u043D\u044B\u0445 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" }), _jsx("span", { children: "PACKING \u0438 SHIPPING \u0441\u043E\u0433\u043B\u0430\u0441\u043E\u0432\u0430\u043D\u044B \u0441 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0430\u043C\u0438 \u0438 \u0437\u0430\u044F\u0432\u043A\u0430\u043C\u0438." })] })) : null, data?.rows.length ? (_jsx("div", { className: "admin-phantom__table-wrap", children: _jsxs("table", { className: "admin-phantom__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431 / \u043A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u041F\u043E\u0447\u0435\u043C\u0443 \u044D\u0442\u043E \u0444\u0430\u043D\u0442\u043E\u043C" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: data.rows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.boxCode }), _jsxs("small", { children: [row.clientCode, " \u00B7 ", row.clientName] })] }), _jsxs("td", { children: [_jsx("strong", { children: row.internalSku }), _jsxs("small", { children: [row.skuName, row.barcode ? ` · ШК ${row.barcode}` : ''] })] }), _jsx("td", { children: _jsx("span", { className: `admin-phantom__status admin-phantom__status--${row.status.toLowerCase()}`, children: row.status }) }), _jsx("td", { children: _jsxs("strong", { className: "admin-phantom__quantity", children: [row.suspectQuantity, " \u0438\u0437 ", row.currentQuantity] }) }), _jsxs("td", { children: [_jsx("strong", { children: row.reason }), row.shippedMarks.map((mark) => _jsxs("small", { children: ["\u041A\u0418\u0417 ", mark.maskedKiz, " \u00B7 \u0437\u0430\u044F\u0432\u043A\u0430 \u2116", mark.requestNumber, mark.orderId ? ` · WB ${mark.orderId}` : ''] }, mark.markId)), row.closedRequests.map((request) => _jsxs("small", { children: ["\u0417\u0430\u043A\u0440\u044B\u0442\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u2116", request.requestNumber, " \u00B7 \u0437\u0430\u0432\u0438\u0441\u043B\u043E ", request.quantity, " \u0448\u0442."] }, request.movementId))] }), _jsx("td", { children: _jsxs("button", { className: "admin-button admin-button--danger admin-button--compact", type: "button", onClick: () => void fixOne(row), disabled: Boolean(busy), children: [_jsx(Trash2, { size: 15 }), " ", busy === row.balanceId ? 'Исправляю…' : 'Удалить фантом'] }) })] }, row.balanceId))) })] }) })) : null, _jsxs("p", { className: "admin-phantom__note", children: [_jsx(Boxes, { size: 15 }), " \u041F\u0435\u0440\u0435\u0434 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435\u043C \u0441\u0435\u0440\u0432\u0435\u0440 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043E\u043A, \u041A\u0418\u0417, \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443 \u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438. \u0418\u0437\u043C\u0435\u043D\u0438\u0432\u0448\u0438\u0435\u0441\u044F \u0441\u0442\u0440\u043E\u043A\u0438 \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F."] })] }));
}
function Metric({ label, value, danger = false }) {
    return _jsxs("div", { className: danger ? 'danger' : '', children: [_jsx("strong", { children: value }), _jsx("span", { children: label })] });
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось проверить фантомные остатки.';
}
