import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createArticleMapping, deleteArticleMapping, fetchArticleMappings, fetchClients, fetchSkus, importArticleMappingsXlsx, } from '../../lib/api';
import { RelabelReconciliationPanel } from './RelabelReconciliationPanel';
import { useRememberedClientId } from '../../lib/rememberedClient';
const emptyForm = {
    sourceArticle: '',
    targetArticle: '',
    comment: '',
};
export function ArticleMappingPanel({ session, enabledClientsOnly = false, standalone = false, }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [mappings, setMappings] = useState([]);
    const [availableSkus, setAvailableSkus] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [areProductsLoading, setProductsLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    const canEdit = session.user.permissionCodes.includes('system:admin') ||
        session.user.permissionCodes.includes('skus:write') ||
        session.user.writableClientIds.includes(clientId);
    const selectedSourceSku = useMemo(() => findSkuByReference(availableSkus, form.sourceArticle), [availableSkus, form.sourceArticle]);
    const selectedTargetSku = useMemo(() => findSkuByReference(availableSkus, form.targetArticle), [availableSkus, form.targetArticle]);
    useEffect(() => {
        let isActive = true;
        async function loadClients() {
            try {
                const loadedClients = await fetchClients(session.accessToken);
                const nextClients = enabledClientsOnly
                    ? loadedClients.filter((client) => client.relabelingEnabled)
                    : loadedClients;
                if (!isActive) {
                    return;
                }
                setClients(nextClients);
                setClientId((current) => (nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id ?? ''));
            }
            catch (caught) {
                if (isActive) {
                    setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
                }
            }
        }
        void loadClients();
        return () => {
            isActive = false;
        };
    }, [enabledClientsOnly, session.accessToken]);
    useEffect(() => {
        if (!clientId) {
            setMappings([]);
            setAvailableSkus([]);
            return;
        }
        setForm(emptyForm);
        void Promise.all([loadMappings(clientId), loadProducts(clientId)]);
    }, [clientId]);
    async function loadMappings(nextClientId = clientId) {
        if (!nextClientId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const list = await fetchArticleMappings(session.accessToken, nextClientId);
            setMappings(list);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить соответствия.');
        }
        finally {
            setLoading(false);
        }
    }
    async function loadProducts(nextClientId = clientId) {
        if (!nextClientId) {
            return;
        }
        setProductsLoading(true);
        try {
            setAvailableSkus(await fetchSkus(session.accessToken, { clientId: nextClientId }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить товары клиента.');
        }
        finally {
            setProductsLoading(false);
        }
    }
    async function submit(event) {
        event.preventDefault();
        if (!clientId) {
            return;
        }
        if (normalizeProductReference(form.sourceArticle) ===
            normalizeProductReference(form.targetArticle)) {
            setError('Исходный товар и товар после переклейки должны отличаться.');
            return;
        }
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            await createArticleMapping(session.accessToken, {
                clientId,
                sourceArticle: form.sourceArticle,
                targetArticle: form.targetArticle,
                comment: form.comment || undefined,
            });
            setForm(emptyForm);
            setMessage('Товар добавлен в таблицу переклейки.');
            await loadMappings(clientId);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить соответствие.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function importFile(event) {
        event.preventDefault();
        if (!clientId || !file) {
            return;
        }
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            const result = await importArticleMappingsXlsx(session.accessToken, { clientId, file });
            setFile(null);
            setMessage(`Импортировано: создано ${result.summary.created}, обновлено ${result.summary.updated}, ошибок ${result.summary.errors}.`);
            await loadMappings(clientId);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось импортировать соответствия.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function removeMapping(mapping) {
        if (!canEdit || !window.confirm(`Удалить соответствие «${mapping.sourceArticle} → ${mapping.targetArticle}»?`)) {
            return;
        }
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            await deleteArticleMapping(session.accessToken, mapping.id);
            setMessage('Соответствие удалено.');
            await loadMappings(clientId);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось удалить соответствие.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx("div", { className: "directory-stack", children: _jsxs("div", { className: "directory-form", children: [_jsxs("div", { className: "directory-subheading", children: [_jsxs("div", { children: [_jsx("h3", { children: standalone ? 'Соответствие' : 'Соответствия артикулов' }), _jsx("span", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0431\u0435\u0440\u0435\u0442 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0442\u043E\u0432\u0430\u0440 \u00AB\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442\u00BB, \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0438\u0432\u0430\u0435\u0442 \u0435\u0433\u043E \u0438 \u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0435\u0442 \u043D\u043E\u0432\u044B\u0439 \u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430 \u00AB\u0414\u043E\u043B\u0436\u043D\u043E \u0443\u0435\u0445\u0430\u0442\u044C\u00BB." })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void loadMappings(), disabled: isLoading || !clientId, children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить' })] })] }), clients.length > 0 ? (_jsxs("label", { className: "directory-select-row", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id))) })] })) : (_jsx("p", { className: "form-info", children: "\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430 \u043D\u0438 \u0434\u043B\u044F \u043E\u0434\u043D\u043E\u0433\u043E \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430. \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u0444\u043B\u0430\u0433 \u00AB\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430\u00BB \u0432 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })), canEdit && selectedClient ? (_jsxs("div", { className: "relabel-product-entry", children: [_jsxs("div", { className: "relabel-product-entry__heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440 \u0432 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0443" }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u0438\u0437 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438\u043B\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0430\u0440\u0442\u0438\u043A\u0443\u043B/\u0428\u041A \u0432\u0440\u0443\u0447\u043D\u0443\u044E." })] }), _jsx("em", { children: areProductsLoading
                                        ? 'Загружаю товары…'
                                        : `Доступно товаров: ${availableSkus.length}` })] }), _jsxs("form", { className: "directory-fields relabel-product-form", onSubmit: submit, children: [_jsxs("label", { children: [_jsx("span", { children: "\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442 \u2014 \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440" }), _jsx("input", { list: "relabel-source-products", placeholder: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B, SKU \u0438\u043B\u0438 \u0428\u041A", value: form.sourceArticle, onChange: (event) => setForm({ ...form, sourceArticle: event.target.value }), required: true }), _jsx("small", { children: selectedSourceSku ? skuDescription(selectedSourceSku) : 'Физический товар на остатках WMS' })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u043B\u0436\u043D\u043E \u0443\u0435\u0445\u0430\u0442\u044C \u2014 \u0442\u043E\u0432\u0430\u0440 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438" }), _jsx("input", { list: "relabel-target-products", placeholder: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B, SKU \u0438\u043B\u0438 \u0428\u041A", value: form.targetArticle, onChange: (event) => setForm({ ...form, targetArticle: event.target.value }), required: true }), _jsx("small", { children: selectedTargetSku ? skuDescription(selectedTargetSku) : 'Товар, который указан в заказе WB' })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { placeholder: "\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E", value: form.comment, onChange: (event) => setForm({ ...form, comment: event.target.value }) })] }), _jsxs("button", { className: "primary-button directory-submit", type: "submit", disabled: isSubmitting || !selectedClient, children: [_jsx(Plus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Добавляю…' : 'Добавить товар' })] }), _jsx(ProductOptions, { id: "relabel-source-products", skus: availableSkus }), _jsx(ProductOptions, { id: "relabel-target-products", skus: availableSkus })] })] })) : null, canEdit && selectedClient ? _jsxs("form", { className: "directory-import-row", onSubmit: importFile, children: [_jsxs("label", { className: "directory-file-input", children: [_jsx(Upload, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: file ? file.name : 'Excel соответствий' }), _jsx("input", { accept: ".xlsx,.xls", type: "file", onChange: (event) => setFile(event.target.files?.[0] ?? null) })] }), _jsx("button", { className: "directory-submit", disabled: isSubmitting || !file || !selectedClient, type: "submit", children: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" })] }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, _jsx("div", { className: "client-table-scroll", children: _jsxs("table", { className: "client-directory-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442" }), _jsx("th", { children: "\u0414\u043E\u043B\u0436\u043D\u043E \u0443\u0435\u0445\u0430\u0442\u044C" }), _jsx("th", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), canEdit ? _jsx("th", { "aria-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }) : null] }) }), _jsxs("tbody", { children: [mappings.map((mapping) => {
                                        const sourceSku = findSkuByReference(availableSkus, mapping.sourceArticle);
                                        const targetSku = findSkuByReference(availableSkus, mapping.targetArticle);
                                        return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: mapping.sourceArticle }), sourceSku ? _jsx("small", { className: "relabel-product-summary", children: skuDescription(sourceSku) }) : null] }), _jsxs("td", { children: [_jsx("strong", { children: mapping.targetArticle }), targetSku ? _jsx("small", { className: "relabel-product-summary", children: skuDescription(targetSku) }) : null] }), _jsx("td", { children: mapping.comment || '-' }), canEdit ? (_jsx("td", { children: _jsx("button", { className: "icon-button", disabled: isSubmitting, onClick: () => void removeMapping(mapping), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435", type: "button", children: _jsx(Trash2, { size: 16, "aria-hidden": "true" }) }) })) : null] }, mapping.id));
                                    }), mappings.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: canEdit ? 4 : 3, children: isLoading ? 'Загрузка...' : 'Соответствия не найдены' }) })) : null] })] }) }), standalone && selectedClient ? (_jsx(RelabelReconciliationPanel, { session: session, clientId: selectedClient.id, canEdit: canEdit })) : null] }) }));
}
function ProductOptions({ id, skus }) {
    return (_jsx("datalist", { id: id, children: skus.map((sku) => (_jsx("option", { value: preferredSkuReference(sku), label: skuDescription(sku) }, sku.id))) }));
}
function preferredSkuReference(sku) {
    return sku.article?.trim() || sku.clientSku?.trim() || sku.internalSku.trim();
}
function findSkuByReference(skus, value) {
    const normalized = normalizeProductReference(value);
    if (!normalized) {
        return null;
    }
    return skus.find((sku) => [
        sku.article,
        sku.clientSku,
        sku.internalSku,
        ...sku.barcodes.map((barcode) => barcode.value),
    ].some((candidate) => normalizeProductReference(candidate ?? '') === normalized)) ?? null;
}
function normalizeProductReference(value) {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim();
}
function skuDescription(sku) {
    const barcode = sku.barcodes.find((item) => item.isPrimary)?.value
        ?? sku.barcodes[0]?.value;
    return [
        sku.name,
        sku.color,
        sku.size ? `размер ${sku.size}` : null,
        barcode ? `ШК ${barcode}` : null,
    ].filter(Boolean).join(' · ');
}
