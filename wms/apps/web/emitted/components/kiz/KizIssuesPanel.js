import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck, Trash2, Wrench, X, } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBoxKizDiscrepancies, fetchKizIssues, markKizIssueRead, resolveKizIssue, writeOffAllBoxKizDiscrepancies, writeOffBoxKizDiscrepancy, } from '../../lib/api';
import './kiz.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
export function KizIssuesPanel({ session }) {
    const [status, setStatus] = useState('open');
    const [search, setSearch] = useState('');
    const [report, setReport] = useState(null);
    const [discrepancyReport, setDiscrepancyReport] = useState(null);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [selectedIssue, setSelectedIssue] = useState(null);
    const [selectedDiscrepancy, setSelectedDiscrepancy] = useState(null);
    const [replacementKiz, setReplacementKiz] = useState('');
    const [comment, setComment] = useState('');
    const [confirmBoxMove, setConfirmBoxMove] = useState(true);
    const [confirmExtraUnit, setConfirmExtraUnit] = useState(false);
    const [isSaving, setSaving] = useState(false);
    const [confirmWriteOff, setConfirmWriteOff] = useState(false);
    const [writeOffComment, setWriteOffComment] = useState('');
    const [isBulkWriteOffOpen, setBulkWriteOffOpen] = useState(false);
    const [confirmBulkWriteOff, setConfirmBulkWriteOff] = useState(false);
    const [bulkWriteOffComment, setBulkWriteOffComment] = useState('');
    const load = useCallback(async (quiet = false) => {
        if (!quiet)
            setLoading(true);
        setError('');
        try {
            const [issues, discrepancies] = await Promise.all([
                fetchKizIssues(session.accessToken, {
                    status,
                    search: search.trim() || undefined,
                    limit: 300,
                }),
                fetchBoxKizDiscrepancies(session.accessToken, {
                    search: search.trim() || undefined,
                    limit: 300,
                }),
            ]);
            setReport(issues);
            setDiscrepancyReport(discrepancies);
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось загрузить очередь проблемных КИЗ.');
        }
        finally {
            if (!quiet)
                setLoading(false);
        }
    }, [search, session.accessToken, status]);
    useEffect(() => {
        void load();
        const timer = window.setInterval(() => void load(true), 30_000);
        return () => window.clearInterval(timer);
    }, [load, session.user.activeWarehouseId]);
    const clients = useMemo(() => {
        const byId = new Map();
        report?.issues.forEach((issue) => {
            if (issue.client)
                byId.set(issue.client.id, issue.client);
        });
        return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'));
    }, [report]);
    function submitSearch(event) {
        event.preventDefault();
        void load();
    }
    function openIssue(issue) {
        setSelectedIssue(issue);
        setReplacementKiz('');
        setComment('');
        setConfirmBoxMove(true);
        setConfirmExtraUnit(false);
        setMessage('');
        setError('');
        if (issue.isUnread) {
            void markKizIssueRead(session.accessToken, issue.issueKey)
                .then(() => {
                window.dispatchEvent(new Event('kiz-issues-changed'));
                void load(true);
            })
                .catch(() => undefined);
        }
    }
    function closeIssue() {
        if (isSaving)
            return;
        setSelectedIssue(null);
    }
    function openDiscrepancy(row) {
        setSelectedIssue(null);
        setSelectedDiscrepancy(row);
        setConfirmWriteOff(false);
        setWriteOffComment('');
        setMessage('');
        setError('');
    }
    function closeDiscrepancy() {
        if (isSaving)
            return;
        setSelectedDiscrepancy(null);
    }
    async function writeOffDiscrepancy() {
        if (!selectedDiscrepancy || !confirmWriteOff)
            return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const result = await writeOffBoxKizDiscrepancy(session.accessToken, selectedDiscrepancy.boxId, selectedDiscrepancy.skuId, {
                confirm: true,
                comment: writeOffComment.trim() || undefined,
            });
            setMessage(result.message);
            setSelectedDiscrepancy(null);
            window.dispatchEvent(new Event('kiz-issues-changed'));
            await load(true);
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось списать расхождение КИЗ.');
        }
        finally {
            setSaving(false);
        }
    }
    function openBulkWriteOff() {
        setSelectedIssue(null);
        setSelectedDiscrepancy(null);
        setConfirmBulkWriteOff(false);
        setBulkWriteOffComment('');
        setMessage('');
        setError('');
        setBulkWriteOffOpen(true);
    }
    function closeBulkWriteOff() {
        if (isSaving)
            return;
        setBulkWriteOffOpen(false);
    }
    async function writeOffAllDiscrepancies() {
        if (!confirmBulkWriteOff)
            return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const result = await writeOffAllBoxKizDiscrepancies(session.accessToken, { search: search.trim() || undefined }, {
                confirm: true,
                comment: bulkWriteOffComment.trim() || undefined,
            });
            setMessage(result.message);
            setBulkWriteOffOpen(false);
            window.dispatchEvent(new Event('kiz-issues-changed'));
            await load(true);
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось выполнить массовое исправление КИЗ.');
        }
        finally {
            setSaving(false);
        }
    }
    async function resolve(action) {
        if (!selectedIssue)
            return;
        if ((action === 'REPLACE_KIZ' || action === 'REGISTER_EXTRA_UNIT') &&
            (replacementKiz.trim().length < 16 ||
                replacementKiz.trim().length > 135)) {
            setError('Отсканируйте корректный КИЗ Data Matrix.');
            return;
        }
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const result = await resolveKizIssue(session.accessToken, selectedIssue.issueKey, {
                action,
                kiz: action === 'REPLACE_KIZ' || action === 'REGISTER_EXTRA_UNIT'
                    ? replacementKiz.trim()
                    : undefined,
                confirmBoxMove: action === 'REPLACE_KIZ' ? confirmBoxMove : undefined,
                comment: comment.trim() || undefined,
            });
            setMessage(result.message);
            setSelectedIssue(null);
            window.dispatchEvent(new Event('kiz-issues-changed'));
            await load(true);
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось исправить проблему КИЗ.');
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0438", title: "\u041A\u0418\u0417", description: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0439: \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443 \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F, \u0441\u0432\u0435\u0440\u0438\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430 \u0438\u043B\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0443.", tiles: [
            { title: 'Проблемные КИЗ', description: 'Очередь ошибок и полная история использования кода.', icon: AlertTriangle, tone: 'red' },
            { title: 'Расхождения в коробах', description: 'Найти лишние и отсутствующие КИЗ по фактическим остаткам.', icon: Search, tone: 'orange' },
            { title: 'Исправления', description: 'Заменить КИЗ, подтвердить единицу или списать расхождение.', icon: Wrench, tone: 'green' },
        ], children: _jsxs("div", { className: "kiz-panel", children: [_jsxs("section", { className: "kiz-hero", children: [_jsx("div", { className: "kiz-hero__icon", children: _jsx(ShieldCheck, { size: 26, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0438" }), _jsx("h2", { children: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0435 \u041A\u0418\u0417" }), _jsx("p", { children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u044F Wildberries, \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0435 \u0441\u043A\u0430\u043D\u044B \u0438 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u043C\u0435\u0436\u0434\u0443 \u043E\u0442\u043F\u0438\u043A\u0430\u043D\u043D\u044B\u043C \u0442\u043E\u0432\u0430\u0440\u043E\u043C, \u043A\u043E\u0440\u043E\u0431\u043E\u043C \u0438 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0435\u0439 \u041A\u0418\u0417 \u0432 WMS." })] }), _jsxs("button", { className: "icon-text-button", type: "button", disabled: isLoading, onClick: () => void load(), children: [_jsx(RefreshCw, { className: isLoading ? 'is-spinning' : '', size: 16, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), _jsxs("section", { className: "kiz-summary", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u041A\u0418\u0417", children: [_jsx(Summary, { label: "\u041D\u0435\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E", value: report?.summary.unread ?? 0, tone: "danger" }), _jsx(Summary, { label: "\u041E\u0442\u043A\u0440\u044B\u0442\u043E", value: report?.summary.open ?? 0, tone: "danger" }), _jsx(Summary, { label: "\u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435", value: report?.summary.critical ?? 0, tone: "danger" }), _jsx(Summary, { label: "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u044F", value: report?.summary.warning ?? 0, tone: "warning" }), _jsx(Summary, { label: "\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E", value: report?.summary.resolved ?? 0, tone: "success" }), _jsx(Summary, { label: "\u041B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417", value: discrepancyReport?.summary.excessKiz ?? 0, tone: "warning" })] }), _jsxs("section", { className: "kiz-toolbar", children: [_jsx("div", { className: "kiz-tabs", role: "tablist", "aria-label": "\u0421\u0442\u0430\u0442\u0443\u0441 \u043F\u0440\u043E\u0431\u043B\u0435\u043C", children: [
                                ['open', 'Открытые'],
                                ['resolved', 'Исправленные'],
                                ['all', 'Все'],
                            ].map(([value, label]) => (_jsx("button", { className: status === value ? 'active' : '', type: "button", onClick: () => setStatus(value), children: label }, value))) }), _jsxs("form", { className: "kiz-search", onSubmit: submitSearch, children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041A\u0418\u0417, \u0437\u0430\u044F\u0432\u043A\u0430, \u0437\u0430\u043A\u0430\u0437, \u0442\u043E\u0432\u0430\u0440, \u043A\u043E\u0440\u043E\u0431 \u0438\u043B\u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" }), _jsx("button", { type: "submit", children: "\u041D\u0430\u0439\u0442\u0438" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, _jsxs("section", { className: "kiz-queue kiz-discrepancies", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u041A\u0418\u0417 \u043F\u043E \u043A\u043E\u0440\u043E\u0431\u0430\u043C" }), _jsx("span", { children: "\u041A\u0418\u0417 \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u0440\u043E\u0432\u043D\u043E \u0441\u0442\u043E\u043B\u044C\u043A\u043E, \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0435\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430 \u0447\u0438\u0441\u043B\u0438\u0442\u0441\u044F \u0432 \u043A\u043E\u0440\u043E\u0431\u0435" })] }), _jsxs("div", { className: "kiz-discrepancies__actions", children: [_jsxs("button", { className: "kiz-write-off-all-button", type: "button", disabled: isLoading ||
                                                !discrepancyReport ||
                                                discrepancyReport.summary.rows - discrepancyReport.summary.blockedRows <= 0, onClick: openBulkWriteOff, children: [_jsx(Wrench, { size: 16, "aria-hidden": "true" }), "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435"] }), _jsx("strong", { children: discrepancyReport?.summary.rows ?? 0 })] })] }), isLoading && !discrepancyReport ? (_jsxs("div", { className: "kiz-empty", children: [_jsx(RefreshCw, { className: "is-spinning", size: 24, "aria-hidden": "true" }), "\u0421\u0432\u0435\u0440\u044F\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0438 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u041A\u0418\u0417\u2026"] })) : discrepancyReport?.discrepancies.length ? (_jsx("div", { className: "kiz-table-wrap", children: _jsxs("table", { className: "kiz-table kiz-discrepancy-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431 / \u043A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041A\u043E\u0441\u0442\u044E\u043C / \u0442\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0412 \u043A\u043E\u0440\u043E\u0431\u0435" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041B\u0438\u0448\u043D\u0438\u0445" }), _jsx("th", {})] }) }), _jsx("tbody", { children: discrepancyReport.discrepancies.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.boxCode }), _jsxs("small", { children: [row.clientCode, " \u00B7 ", row.clientName] }), _jsx("small", { children: row.warehouseCity || 'Филиал не указан' })] }), _jsxs("td", { children: [_jsx("strong", { children: row.internalSku }), _jsx("small", { children: [row.productName, row.size].filter(Boolean).join(' · ') })] }), _jsx("td", { children: _jsxs("strong", { children: [row.boxQuantity, " \u0448\u0442."] }) }), _jsxs("td", { children: [_jsx("strong", { children: row.registeredKizCount }), row.protectedKizCount ? (_jsxs("small", { children: ["\u0437\u0430\u043D\u044F\u0442\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u043C\u0438 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438: ", row.protectedKizCount] })) : null] }), _jsx("td", { children: _jsxs("strong", { className: "kiz-excess-count", children: ["+", row.excessKizCount] }) }), _jsx("td", { children: _jsxs("button", { className: "kiz-write-off-button", type: "button", disabled: !row.canWriteOff, title: row.canWriteOff ? undefined : 'Сначала исправьте активные FBS-заказы, использующие КИЗ из этого короба', onClick: () => openDiscrepancy(row), children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), row.canWriteOff ? 'Списать расхождение' : 'Занято заказами'] }) })] }, `${row.boxId}:${row.skuId}`))) })] }) })) : (_jsxs("div", { className: "kiz-empty", children: [_jsx(CheckCircle2, { size: 28, "aria-hidden": "true" }), _jsx("strong", { children: "\u041B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417 \u0432 \u043A\u043E\u0440\u043E\u0431\u0430\u0445 \u043D\u0435\u0442" }), _jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u041A\u0418\u0417 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u0443\u0447\u0442\u0451\u043D\u043D\u044B\u043C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E\u043C \u0442\u043E\u0432\u0430\u0440\u0430." })] }))] }), _jsxs("section", { className: "kiz-queue", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0440\u0430\u0437\u0431\u043E\u0440\u0430" }), _jsxs("span", { children: ["\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043A\u0430\u0436\u0434\u044B\u0435 30 \u0441\u0435\u043A\u0443\u043D\u0434", clients.length ? ` · клиентов в выдаче: ${clients.length}` : ''] })] }), _jsx("strong", { children: report?.issues.length ?? 0 })] }), isLoading && !report ? (_jsxs("div", { className: "kiz-empty", children: [_jsx(RefreshCw, { className: "is-spinning", size: 24, "aria-hidden": "true" }), "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u041A\u0418\u0417\u2026"] })) : report?.issues.length ? (_jsx("div", { className: "kiz-table-wrap", children: _jsxs("table", { className: "kiz-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u0430" }), _jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 / \u0437\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440 \u0438 \u043A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u043E" }), _jsx("th", {})] }) }), _jsx("tbody", { children: report.issues.map((issue) => (_jsxs("tr", { className: issue.isUnread ? 'kiz-row--unread' : undefined, children: [_jsxs("td", { children: [_jsxs("span", { className: `kiz-severity kiz-severity--${issue.severity.toLowerCase()}`, children: [issue.severity === 'CRITICAL' ? (_jsx(AlertTriangle, { size: 14, "aria-hidden": "true" })) : (_jsx(Clock3, { size: 14, "aria-hidden": "true" })), issue.title] }), issue.isUnread ? (_jsx("span", { className: "kiz-unread-label", children: "\u041D\u043E\u0432\u043E\u0435" })) : null, _jsx("small", { children: issue.explanation }), issue.errorMessage ? (_jsx("small", { className: "kiz-error-detail", children: issue.errorMessage })) : null, issue.stockConflict ? (_jsxs("small", { className: "kiz-stock-conflict", children: ["\u041E\u0441\u0442\u0430\u0442\u043E\u043A: ", issue.stockConflict.availableQuantity, " \u00B7 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u041A\u0418\u0417:", ' ', issue.stockConflict.registeredKizCount, " \u00B7 \u0437\u0430\u043D\u044F\u0442\u043E:", ' ', issue.stockConflict.usedKizCount] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: issue.request
                                                                ? `№${String(issue.request.number).padStart(6, '0')}`
                                                                : 'Без заявки' }), _jsxs("small", { children: ["\u0417\u0430\u043A\u0430\u0437 WB: ", issue.orderId || '—'] }), _jsx("small", { children: issue.client
                                                                ? `${issue.client.code} · ${issue.client.name}`
                                                                : 'Клиент не найден' }), issue.duplicate ? (_jsxs("small", { className: "kiz-duplicate", children: ["\u0413\u0434\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D: \u0437\u0430\u044F\u0432\u043A\u0430", ' ', issue.duplicate.existingRequestNumber
                                                                    ? `№${String(issue.duplicate.existingRequestNumber).padStart(6, '0')}`
                                                                    : '—', ", \u0437\u0430\u043A\u0430\u0437 WB ", issue.duplicate.existingOrderId || '—', ", \u043A\u043E\u0440\u043E\u0431 ", issue.duplicate.existingBoxCode || '—', _jsx("br", {}), "\u041A\u043E\u0441\u0442\u044E\u043C / \u0442\u043E\u0432\u0430\u0440:", ' ', formatExistingProduct(issue.duplicate.existingProduct)] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: issue.sku?.internalSku || 'SKU не найден' }), _jsx("small", { children: [issue.sku?.name, issue.sku?.size]
                                                                .filter(Boolean)
                                                                .join(' · ') || '—' }), _jsxs("small", { children: ["\u041A\u043E\u0440\u043E\u0431: ", issue.boxCode || 'без короба', " \u00B7", ' ', issue.branch?.city || 'город не указан'] })] }), _jsxs("td", { children: [_jsx("code", { children: issue.kiz || 'не сохранён' }), _jsxs("small", { children: ["WB: ", issue.wbMetaStatus || '—'] })] }), _jsxs("td", { children: [_jsx("strong", { children: formatDateTime(issue.detectedAt) }), _jsx("small", { children: issue.workerName || 'сотрудник не указан' }), issue.resolution ? (_jsxs("small", { className: "kiz-resolution", children: ["\u0420\u0435\u0448\u0438\u043B: ", issue.resolution.userName || '—'] })) : null] }), _jsx("td", { children: issue.status === 'OPEN' ? (_jsxs("button", { className: "kiz-fix-button", type: "button", onClick: () => openIssue(issue), children: [_jsx(Wrench, { size: 15, "aria-hidden": "true" }), "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C"] })) : (_jsxs("span", { className: "kiz-resolved", children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), "\u0420\u0435\u0448\u0435\u043D\u043E"] })) })] }, issue.issueKey))) })] }) })) : (_jsxs("div", { className: "kiz-empty", children: [_jsx(CheckCircle2, { size: 28, "aria-hidden": "true" }), _jsx("strong", { children: status === 'open'
                                        ? 'Открытых проблем КИЗ нет'
                                        : 'По выбранному фильтру записей нет' }), _jsx("span", { children: "\u041D\u043E\u0432\u044B\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438." })] }))] }), selectedIssue ? (_jsx("div", { className: "kiz-dialog-backdrop", role: "presentation", onMouseDown: (event) => {
                        if (event.currentTarget === event.target)
                            closeIssue();
                    }, children: _jsxs("section", { className: "kiz-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "kiz-dialog-title", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441 \u0436\u0443\u0440\u043D\u0430\u043B\u043E\u043C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439" }), _jsx("h3", { id: "kiz-dialog-title", children: selectedIssue.title })] }), _jsx("button", { className: "icon-button", type: "button", onClick: closeIssue, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "kiz-dialog__facts", children: [_jsx(Fact, { label: "\u0417\u0430\u044F\u0432\u043A\u0430", value: selectedIssue.request
                                            ? `№${String(selectedIssue.request.number).padStart(6, '0')}`
                                            : '—' }), _jsx(Fact, { label: "\u0417\u0430\u043A\u0430\u0437 WB", value: selectedIssue.orderId || '—' }), _jsx(Fact, { label: "\u0422\u043E\u0432\u0430\u0440", value: selectedIssue.sku?.internalSku || '—' }), _jsx(Fact, { label: "\u041A\u043E\u0440\u043E\u0431", value: selectedIssue.boxCode || '—' })] }), _jsx("p", { className: "kiz-dialog__explanation", children: selectedIssue.explanation }), selectedIssue.duplicate ? (_jsxs("section", { className: "kiz-dialog__diagnostic", children: [_jsx("strong", { children: "\u0413\u0434\u0435 \u044D\u0442\u043E\u0442 \u041A\u0418\u0417 \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D" }), _jsxs("div", { children: [_jsx(Fact, { label: "\u0417\u0430\u044F\u0432\u043A\u0430", value: selectedIssue.duplicate.existingRequestNumber
                                                    ? `№${String(selectedIssue.duplicate.existingRequestNumber).padStart(6, '0')}`
                                                    : '—' }), _jsx(Fact, { label: "\u0417\u0430\u043A\u0430\u0437 WB", value: selectedIssue.duplicate.existingOrderId || '—' }), _jsx(Fact, { label: "\u041A\u043E\u0441\u0442\u044E\u043C / \u0442\u043E\u0432\u0430\u0440", value: formatExistingProduct(selectedIssue.duplicate.existingProduct) }), _jsx(Fact, { label: "\u041A\u043E\u0440\u043E\u0431", value: selectedIssue.duplicate.existingBoxCode || '—' })] })] })) : null, selectedIssue.stockConflict ? (_jsxs("section", { className: "kiz-dialog__diagnostic", children: [_jsx("strong", { children: "\u0427\u0442\u043E \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0438\u043B\u0430 \u0441\u0438\u0441\u0442\u0435\u043C\u0430" }), _jsxs("div", { children: [_jsx(Fact, { label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u043A\u043E\u0440\u043E\u0431\u0435", value: String(selectedIssue.stockConflict.availableQuantity) }), _jsx(Fact, { label: "\u041A\u0418\u0417 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043E", value: String(selectedIssue.stockConflict.registeredKizCount) }), _jsx(Fact, { label: "\u041A\u0418\u0417 \u0437\u0430\u043D\u044F\u0442\u043E \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438", value: String(selectedIssue.stockConflict.usedKizCount) })] }), selectedIssue.stockConflict.usedAssignments.length ? (_jsx("ul", { children: selectedIssue.stockConflict.usedAssignments.map((assignment, index) => (_jsxs("li", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430", ' ', assignment.requestNumber
                                                    ? `№${String(assignment.requestNumber).padStart(6, '0')}`
                                                    : '—', ' · ', "\u0437\u0430\u043A\u0430\u0437 WB ", assignment.orderId || '—', ' · ', "\u043A\u043E\u0440\u043E\u0431 ", assignment.boxCode || '—'] }, `${assignment.orderId ?? 'order'}-${index}`))) })) : null] })) : null, selectedIssue.allowedActions.includes('REPLACE_KIZ') ||
                                selectedIssue.allowedActions.includes('REGISTER_EXTRA_UNIT') ? (_jsxs("label", { className: "kiz-dialog__field", children: [_jsx("span", { children: selectedIssue.kind === 'BOX_KIZ_EXHAUSTED'
                                            ? 'КИЗ физической дополнительной единицы'
                                            : 'Новый корректный КИЗ' }), _jsx("textarea", { autoFocus: true, value: replacementKiz, onChange: (event) => setReplacementKiz(event.target.value), placeholder: "\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 Data Matrix", rows: 3 }), _jsx("small", { children: selectedIssue.kind === 'BOX_KIZ_EXHAUSTED'
                                            ? 'Если товар физически есть сверх текущего остатка, система добавит ровно одну единицу, зарегистрирует этот КИЗ и передаст его в Wildberries.'
                                            : 'Код будет повторно отправлен в Wildberries. Для уже отпиканного заказа система безопасно вернёт одну единицу в работу и соберёт её снова.' })] })) : (selectedIssue.allowedActions.includes('PREPARE_EXTRA_UNIT') ? (_jsx("p", { className: "kiz-dialog__notice", children: "\u041A\u0418\u0417 \u0437\u0434\u0435\u0441\u044C \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u043D\u0435 \u043D\u0443\u0436\u043D\u043E. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u0435\u0434\u0438\u043D\u0438\u0446\u0443, \u043F\u043E\u0441\u043B\u0435 \u0447\u0435\u0433\u043E \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0435\u0442 \u0435\u0451 \u041A\u0418\u0417 \u043D\u0430 \u0422\u0421\u0414. WMS \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0435\u0442 \u043A\u043E\u0434 \u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0441\u0442 \u0435\u0433\u043E \u0432 Wildberries." })) : (_jsx("p", { className: "kiz-dialog__notice", children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: \u0437\u0430\u043A\u0430\u0437 \u0443\u0436\u0435 \u0437\u0430\u043A\u0440\u044B\u0442, \u0443\u043F\u0430\u043A\u043E\u0432\u0430\u043D \u0432 \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u043E \u0438\u043B\u0438 \u0437\u0430\u0434\u0430\u043D\u0438\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C." }))), selectedIssue.allowedActions.includes('REPLACE_KIZ') ? (_jsxs("label", { className: "kiz-dialog__check", children: [_jsx("input", { type: "checkbox", checked: confirmBoxMove, onChange: (event) => setConfirmBoxMove(event.target.checked) }), _jsx("span", { children: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u043F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C \u041A\u0418\u0417 \u043A \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u043C\u0443 \u043A\u043E\u0440\u043E\u0431\u0443, \u0435\u0441\u043B\u0438 \u0432 WMS \u0443\u043A\u0430\u0437\u0430\u043D \u0434\u0440\u0443\u0433\u043E\u0439 \u043A\u043E\u0440\u043E\u0431" })] })) : null, selectedIssue.allowedActions.includes('REGISTER_EXTRA_UNIT') ||
                                selectedIssue.allowedActions.includes('PREPARE_EXTRA_UNIT') ? (_jsxs("label", { className: "kiz-dialog__check kiz-dialog__check--warning", children: [_jsx("input", { type: "checkbox", checked: confirmExtraUnit, onChange: (event) => setConfirmExtraUnit(event.target.checked) }), _jsx("span", { children: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E, \u0447\u0442\u043E \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0435\u0434\u0438\u043D\u0438\u0446\u0430 \u0442\u043E\u0432\u0430\u0440\u0430 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442. \u041F\u0440\u0438 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0431\u0443\u0434\u0435\u0442 \u0443\u0432\u0435\u043B\u0438\u0447\u0435\u043D \u0440\u043E\u0432\u043D\u043E \u043D\u0430 1 \u0441 \u0437\u0430\u043F\u0438\u0441\u044C\u044E \u0432 \u0436\u0443\u0440\u043D\u0430\u043B\u0435." })] })) : null, _jsxs("label", { className: "kiz-dialog__field", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }), _jsx("textarea", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u0427\u0442\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u043B\u0438 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u043F\u0440\u0438\u043D\u044F\u043B\u0438 \u0440\u0435\u0448\u0435\u043D\u0438\u0435", rows: 2 })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { children: [_jsxs("button", { className: "secondary-button", type: "button", disabled: isSaving, onClick: () => void resolve('MARK_RESOLVED'), children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), "\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0440\u0435\u0448\u0451\u043D\u043D\u043E\u0439"] }), selectedIssue.allowedActions.includes('REPLACE_KIZ') ? (_jsxs("button", { className: "primary-button", type: "button", disabled: isSaving, onClick: () => void resolve('REPLACE_KIZ'), children: [isSaving ? (_jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" })) : (_jsx(Wrench, { size: 16, "aria-hidden": "true" })), isSaving ? 'Исправляю…' : 'Исправить КИЗ'] })) : null, selectedIssue.allowedActions.includes('RELEASE_BOX') ? (_jsx("button", { className: "secondary-button", type: "button", disabled: isSaving, onClick: () => void resolve('RELEASE_BOX'), children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0434\u0440\u0443\u0433\u043E\u0439 \u043A\u043E\u0440\u043E\u0431" })) : null, selectedIssue.allowedActions.includes('REGISTER_EXTRA_UNIT') ? (_jsxs("button", { className: "primary-button", type: "button", disabled: isSaving || !confirmExtraUnit, onClick: () => void resolve('REGISTER_EXTRA_UNIT'), children: [isSaving ? (_jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" })) : (_jsx(Wrench, { size: 16, "aria-hidden": "true" })), isSaving
                                                ? 'Исправляю…'
                                                : 'Подтвердить +1 и принять КИЗ'] })) : null, selectedIssue.allowedActions.includes('PREPARE_EXTRA_UNIT') ? (_jsxs("button", { className: "primary-button", type: "button", disabled: isSaving || !confirmExtraUnit, onClick: () => void resolve('PREPARE_EXTRA_UNIT'), children: [isSaving ? (_jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" })) : (_jsx(Wrench, { size: 16, "aria-hidden": "true" })), isSaving
                                                ? 'Подготавливаю…'
                                                : 'Учесть +1 и разрешить повторный скан'] })) : null] })] }) })) : null, selectedDiscrepancy ? (_jsx("div", { className: "kiz-dialog-backdrop", role: "presentation", onMouseDown: (event) => {
                        if (event.currentTarget === event.target)
                            closeDiscrepancy();
                    }, children: _jsxs("section", { className: "kiz-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "kiz-write-off-title", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u0443\u0435\u043C\u043E\u0435 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("h3", { id: "kiz-write-off-title", children: "\u0421\u043F\u0438\u0441\u0430\u0442\u044C \u043B\u0438\u0448\u043D\u0438\u0435 \u041A\u0418\u0417" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: closeDiscrepancy, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "kiz-dialog__facts", children: [_jsx(Fact, { label: "\u041A\u043E\u0440\u043E\u0431", value: selectedDiscrepancy.boxCode }), _jsx(Fact, { label: "\u0422\u043E\u0432\u0430\u0440", value: selectedDiscrepancy.internalSku }), _jsx(Fact, { label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A", value: `${selectedDiscrepancy.boxQuantity} шт.` }), _jsx(Fact, { label: "\u041A\u0418\u0417 \u0441\u0435\u0439\u0447\u0430\u0441", value: String(selectedDiscrepancy.registeredKizCount) })] }), _jsxs("p", { className: "kiz-dialog__explanation", children: ["\u0411\u0443\u0434\u0435\u0442 \u0441\u043F\u0438\u0441\u0430\u043D\u043E ", selectedDiscrepancy.excessKizCount, " \u043B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417. \u041F\u043E\u0441\u043B\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u0432 \u043A\u043E\u0440\u043E\u0431\u0435 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u0440\u043E\u0432\u043D\u043E ", selectedDiscrepancy.boxQuantity, " \u041A\u0418\u0417 \u2014 \u043F\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443 \u0442\u043E\u0432\u0430\u0440\u0430."] }), _jsx("p", { className: "kiz-dialog__notice", children: "\u041A\u0418\u0417, \u0437\u0430\u043D\u044F\u0442\u044B\u0435 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u043C\u0438 FBS-\u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438, \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u044B \u0438 \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F. \u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u0434\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u0442\u0441\u044F \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u043E\u0442\u0433\u0440\u0443\u0437\u043E\u043A \u0438 \u0432 \u0436\u0443\u0440\u043D\u0430\u043B\u0435 \u044D\u0442\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438." }), _jsxs("label", { className: "kiz-dialog__field", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }), _jsx("textarea", { value: writeOffComment, onChange: (event) => setWriteOffComment(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u043D \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u043A\u043E\u0440\u043E\u0431\u0435", rows: 2 })] }), _jsxs("label", { className: "kiz-dialog__check kiz-dialog__check--warning", children: [_jsx("input", { type: "checkbox", checked: confirmWriteOff, onChange: (event) => setConfirmWriteOff(event.target.checked) }), _jsxs("span", { children: ["\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 ", selectedDiscrepancy.excessKizCount, " \u043B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417. \u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u0432 \u043A\u043E\u0440\u043E\u0431\u0435 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F."] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", disabled: isSaving, onClick: closeDiscrepancy, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "button", disabled: isSaving || !confirmWriteOff, onClick: () => void writeOffDiscrepancy(), children: [isSaving ? _jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" }) : _jsx(Trash2, { size: 16, "aria-hidden": "true" }), isSaving ? 'Списываю…' : `Списать ${selectedDiscrepancy.excessKizCount} КИЗ`] })] })] }) })) : null, isBulkWriteOffOpen && discrepancyReport ? (_jsx("div", { className: "kiz-dialog-backdrop", role: "presentation", onMouseDown: (event) => {
                        if (event.currentTarget === event.target)
                            closeBulkWriteOff();
                    }, children: _jsxs("section", { className: "kiz-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "kiz-write-off-all-title", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" }), _jsx("h3", { id: "kiz-write-off-all-title", children: "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u041A\u0418\u0417" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: closeBulkWriteOff, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "kiz-dialog__facts", children: [_jsx(Fact, { label: "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439", value: String(discrepancyReport.summary.rows) }), _jsx(Fact, { label: "\u041B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417", value: String(discrepancyReport.summary.excessKiz) }), _jsx(Fact, { label: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0434\u043B\u044F \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F", value: String(discrepancyReport.summary.rows - discrepancyReport.summary.blockedRows) }), _jsx(Fact, { label: "\u0417\u0430\u0449\u0438\u0449\u0435\u043D\u043E \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438", value: String(discrepancyReport.summary.blockedRows) })] }), _jsxs("p", { className: "kiz-dialog__explanation", children: ["\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432\u0441\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F", search.trim() ? ' по текущему поиску' : ' выбранного филиала', " \u0438 \u043E\u0441\u0442\u0430\u0432\u0438\u0442 \u0432 \u043A\u0430\u0436\u0434\u043E\u043C \u043A\u043E\u0440\u043E\u0431\u0435 \u0440\u043E\u0432\u043D\u043E \u0441\u0442\u043E\u043B\u044C\u043A\u043E \u041A\u0418\u0417, \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432 \u043D\u0451\u043C \u0447\u0438\u0441\u043B\u0438\u0442\u0441\u044F \u0442\u043E\u0432\u0430\u0440\u0430."] }), _jsx("p", { className: "kiz-dialog__notice", children: "\u041A\u0418\u0417 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u043D\u0435 \u0441\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0442\u0441\u044F. \u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u0432 \u0441\u043F\u0438\u0441\u043A\u0435 \u0434\u043B\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0440\u0430\u0437\u0431\u043E\u0440\u0430. \u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F." }), _jsxs("label", { className: "kiz-dialog__field", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }), _jsx("textarea", { value: bulkWriteOffComment, onChange: (event) => setBulkWriteOffComment(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430 \u043E\u0431\u0449\u0430\u044F \u0441\u0432\u0435\u0440\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u0438 \u041A\u0418\u0417", rows: 2 })] }), _jsxs("label", { className: "kiz-dialog__check kiz-dialog__check--warning", children: [_jsx("input", { type: "checkbox", checked: confirmBulkWriteOff, onChange: (event) => setConfirmBulkWriteOff(event.target.checked) }), _jsx("span", { children: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E \u043C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043B\u0438\u0448\u043D\u0438\u0445 \u041A\u0418\u0417. \u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u0432 \u043A\u043E\u0440\u043E\u0431\u0430\u0445 \u043D\u0435 \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F." })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", disabled: isSaving, onClick: closeBulkWriteOff, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "button", disabled: isSaving || !confirmBulkWriteOff, onClick: () => void writeOffAllDiscrepancies(), children: [isSaving ? _jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" }) : _jsx(Wrench, { size: 16, "aria-hidden": "true" }), isSaving ? 'Исправляю всё…' : 'Исправить все'] })] })] }) })) : null] }) }));
}
function Summary({ label, value, tone, }) {
    return (_jsxs("article", { className: `kiz-summary__card kiz-summary__card--${tone}`, children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function Fact({ label, value }) {
    return (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function formatExistingProduct(product) {
    if (!product)
        return '—';
    const primary = product.name || product.internalSku || product.article || 'Товар не найден';
    const details = [
        product.internalSku && product.internalSku !== primary
            ? product.internalSku
            : null,
        product.article &&
            product.article !== primary &&
            product.article !== product.internalSku
            ? `арт. ${product.article}`
            : null,
        product.color,
        product.size,
    ].filter((value) => Boolean(value));
    return details.length > 0 ? `${primary} · ${details.join(' · ')}` : primary;
}
function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(date);
}
