import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, Boxes, CheckCircle2, CircleX, LoaderCircle, RefreshCw, Search, ShieldCheck, Wrench, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { checkAdministrationFbsRequestErrors, fetchAdministrationFbsErrorRequests, repairAdministrationFbsRequestErrors, } from '../../lib/api';
export function AdministrationFbsErrorCorrection({ session }) {
    const [requests, setRequests] = useState([]);
    const [selectedRequestId, setSelectedRequestId] = useState('');
    const [query, setQuery] = useState('');
    const [audit, setAudit] = useState(null);
    const [rowFilter, setRowFilter] = useState('ISSUES');
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const filteredRequests = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        if (!normalized)
            return requests;
        return requests.filter((request) => [request.number, request.title, request.client.code, request.client.name]
            .join(' ')
            .toLocaleLowerCase('ru-RU')
            .includes(normalized));
    }, [query, requests]);
    const rows = useMemo(() => {
        if (!audit)
            return [];
        if (rowFilter === 'ALL')
            return audit.rows;
        if (rowFilter === 'OK')
            return audit.rows.filter((row) => row.state === 'OK');
        return audit.rows.filter((row) => row.state !== 'OK');
    }, [audit, rowFilter]);
    useEffect(() => {
        void loadRequests();
    }, []);
    async function loadRequests() {
        setLoading(true);
        setError('');
        try {
            const result = await fetchAdministrationFbsErrorRequests(session.accessToken);
            setRequests(result);
            setSelectedRequestId((current) => current || result[0]?.id || '');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function check() {
        if (!selectedRequestId)
            return;
        setChecking(true);
        setError('');
        setMessage('');
        try {
            const result = await checkAdministrationFbsRequestErrors(session.accessToken, selectedRequestId);
            setAudit(result);
            setRowFilter(result.summary.issues > 0 ? 'ISSUES' : 'ALL');
            setMessage(result.summary.issues > 0
                ? `Проверка завершена: найдено проблемных коробов — ${result.summary.issues}. Данные пока не изменялись.`
                : 'Проверка завершена: список коробов соответствует живым остаткам.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setChecking(false);
        }
    }
    async function repair() {
        if (!audit || audit.summary.issues === 0 || repairing)
            return;
        const confirmed = window.confirm(`Исправить подбор коробов заявки №${String(audit.request.number).padStart(6, '0')}?\n\n` +
            'Незапущенные задания будут заново распределены по живым остаткам. Уже отсканированные ШК и КИЗ останутся без изменений.');
        if (!confirmed)
            return;
        setRepairing(true);
        setError('');
        setMessage('');
        try {
            const result = await repairAdministrationFbsRequestErrors(session.accessToken, audit.request.id);
            setAudit(result.after);
            setRowFilter(result.after.summary.issues > 0 ? 'ISSUES' : 'ALL');
            setMessage(result.message);
            await loadRequests();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setRepairing(false);
        }
    }
    return (_jsxs("section", { className: "admin-section admin-fbs-errors", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043E\u0448\u0438\u0431\u043E\u043A" }), _jsx("h3", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 FBS-\u0437\u0430\u044F\u0432\u043A\u0438" })] }), _jsx("p", { children: "\u0421\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u0442 \u0441\u0442\u0430\u0440\u044B\u0439 \u043F\u043B\u0430\u043D \u043F\u043E\u0434\u0431\u043E\u0440\u0430 \u0441 \u0436\u0438\u0432\u044B\u043C\u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u043C\u0438, \u043F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430\u043C\u0438 \u0438 \u0442\u0435\u043A\u0443\u0449\u0438\u043C\u0438 FBS-\u0440\u0435\u0437\u0435\u0440\u0432\u0430\u043C\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043C\u0435\u043D\u044F\u0435\u0442; \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439." })] }), _jsxs("div", { className: "admin-fbs-errors__safety", children: [_jsx(ShieldCheck, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u043F\u0435\u0440\u0435\u0441\u0447\u0451\u0442" }), _jsx("span", { children: "\u0427\u0443\u0436\u0438\u0435 \u0440\u0435\u0437\u0435\u0440\u0432\u044B \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F. \u041D\u0430\u0447\u0430\u0442\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B, \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0428\u041A \u0438 \u041A\u0418\u0417 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u0442\u0441\u044F." })] })] }), _jsxs("div", { className: "admin-fbs-errors__controls", children: [_jsxs("label", { className: "admin-fbs-errors__search", children: [_jsx("span", { children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsxs("div", { children: [_jsx(Search, { size: 16 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u041D\u043E\u043C\u0435\u0440, \u043A\u043B\u0438\u0435\u043D\u0442 \u0438\u043B\u0438 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F FBS-\u0437\u0430\u044F\u0432\u043A\u0430" }), _jsxs("select", { value: selectedRequestId, onChange: (event) => {
                                    setSelectedRequestId(event.target.value);
                                    setAudit(null);
                                    setMessage('');
                                    setError('');
                                }, disabled: loading, children: [filteredRequests.length === 0 ? _jsx("option", { value: "", children: "\u0417\u0430\u044F\u0432\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, filteredRequests.map((request) => (_jsxs("option", { value: request.id, children: ["\u2116", String(request.number).padStart(6, '0'), " \u00B7 ", request.client.name, " \u00B7 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ", request.tasks.outstanding] }, request.id)))] })] }), _jsxs("button", { type: "button", className: "admin-button admin-button--primary", onClick: () => void check(), disabled: !selectedRequestId || checking || repairing, children: [checking ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(RefreshCw, { size: 17 }), checking ? 'Проверяю…' : 'Проверить короба'] }), _jsxs("button", { type: "button", className: "admin-button admin-button--danger", onClick: () => void repair(), disabled: !audit?.summary.issues || checking || repairing, children: [repairing ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(Wrench, { size: 17 }), repairing ? 'Исправляю…' : 'Исправить найденное'] })] }), message ? _jsxs("div", { className: "admin-message admin-message--ok", children: [_jsx(CheckCircle2, { size: 18 }), message] }) : null, error ? _jsxs("div", { className: "admin-message admin-message--error", children: [_jsx(CircleX, { size: 18 }), error] }) : null, audit ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "admin-fbs-errors__request", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u0430 \u0437\u0430\u044F\u0432\u043A\u0430" }), _jsxs("strong", { children: ["\u2116", String(audit.request.number).padStart(6, '0'), " \u00B7 ", audit.request.client.name] })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u0412\u0441\u0435\u0433\u043E \u0437\u0430\u0434\u0430\u043D\u0438\u0439" }), _jsx("dd", { children: audit.taskSummary.total })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0421\u043E\u0431\u0440\u0430\u043D\u043E" }), _jsx("dd", { children: audit.taskSummary.completed })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C" }), _jsx("dd", { children: audit.taskSummary.outstanding })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0421\u0435\u0439\u0447\u0430\u0441 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435" }), _jsx("dd", { children: audit.taskSummary.inProgress })] })] })] }), _jsxs("div", { className: "admin-fbs-errors__metrics", children: [_jsx(Metric, { icon: _jsx(Boxes, { size: 18 }), label: "\u0412 \u043F\u043B\u0430\u043D\u0435", value: audit.summary.planBoxes, tone: "neutral" }), _jsx(Metric, { icon: _jsx(CheckCircle2, { size: 18 }), label: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B", value: audit.summary.healthy, tone: "ok" }), _jsx(Metric, { icon: _jsx(AlertTriangle, { size: 18 }), label: "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F", value: audit.summary.issues, tone: "danger" }), _jsx(Metric, { icon: _jsx(CircleX, { size: 18 }), label: "\u0417\u0430\u043D\u044F\u0442\u044B \u0440\u0435\u0437\u0435\u0440\u0432\u0430\u043C\u0438", value: audit.summary.blockedByReservations + audit.summary.skuOrQuantityMismatch, tone: "warning" }), _jsx(Metric, { icon: _jsx(RefreshCw, { size: 18 }), label: "\u0411\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B", value: audit.summary.noRemainingDemand, tone: "neutral" }), _jsx(Metric, { icon: _jsx(AlertTriangle, { size: 18 }), label: "\u041D\u0435 \u043D\u0430 \u043F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0435", value: audit.summary.notOnPalletSort, tone: "warning" })] }), _jsxs("div", { className: "admin-fbs-errors__toolbar", children: [_jsxs("div", { children: [_jsxs("button", { type: "button", className: rowFilter === 'ISSUES' ? 'active' : '', onClick: () => setRowFilter('ISSUES'), children: ["\u0422\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B (", audit.summary.issues, ")"] }), _jsxs("button", { type: "button", className: rowFilter === 'ALL' ? 'active' : '', onClick: () => setRowFilter('ALL'), children: ["\u0412\u0441\u0435 (", audit.summary.planBoxes, ")"] }), _jsxs("button", { type: "button", className: rowFilter === 'OK' ? 'active' : '', onClick: () => setRowFilter('OK'), children: ["\u0418\u0441\u043F\u0440\u0430\u0432\u043D\u044B\u0435 (", audit.summary.healthy, ")"] })] }), _jsxs("small", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E ", new Date(audit.checkedAt).toLocaleString('ru-RU')] })] }), _jsxs("div", { className: "admin-fbs-errors__table-wrap", children: [_jsxs("table", { className: "admin-fbs-errors__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431 / \u043F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u0420\u0435\u0437\u0435\u0440\u0432" }), _jsx("th", { children: "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u043E" }), _jsx("th", { children: "\u041D\u0443\u0436\u043D\u043E" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440\u044B \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: rows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.code }), _jsx("small", { children: row.palletCode ?? 'Не размещён' })] }), _jsx("td", { children: _jsx(Status, { state: row.state, label: row.stateLabel }) }), _jsx("td", { children: row.availableUnits }), _jsx("td", { children: row.reservedUnits }), _jsx("td", { children: row.freeUnits }), _jsx("td", { children: row.requiredUnits }), _jsxs("td", { children: [row.products.length ? (_jsxs("details", { children: [_jsxs("summary", { children: [row.products.length, " \u0442\u043E\u0432\u0430\u0440(\u0430/\u043E\u0432)"] }), _jsx("ul", { children: row.products.map((product) => _jsxs("li", { children: [product.name, ": \u043E\u0441\u0442. ", product.available, ", \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E ", product.free, ", \u043D\u0443\u0436\u043D\u043E ", product.required] }, product.skuId)) })] })) : null, row.externalOrdersCount > 0 ? _jsxs("small", { children: ["\u0417\u0430\u043D\u044F\u043B\u0438 \u0437\u0430\u043A\u0430\u0437\u044B: ", row.externalOrders.join(', '), row.externalOrdersCount > row.externalOrders.length ? ` и ещё ${row.externalOrdersCount - row.externalOrders.length}` : ''] }) : null, _jsx("span", { children: row.recommendation })] })] }, row.code))) })] }), rows.length === 0 ? _jsxs("div", { className: "admin-fbs-errors__empty", children: [_jsx(CheckCircle2, { size: 22 }), "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E."] }) : null] })] })) : (_jsxs("div", { className: "admin-fbs-errors__empty", children: [loading ? _jsx(LoaderCircle, { className: "spin", size: 24 }) : _jsx(Search, { size: 24 }), loading ? 'Загружаю активные заявки…' : 'Выберите заявку и нажмите «Проверить короба».'] }))] }));
}
function Metric({ icon, label, value, tone }) {
    return _jsxs("article", { className: `is-${tone}`, children: [_jsxs("span", { children: [icon, label] }), _jsx("strong", { children: value })] });
}
function Status({ state, label }) {
    return _jsx("span", { className: `admin-fbs-errors__status is-${state.toLocaleLowerCase('en-US')}`, children: label });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
