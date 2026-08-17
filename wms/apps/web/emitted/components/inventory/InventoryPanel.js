import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, Boxes, CheckCircle2, ClipboardCheck, ListChecks, LockKeyhole, RefreshCw, ScanLine, Settings2, ShieldCheck, ShieldAlert, UnlockKeyhole, } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cancelInventorySession, approveInventoryBoxRescan, completeInventorySession, decideInventoryLine, fetchClients, fetchInventoryDashboard, fetchInventorySession, finishInventoryBox, openInventoryBox, scanInventoryItem, sendInventoryToReview, setInventoryCount, startInventorySession, } from '../../lib/api';
import './inventory.css';
import { useRememberedClientId } from '../../lib/rememberedClient';
const modes = [
    {
        id: 'FULL',
        number: '01',
        title: 'Полная инвентаризация',
        description: 'Проверка всех коробов. Все движения товара блокируются до завершения.',
        icon: LockKeyhole,
        danger: true,
    },
    {
        id: 'PARTIAL',
        number: '02',
        title: 'Частичная инвентаризация',
        description: 'Проверка выбранных коробов без остановки складских операций.',
        icon: ListChecks,
    },
    {
        id: 'BOX_CHECK',
        number: '03',
        title: 'Проверка содержимого короба',
        description: 'Быстрая сверка: система сразу показывает, всё ли совпало и что отличается.',
        icon: ScanLine,
    },
    {
        id: 'RECONCILIATION',
        number: '04',
        title: 'Актуализация остатков на базе инвентаризации',
        description: 'Журнал всех проверок и решения менеджера по расхождениям.',
        icon: Settings2,
    },
];
export function InventoryPanel({ session }) {
    const [mode, setMode] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [approvingRescanId, setApprovingRescanId] = useState('');
    const dashboardSignatureRef = useRef('');
    function acceptDashboard(nextDashboard) {
        const nextSignature = JSON.stringify(nextDashboard);
        if (dashboardSignatureRef.current === nextSignature) {
            return;
        }
        dashboardSignatureRef.current = nextSignature;
        setDashboard(nextDashboard);
    }
    async function load() {
        setLoading(true);
        setMessage('');
        try {
            const [nextDashboard, nextClients] = await Promise.all([
                fetchInventoryDashboard(session.accessToken),
                fetchClients(session.accessToken),
            ]);
            acceptDashboard(nextDashboard);
            setClients(nextClients.filter((client) => client.status !== 'ARCHIVED'));
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function refreshDashboard(reportError = true) {
        try {
            acceptDashboard(await fetchInventoryDashboard(session.accessToken));
        }
        catch (caught) {
            if (reportError) {
                setMessage(errorMessage(caught));
            }
        }
    }
    useEffect(() => {
        dashboardSignatureRef.current = '';
        setDashboard(null);
        void load();
    }, [session.accessToken]);
    useEffect(() => {
        const timer = window.setInterval(() => {
            void refreshDashboard(false);
        }, 5000);
        return () => window.clearInterval(timer);
    }, [session.accessToken]);
    async function approveRescan(request) {
        setApprovingRescanId(request.id);
        setMessage('');
        try {
            await approveInventoryBoxRescan(session.accessToken, request.id);
            await refreshDashboard();
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setApprovingRescanId('');
        }
    }
    return (_jsxs("div", { className: "inventory", children: [_jsxs("section", { className: "inventory-hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u043A\u043B\u0430\u0434 \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" }), _jsx("h2", { children: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }), _jsx("p", { children: "\u0421\u0432\u0435\u0440\u043A\u0430 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0433\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u043C\u0438 WMS \u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C\u0430\u044F \u0430\u043A\u0442\u0443\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F." })] }), _jsxs("div", { className: `inventory-lock ${dashboard?.movementLock.active ? 'inventory-lock--active' : ''}`, children: [dashboard?.movementLock.active ? _jsx(LockKeyhole, { size: 20 }) : _jsx(UnlockKeyhole, { size: 20 }), _jsxs("span", { children: [_jsx("small", { children: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u044F \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("strong", { children: dashboard?.movementLock.active ? 'Заблокированы' : 'Разрешены' })] })] })] }), dashboard?.movementLock.active ? (_jsxs("div", { className: "inventory-alert inventory-alert--danger", children: [_jsx(ShieldAlert, { size: 20 }), _jsxs("div", { children: [_jsxs("strong", { children: ["\u0418\u0434\u0451\u0442 \u043F\u043E\u043B\u043D\u0430\u044F \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F: ", dashboard.movementLock.title] }), _jsxs("span", { children: ["\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u043B ", dashboard.movementLock.createdByName, ". \u041F\u0440\u0438\u0451\u043C\u043A\u0430, \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F, \u0441\u0431\u043E\u0440\u043A\u0430, \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0430 \u0438 \u0440\u0443\u0447\u043D\u044B\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0434\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0438\u043B\u0438 \u043E\u0442\u043C\u0435\u043D\u044B."] })] })] })) : null, dashboard?.canApproveRescan && dashboard.pendingRescanRequests.length ? (_jsxs("section", { className: "inventory-rescan-requests", "aria-label": "\u0417\u0430\u043F\u0440\u043E\u0441\u044B \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0439 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043A\u043E\u0440\u043E\u0431\u043E\u0432", children: [_jsxs("div", { className: "inventory-rescan-requests__heading", children: [_jsx(ShieldCheck, { size: 21 }), _jsxs("div", { children: [_jsx("strong", { children: "\u041D\u0443\u0436\u043D\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u0443\u044E \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443" }), _jsx("span", { children: "\u0421\u0431\u043E\u0440\u0449\u0438\u043A \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043B \u0443\u0436\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0439 \u043A\u043E\u0440\u043E\u0431. \u0411\u0435\u0437 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u043A\u043E\u0440\u043E\u0431 \u043D\u0435 \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F." })] })] }), _jsx("div", { className: "inventory-rescan-requests__list", children: dashboard.pendingRescanRequests.map((request) => (_jsxs("article", { children: [_jsxs("div", { children: [_jsx("strong", { children: request.boxCode }), _jsxs("span", { children: [request.clientName, " \u00B7 ", request.sessionTitle] }), _jsxs("small", { children: ["\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u043B ", request.requestedByName, " \u00B7 ", formatDate(request.createdAt)] })] }), _jsxs("button", { className: "primary-button", type: "button", disabled: Boolean(approvingRescanId), onClick: () => void approveRescan(request), children: [_jsx(ShieldCheck, { size: 16 }), approvingRescanId === request.id ? 'Подтверждаю…' : 'Разрешить один повторный скан'] })] }, request.id))) })] })) : null, _jsx("div", { className: "inventory-mode-grid", children: modes.map((item) => {
                    const Icon = item.icon;
                    return (_jsxs("button", { className: `inventory-mode ${mode === item.id ? 'inventory-mode--active' : ''} ${item.danger ? 'inventory-mode--danger' : ''}`, type: "button", onClick: () => setMode(item.id), children: [_jsx("span", { className: "inventory-mode__number", children: item.number }), _jsx(Icon, { size: 24 }), _jsx("strong", { children: item.title }), _jsx("small", { children: item.description })] }, item.id));
                }) }), message ? _jsx("p", { className: "form-error", children: message }) : null, loading ? _jsx("p", { className: "muted", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0434\u0430\u043D\u043D\u044B\u0435 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438\u2026" }) : null, !loading && mode && dashboard ? (_jsxs("section", { className: "inventory-workbench", children: [_jsxs("div", { className: "inventory-workbench__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0420\u0430\u0431\u043E\u0447\u0430\u044F \u0437\u043E\u043D\u0430" }), _jsx("h3", { children: modes.find((item) => item.id === mode)?.title })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void refreshDashboard(), children: [_jsx(RefreshCw, { size: 16 }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), mode === 'RECONCILIATION' ? (_jsx(Reconciliation, { dashboard: dashboard, session: session, onChanged: refreshDashboard })) : (_jsx(InventoryOperation, { type: mode, dashboard: dashboard, clients: clients, session: session, onChanged: refreshDashboard }))] })) : null] }));
}
function InventoryOperation({ type, dashboard, clients, session, onChanged, }) {
    const candidates = dashboard.activeSessions.filter((item) => item.type === type);
    const [activeId, setActiveId] = useState(candidates[0]?.id ?? '');
    const [current, setCurrent] = useState(candidates[0] ?? null);
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: clients[0]?.id ?? '',
    });
    const [title, setTitle] = useState('');
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        const next = candidates.find((item) => item.id === activeId) ?? candidates[0] ?? null;
        setCurrent(next);
        setActiveId(next?.id ?? '');
    }, [type, dashboard.activeSessions]);
    async function create(event) {
        event.preventDefault();
        if (type !== 'FULL' && !clientId) {
            setMessage('Выберите клиента.');
            return;
        }
        setBusy(true);
        setMessage('');
        try {
            const created = await startInventorySession(session.accessToken, {
                type,
                clientId: type === 'FULL' ? undefined : clientId,
                title,
                comment,
            });
            setCurrent(created);
            setActiveId(created.id);
            setTitle('');
            setComment('');
            await onChanged();
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function refreshSession() {
        if (!current)
            return;
        setCurrent(await fetchInventorySession(session.accessToken, current.id));
    }
    if (current) {
        return (_jsxs("div", { className: "inventory-session", children: [candidates.length > 1 ? (_jsxs("label", { className: "inventory-field", children: [_jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430" }), _jsx("select", { value: activeId, onChange: (event) => setActiveId(event.target.value), children: candidates.map((item) => (_jsx("option", { value: item.id, children: item.title }, item.id))) })] })) : null, _jsx(SessionHeader, { current: current }), _jsx(BoxCounter, { session: session, inventory: current, onChanged: refreshSession }), _jsxs("div", { className: "inventory-session__actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: async () => {
                                setBusy(true);
                                try {
                                    await sendInventoryToReview(session.accessToken, current.id);
                                    setCurrent(null);
                                    await onChanged();
                                }
                                catch (caught) {
                                    setMessage(errorMessage(caught));
                                }
                                finally {
                                    setBusy(false);
                                }
                            }, disabled: busy, children: [_jsx(ClipboardCheck, { size: 16 }), type === 'BOX_CHECK' ? 'Завершить проверку' : 'Передать менеджеру на актуализацию'] }), dashboard.canManage ? (_jsx("button", { className: "danger-button", type: "button", onClick: async () => {
                                if (!window.confirm('Отменить эту инвентаризацию?'))
                                    return;
                                setBusy(true);
                                try {
                                    await cancelInventorySession(session.accessToken, current.id);
                                    setCurrent(null);
                                    await onChanged();
                                }
                                catch (caught) {
                                    setMessage(errorMessage(caught));
                                }
                                finally {
                                    setBusy(false);
                                }
                            }, children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C" })) : null] }), message ? _jsx("p", { className: "form-error", children: message }) : null] }));
    }
    return (_jsxs("form", { className: "inventory-start", onSubmit: create, children: [type === 'FULL' ? (_jsxs("div", { className: "inventory-alert inventory-alert--danger", children: [_jsx(AlertTriangle, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u043E\u043B\u043D\u0430\u044F \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439 \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("span", { children: "\u0421\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043F\u0443\u0441\u043A\u0430 \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u0437\u0430\u043F\u0440\u0435\u0442\u0438\u0442 \u043B\u044E\u0431\u044B\u0435 \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F. \u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u0441\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0438\u043B\u0438 \u043E\u0442\u043C\u0435\u043D\u044B \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u043E\u043C." })] })] })) : (_jsxs("label", { className: "inventory-field", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] })), _jsxs("label", { className: "inventory-field", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438" }), _jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u043E\u0434\u0441\u0442\u0430\u0432\u0438\u0442 \u0434\u0430\u0442\u0443 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] }), _jsxs("label", { className: "inventory-field inventory-field--wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { value: comment, onChange: (event) => setComment(event.target.value), rows: 3, placeholder: "\u0417\u043E\u043D\u0430, \u043F\u0440\u0438\u0447\u0438\u043D\u0430, \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0438\u043B\u0438 \u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0435\u0442\u0430\u043B\u0438" })] }), _jsxs("button", { className: type === 'FULL' ? 'danger-button' : 'primary-button', type: "submit", disabled: busy, children: [type === 'FULL' ? _jsx(LockKeyhole, { size: 16 }) : _jsx(ScanLine, { size: 16 }), busy ? 'Запускаю…' : 'Начать инвентаризацию'] }), message ? _jsx("p", { className: "form-error", children: message }) : null] }));
}
function SessionHeader({ current }) {
    return (_jsxs("div", { className: "inventory-session__summary", children: [_jsxs("div", { children: [_jsx("span", { className: `inventory-status inventory-status--${current.status.toLowerCase()}`, children: statusLabel(current.status) }), _jsx("h4", { children: current.title }), _jsxs("p", { children: ["\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u043B ", current.createdByName, " \u00B7 ", formatDate(current.startedAt)] })] }), _jsxs("div", { className: "inventory-metrics", children: [_jsxs("span", { children: [_jsx("small", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsxs("strong", { children: [current.progress?.checkedBoxes ?? current.boxes.filter((box) => box.status !== 'COUNTING').length, current.progress?.totalBoxes ? ` / ${current.progress.totalBoxes}` : ''] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0421 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F\u043C\u0438" }), _jsx("strong", { children: current.progress?.mismatchBoxes ?? current.boxes.filter((box) => box.status === 'MISMATCH').length })] })] })] }));
}
function BoxCounter({ session, inventory, onChanged, }) {
    const [boxCode, setBoxCode] = useState('');
    const [box, setBox] = useState(null);
    const [barcode, setBarcode] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const barcodeRef = useRef(null);
    async function open(event) {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
            const next = await openInventoryBox(session.accessToken, inventory.id, boxCode);
            setBox(next);
            setBoxCode(next.boxCode);
            setTimeout(() => barcodeRef.current?.focus(), 0);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function reloadBox() {
        const refreshed = await fetchInventorySession(session.accessToken, inventory.id);
        setBox(refreshed.boxes.find((item) => item.id === box?.id) ?? null);
        await onChanged();
    }
    async function scan(event) {
        event.preventDefault();
        if (!box || !barcode.trim())
            return;
        setBusy(true);
        setMessage('');
        try {
            await scanInventoryItem(session.accessToken, box.id, barcode, quantity);
            setBarcode('');
            setQuantity(1);
            await reloadBox();
            setTimeout(() => barcodeRef.current?.focus(), 0);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "inventory-counter", children: [_jsxs("form", { className: "inventory-scanbar", onSubmit: open, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("input", { value: boxCode, onChange: (event) => setBoxCode(event.target.value), placeholder: "\u041F\u0440\u043E\u043F\u0438\u043A\u0430\u0439\u0442\u0435 \u0438\u043B\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u043E\u043C\u0435\u0440", autoFocus: true })] }), _jsxs("button", { className: "secondary-button", type: "submit", disabled: !boxCode.trim() || busy, children: [_jsx(Boxes, { size: 16 }), " \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u043E\u0440\u043E\u0431"] })] }), box ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "inventory-box-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: box.clientName }), _jsxs("h4", { children: ["\u041A\u043E\u0440\u043E\u0431 ", box.boxCode] })] }), _jsx("span", { className: `inventory-status inventory-status--${box.status.toLowerCase()}`, children: boxStatusLabel(box.status) })] }), box.status === 'COUNTING' ? (_jsxs("form", { className: "inventory-item-scan", onSubmit: scan, children: [_jsxs("label", { children: [_jsx("span", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434 \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("input", { ref: barcodeRef, value: barcode, onChange: (event) => setBarcode(event.target.value), placeholder: "\u0421\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443" })] }), _jsxs("label", { className: "inventory-item-scan__quantity", children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { type: "number", min: 1, value: quantity, onChange: (event) => setQuantity(Math.max(1, Number(event.target.value) || 1)) })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !barcode.trim() || busy, children: [_jsx(ScanLine, { size: 16 }), " \u0423\u0447\u0435\u0441\u0442\u044C"] })] })) : null, _jsx(InventoryLinesTable, { box: box, editable: box.status === 'COUNTING', onSetCount: async (lineId, counted) => {
                            await setInventoryCount(session.accessToken, box.id, lineId, counted);
                            await reloadBox();
                        } }), box.status === 'COUNTING' ? (_jsxs("button", { className: "primary-button", type: "button", disabled: busy, onClick: async () => {
                            setBusy(true);
                            setMessage('');
                            try {
                                const finished = await finishInventoryBox(session.accessToken, box.id);
                                setBox(finished);
                                await onChanged();
                            }
                            catch (caught) {
                                setMessage(errorMessage(caught));
                            }
                            finally {
                                setBusy(false);
                            }
                        }, children: [_jsx(CheckCircle2, { size: 16 }), " \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u043F\u043E\u0434\u0441\u0447\u0451\u0442 \u043A\u043E\u0440\u043E\u0431\u0430"] })) : (_jsx(BoxResult, { box: box }))] })) : (_jsxs("div", { className: "inventory-empty", children: [_jsx(ScanLine, { size: 28 }), _jsx("strong", { children: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0441 \u043D\u043E\u043C\u0435\u0440\u0430 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("span", { children: "\u041F\u043E\u0441\u043B\u0435 \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u043E\u043A\u0430\u0436\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u0435\u043C\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0438 \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442 \u043F\u043E\u043B\u0435 \u0434\u043B\u044F \u043F\u043E\u0434\u0441\u0447\u0451\u0442\u0430." })] })), message ? _jsx("p", { className: "form-error", children: message }) : null] }));
}
function InventoryLinesTable({ box, editable, onSetCount, }) {
    if (box.lines.length === 0) {
        return _jsx("p", { className: "muted", children: "\u041F\u043E \u0434\u0430\u043D\u043D\u044B\u043C WMS \u043A\u043E\u0440\u043E\u0431 \u043F\u0443\u0441\u0442. \u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435 \u043A\u0430\u043A \u0438\u0437\u043B\u0438\u0448\u0435\u043A." });
    }
    return (_jsx("div", { className: "inventory-table-wrap", children: _jsxs("table", { className: "inventory-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u0412 WMS" }), _jsx("th", { children: "\u0424\u0430\u043A\u0442" }), _jsx("th", { children: "\u0420\u0430\u0437\u043D\u0438\u0446\u0430" })] }) }), _jsx("tbody", { children: box.lines.map((line) => {
                        const difference = line.countedQuantity - line.expectedQuantity;
                        return (_jsxs("tr", { className: difference === 0 ? '' : 'inventory-table__mismatch', children: [_jsxs("td", { children: [_jsx("strong", { children: line.skuName }), _jsx("small", { children: line.internalSku })] }), _jsx("td", { children: line.barcode || '—' }), _jsx("td", { children: line.expectedQuantity }), _jsx("td", { children: editable ? (_jsx("input", { type: "number", min: 0, value: line.countedQuantity, onChange: (event) => void onSetCount(line.id, Math.max(0, Number(event.target.value) || 0)) })) : line.countedQuantity }), _jsx("td", { className: difference === 0 ? 'inventory-diff--ok' : 'inventory-diff--bad', children: difference > 0 ? `+${difference}` : difference })] }, line.id));
                    }) })] }) }));
}
function BoxResult({ box }) {
    const mismatches = box.lines.filter((line) => line.countedQuantity !== line.expectedQuantity);
    return (_jsxs("div", { className: `inventory-result ${mismatches.length ? 'inventory-result--bad' : 'inventory-result--ok'}`, children: [mismatches.length ? _jsx(AlertTriangle, { size: 22 }) : _jsx(CheckCircle2, { size: 22 }), _jsxs("div", { children: [_jsx("strong", { children: mismatches.length ? 'Содержимое отличается' : 'Всё в порядке' }), _jsx("span", { children: mismatches.length
                            ? `Расхождений: ${mismatches.length}. Они выделены в таблице с точной разницей.`
                            : 'Фактическое содержимое полностью совпадает с данными WMS.' })] })] }));
}
function Reconciliation({ dashboard, session, onChanged, }) {
    const [busyLine, setBusyLine] = useState('');
    const [busyAction, setBusyAction] = useState(null);
    const [lineFeedback, setLineFeedback] = useState({});
    const [message, setMessage] = useState('');
    const history = dashboard.historySessions ?? dashboard.reviewSessions;
    const checkedBoxes = history.flatMap((inventory) => inventory.boxes)
        .filter((box) => box.status !== 'COUNTING');
    const matchedBoxes = checkedBoxes.filter((box) => box.status === 'MATCHED').length;
    const visibleReviews = history
        .map((review) => {
        const visibleBoxes = review.type === 'BOX_CHECK'
            ? review.boxes.filter((box) => box.lines.some((line) => line.countedQuantity !== line.expectedQuantity))
            : review.boxes;
        return {
            review,
            boxes: [...visibleBoxes].sort((left, right) => Number(boxNeedsResolution(right)) - Number(boxNeedsResolution(left))),
        };
    })
        .filter(({ review, boxes }) => review.type !== 'BOX_CHECK' || boxes.length > 0)
        .sort((left, right) => Number(right.boxes.some(boxNeedsResolution)) - Number(left.boxes.some(boxNeedsResolution)));
    async function resolveLine(lineId, action) {
        setBusyLine(lineId);
        setBusyAction(action);
        setMessage('');
        setLineFeedback((current) => {
            const next = { ...current };
            delete next[lineId];
            return next;
        });
        try {
            await decideInventoryLine(session.accessToken, lineId, action);
            setLineFeedback((current) => ({
                ...current,
                [lineId]: { tone: 'success', text: resolutionSuccessMessage(action) },
            }));
            await onChanged();
        }
        catch (caught) {
            setLineFeedback((current) => ({
                ...current,
                [lineId]: { tone: 'error', text: errorMessage(caught) },
            }));
        }
        finally {
            setBusyLine('');
            setBusyAction(null);
        }
    }
    if (history.length === 0) {
        return _jsxs("div", { className: "inventory-empty", children: [_jsx(ClipboardCheck, { size: 28 }), _jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043E\u043A \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0417\u0434\u0435\u0441\u044C \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u043F\u043E\u043B\u043D\u044B\u0435, \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u044B\u0435 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0433\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432." })] });
    }
    return (_jsxs("div", { className: "inventory-reconciliation", children: [!dashboard.canManage ? (_jsxs("div", { className: "inventory-alert", children: [_jsx(ShieldAlert, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430" }), _jsx("span", { children: "\u0420\u0435\u0448\u0435\u043D\u0438\u044F \u043F\u043E \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F\u043C \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0442\u044C \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0438\u043B\u0438 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440." })] })] })) : null, _jsxs("div", { className: "inventory-history-summary", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0416\u0443\u0440\u043D\u0430\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A" }), _jsx("strong", { children: "\u0412\u0441\u0435 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("span", { children: "\u0412 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0433\u043E \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0440\u043E\u0431\u0430 \u0441 \u043E\u0448\u0438\u0431\u043A\u0430\u043C\u0438. \u0423\u0441\u043F\u0435\u0448\u043D\u044B\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u043A\u0440\u044B\u0442\u044B." })] }), _jsxs("div", { className: "inventory-metrics", children: [_jsxs("span", { children: [_jsx("small", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043E\u043A" }), _jsx("strong", { children: history.length })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E" }), _jsx("strong", { children: checkedBoxes.length })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0411\u0435\u0437 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439" }), _jsx("strong", { children: matchedBoxes })] })] })] }), visibleReviews.length === 0 ? (_jsxs("div", { className: "inventory-empty", children: [_jsx(CheckCircle2, { size: 28 }), _jsx("strong", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u043E\u0448\u0438\u0431\u043A\u0430\u043C\u0438 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0412\u0441\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043F\u0440\u043E\u0448\u0435\u0434\u0448\u0438\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u043A\u0440\u044B\u0442\u044B \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430." })] })) : null, visibleReviews.map(({ review, boxes }) => (_jsxs("article", { className: "inventory-review", children: [boxes.map((box) => {
                        const mismatches = box.lines.filter((line) => line.countedQuantity !== line.expectedQuantity);
                        const missingQuantity = mismatches.reduce((sum, line) => sum + Math.max(0, line.expectedQuantity - line.countedQuantity), 0);
                        const excessQuantity = mismatches.reduce((sum, line) => sum + Math.max(0, line.countedQuantity - line.expectedQuantity), 0);
                        return (_jsxs("details", { className: "inventory-review-box", children: [_jsxs("summary", { className: "inventory-review-box__summary", children: [_jsxs("strong", { children: ["\u041A\u043E\u0440\u043E\u0431 ", box.boxCode] }), _jsx("span", { className: mismatches.length ? 'inventory-review-box__mismatch' : 'inventory-review-box__matched', children: mismatches.length
                                                ? `Расхождения: ${mismatches.length} поз. · недостача ${missingQuantity} шт.${excessQuantity ? ` · излишек ${excessQuantity} шт.` : ''}`
                                                : 'Без расхождений' }), _jsxs("span", { className: "inventory-review-box__meta", children: [box.countedByName ? box.countedByName : 'Проверка начата', ' · ', formatDate(box.completedAt ?? box.startedAt)] }), _jsx("span", { className: `inventory-status inventory-status--${box.status.toLowerCase()}`, children: boxStatusLabel(box.status) })] }), _jsx("div", { className: "inventory-review-box__details", children: box.lines.length > 0 ? _jsx("div", { className: "inventory-table-wrap", children: _jsxs("table", { className: "inventory-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "WMS" }), _jsx("th", { children: "\u0424\u0430\u043A\u0442" }), _jsx("th", { children: "\u0420\u0430\u0437\u043D\u0438\u0446\u0430" }), _jsx("th", { children: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 / \u0440\u0435\u0448\u0435\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: box.lines.map((line) => {
                                                        const difference = line.countedQuantity - line.expectedQuantity;
                                                        return (_jsxs("tr", { className: difference !== 0 ? 'inventory-table__mismatch' : undefined, children: [_jsxs("td", { children: [_jsx("strong", { children: line.skuName }), _jsxs("small", { children: ["\u0410\u0440\u0442\u0438\u043A\u0443\u043B: ", line.internalSku] }), _jsxs("small", { children: ["\u0428\u041A: ", line.barcode || '—'] })] }), _jsx("td", { children: line.expectedQuantity }), _jsx("td", { children: line.countedQuantity }), _jsx("td", { className: difference === 0 ? 'inventory-diff--ok' : 'inventory-diff--bad', children: difference > 0 ? `+${difference}` : difference }), _jsx("td", { children: _jsxs("div", { className: "inventory-decision-cell", children: [difference === 0 ? (_jsxs("span", { className: "inventory-decision-done", children: [_jsx(CheckCircle2, { size: 15 }), "\u0421\u043E\u0432\u043F\u0430\u043B\u043E"] })) : line.decision === 'PENDING' && dashboard.canManage && (review.status === 'REVIEW' ||
                                                                                (review.type === 'BOX_CHECK' && (review.status === 'ACTIVE' ||
                                                                                    review.status === 'COMPLETED'))) ? (_jsxs("div", { className: "inventory-decision", children: [_jsx("button", { className: "primary-button", type: "button", disabled: Boolean(busyLine), "aria-busy": busyLine === line.id && busyAction === 'APPLY_ACTUAL', title: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 WMS \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0441\u0447\u0451\u0442\u0430", onClick: () => void resolveLine(line.id, 'APPLY_ACTUAL'), children: busyLine === line.id && busyAction === 'APPLY_ACTUAL' ? 'Актуализирую…' : 'Актуализировать' }), _jsx("button", { className: "secondary-button inventory-delete-action", type: "button", disabled: Boolean(busyLine), "aria-busy": busyLine === line.id && busyAction === 'DELETE_FROM_BOX', title: "\u041E\u0431\u043D\u0443\u043B\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u044D\u0442\u043E\u0439 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u0432 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u043E\u043C \u043A\u043E\u0440\u043E\u0431\u0435", onClick: () => void resolveLine(line.id, 'DELETE_FROM_BOX'), children: busyLine === line.id && busyAction === 'DELETE_FROM_BOX' ? 'Удаляю…' : 'Удалить из короба' }), _jsx("button", { className: "secondary-button", type: "button", disabled: Boolean(busyLine), "aria-busy": busyLine === line.id && busyAction === 'ACCEPT_AS_IS', title: "\u041F\u0440\u0438\u0437\u043D\u0430\u0442\u044C \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u043C, \u043D\u043E \u043D\u0435 \u043C\u0435\u043D\u044F\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A WMS", onClick: () => void resolveLine(line.id, 'ACCEPT_AS_IS'), children: busyLine === line.id && busyAction === 'ACCEPT_AS_IS' ? 'Принимаю…' : 'Принять как есть' }), _jsx("button", { className: "secondary-button", type: "button", disabled: Boolean(busyLine), "aria-busy": busyLine === line.id && busyAction === 'LEAVE_FOR_LATER', title: "\u041D\u0435 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0442\u044C \u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u0438 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 \u043D\u0430 \u0440\u0430\u0437\u0431\u043E\u0440\u0435", onClick: () => void resolveLine(line.id, 'LEAVE_FOR_LATER'), children: busyLine === line.id && busyAction === 'LEAVE_FOR_LATER' ? 'Оставляю…' : 'Оставить на разбор' })] })) : line.decision === 'PENDING' ? (_jsxs("span", { className: "inventory-decision-pending", children: [_jsx(AlertTriangle, { size: 15 }), line.resolutionAction === 'LEAVE_FOR_LATER' ? 'Оставлено на разборе' : 'Ожидает решения'] })) : (_jsxs("span", { className: "inventory-decision-done", children: [_jsx(CheckCircle2, { size: 15 }), resolutionActionLabel(line.resolutionAction, line.decision), line.decidedByName ? ` · ${line.decidedByName}` : '', line.decidedAt ? ` · ${formatDate(line.decidedAt)}` : ''] })), lineFeedback[line.id] ? (_jsxs("span", { className: `inventory-action-feedback inventory-action-feedback--${lineFeedback[line.id].tone}`, role: lineFeedback[line.id].tone === 'error' ? 'alert' : 'status', "aria-live": "polite", children: [lineFeedback[line.id].tone === 'success' ? _jsx(CheckCircle2, { size: 15 }) : _jsx(AlertTriangle, { size: 15 }), lineFeedback[line.id].text] })) : null] }) })] }, line.id));
                                                    }) })] }) }) : (_jsx("p", { className: "inventory-box-empty", children: "\u0412 \u043A\u043E\u0440\u043E\u0431\u0435 \u043D\u0435 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0442\u043E\u0432\u0430\u0440\u043D\u044B\u0445 \u043F\u043E\u0437\u0438\u0446\u0438\u0439." })) })] }, box.id));
                    }), dashboard.canManage && review.status === 'REVIEW' ? _jsxs("div", { className: "inventory-session__actions", children: [_jsxs("button", { className: "primary-button", type: "button", disabled: (review.progress?.unresolvedLines ?? 0) > 0, onClick: async () => {
                                    try {
                                        await completeInventorySession(session.accessToken, review.id);
                                        await onChanged();
                                    }
                                    catch (caught) {
                                        setMessage(errorMessage(caught));
                                    }
                                }, children: [_jsx(UnlockKeyhole, { size: 16 }), "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044E"] }), _jsxs("span", { className: "muted", children: ["\u041D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u043F\u043E\u0437\u0438\u0446\u0438\u0439: ", review.progress?.unresolvedLines ?? 0] })] }) : null] }, review.id))), message ? _jsx("p", { className: "form-error", children: message }) : null] }));
}
function boxNeedsResolution(box) {
    return box.lines.some((line) => line.countedQuantity !== line.expectedQuantity &&
        line.decision === 'PENDING');
}
function statusLabel(status) {
    return { ACTIVE: 'Идёт подсчёт', REVIEW: 'Актуализация', COMPLETED: 'Завершена', CANCELLED: 'Отменена' }[status];
}
function boxStatusLabel(status) {
    return { COUNTING: 'Подсчёт', MATCHED: 'Всё совпало', MISMATCH: 'Есть расхождения', RESOLVED: 'Разобран' }[status];
}
function resolutionActionLabel(action, decision) {
    if (action === 'DELETE_FROM_BOX')
        return 'Удалено из короба';
    if (action === 'APPLY_ACTUAL')
        return 'Остаток актуализирован';
    if (action === 'ACCEPT_AS_IS')
        return 'Принято без изменения WMS';
    return decision === 'APPLY_ACTUAL' ? 'Остаток актуализирован' : 'Оставлен остаток WMS';
}
function resolutionSuccessMessage(action) {
    if (action === 'DELETE_FROM_BOX')
        return 'Позиция удалена из остатков этого короба.';
    if (action === 'ACCEPT_AS_IS')
        return 'Расхождение принято, остаток WMS оставлен без изменений.';
    if (action === 'LEAVE_FOR_LATER')
        return 'Позиция оставлена на разборе, остаток не изменён.';
    return 'Остаток в коробе актуализирован по факту.';
}
function formatDate(value) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
