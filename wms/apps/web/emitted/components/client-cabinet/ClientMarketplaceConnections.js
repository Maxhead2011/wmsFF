import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, CircleAlert, KeyRound, PlugZap, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { checkMarketplaceConnection, createMarketplaceConnection, deleteMarketplaceConnection, fetchMarketplaceConnections, syncMarketplaceProducts, updateMarketplaceConnection, } from '../../lib/api';
const marketplaceOptions = [
    { value: 'WILDBERRIES', label: 'Wildberries' },
    { value: 'OZON', label: 'Ozon' },
    { value: 'YANDEX_MARKET', label: 'Яндекс Маркет' },
    { value: 'SBER_MARKET', label: 'СберМегаМаркет' },
    { value: 'OTHER', label: 'Другое' },
];
const emptyForm = {
    id: '',
    marketplace: 'WILDBERRIES',
    accountName: '',
    sellerId: '',
    apiKey: '',
    isActive: true,
    comment: '',
};
export function ClientMarketplaceConnections({ accessToken, client }) {
    const [connections, setConnections] = useState([]);
    const [checksById, setChecksById] = useState({});
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [isEditorOpen, setEditorOpen] = useState(false);
    const [checkingIds, setCheckingIds] = useState([]);
    const [syncingIds, setSyncingIds] = useState([]);
    const selectedConnection = useMemo(() => connections.find((connection) => connection.id === form.id) ?? null, [connections, form.id]);
    useEffect(() => {
        setForm(emptyForm);
        setChecksById({});
        setMessage('');
        setError('');
        setEditorOpen(false);
        void loadConnections();
    }, [client.id]);
    async function loadConnections() {
        setLoading(true);
        setError('');
        try {
            const loaded = await fetchMarketplaceConnections(accessToken, { clientId: client.id });
            setConnections(loaded);
            if (loaded.length === 0) {
                setForm(emptyForm);
            }
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить подключения маркетплейсов.');
        }
        finally {
            setLoading(false);
        }
    }
    function openNewConnection() {
        setForm(emptyForm);
        setMessage('');
        setError('');
        setEditorOpen(true);
    }
    function editConnection(connection) {
        setForm({
            id: connection.id,
            marketplace: connection.marketplace,
            accountName: connection.accountName ?? '',
            sellerId: connection.sellerId ?? '',
            apiKey: '',
            isActive: connection.isActive,
            comment: connection.comment ?? '',
        });
        setMessage('Для замены ключа вставьте новый API-ключ. Пустое поле сохранит действующий ключ.');
        setError('');
        setEditorOpen(true);
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            const payload = {
                clientId: client.id,
                marketplace: form.marketplace,
                accountName: form.accountName.trim(),
                sellerId: form.sellerId.trim(),
                apiKey: form.apiKey.trim(),
                isActive: form.isActive,
                comment: form.comment.trim(),
            };
            let saved;
            if (form.id) {
                const { apiKey, ...withoutApiKey } = payload;
                saved = await updateMarketplaceConnection(accessToken, form.id, apiKey ? payload : withoutApiKey);
                setConnections((current) => current.map((connection) => (connection.id === saved.id ? saved : connection)));
            }
            else {
                saved = await createMarketplaceConnection(accessToken, payload);
                setConnections((current) => [saved, ...current]);
            }
            setForm(emptyForm);
            setEditorOpen(false);
            await verifyConnection(saved.id, true);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить подключение.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function verifyConnection(connectionId, syncCardsAfterCheck = false) {
        setCheckingIds((current) => (current.includes(connectionId) ? current : [...current, connectionId]));
        setError('');
        setMessage('');
        try {
            const result = await checkMarketplaceConnection(accessToken, connectionId);
            setChecksById((current) => ({ ...current, [connectionId]: result }));
            const failed = result.checks.filter((check) => !check.ok);
            const productsAvailable = result.checks.find((check) => check.key === 'products')?.ok === true;
            if (syncCardsAfterCheck && productsAvailable) {
                const syncResult = await synchronizeProducts(connectionId);
                if (syncResult) {
                    setMessage([
                        result.ok ? 'API подключён и полностью проверен.' : 'API сохранён, часть разрешений требует внимания.',
                        `Карточки загружены: ${syncResult.productsReceived}.`,
                        `Создано: ${syncResult.created}, обновлено: ${syncResult.updated}.`,
                        syncResult.mergedDrafts ? `Объединено товаров без карточки: ${syncResult.mergedDrafts}.` : '',
                        syncResult.skipped ? `Пропущено: ${syncResult.skipped}.` : '',
                    ]
                        .filter(Boolean)
                        .join(' '));
                }
            }
            else {
                setMessage(result.ok
                    ? 'API работает: доступны FBS-заказы, карточки товаров и склады.'
                    : syncCardsAfterCheck
                        ? 'API-ключ сохранён. Проверьте разрешения ниже; карточки не загружались из-за отсутствия доступа.'
                        : 'Проверка API завершена. Часть разрешений требует внимания.');
            }
            if (failed.length > 0) {
                setError(failed.map((check) => `${check.label}: ${check.message}`).join(' '));
            }
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить API-подключение.');
        }
        finally {
            setCheckingIds((current) => current.filter((id) => id !== connectionId));
        }
    }
    async function synchronizeProducts(connectionId) {
        setSyncingIds((current) => (current.includes(connectionId) ? current : [...current, connectionId]));
        try {
            return await syncMarketplaceProducts(accessToken, connectionId);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось синхронизировать товары.');
            return null;
        }
        finally {
            setSyncingIds((current) => current.filter((id) => id !== connectionId));
        }
    }
    async function runProductSync(connectionId) {
        setError('');
        setMessage('');
        const result = await synchronizeProducts(connectionId);
        if (!result) {
            return;
        }
        setMessage([
            'Товары синхронизированы.',
            `Получено: ${result.productsReceived}. Создано: ${result.created}. Обновлено: ${result.updated}.`,
            result.mergedDrafts ? `Объединено товаров без карточки: ${result.mergedDrafts}.` : '',
            result.skipped ? `Пропущено: ${result.skipped}.` : '',
        ]
            .filter(Boolean)
            .join(' '));
    }
    async function removeConnection(connection) {
        const confirmed = window.confirm(`Удалить подключение ${marketplaceLabel(connection.marketplace)} для клиента ${client.name}?`);
        if (!confirmed) {
            return;
        }
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            const deleted = await deleteMarketplaceConnection(accessToken, connection.id);
            setConnections((current) => current.filter((item) => item.id !== deleted.id));
            setChecksById((current) => {
                const next = { ...current };
                delete next[deleted.id];
                return next;
            });
            if (form.id === deleted.id) {
                setForm(emptyForm);
                setEditorOpen(false);
            }
            setMessage('Подключение удалено.');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось удалить подключение.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("section", { className: "client-marketplace-panel", "aria-label": "API \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u043E\u0432", children: [_jsxs("div", { className: "client-marketplace-panel__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "API \u0434\u043B\u044F FBS \u0438 \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u0442\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("span", { children: "\u041A\u043B\u044E\u0447 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432\u0441\u0435\u043C\u0438 \u043C\u043E\u0434\u0443\u043B\u044F\u043C\u0438 WMS" })] }), _jsxs("div", { className: "client-marketplace-panel__heading-actions", children: [_jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void loadConnections(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить' })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: openNewConnection, children: [_jsx(KeyRound, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C API" })] })] })] }), connections.length === 0 && !isLoading ? (_jsxs("button", { className: "client-marketplace-empty", type: "button", onClick: openNewConnection, children: [_jsx(KeyRound, { size: 24, "aria-hidden": "true" }), _jsx("strong", { children: "API-\u043A\u043B\u044E\u0447 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043A\u043B\u044E\u0447 \u2014 WMS \u0441\u0440\u0430\u0437\u0443 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442 FBS, \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0438 \u0441\u043A\u043B\u0430\u0434\u044B, \u0437\u0430\u0442\u0435\u043C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442 \u0442\u043E\u0432\u0430\u0440\u044B." })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, connections.length > 0 ? (_jsx("div", { className: "client-marketplace-table-wrap", children: _jsxs("table", { className: "client-marketplace-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("th", { children: "\u041A\u0430\u0431\u0438\u043D\u0435\u0442" }), _jsx("th", { children: "ID" }), _jsx("th", { children: "API-\u043A\u043B\u044E\u0447" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsx("tbody", { children: connections.map((connection) => {
                                const check = checksById[connection.id];
                                const isChecking = checkingIds.includes(connection.id);
                                const isSyncing = syncingIds.includes(connection.id);
                                return (_jsxs("tr", { children: [_jsx("td", { children: marketplaceLabel(connection.marketplace) }), _jsx("td", { children: connection.accountName || 'не задан' }), _jsx("td", { children: connection.sellerId || 'не требуется' }), _jsx("td", { children: _jsx("span", { className: "client-marketplace-key", children: connection.apiKeyMask }) }), _jsx("td", { children: !connection.isActive ? (_jsx("span", { className: "client-marketplace-access is-off", children: "\u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E" })) : isChecking ? (_jsx("span", { className: "client-marketplace-access is-loading", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E API\u2026" })) : check ? (_jsx("div", { className: "client-marketplace-checks", children: check.checks.map((item) => (_jsxs("span", { className: `client-marketplace-access ${item.ok ? 'is-ok' : 'is-error'}`, title: item.message, children: [item.ok ? (_jsx(CheckCircle2, { size: 13, "aria-hidden": "true" })) : (_jsx(CircleAlert, { size: 13, "aria-hidden": "true" })), item.label] }, item.key))) })) : (_jsx("span", { className: "client-marketplace-access is-unknown", children: "\u0415\u0449\u0451 \u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E" })) }), _jsx("td", { children: _jsxs("div", { className: "client-marketplace-row-actions", children: [_jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void verifyConnection(connection.id), disabled: isChecking || !connection.isActive, children: [_jsx(PlugZap, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: isChecking ? 'Проверка' : 'Проверить API' })] }), _jsx("button", { className: "icon-text-button", type: "button", onClick: () => editConnection(connection), children: "\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u043B\u044E\u0447" }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void runProductSync(connection.id), disabled: isSyncing || !connection.isActive, children: [_jsx(RefreshCw, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: isSyncing ? 'Загрузка' : 'Загрузить карточки' })] }), _jsxs("button", { className: "icon-text-button client-cabinet-danger-button", type: "button", onClick: () => void removeConnection(connection), children: [_jsx(Trash2, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] })] }) })] }, connection.id));
                            }) })] }) })) : null, isEditorOpen ? (_jsx("div", { className: "client-marketplace-dialog-backdrop", role: "presentation", onMouseDown: () => !isSubmitting && setEditorOpen(false), children: _jsxs("form", { className: "client-marketplace-dialog", role: "dialog", "aria-modal": "true", "aria-label": form.id ? 'Изменение API-ключа' : 'Подключение API', onSubmit: submit, onMouseDown: (event) => event.stopPropagation(), children: [_jsxs("header", { children: [_jsx("div", { className: "client-marketplace-dialog__icon", children: _jsx(KeyRound, { size: 22, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h3", { children: form.id ? 'Изменить подключение API' : 'Подключить API клиента' }), _jsx("p", { children: client.name })] }), _jsx("button", { className: "icon-button", type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", onClick: () => setEditorOpen(false), disabled: isSubmitting, children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "client-marketplace-form", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("select", { value: form.marketplace, onChange: (event) => setForm({ ...form, marketplace: event.target.value }), children: marketplaceOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430" }), _jsx("input", { value: form.accountName, onChange: (event) => setForm({ ...form, accountName: event.target.value }), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442" })] }), _jsxs("label", { children: [_jsx("span", { children: form.marketplace === 'OZON' ? 'Client-Id Ozon' : 'ID продавца / кабинета' }), _jsx("input", { value: form.sellerId, onChange: (event) => setForm({ ...form, sellerId: event.target.value }), required: form.marketplace === 'OZON' })] }), _jsxs("label", { className: "client-marketplace-form__wide", children: [_jsx("span", { children: form.id ? 'Новый API-ключ' : 'API-ключ' }), _jsx("input", { type: "password", autoComplete: "new-password", value: form.apiKey, onChange: (event) => setForm({ ...form, apiKey: event.target.value }), placeholder: form.id ? selectedConnection?.apiKeyMask ?? '' : 'Вставьте API-ключ', required: !form.id }), _jsx("small", { children: "\u041F\u043E\u0441\u043B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F WMS \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442 \u0434\u043E\u0441\u0442\u0443\u043F \u043A FBS, \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430\u043C \u0438 \u0441\u043A\u043B\u0430\u0434\u0430\u043C, \u0430 \u0437\u0430\u0442\u0435\u043C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432." })] }), _jsxs("label", { className: "client-marketplace-checkbox", children: [_jsx("input", { type: "checkbox", checked: form.isActive, onChange: (event) => setForm({ ...form, isActive: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u043E" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: form.comment, onChange: (event) => setForm({ ...form, comment: event.target.value }) })] })] }), _jsxs("footer", { children: [_jsx("button", { className: "icon-text-button", type: "button", onClick: () => setEditorOpen(false), disabled: isSubmitting, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "submit", disabled: isSubmitting || (!form.id && form.apiKey.trim().length < 8), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохраняю и проверяю…' : 'Сохранить и проверить' })] })] })] }) })) : null] }));
}
function marketplaceLabel(type) {
    return marketplaceOptions.find((option) => option.value === type)?.label ?? type;
}
