import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, History, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { decideWarehouseBoxCheckRow, fetchClients, fetchWarehouseBoxChecks, runWarehouseBoxCheck, } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function BoxIntegrityPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [periodFrom, setPeriodFrom] = useState(dateInput(daysAgo(30)));
    const [periodTo, setPeriodTo] = useState(dateInput(new Date()));
    const [checks, setChecks] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [busy, setBusy] = useState(false);
    const [busyRowId, setBusyRowId] = useState('');
    const [message, setMessage] = useState('');
    const [quantities, setQuantities] = useState({});
    const selected = checks.find((check) => check.id === selectedId) ?? checks[0] ?? null;
    const groupedRows = useMemo(() => groupRows(selected?.rows ?? []), [selected]);
    useEffect(() => {
        let active = true;
        Promise.all([
            fetchClients(session.accessToken),
            fetchWarehouseBoxChecks(session.accessToken),
        ])
            .then(([nextClients, nextChecks]) => {
            if (!active)
                return;
            setClients(nextClients);
            setChecks(nextChecks);
            setSelectedId(nextChecks[0]?.id ?? '');
        })
            .catch((caught) => {
            if (active)
                setMessage(errorMessage(caught));
        });
        return () => {
            active = false;
        };
    }, [session.accessToken]);
    async function loadChecks(nextClientId = clientId) {
        const nextChecks = await fetchWarehouseBoxChecks(session.accessToken, nextClientId || undefined);
        setChecks(nextChecks);
        setSelectedId((current) => nextChecks.some((check) => check.id === current) ? current : nextChecks[0]?.id ?? '');
    }
    async function runCheck() {
        setBusy(true);
        setMessage('');
        try {
            const check = await runWarehouseBoxCheck(session.accessToken, {
                periodFrom,
                periodTo,
                clientId: clientId || undefined,
            });
            setChecks((current) => [check, ...current.filter((item) => item.id !== check.id)]);
            setSelectedId(check.id);
            setMessage(check.findingsCount
                ? `Проверка завершена: найдено ${check.findingsCount} подозрительных позиций. Ничего не списано автоматически.`
                : 'Проверка завершена: подозрительных остатков за выбранный период не найдено.');
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function decide(row, action) {
        const quantityValue = quantities[row.id];
        const quantity = action === 'SET_QUANTITY' ? Number(quantityValue) : undefined;
        if (action === 'SET_QUANTITY' && (!Number.isInteger(quantity) || quantity < 0)) {
            setMessage('Введите целое новое количество от 0.');
            return;
        }
        if (action === 'WRITE_OFF' &&
            !window.confirm(`Списать весь доступный остаток ${row.internalSku} (${row.currentQuantity} шт.) из короба ${row.boxCode}?`)) {
            return;
        }
        setBusyRowId(row.id);
        setMessage('');
        try {
            const updated = await decideWarehouseBoxCheckRow(session.accessToken, row.id, { action, quantity });
            setChecks((current) => current.map((check) => (check.id === updated.id ? updated : check)));
            setMessage('Решение применено и сохранено в истории проверки.');
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusyRowId('');
        }
    }
    return (_jsxs("div", { className: "box-integrity", children: [_jsxs("div", { className: "box-integrity__intro", children: [_jsx(ShieldCheck, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0444\u0430\u043D\u0442\u043E\u043C\u043D\u044B\u0445 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432" }), _jsx("p", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u0432\u0441\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u0438 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0430. \u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0432\u0430\u0448\u0435\u0433\u043E \u0440\u0435\u0448\u0435\u043D\u0438\u044F." })] })] }), _jsxs("div", { className: "box-integrity__filters", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => {
                                    const value = event.target.value;
                                    setClientId(value);
                                    void loadChecks(value).catch((caught) => setMessage(errorMessage(caught)));
                                }, children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void runCheck(), disabled: busy || !periodFrom || !periodTo, children: [_jsx(Play, { size: 16, "aria-hidden": "true" }), busy ? 'Проверяю…' : 'Запустить проверку'] })] }), message ? _jsx("p", { className: "warehouse-inline", children: message }) : null, checks.length > 0 ? (_jsx("div", { className: "box-integrity__history", children: _jsxs("label", { children: [_jsxs("span", { children: [_jsx(History, { size: 15, "aria-hidden": "true" }), " \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A"] }), _jsx("select", { value: selected?.id ?? '', onChange: (event) => setSelectedId(event.target.value), children: checks.map((check) => (_jsxs("option", { value: check.id, children: [formatDateTime(check.createdAt), " \u00B7 ", formatDate(check.periodFrom), "\u2014", formatDate(check.periodTo), " \u00B7 \u043D\u0430\u0439\u0434\u0435\u043D\u043E ", check.findingsCount] }, check.id))) })] }) })) : null, selected ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "box-integrity__summary", children: [_jsx(SummaryCard, { label: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432", value: selected.boxesChecked }), _jsx(SummaryCard, { label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u0440\u0438\u0441\u043A\u043E\u043C", value: groupedRows.length, tone: "warning" }), _jsx(SummaryCard, { label: "\u041F\u043E\u0434\u043E\u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0435\u0434\u0438\u043D\u0438\u0446", value: selected.probableUnits, tone: "danger" }), _jsx(SummaryCard, { label: "\u0422\u043E\u0447\u043D\u044B\u0445 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0439", value: selected.highConfidenceRows, tone: "danger" })] }), groupedRows.length === 0 ? (_jsxs("div", { className: "box-integrity__empty", children: [_jsx(CheckCircle2, { size: 22, "aria-hidden": "true" }), "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E\u0434\u043E\u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E."] })) : (_jsx("div", { className: "box-integrity__boxes", children: groupedRows.map((group) => (_jsxs("details", { className: "box-integrity__box", children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsx(AlertTriangle, { size: 17, "aria-hidden": "true" }), _jsx("strong", { children: group.boxCode }), _jsx("small", { children: group.clientName })] }), _jsxs("span", { children: [group.rows.length, " \u043F\u043E\u0437. \u00B7 \u0440\u0438\u0441\u043A ", group.rows.reduce((sum, row) => sum + row.suspectQuantity, 0), " \u0448\u0442."] })] }), _jsx("div", { className: "box-integrity__rows", children: group.rows.map((row) => (_jsxs("article", { className: `box-integrity__row box-integrity__row--${row.severity.toLowerCase()}`, children: [_jsxs("div", { className: "box-integrity__row-head", children: [_jsxs("div", { children: [_jsx("strong", { children: row.skuName }), _jsxs("span", { children: [row.internalSku, row.barcode ? ` · ШК ${row.barcode}` : ''] })] }), _jsx("span", { className: `box-integrity__badge box-integrity__badge--${row.severity.toLowerCase()}`, children: severityLabel(row.severity) })] }), _jsx("p", { children: row.reasonLabel }), _jsxs("div", { className: "box-integrity__metrics", children: [_jsxs("span", { children: ["\u0412 WMS ", _jsx("strong", { children: row.currentQuantity })] }), _jsxs("span", { children: ["\u041F\u043E\u0434 \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u043C ", _jsx("strong", { children: row.suspectQuantity })] }), _jsxs("span", { children: ["\u0412\u0437\u044F\u0442\u043E \u043D\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0443 ", _jsx("strong", { children: row.relabelQuantity })] }), _jsxs("span", { children: ["\u0412\u0437\u044F\u0442\u043E \u0432 FBS ", _jsx("strong", { children: row.fbsPickedQuantity })] }), _jsxs("span", { children: ["\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E ", _jsx("strong", { children: row.restoredQuantity })] }), _jsxs("span", { children: ["\u041A\u0418\u0417 / \u043B\u0438\u0448\u043D\u0438\u0445 ", _jsxs("strong", { children: [row.markCount, " / ", row.excessMarkCount] })] })] }), row.evidence?.relabelOrders?.length ? (_jsxs("small", { className: "box-integrity__evidence", children: ["\u0421\u043E\u0431\u044B\u0442\u0438\u044F: ", row.evidence.relabelOrders.join('; ')] })) : null, row.decision === 'PENDING' ? (_jsxs("div", { className: "box-integrity__actions", children: [_jsx("button", { className: "secondary-button", type: "button", disabled: busyRowId === row.id, onClick: () => void decide(row, 'KEEP_AS_IS'), children: "\u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043A\u0430\u043A \u0435\u0441\u0442\u044C" }), _jsx("button", { className: "danger-button", type: "button", disabled: busyRowId === row.id, onClick: () => void decide(row, 'WRITE_OFF'), children: "\u0421\u043F\u0438\u0441\u0430\u0442\u044C" }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u0432\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { type: "number", min: "0", step: "1", value: quantities[row.id] ?? String(row.currentQuantity), onChange: (event) => setQuantities((current) => ({ ...current, [row.id]: event.target.value })) })] }), _jsx("button", { className: "primary-button", type: "button", disabled: busyRowId === row.id, onClick: () => void decide(row, 'SET_QUANTITY'), children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" })] })) : (_jsxs("div", { className: "box-integrity__decision", children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), decisionLabel(row), " \u00B7 ", row.decidedByName ?? 'менеджер', " \u00B7 ", formatDateTime(row.decidedAt)] }))] }, row.id))) })] }, group.boxCode))) }))] })) : (_jsx("p", { className: "warehouse-inline", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043E\u043A \u0435\u0449\u0451 \u043D\u0435\u0442. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0435\u0440\u0438\u043E\u0434 \u0438 \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043F\u0435\u0440\u0432\u0443\u044E." }))] }));
}
function SummaryCard({ label, value, tone = 'normal' }) {
    return (_jsxs("div", { className: `box-integrity__summary-card box-integrity__summary-card--${tone}`, children: [_jsx("strong", { children: value }), _jsx("span", { children: label })] }));
}
function groupRows(rows) {
    const map = new Map();
    rows.forEach((row) => {
        const group = map.get(row.boxCode) ?? { boxCode: row.boxCode, clientName: row.clientName, rows: [] };
        group.rows.push(row);
        map.set(row.boxCode, group);
    });
    return [...map.values()].sort((left, right) => {
        const leftPending = left.rows.filter((row) => row.decision === 'PENDING').length;
        const rightPending = right.rows.filter((row) => row.decision === 'PENDING').length;
        return rightPending - leftPending || left.boxCode.localeCompare(right.boxCode);
    });
}
function severityLabel(value) {
    if (value === 'HIGH')
        return 'Точный риск';
    if (value === 'MEDIUM')
        return 'Нужна проверка';
    return 'Расхождение КИЗ';
}
function decisionLabel(row) {
    if (row.decision === 'KEEP_AS_IS')
        return `Оставлено как есть: ${row.afterQuantity ?? row.currentQuantity} шт.`;
    if (row.decision === 'WRITE_OFF')
        return `Списано: ${row.beforeQuantity ?? row.currentQuantity} → 0`;
    return `Количество изменено: ${row.beforeQuantity ?? row.currentQuantity} → ${row.afterQuantity ?? row.decidedQuantity ?? 0}`;
}
function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}
function dateInput(value) {
    return value.toISOString().slice(0, 10);
}
function formatDate(value) {
    return value ? new Date(value).toLocaleDateString('ru-RU') : '—';
}
function formatDateTime(value) {
    return value ? new Date(value).toLocaleString('ru-RU') : '—';
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
