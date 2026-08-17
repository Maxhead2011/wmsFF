import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ImageOff, Pencil, PlusCircle, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createSku, deleteSku, fetchClients, fetchMarketplaceConnections, fetchSku, fetchSkus, syncMarketplaceProducts, updateSku, } from '../../lib/api';
import { BulkVolumeEditor } from './BulkVolumeEditor';
import './catalog.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
const marketplaceLabels = {
    WILDBERRIES: 'Wildberries',
    OZON: 'Ozon',
    YANDEX_MARKET: 'Яндекс Маркет',
    SBER_MARKET: 'СберМегаМаркет',
    OTHER: 'Другое',
};
const emptySkuForm = {
    internalSku: '',
    clientSku: '',
    article: '',
    barcode: '',
    photoUrls: '',
    name: '',
    brand: '',
    category: '',
    color: '',
    size: '',
    weightGrams: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    needsChestnyZnak: false,
    isUnmarked: false,
    needsLabel: false,
    needsRelabel: false,
};
const emptyManualSkuForm = {
    ...emptySkuForm,
    clientId: '',
};
export function CatalogPanel({ session }) {
    const canRead = canUse(session.user, 'skus:read');
    const canWrite = canUse(session.user, 'skus:write');
    const [clients, setClients] = useState([]);
    const [clientState, setClientState] = useState('idle');
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [skus, setSkus] = useState([]);
    const [skuState, setSkuState] = useState('idle');
    const [connections, setConnections] = useState([]);
    const [selectedSku, setSelectedSku] = useState(null);
    const [form, setForm] = useState(null);
    const [manualForm, setManualForm] = useState(emptyManualSkuForm);
    const [isManualFormOpen, setManualFormOpen] = useState(false);
    const [isCreatingSku, setCreatingSku] = useState(false);
    const [isEditing, setEditing] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [syncingIds, setSyncingIds] = useState([]);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const selectedClient = useMemo(() => clients.find((client) => client.id === selectedClientId) ?? null, [clients, selectedClientId]);
    useEffect(() => {
        if (!canRead) {
            return;
        }
        let isActive = true;
        async function loadClients() {
            setClientState('loading');
            setError('');
            try {
                const list = await fetchClients(session.accessToken);
                if (!isActive) {
                    return;
                }
                setClients(list);
                setSelectedClientId((current) => validRememberedClientId(current, list));
                setManualForm((current) => ({
                    ...current,
                    clientId: current.clientId || selectedClientId || list[0]?.id || '',
                }));
                setClientState('ready');
            }
            catch (caught) {
                if (isActive) {
                    setClientState('error');
                    setError(errorMessage(caught, 'Не удалось загрузить клиентов.'));
                }
            }
        }
        void loadClients();
        return () => {
            isActive = false;
        };
    }, [canRead, session.accessToken]);
    useEffect(() => {
        if (selectedClientId) {
            setManualForm((current) => ({ ...current, clientId: selectedClientId }));
        }
    }, [selectedClientId]);
    useEffect(() => {
        if (!canRead) {
            return;
        }
        let isActive = true;
        async function loadCatalog() {
            setSkuState('loading');
            setError('');
            try {
                const [nextSkus, nextConnections] = await Promise.all([
                    fetchSkus(session.accessToken, { clientId: selectedClientId || undefined, search: appliedSearch || undefined }),
                    selectedClientId ? fetchMarketplaceConnections(session.accessToken, { clientId: selectedClientId }) : Promise.resolve([]),
                ]);
                if (!isActive) {
                    return;
                }
                setSkus(nextSkus);
                setConnections(nextConnections);
                setSkuState('ready');
            }
            catch (caught) {
                if (isActive) {
                    setSkuState('error');
                    setError(errorMessage(caught, 'Не удалось загрузить каталог.'));
                }
            }
        }
        void loadCatalog();
        return () => {
            isActive = false;
        };
    }, [appliedSearch, canRead, reloadKey, selectedClientId, session.accessToken]);
    if (!canRead) {
        return null;
    }
    function applySearch(event) {
        event.preventDefault();
        setAppliedSearch(search.trim());
    }
    async function openSku(skuId) {
        setError('');
        setMessage('');
        try {
            const detail = await fetchSku(session.accessToken, skuId);
            setSelectedSku(detail);
            setForm(formFromSku(detail));
            setEditing(false);
        }
        catch (caught) {
            setError(errorMessage(caught, 'Не удалось открыть карточку товара.'));
        }
    }
    async function runProductSync(connectionId) {
        setSyncingIds((current) => [...current, connectionId]);
        setError('');
        setMessage('');
        try {
            const result = await syncMarketplaceProducts(session.accessToken, connectionId);
            setMessage(`Товары синхронизированы. Получено: ${result.productsReceived}. Создано: ${result.created}. Обновлено: ${result.updated}. Объединено товаров без карточки: ${result.mergedDrafts}.`);
            setReloadKey((current) => current + 1);
        }
        catch (caught) {
            setError(errorMessage(caught, 'Не удалось синхронизировать товары.'));
        }
        finally {
            setSyncingIds((current) => current.filter((id) => id !== connectionId));
        }
    }
    async function saveSku(event) {
        event.preventDefault();
        if (!selectedSku || !form || !canWrite) {
            return;
        }
        setError('');
        setMessage('');
        try {
            const updated = await updateSku(session.accessToken, selectedSku.id, payloadFromForm(form));
            setSelectedSku(updated);
            setForm(formFromSku(updated));
            setEditing(false);
            setSkus((current) => current.map((sku) => (sku.id === updated.id ? updated : sku)));
            setMessage('Карточка товара сохранена.');
        }
        catch (caught) {
            setError(errorMessage(caught, 'Не удалось сохранить карточку товара.'));
        }
    }
    async function createManualSku(event) {
        event.preventDefault();
        if (!canWrite) {
            return;
        }
        setCreatingSku(true);
        setError('');
        setMessage('');
        try {
            const created = await createSku(session.accessToken, payloadFromManualForm(manualForm));
            const detail = await fetchSku(session.accessToken, created.id);
            setSelectedSku(detail);
            setForm(formFromSku(detail));
            setEditing(false);
            setManualForm({ ...emptyManualSkuForm, clientId: manualForm.clientId });
            setManualFormOpen(false);
            setReloadKey((current) => current + 1);
            setMessage('Товар и карточка созданы вручную.');
        }
        catch (caught) {
            setError(errorMessage(caught, 'Не удалось создать товар вручную.'));
        }
        finally {
            setCreatingSku(false);
        }
    }
    async function removeSku() {
        if (!selectedSku || !canWrite) {
            return;
        }
        const confirmed = window.confirm(`Удалить товар ${selectedSku.name}?`);
        if (!confirmed) {
            return;
        }
        setError('');
        setMessage('');
        try {
            await deleteSku(session.accessToken, selectedSku.id);
            setSkus((current) => current.filter((sku) => sku.id !== selectedSku.id));
            setSelectedSku(null);
            setForm(null);
            setMessage('Карточка товара удалена.');
        }
        catch (caught) {
            setError(errorMessage(caught, 'Не удалось удалить карточку товара.'));
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430", title: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u0442\u043E\u0432\u0430\u0440\u043E\u0432", description: "\u041D\u0430\u0439\u0434\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440, \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0438\u043B\u0438 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u0439\u0442\u0435 \u043A\u0430\u0442\u0430\u043B\u043E\u0433 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0441 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u043E\u043C.", tiles: [
            { title: 'Поиск и карточки', description: 'Быстрый поиск по названию, SKU, артикулу или штрихкоду.', icon: Search, tone: 'blue' },
            { title: 'Новый товар', description: 'Создать SKU вручную со всеми размерами и признаками.', icon: PlusCircle, tone: 'green' },
            { title: 'Синхронизация', description: 'Загрузить карточки из подключённого маркетплейса.', icon: RefreshCw, tone: 'violet' },
        ], children: _jsxs("section", { className: "catalog-panel", "aria-label": "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u0442\u043E\u0432\u0430\u0440\u043E\u0432", children: [_jsxs("div", { className: "section-heading catalog-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433" }), _jsx("h2", { children: "\u041E\u0431\u0449\u0430\u044F \u0431\u0430\u0437\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setReloadKey((current) => current + 1), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u0430\u0442\u0430\u043B\u043E\u0433", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "catalog-toolbar", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), disabled: clientState === 'loading', children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0442\u043E\u0432\u0430\u0440\u044B" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)))] })] }), _jsxs("form", { className: "catalog-search", onSubmit: applySearch, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A" }), _jsxs("div", { children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, SKU, \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0438\u043B\u0438 \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434" })] })] }), _jsxs("button", { className: "icon-text-button", type: "submit", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0430\u0439\u0442\u0438" })] })] })] }), selectedClient ? (_jsxs("div", { className: "catalog-marketplaces", children: [_jsxs("div", { children: [_jsx("strong", { children: selectedClient.name }), _jsx("span", { children: "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u0438\u0437 API \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u044B \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433, \u043D\u043E \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u0451\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u0438" })] }), _jsxs("div", { className: "catalog-marketplaces__actions", children: [connections.length === 0 ? _jsx("span", { className: "catalog-muted", children: "API \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }) : null, connections.map((connection) => (_jsxs("button", { className: "icon-text-button", disabled: !connection.isActive || syncingIds.includes(connection.id), onClick: () => void runProductSync(connection.id), type: "button", title: connection.apiKeyMask, children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsxs("span", { children: [syncingIds.includes(connection.id) ? 'Загружаю' : 'Выгрузить', " ", marketplaceLabel(connection.marketplace)] })] }, connection.id)))] })] })) : (_jsx("div", { className: "catalog-marketplaces", children: _jsxs("div", { children: [_jsx("strong", { children: "\u041E\u0431\u0449\u0438\u0439 \u043A\u0430\u0442\u0430\u043B\u043E\u0433" }), _jsx("span", { children: "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u043E\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432. \u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E\u044F\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 \u043F\u0440\u0438\u0435\u043C\u043A\u0443 \u0438\u043B\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0443 \u0441\u043A\u043B\u0430\u0434\u0430." })] }) })), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, canWrite ? (_jsx(BulkVolumeEditor, { clients: clients, defaultClientId: selectedClientId, onApplied: () => setReloadKey((current) => current + 1), session: session })) : null, canWrite ? (_jsxs("section", { className: "catalog-manual-card", "aria-label": "\u0420\u0443\u0447\u043D\u043E\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u0430", children: [_jsxs("div", { className: "catalog-manual-card__heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041D\u043E\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440 \u0432\u0440\u0443\u0447\u043D\u0443\u044E" }), _jsx("span", { children: "\u0421\u043E\u0437\u0434\u0430\u0435\u0442 SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0442\u043E\u0432\u0430\u0440\u0430 \u0441 \u0444\u043E\u0442\u043E, \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430\u043C\u0438 \u0438 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430\u043C\u0438" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => setManualFormOpen((current) => !current), children: [_jsx(PlusCircle, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isManualFormOpen ? 'Свернуть' : 'Добавить товар' })] })] }), isManualFormOpen ? (_jsxs("form", { className: "catalog-manual-form", onSubmit: (event) => void createManualSku(event), children: [_jsxs("div", { className: "catalog-card-form__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: manualForm.clientId, onChange: (event) => {
                                                        const clientId = event.target.value;
                                                        setManualForm({ ...manualForm, clientId });
                                                        setSelectedClientId(clientId);
                                                    }, required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)))] })] }), _jsx(TextField, { disabled: false, label: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU", value: manualForm.internalSku, onChange: (value) => setManualForm({ ...manualForm, internalSku: value }), required: true }), _jsx(TextField, { disabled: false, label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", value: manualForm.name, onChange: (value) => setManualForm({ ...manualForm, name: value }), required: true }), _jsx(TextField, { disabled: false, label: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B \u0412\u0411 / \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430", value: manualForm.article, onChange: (value) => setManualForm({ ...manualForm, article: value }) }), _jsx(TextField, { disabled: false, label: "SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430", value: manualForm.clientSku, onChange: (value) => setManualForm({ ...manualForm, clientSku: value }) }), _jsx(TextField, { disabled: false, label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434", value: manualForm.barcode, onChange: (value) => setManualForm({ ...manualForm, barcode: value }) }), _jsx(TextField, { disabled: false, label: "\u0411\u0440\u0435\u043D\u0434", value: manualForm.brand, onChange: (value) => setManualForm({ ...manualForm, brand: value }) }), _jsx(TextField, { disabled: false, label: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", value: manualForm.category, onChange: (value) => setManualForm({ ...manualForm, category: value }) }), _jsx(TextField, { disabled: false, label: "\u0426\u0432\u0435\u0442", value: manualForm.color, onChange: (value) => setManualForm({ ...manualForm, color: value }) }), _jsx(TextField, { disabled: false, label: "\u0420\u0430\u0437\u043C\u0435\u0440", value: manualForm.size, onChange: (value) => setManualForm({ ...manualForm, size: value }) }), _jsx(TextField, { disabled: false, label: "\u0412\u0435\u0441, \u0433", value: manualForm.weightGrams, onChange: (value) => setManualForm({ ...manualForm, weightGrams: value }) }), _jsx(TextField, { disabled: false, label: "\u0414\u043B\u0438\u043D\u0430, \u0441\u043C", value: manualForm.lengthCm, onChange: (value) => setManualForm({ ...manualForm, lengthCm: value }) }), _jsx(TextField, { disabled: false, label: "\u0428\u0438\u0440\u0438\u043D\u0430, \u0441\u043C", value: manualForm.widthCm, onChange: (value) => setManualForm({ ...manualForm, widthCm: value }) }), _jsx(TextField, { disabled: false, label: "\u0412\u044B\u0441\u043E\u0442\u0430, \u0441\u043C", value: manualForm.heightCm, onChange: (value) => setManualForm({ ...manualForm, heightCm: value }) })] }), _jsx(TextAreaField, { disabled: false, label: "\u0424\u043E\u0442\u043E URL", value: manualForm.photoUrls, onChange: (value) => setManualForm({ ...manualForm, photoUrls: value }), placeholder: "\u041E\u0434\u043D\u0430 \u0441\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u0444\u043E\u0442\u043E \u0432 \u0441\u0442\u0440\u043E\u043A\u0435" }), _jsxs("div", { className: "catalog-card-form__checks", children: [_jsx(CheckboxField, { disabled: false, label: "\u0427\u0435\u0441\u0442\u043D\u044B\u0439 \u0417\u041D\u0410\u041A", checked: manualForm.needsChestnyZnak, onChange: (value) => setManualForm({ ...manualForm, needsChestnyZnak: value }) }), _jsx(CheckboxField, { disabled: false, label: "\u0411\u0435\u0437 \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0438", checked: manualForm.isUnmarked, onChange: (value) => setManualForm({ ...manualForm, isUnmarked: value }) }), _jsx(CheckboxField, { disabled: false, label: "\u041D\u0443\u0436\u043D\u0430 \u044D\u0442\u0438\u043A\u0435\u0442\u043A\u0430", checked: manualForm.needsLabel, onChange: (value) => setManualForm({ ...manualForm, needsLabel: value }) }), _jsx(CheckboxField, { disabled: false, label: "\u041D\u0443\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430", checked: manualForm.needsRelabel, onChange: (value) => setManualForm({ ...manualForm, needsRelabel: value }) })] }), _jsx("div", { className: "catalog-card-form__actions", children: _jsxs("button", { className: "primary-button", type: "submit", disabled: isCreatingSku, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isCreatingSku ? 'Создаю' : 'Создать товар' })] }) })] })) : null] })) : null, _jsx("div", { className: "catalog-table-wrap", children: _jsxs("table", { className: "catalog-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0424\u043E\u0442\u043E" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("th", { children: "\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B" }), _jsx("th", { children: "\u041B\u0438\u0442\u0440\u0430\u0436" }), _jsx("th", { children: "\u041F\u0440\u0438\u0437\u043D\u0430\u043A\u0438" })] }) }), _jsxs("tbody", { children: [skus.map((sku) => (_jsxs("tr", { onClick: () => void openSku(sku.id), tabIndex: 0, children: [_jsx("td", { children: _jsx(SkuPhoto, { sku: sku }) }), _jsxs("td", { children: [_jsx("strong", { children: sku.name }), _jsx("span", { children: [sku.internalSku, sku.article, sku.brand].filter(Boolean).join(' · ') || '-' })] }), _jsx("td", { children: sku.client ? `${sku.client.code} · ${sku.client.name}` : '-' }), _jsxs("td", { children: [_jsx("strong", { children: sku.marketplace ? marketplaceLabel(sku.marketplace) : 'WMS' }), _jsx("span", { children: sku.marketplaceOfferId || sku.clientSku || '-' })] }), _jsx("td", { children: primaryBarcode(sku) || '-' }), _jsx("td", { children: formatDimensions(sku) }), _jsx("td", { children: formatNumber(sku.volumeLiters, 'л') }), _jsx("td", { children: skuFlags(sku).join(', ') || '-' })] }, sku.id))), skus.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: skuState === 'loading' ? 'Загрузка каталога...' : 'Товары не найдены' }) })) : null] })] }) }), selectedSku && form ? (_jsx(SkuModal, { canWrite: canWrite, form: form, isEditing: isEditing, onChange: setForm, onClose: () => {
                        setSelectedSku(null);
                        setForm(null);
                    }, onDelete: () => void removeSku(), onEdit: () => setEditing(true), onSave: (event) => void saveSku(event), sku: selectedSku })) : null] }) }));
}
function SkuModal({ canWrite, form, isEditing, onChange, onClose, onDelete, onEdit, onSave, sku, }) {
    return (_jsx("div", { className: "catalog-modal-backdrop", role: "presentation", children: _jsxs("section", { className: "catalog-modal", "aria-label": "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430", role: "dialog", "aria-modal": "true", children: [_jsxs("header", { className: "catalog-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: sku.marketplace ? marketplaceLabel(sku.marketplace) : 'Карточка WMS' }), _jsx("h3", { children: sku.name })] }), _jsxs("div", { className: "catalog-modal__actions", children: [canWrite && !isEditing ? (_jsxs("button", { className: "icon-text-button", type: "button", onClick: onEdit, children: [_jsx(Pencil, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] })) : null, canWrite ? (_jsxs("button", { className: "icon-text-button catalog-danger-button", type: "button", onClick: onDelete, children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] })) : null, _jsx("button", { className: "icon-button", type: "button", onClick: onClose, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] })] }), _jsxs("div", { className: "catalog-modal__body", children: [_jsxs("aside", { className: "catalog-modal__media", children: [_jsx(SkuPhoto, { sku: sku, large: true }), _jsxs("div", { className: "catalog-photo-strip", children: [sku.marketplacePhotos.map((photo, index) => (_jsx("img", { alt: `${sku.name} ${index + 1}`, src: photo, loading: index < 4 ? 'eager' : 'lazy' }, photo))), sku.marketplacePhotos.length === 0 ? _jsx("span", { children: "\u0424\u043E\u0442\u043E \u0438\u0437 API \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }) : null] })] }), _jsxs("form", { className: "catalog-card-form", onSubmit: onSave, children: [_jsxs("div", { className: "catalog-card-form__grid", children: [_jsx(TextField, { disabled: !isEditing, label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", value: form.name, onChange: (value) => onChange({ ...form, name: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU", value: form.internalSku, onChange: (value) => onChange({ ...form, internalSku: value }) }), _jsx(TextField, { disabled: !isEditing, label: "SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430", value: form.clientSku, onChange: (value) => onChange({ ...form, clientSku: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B", value: form.article, onChange: (value) => onChange({ ...form, article: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434", value: form.barcode, onChange: (value) => onChange({ ...form, barcode: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0411\u0440\u0435\u043D\u0434", value: form.brand, onChange: (value) => onChange({ ...form, brand: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", value: form.category, onChange: (value) => onChange({ ...form, category: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0426\u0432\u0435\u0442", value: form.color, onChange: (value) => onChange({ ...form, color: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0420\u0430\u0437\u043C\u0435\u0440", value: form.size, onChange: (value) => onChange({ ...form, size: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0412\u0435\u0441, \u0433", value: form.weightGrams, onChange: (value) => onChange({ ...form, weightGrams: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0414\u043B\u0438\u043D\u0430, \u0441\u043C", value: form.lengthCm, onChange: (value) => onChange({ ...form, lengthCm: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0428\u0438\u0440\u0438\u043D\u0430, \u0441\u043C", value: form.widthCm, onChange: (value) => onChange({ ...form, widthCm: value }) }), _jsx(TextField, { disabled: !isEditing, label: "\u0412\u044B\u0441\u043E\u0442\u0430, \u0441\u043C", value: form.heightCm, onChange: (value) => onChange({ ...form, heightCm: value }) })] }), _jsx(TextAreaField, { disabled: !isEditing, label: "\u0424\u043E\u0442\u043E URL", value: form.photoUrls, onChange: (value) => onChange({ ...form, photoUrls: value }), placeholder: "\u041E\u0434\u043D\u0430 \u0441\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u0444\u043E\u0442\u043E \u0432 \u0441\u0442\u0440\u043E\u043A\u0435" }), _jsxs("div", { className: "catalog-card-form__checks", children: [_jsx(CheckboxField, { disabled: !isEditing, label: "\u0427\u0435\u0441\u0442\u043D\u044B\u0439 \u0417\u041D\u0410\u041A", checked: form.needsChestnyZnak, onChange: (value) => onChange({ ...form, needsChestnyZnak: value }) }), _jsx(CheckboxField, { disabled: !isEditing, label: "\u0411\u0435\u0437 \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0438", checked: form.isUnmarked, onChange: (value) => onChange({ ...form, isUnmarked: value }) }), _jsx(CheckboxField, { disabled: !isEditing, label: "\u041D\u0443\u0436\u043D\u0430 \u044D\u0442\u0438\u043A\u0435\u0442\u043A\u0430", checked: form.needsLabel, onChange: (value) => onChange({ ...form, needsLabel: value }) }), _jsx(CheckboxField, { disabled: !isEditing, label: "\u041D\u0443\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430", checked: form.needsRelabel, onChange: (value) => onChange({ ...form, needsRelabel: value }) })] }), isEditing ? (_jsx("div", { className: "catalog-card-form__actions", children: _jsxs("button", { className: "primary-button", type: "submit", children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" })] }) })) : null] })] })] }) }));
}
function TextField({ disabled, label, onChange, required = false, value, }) {
    return (_jsxs("label", { children: [_jsx("span", { children: label }), _jsx("input", { disabled: disabled, required: required, value: value, onChange: (event) => onChange(event.target.value) })] }));
}
function TextAreaField({ disabled, label, onChange, placeholder, value, }) {
    return (_jsxs("label", { children: [_jsx("span", { children: label }), _jsx("textarea", { disabled: disabled, value: value, onChange: (event) => onChange(event.target.value), placeholder: placeholder })] }));
}
function CheckboxField({ checked, disabled, label, onChange, }) {
    return (_jsxs("label", { children: [_jsx("input", { disabled: disabled, type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) }), _jsx("span", { children: label })] }));
}
function SkuPhoto({ large = false, sku }) {
    const photo = sku.marketplacePhotos[0];
    if (!photo) {
        return (_jsx("span", { className: large ? 'catalog-photo catalog-photo--large catalog-photo--empty' : 'catalog-photo catalog-photo--empty', children: _jsx(ImageOff, { size: large ? 30 : 18, "aria-hidden": "true" }) }));
    }
    return _jsx("img", { className: large ? 'catalog-photo catalog-photo--large' : 'catalog-photo', alt: sku.name, src: photo, loading: large ? 'eager' : 'lazy' });
}
function formFromSku(sku) {
    return {
        internalSku: sku.internalSku,
        clientSku: sku.clientSku ?? '',
        article: sku.article ?? '',
        barcode: primaryBarcode(sku),
        photoUrls: sku.marketplacePhotos.join('\n'),
        name: sku.name,
        brand: sku.brand ?? '',
        category: sku.category ?? '',
        color: sku.color ?? '',
        size: sku.size ?? '',
        weightGrams: valueToText(sku.weightGrams),
        lengthCm: valueToText(sku.lengthCm),
        widthCm: valueToText(sku.widthCm),
        heightCm: valueToText(sku.heightCm),
        needsChestnyZnak: sku.needsChestnyZnak,
        isUnmarked: sku.isUnmarked,
        needsLabel: sku.needsLabel,
        needsRelabel: sku.needsRelabel,
    };
}
function payloadFromForm(form) {
    return {
        internalSku: form.internalSku.trim(),
        clientSku: form.clientSku.trim(),
        article: form.article.trim(),
        barcode: form.barcode.trim(),
        photoUrls: parsePhotoUrls(form.photoUrls),
        name: form.name.trim(),
        brand: form.brand.trim(),
        category: form.category.trim(),
        color: form.color.trim(),
        size: form.size.trim(),
        weightGrams: parseOptionalNumber(form.weightGrams),
        lengthCm: parseOptionalNumber(form.lengthCm),
        widthCm: parseOptionalNumber(form.widthCm),
        heightCm: parseOptionalNumber(form.heightCm),
        needsChestnyZnak: form.needsChestnyZnak,
        isUnmarked: form.isUnmarked,
        needsLabel: form.needsLabel,
        needsRelabel: form.needsRelabel,
    };
}
function payloadFromManualForm(form) {
    return {
        clientId: form.clientId,
        internalSku: form.internalSku.trim(),
        clientSku: form.clientSku.trim() || undefined,
        article: form.article.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        photoUrls: parsePhotoUrls(form.photoUrls),
        name: form.name.trim(),
        brand: form.brand.trim() || undefined,
        category: form.category.trim() || undefined,
        color: form.color.trim() || undefined,
        size: form.size.trim() || undefined,
        weightGrams: parseOptionalNumber(form.weightGrams),
        lengthCm: parseOptionalNumber(form.lengthCm),
        widthCm: parseOptionalNumber(form.widthCm),
        heightCm: parseOptionalNumber(form.heightCm),
        needsChestnyZnak: form.needsChestnyZnak,
        isUnmarked: form.isUnmarked,
        needsLabel: form.needsLabel,
        needsRelabel: form.needsRelabel,
    };
}
function parsePhotoUrls(value) {
    return value
        .split(/\r?\n|,/)
        .map((photo) => photo.trim())
        .filter(Boolean);
}
function primaryBarcode(sku) {
    return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}
function formatDimensions(sku) {
    if (!sku.lengthCm || !sku.widthCm || !sku.heightCm) {
        return '-';
    }
    return `${sku.lengthCm} × ${sku.widthCm} × ${sku.heightCm} см`;
}
function formatNumber(value, suffix) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    return `${value} ${suffix}`;
}
function skuFlags(sku) {
    return [
        sku.needsChestnyZnak ? 'ЧЗ' : '',
        sku.isUnmarked ? 'без маркировки' : '',
        sku.needsLabel ? 'этикетка' : '',
        sku.needsRelabel ? 'перемаркировка' : '',
    ].filter(Boolean);
}
function valueToText(value) {
    return value === null || value === undefined ? '' : String(value);
}
function parseOptionalNumber(value) {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) {
        return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function marketplaceLabel(type) {
    return marketplaceLabels[type] ?? type;
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function errorMessage(caught, fallback) {
    return caught instanceof Error ? caught.message : fallback;
}
