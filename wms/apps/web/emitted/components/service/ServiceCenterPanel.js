import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Bell, Database, Download, Eraser, Lock, RefreshCw, Search, ShieldAlert, Smartphone, Trash2, Users, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { closeServiceSession, fetchClients, fetchServiceClientRequestsCleanupPreview, fetchServiceClientStockCleanupPreview, fetchServiceMaintenance, fetchServiceSessions, fetchServiceTelegramGroups, fetchServiceTelegramSettings, purgeServiceClientRequests, purgeServiceClientStock, searchServiceKiz, testServiceTelegramClient, testServiceTelegramFulfillment, updateServiceMaintenance, updateServiceTelegramClient, updateServiceTelegramGlobal, } from '../../lib/api';
import './service-center.css';
import { useRememberedClientId } from '../../lib/rememberedClient';
const emptySummary = {
    balanceRows: 0,
    quantity: 0,
    uniqueSkusInStock: 0,
    movements: 0,
    boxes: 0,
    pallets: 0,
    productMarks: 0,
};
const telegramSectionOptions = [
    { id: 'REQUESTS', label: 'Заявки' },
    { id: 'FBS', label: 'FBS и сборка' },
    { id: 'WAREHOUSE', label: 'Склад и приёмка' },
    { id: 'LOGISTICS', label: 'Логистика' },
    { id: 'BILLING', label: 'Биллинг' },
    { id: 'KIZ', label: 'КИЗ' },
    { id: 'SYSTEM', label: 'Системные' },
];
const tabs = [
    { id: 'mode', label: 'Режим', icon: Lock },
    { id: 'sessions', label: 'Сессии', icon: Users },
    { id: 'telegram', label: 'Telegram', icon: Bell },
    { id: 'kiz', label: 'КИЗ', icon: Search },
    { id: 'stock', label: 'Остатки', icon: Database },
    { id: 'requests', label: 'Заявки', icon: Trash2 },
];
export function ServiceCenterPanel({ session }) {
    const [activeTab, setActiveTab] = useState('mode');
    const [clients, setClients] = useState({ status: 'idle', data: [] });
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [stockPreview, setStockPreview] = useState({
        status: 'idle',
        data: null,
    });
    const [requestsPreview, setRequestsPreview] = useState({
        status: 'idle',
        data: null,
    });
    const [maintenance, setMaintenance] = useState({ status: 'idle', data: null });
    const [sessions, setSessions] = useState({ status: 'idle', data: [] });
    const [closingSessionId, setClosingSessionId] = useState('');
    const [telegram, setTelegram] = useState({ status: 'idle', data: null });
    const [telegramGroups, setTelegramGroups] = useState({ status: 'idle', data: [] });
    const [kizRows, setKizRows] = useState({ status: 'idle', data: [] });
    const [stockConfirmation, setStockConfirmation] = useState('');
    const [requestsConfirmation, setRequestsConfirmation] = useState('');
    const [kizSearch, setKizSearch] = useState('');
    const [message, setMessage] = useState(null);
    const [isBusy, setBusy] = useState(false);
    const selectedClient = useMemo(() => clients.data.find((client) => client.id === selectedClientId) ?? null, [clients.data, selectedClientId]);
    const currentSummary = stockPreview.data?.summary ?? emptySummary;
    useEffect(() => {
        void loadBase();
    }, []);
    useEffect(() => {
        if (!selectedClientId) {
            return;
        }
        void loadClientDependent(selectedClientId);
    }, [selectedClientId]);
    async function loadBase() {
        await Promise.all([loadClients(), loadMaintenance(), loadSessions(), loadTelegramGroups()]);
    }
    async function loadClients() {
        setClients((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const loaded = await fetchClients(session.accessToken);
            setClients({ status: 'ready', data: loaded });
            const clientId = selectedClientId || loaded[0]?.id || '';
            if (clientId) {
                setSelectedClientId(clientId);
                await loadClientDependent(clientId);
            }
        }
        catch (caught) {
            setClients({ status: 'error', data: [], error: errorMessage(caught) });
        }
    }
    async function loadClientDependent(clientId) {
        await Promise.all([loadStockPreview(clientId), loadRequestsPreview(clientId), loadTelegram(clientId)]);
    }
    async function loadStockPreview(clientId = selectedClientId) {
        if (!clientId) {
            return;
        }
        setStockPreview((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setStockPreview({ status: 'ready', data: await fetchServiceClientStockCleanupPreview(session.accessToken, clientId) });
            setStockConfirmation('');
        }
        catch (caught) {
            setStockPreview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
        }
    }
    async function loadRequestsPreview(clientId = selectedClientId) {
        if (!clientId) {
            return;
        }
        setRequestsPreview((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setRequestsPreview({
                status: 'ready',
                data: await fetchServiceClientRequestsCleanupPreview(session.accessToken, clientId),
            });
            setRequestsConfirmation('');
        }
        catch (caught) {
            setRequestsPreview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
        }
    }
    async function loadMaintenance() {
        setMaintenance((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setMaintenance({ status: 'ready', data: await fetchServiceMaintenance(session.accessToken) });
        }
        catch (caught) {
            setMaintenance({ status: 'error', data: null, error: errorMessage(caught) });
        }
    }
    async function loadSessions() {
        setSessions((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setSessions({ status: 'ready', data: await fetchServiceSessions(session.accessToken) });
        }
        catch (caught) {
            setSessions({ status: 'error', data: [], error: errorMessage(caught) });
        }
    }
    async function closeSession(item) {
        if (!window.confirm(`Закрыть сессию пользователя ${item.name}? Пользователю потребуется войти повторно.`)) {
            return;
        }
        setClosingSessionId(item.id);
        setMessage(null);
        try {
            await closeServiceSession(session.accessToken, item.id);
            await loadSessions();
            setMessage(`Сессия пользователя ${item.name} закрыта.`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setClosingSessionId('');
        }
    }
    async function loadTelegram(clientId = selectedClientId) {
        setTelegram((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setTelegram({ status: 'ready', data: await fetchServiceTelegramSettings(session.accessToken, clientId || undefined) });
        }
        catch (caught) {
            setTelegram({ status: 'error', data: null, error: errorMessage(caught) });
        }
    }
    async function loadTelegramGroups() {
        setTelegramGroups((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const result = await fetchServiceTelegramGroups(session.accessToken);
            setTelegramGroups({ status: 'ready', data: result.groups, error: result.warning });
        }
        catch (caught) {
            setTelegramGroups({ status: 'error', data: [], error: errorMessage(caught) });
        }
    }
    async function toggleMaintenance(enabled) {
        setBusy(true);
        setMessage(null);
        try {
            const updated = await updateServiceMaintenance(session.accessToken, {
                enabled,
                message: maintenance.data?.message || 'Вход временно закрыт: идут сервисные работы.',
            });
            setMaintenance({ status: 'ready', data: updated });
            setMessage(enabled ? 'Сервисный режим включен.' : 'Сервисный режим выключен.');
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function saveTelegramGlobal() {
        if (!telegram.data) {
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const updated = await updateServiceTelegramGlobal(session.accessToken, telegram.data.global);
            setTelegram((current) => (current.data ? { status: 'ready', data: { ...current.data, global: updated } } : current));
            await loadTelegramGroups();
            setMessage('Настройки Telegram сохранены.');
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function saveTelegramClient() {
        if (!telegram.data?.client || !selectedClientId) {
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const updated = await updateServiceTelegramClient(session.accessToken, selectedClientId, telegram.data.client);
            setTelegram((current) => (current.data ? { status: 'ready', data: { ...current.data, client: updated } } : current));
            setMessage('Telegram клиента сохранен.');
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function runKizSearch() {
        setKizRows((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            setKizRows({
                status: 'ready',
                data: await searchServiceKiz(session.accessToken, { clientId: selectedClientId || undefined, search: kizSearch }),
            });
        }
        catch (caught) {
            setKizRows({ status: 'error', data: [], error: errorMessage(caught) });
        }
    }
    async function purgeStock() {
        if (!selectedClientId || stockConfirmation !== stockPreview.data?.confirmationText) {
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const result = await purgeServiceClientStock(session.accessToken, selectedClientId, stockConfirmation);
            setStockPreview({
                status: 'ready',
                data: {
                    client: result.client,
                    summary: result.after,
                    confirmationText: stockPreview.data.confirmationText,
                    warning: stockPreview.data.warning,
                },
            });
            setStockConfirmation('');
            setMessage(formatStockPurgeResult(result));
            await loadRequestsPreview(selectedClientId);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function purgeRequests() {
        if (!selectedClientId || requestsConfirmation !== requestsPreview.data?.confirmationText) {
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const result = await purgeServiceClientRequests(session.accessToken, selectedClientId, requestsConfirmation);
            setRequestsConfirmation('');
            setMessage(`Удалено заявок: ${result.deleted.requests}. Отвязано начислений: ${result.deleted.detachedBillingCharges}.`);
            await loadRequestsPreview(selectedClientId);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("section", { className: "service-panel", "aria-label": "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u043E\u0435 \u043C\u0435\u043D\u044E", children: [_jsxs("div", { className: "panel-heading service-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u043E\u0435 \u043C\u0435\u043D\u044E" }), _jsx("h2", { children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u043C\u0438 \u0434\u0430\u043D\u043D\u044B\u043C\u0438" })] }), _jsx(ShieldAlert, { size: 22, "aria-hidden": "true" })] }), _jsxs("div", { className: "service-mobile-app", children: [_jsx("span", { className: "service-mobile-app__icon", children: _jsx(Smartphone, { size: 22, "aria-hidden": "true" }) }), _jsxs("span", { children: [_jsx("strong", { children: "LOGOff WMS Mobile" }), _jsx("small", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 \u0438 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u0438\u0432\u043D\u044B\u0439 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442 \u0434\u043B\u044F Android" })] }), _jsxs("a", { className: "secondary-button", href: "/downloads/logoff-wms-mobile.apk", download: true, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C APK"] })] }), _jsx("div", { className: "service-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u043D\u043E\u0433\u043E \u043C\u0435\u043D\u044E", children: tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (_jsxs("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), role: "tab", type: "button", children: [_jsx(Icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id));
                }) }), _jsx(ClientSelector, { clients: clients, selectedClientId: selectedClientId, onChange: setSelectedClientId, onRefresh: () => void loadClients() }), message ? _jsx("div", { className: "service-message", children: message }) : null, activeTab === 'mode' ? (_jsx(Section, { title: "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C", icon: _jsx(Lock, { size: 18 }), children: _jsxs("div", { className: "service-two-columns", children: [_jsxs("div", { className: "service-card", children: [_jsx("strong", { children: maintenance.data?.enabled ? 'Вход пользователей заблокирован' : 'Вход открыт' }), _jsx("span", { children: maintenance.data?.message || 'Администраторы и владелец смогут войти даже во время обслуживания.' }), _jsx("button", { className: maintenance.data?.enabled ? 'secondary-button' : 'danger-button', type: "button", disabled: isBusy || maintenance.status === 'loading', onClick: () => void toggleMaintenance(!maintenance.data?.enabled), children: maintenance.data?.enabled ? 'Снять блокировку' : 'Заблокировать вход' })] }), _jsxs("div", { className: "service-card", children: [_jsx("strong", { children: "\u0427\u0442\u043E \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442\u0441\u044F" }), _jsx("span", { children: "\u041D\u043E\u0432\u044B\u0435 \u0432\u0445\u043E\u0434\u044B \u043E\u0431\u044B\u0447\u043D\u044B\u0445 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439. \u0423\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u0442\u043E\u043A\u0435\u043D\u044B \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438." }), _jsxs("small", { children: ["\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435: ", maintenance.data?.updatedAt ? formatDateTime(maintenance.data.updatedAt) : '-'] })] })] }) })) : null, activeTab === 'sessions' ? (_jsxs(Section, { title: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0432\u0445\u043E\u0434\u044B", icon: _jsx(Users, { size: 18 }), children: [_jsxs("button", { className: "secondary-button service-inline-action", type: "button", onClick: () => void loadSessions(), children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] }), _jsx(TableWrap, { children: _jsxs("table", { className: "data-table service-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "IP" }), _jsx("th", { children: "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 / \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435" }), _jsx("th", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u0430" }), _jsx("th", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", {})] }) }), _jsx("tbody", { children: sessions.data.map((item) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: item.email })] }), _jsx("td", { children: item.client }), _jsx("td", { children: item.ip || '-' }), _jsxs("td", { className: "service-muted-cell", children: [_jsx("strong", { children: item.browserName || item.appName }), _jsx("span", { children: item.userAgent || '-' })] }), _jsx("td", { children: formatDateTime(item.openedAt) }), _jsx("td", { children: formatDateTime(item.lastSeenAt) }), _jsx("td", { children: _jsx("span", { className: `service-session-status ${item.isActive ? 'is-active' : 'is-closed'}`, children: item.isActive ? 'Активна' : 'Закрыта' }) }), _jsx("td", { children: item.isActive ? (_jsx("button", { className: "danger-button service-session-close", type: "button", disabled: Boolean(closingSessionId), onClick: () => void closeSession(item), children: closingSessionId === item.id ? 'Закрываю…' : 'Закрыть' })) : null })] }, item.id))) })] }) })] })) : null, activeTab === 'telegram' ? (_jsx(Section, { title: "Telegram-\u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F", icon: _jsx(Bell, { size: 18 }), children: telegram.data ? (_jsxs("div", { className: "service-two-columns", children: [_jsxs("div", { className: "service-card service-form-card", children: [_jsx("strong", { children: "\u0424\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442" }), _jsxs("label", { className: "service-check", children: [_jsx("input", { type: "checkbox", checked: telegram.data.global.enabled, onChange: (event) => setTelegram({ status: 'ready', data: { ...telegram.data, global: { ...telegram.data.global, enabled: event.target.checked } } }) }), _jsx("span", { children: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443 \u0432 Telegram" })] }), _jsxs("label", { children: [_jsx("span", { children: "Bot token" }), _jsx("input", { value: telegram.data.global.botToken, onChange: (event) => setTelegram({ status: 'ready', data: { ...telegram.data, global: { ...telegram.data.global, botToken: event.target.value } } }), placeholder: "123456:ABC..." })] }), _jsxs("label", { children: [_jsx("span", { children: "Chat ID \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0430, \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u0432 \u0441\u0442\u0440\u043E\u043A\u0435" }), _jsx("textarea", { value: telegram.data.global.fulfillmentChatIds.join('\n'), onChange: (event) => setTelegram({
                                                status: 'ready',
                                                data: {
                                                    ...telegram.data,
                                                    global: { ...telegram.data.global, fulfillmentChatIds: event.target.value.split('\n') },
                                                },
                                            }) })] }), _jsx(TelegramSectionPicker, { value: telegram.data.global.sections, onChange: (sections) => setTelegram({
                                        status: 'ready',
                                        data: { ...telegram.data, global: { ...telegram.data.global, sections } },
                                    }) }), _jsxs("div", { className: "service-actions", children: [_jsx("button", { className: "primary-button", type: "button", onClick: () => void saveTelegramGlobal(), disabled: isBusy, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), _jsx("button", { className: "secondary-button", type: "button", onClick: async () => setMessage(JSON.stringify(await testServiceTelegramFulfillment(session.accessToken))), children: "\u0422\u0435\u0441\u0442" })] })] }), _jsxs("div", { className: "service-card service-form-card", children: [_jsx("strong", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("p", { className: "service-help", children: "\u041A\u0430\u043A \u0443\u0437\u043D\u0430\u0442\u044C chat_id: \u043A\u043B\u0438\u0435\u043D\u0442 \u043F\u0438\u0448\u0435\u0442 \u043B\u044E\u0431\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0431\u043E\u0442\u0443, \u0437\u0430\u0442\u0435\u043C \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 https://api.telegram.org/botTOKEN/getUpdates \u0438 \u043A\u043E\u043F\u0438\u0440\u0443\u0435\u0442 \u043F\u043E\u043B\u0435 chat.id." }), _jsxs("label", { className: "service-check", children: [_jsx("input", { type: "checkbox", checked: telegram.data.client?.enabled ?? false, onChange: (event) => setTelegram({
                                                status: 'ready',
                                                data: {
                                                    ...telegram.data,
                                                    client: {
                                                        clientId: selectedClientId,
                                                        chatId: telegram.data.client?.chatId ?? '',
                                                        enabled: event.target.checked,
                                                        sections: telegram.data.client?.sections ?? telegramSectionOptions.map((item) => item.id),
                                                    },
                                                },
                                            }) }), _jsx("span", { children: "\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0443" })] }), _jsxs("label", { children: [_jsx("span", { children: "Chat ID \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("input", { list: "telegram-client-groups", value: telegram.data.client?.chatId ?? '', onChange: (event) => setTelegram({
                                                status: 'ready',
                                                data: {
                                                    ...telegram.data,
                                                    client: {
                                                        clientId: selectedClientId,
                                                        enabled: telegram.data.client?.enabled ?? false,
                                                        chatId: event.target.value,
                                                        sections: telegram.data.client?.sections ?? telegramSectionOptions.map((item) => item.id),
                                                    },
                                                },
                                            }), placeholder: "\u0413\u0440\u0443\u043F\u043F\u0430: -1001234567890" })] }), _jsx("datalist", { id: "telegram-client-groups", children: telegramGroups.data.map((group) => (_jsx("option", { value: group.id, children: group.title }, group.id))) }), _jsxs("div", { className: "service-telegram-groups", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0413\u0440\u0443\u043F\u043F\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0432\u0438\u0434\u0438\u0442 \u0431\u043E\u0442" }), _jsx("small", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u0440\u0443\u043F\u043F\u0443 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u2014 \u0435\u0451 ID \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E\u043F\u0430\u0434\u0451\u0442 \u0432 \u043F\u043E\u043B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void loadTelegramGroups(), disabled: telegramGroups.status === 'loading', children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), telegramGroups.status === 'loading' ? 'Ищу группы…' : 'Обновить группы'] }), _jsx("div", { className: "service-telegram-group-list", children: telegramGroups.data.map((group) => (_jsxs("button", { className: telegram.data?.client?.chatId === group.id ? 'is-active' : '', type: "button", onClick: () => setTelegram({
                                                    status: 'ready',
                                                    data: {
                                                        ...telegram.data,
                                                        client: {
                                                            clientId: selectedClientId,
                                                            enabled: telegram.data.client?.enabled ?? true,
                                                            chatId: group.id,
                                                            sections: telegram.data.client?.sections ?? telegramSectionOptions.map((item) => item.id),
                                                        },
                                                    },
                                                }), children: [_jsx("span", { children: group.title }), _jsx("small", { children: group.id })] }, group.id))) }), telegramGroups.error ? _jsx("p", { className: "service-help", children: telegramGroups.error }) : null] }), _jsx(TelegramSectionPicker, { value: telegram.data.client?.sections ?? telegramSectionOptions.map((item) => item.id), onChange: (sections) => setTelegram({
                                        status: 'ready',
                                        data: {
                                            ...telegram.data,
                                            client: {
                                                clientId: selectedClientId,
                                                enabled: telegram.data.client?.enabled ?? false,
                                                chatId: telegram.data.client?.chatId ?? '',
                                                sections,
                                            },
                                        },
                                    }) }), _jsxs("div", { className: "service-actions", children: [_jsx("button", { className: "primary-button", type: "button", onClick: () => void saveTelegramClient(), disabled: isBusy || !selectedClientId, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), _jsx("button", { className: "secondary-button", type: "button", disabled: !selectedClientId, onClick: async () => setMessage(JSON.stringify(await testServiceTelegramClient(session.accessToken, selectedClientId))), children: "\u0422\u0435\u0441\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0443" })] })] })] })) : (_jsx("p", { className: "panel-message", children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 Telegram \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u0442\u0441\u044F." })) })) : null, activeTab === 'kiz' ? (_jsxs(Section, { title: "\u041F\u043E\u0438\u0441\u043A \u041A\u0418\u0417", icon: _jsx(Search, { size: 18 }), children: [_jsxs("div", { className: "service-search-row", children: [_jsx("input", { value: kizSearch, onChange: (event) => setKizSearch(event.target.value), placeholder: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u043E\u043C\u0435\u0440 \u0438\u043B\u0438 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442" }), _jsx("button", { className: "primary-button", type: "button", onClick: () => void runKizSearch(), disabled: kizSearch.trim().length < 3, children: "\u041D\u0430\u0439\u0442\u0438" })] }), kizRows.status === 'error' ? _jsx("div", { className: "service-message service-message--error", children: kizRows.error }) : null, _jsx(TableWrap, { children: _jsxs("table", { className: "data-table service-table service-table--wide", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041F\u0440\u0438\u043D\u044F\u0442 / \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: kizRows.data.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.value }), _jsx("span", { children: row.sourceDocument ?? '-' })] }), _jsxs("td", { children: [_jsx("strong", { children: row.sku.name }), _jsx("span", { children: row.sku.barcodes.map((barcode) => barcode.value).join(', ') || row.sku.internalSku })] }), _jsx("td", { children: row.client.name }), _jsx("td", { children: row.box?.code ?? 'Без короба' }), _jsx("td", { children: row.status }), _jsxs("td", { children: [_jsx("span", { children: formatDateTime(row.createdAt) }), _jsx("span", { children: row.stockMovement?.comment ?? row.stockMovement?.sourceDocument ?? '-' })] })] }, row.id))) })] }) })] })) : null, activeTab === 'stock' ? (_jsxs(Section, { title: "\u041E\u0447\u0438\u0441\u0442\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", icon: _jsx(Eraser, { size: 18 }), children: [_jsx(MetricGrid, { summary: currentSummary }), _jsx(DangerZone, { warning: stockPreview.data?.warning ?? 'Выберите клиента, чтобы увидеть данные для очистки.', confirmation: stockConfirmation, confirmationText: stockPreview.data?.confirmationText ?? 'ОЧИСТИТЬ', onConfirmation: setStockConfirmation, actionLabel: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", disabled: isBusy || stockConfirmation !== stockPreview.data?.confirmationText, onAction: () => void purgeStock() })] })) : null, activeTab === 'requests' ? (_jsxs(Section, { title: "\u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043E\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0430", icon: _jsx(Trash2, { size: 18 }), children: [_jsxs("div", { className: "service-two-columns", children: [_jsxs("div", { className: "service-card", children: [_jsx("strong", { children: requestsPreview.data?.total ?? 0 }), _jsx("span", { children: "\u0412\u0441\u0435\u0433\u043E \u0437\u0430\u044F\u0432\u043E\u043A \u0443 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }), _jsxs("div", { className: "service-card", children: [_jsx("strong", { children: requestsPreview.data?.statuses.map((item) => `${item.status}: ${item.count}`).join(', ') || '-' }), _jsx("span", { children: "\u0420\u0430\u0437\u0431\u0438\u0432\u043A\u0430 \u043F\u043E \u0441\u0442\u0430\u0442\u0443\u0441\u0430\u043C" })] })] }), _jsx(DangerZone, { warning: requestsPreview.data?.warning ?? 'Выберите клиента, чтобы увидеть заявки.', confirmation: requestsConfirmation, confirmationText: requestsPreview.data?.confirmationText ?? 'УДАЛИТЬ ЗАЯВКИ', onConfirmation: setRequestsConfirmation, actionLabel: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", disabled: isBusy || requestsConfirmation !== requestsPreview.data?.confirmationText, onAction: () => void purgeRequests() })] })) : null] }));
}
function TelegramSectionPicker({ value, onChange, }) {
    return (_jsxs("fieldset", { className: "service-telegram-sections", children: [_jsx("legend", { children: "\u0418\u0437 \u043A\u0430\u043A\u0438\u0445 \u0440\u0430\u0437\u0434\u0435\u043B\u043E\u0432 \u043F\u0440\u0438\u0441\u044B\u043B\u0430\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }), _jsx("div", { className: "service-telegram-sections__grid", children: telegramSectionOptions.map((item) => (_jsxs("label", { className: "service-check", children: [_jsx("input", { type: "checkbox", checked: value.includes(item.id), onChange: (event) => onChange(event.target.checked
                                ? [...value, item.id]
                                : value.filter((section) => section !== item.id)) }), _jsx("span", { children: item.label })] }, item.id))) })] }));
}
function ClientSelector({ clients, selectedClientId, onChange, onRefresh, }) {
    return (_jsxs("div", { className: "service-client-selector", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 \u0434\u043B\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439" }), _jsx("select", { value: selectedClientId, onChange: (event) => onChange(event.target.value), children: clients.data.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id))) })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: onRefresh, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432"] })] }));
}
function Section({ title, icon, children }) {
    return (_jsxs("section", { className: "service-section", children: [_jsxs("div", { className: "service-section__heading", children: [icon, _jsx("h3", { children: title })] }), children] }));
}
function MetricGrid({ summary }) {
    return (_jsxs("div", { className: "service-metrics", children: [_jsx(Metric, { icon: _jsx(Database, { size: 17 }), label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: summary.quantity }), _jsx(Metric, { icon: _jsx(Database, { size: 17 }), label: "SKU", value: summary.uniqueSkusInStock }), _jsx(Metric, { icon: _jsx(Eraser, { size: 17 }), label: "\u0421\u0442\u0440\u043E\u043A \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432", value: summary.balanceRows }), _jsx(Metric, { icon: _jsx(Eraser, { size: 17 }), label: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0439", value: summary.movements }), _jsx(Metric, { icon: _jsx(Eraser, { size: 17 }), label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432", value: summary.boxes }), _jsx(Metric, { icon: _jsx(Eraser, { size: 17 }), label: "\u041F\u0430\u043B\u043B\u0435\u0442", value: summary.pallets }), _jsx(Metric, { icon: _jsx(Eraser, { size: 17 }), label: "\u041A\u0418\u0417", value: summary.productMarks })] }));
}
function Metric({ icon, label, value }) {
    return (_jsxs("article", { className: "service-metric", children: [icon, _jsx("span", { children: label }), _jsx("strong", { children: new Intl.NumberFormat('ru-RU').format(value) })] }));
}
function DangerZone({ warning, confirmation, confirmationText, onConfirmation, actionLabel, disabled, onAction, }) {
    return (_jsxs("div", { className: "service-danger-box", children: [_jsxs("div", { className: "service-warning", children: [_jsx(AlertTriangle, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: warning })] }), _jsxs("div", { className: "service-danger-zone", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435" }), _jsx("input", { value: confirmation, onChange: (event) => onConfirmation(event.target.value), placeholder: `Введите ${confirmationText}` })] }), _jsxs("button", { className: "danger-button", type: "button", onClick: onAction, disabled: disabled, children: [_jsx(Trash2, { size: 16, "aria-hidden": "true" }), actionLabel] })] })] }));
}
function TableWrap({ children }) {
    return _jsx("div", { className: "service-table-wrap", children: children });
}
function formatStockPurgeResult(result) {
    return `Остатки очищены: строк ${result.deleted.balances}, движений ${result.deleted.movements}, коробов ${result.deleted.boxes}, паллет ${result.deleted.pallets}, КИЗ ${result.deleted.productMarks}.`;
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
