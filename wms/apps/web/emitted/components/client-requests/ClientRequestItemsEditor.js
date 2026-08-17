import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ClipboardPaste, Database, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchTurnoverSuggestions } from '../../lib/api';
import { emptyClientRequestItem, MAX_CLIENT_REQUEST_ITEMS, parseClientRequestItemsText, } from './clientRequestItems';
export function ClientRequestItemsEditor({ items, accessToken, clientId, availability, showQuickSearch = false, showDatabasePicker = false, onChange, onAvailabilityCheck, onError, }) {
    const [pasteText, setPasteText] = useState('');
    const [activeSuggest, setActiveSuggest] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [isSuggesting, setSuggesting] = useState(false);
    const [itemSearch, setItemSearch] = useState('');
    const [isDatabasePickerOpen, setDatabasePickerOpen] = useState(false);
    const [databaseSearch, setDatabaseSearch] = useState('');
    const [databaseSuggestions, setDatabaseSuggestions] = useState([]);
    const [databaseQuantities, setDatabaseQuantities] = useState({});
    const [databaseMessage, setDatabaseMessage] = useState(null);
    const [isDatabaseSuggesting, setDatabaseSuggesting] = useState(false);
    const availabilityByIndex = new Map((availability?.lines ?? []).map((line) => [line.index, line]));
    const visibleItems = useMemo(() => items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => matchesItemSearch(item, itemSearch)), [itemSearch, items]);
    useEffect(() => {
        const query = activeSuggest?.query.trim() ?? '';
        if (!clientId || !activeSuggest) {
            setSuggestions([]);
            return;
        }
        const timeoutId = window.setTimeout(() => {
            setSuggesting(true);
            fetchTurnoverSuggestions(accessToken, { clientId, search: query || undefined })
                .then((result) => setSuggestions(buildStockSuggestions(result).slice(0, 8)))
                .catch(() => setSuggestions([]))
                .finally(() => setSuggesting(false));
        }, 180);
        return () => window.clearTimeout(timeoutId);
    }, [accessToken, activeSuggest, clientId]);
    useEffect(() => {
        if (!clientId || !isDatabasePickerOpen) {
            setDatabaseSuggestions([]);
            return;
        }
        const query = databaseSearch.trim();
        const timeoutId = window.setTimeout(() => {
            setDatabaseSuggesting(true);
            fetchTurnoverSuggestions(accessToken, { clientId, search: query || undefined })
                .then((result) => setDatabaseSuggestions(buildStockSuggestions(result).slice(0, 20)))
                .catch(() => setDatabaseSuggestions([]))
                .finally(() => setDatabaseSuggesting(false));
        }, 220);
        return () => window.clearTimeout(timeoutId);
    }, [accessToken, clientId, databaseSearch, isDatabasePickerOpen]);
    useEffect(() => {
        if (!clientId || !onAvailabilityCheck) {
            return;
        }
        const hasCheckableItems = items.some((item) => item.skuId.trim() || item.barcode.trim());
        if (!hasCheckableItems) {
            return;
        }
        const timeoutId = window.setTimeout(() => onAvailabilityCheck(items), 350);
        return () => window.clearTimeout(timeoutId);
    }, [clientId, items, onAvailabilityCheck]);
    function updateItem(index, field, value) {
        onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value, skuId: field === 'barcode' || field === 'name' ? '' : item.skuId } : item));
        if (field === 'barcode' || field === 'name') {
            setActiveSuggest({ index, query: value });
        }
    }
    function selectSku(index, sku) {
        onError(null);
        onChange(items.map((item, itemIndex) => itemIndex === index
            ? {
                ...item,
                skuId: sku.skuId,
                barcode: sku.barcode,
                name: sku.name,
                internalSku: sku.internalSku,
                clientSku: sku.clientSku ?? '',
                article: sku.article ?? '',
                color: sku.color ?? '',
                size: sku.size ?? '',
            }
            : item));
        setActiveSuggest(null);
        setSuggestions([]);
    }
    function addItem() {
        if (items.length >= MAX_CLIENT_REQUEST_ITEMS) {
            onError(`В заявке может быть не больше ${MAX_CLIENT_REQUEST_ITEMS} позиций.`);
            return;
        }
        onError(null);
        onChange([...items, emptyClientRequestItem()]);
    }
    function addDatabaseItem(sku) {
        const key = stockSuggestionKey(sku);
        const quantity = normalizeDatabaseQuantity(databaseQuantities[key]);
        const existingIndex = items.findIndex((item) => (sku.skuId && item.skuId === sku.skuId) || (sku.barcode && item.barcode.trim() === sku.barcode));
        if (existingIndex === -1 && items.length >= MAX_CLIENT_REQUEST_ITEMS) {
            onError(`В заявке может быть не больше ${MAX_CLIENT_REQUEST_ITEMS} позиций.`);
            return;
        }
        const nextItems = existingIndex >= 0
            ? items.map((item, index) => index === existingIndex
                ? {
                    ...item,
                    skuId: sku.skuId,
                    barcode: sku.barcode,
                    name: sku.name,
                    internalSku: sku.internalSku,
                    clientSku: sku.clientSku ?? '',
                    article: sku.article ?? '',
                    color: sku.color ?? '',
                    size: sku.size ?? '',
                    quantity: String(normalizeDatabaseQuantity(item.quantity) + quantity),
                }
                : item)
            : [
                ...items,
                {
                    ...emptyClientRequestItem(),
                    skuId: sku.skuId,
                    barcode: sku.barcode,
                    name: sku.name,
                    internalSku: sku.internalSku,
                    clientSku: sku.clientSku ?? '',
                    article: sku.article ?? '',
                    color: sku.color ?? '',
                    size: sku.size ?? '',
                    quantity: String(quantity),
                },
            ];
        onError(null);
        onChange(nextItems);
        setDatabaseMessage(existingIndex >= 0
            ? `Количество увеличено: ${sku.internalSku || sku.barcode || sku.name}.`
            : `Товар добавлен: ${sku.internalSku || sku.barcode || sku.name}.`);
    }
    function removeItem(index) {
        onError(null);
        onChange(items.filter((_, itemIndex) => itemIndex !== index));
    }
    function applyPaste() {
        try {
            const parsed = parseClientRequestItemsText(pasteText);
            const nextItems = [...items.filter((item) => item.name || item.barcode || item.comment), ...parsed].slice(0, MAX_CLIENT_REQUEST_ITEMS);
            onError(null);
            onChange(nextItems.length > 0 ? nextItems : [emptyClientRequestItem()]);
            setPasteText('');
        }
        catch (caught) {
            onError(caught instanceof Error ? caught.message : 'Не удалось разобрать состав заявки.');
        }
    }
    return (_jsxs("section", { className: "client-request-items-editor", "aria-label": "\u0421\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsxs("div", { className: "client-request-items-editor__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0421\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsxs("p", { children: [items.length, " / ", MAX_CLIENT_REQUEST_ITEMS, " \u043F\u043E\u0437\u0438\u0446\u0438\u0439"] })] }), _jsxs("button", { className: "secondary-action client-request-small-button", type: "button", onClick: addItem, children: [_jsx(Plus, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0442\u0440\u043E\u043A\u0430" })] })] }), showDatabasePicker ? (_jsxs("div", { className: "client-request-database-picker", children: [_jsxs("div", { className: "client-request-database-picker__bar", children: [_jsxs("button", { className: "secondary-action client-request-small-button", type: "button", onClick: () => {
                                    setDatabasePickerOpen((current) => !current);
                                    setDatabaseMessage(null);
                                }, children: [_jsx(Database, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0438\u0437 \u0431\u0430\u0437\u044B" })] }), _jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A \u0431\u0435\u0440\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u044B \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] }), isDatabasePickerOpen ? (_jsxs("div", { className: "client-request-database-picker__panel", children: [_jsxs("label", { className: "client-request-database-picker__search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { type: "search", value: databaseSearch, onChange: (event) => {
                                            setDatabaseSearch(event.target.value);
                                            setDatabaseMessage(null);
                                        }, placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0428\u041A, \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, SKU \u0438\u043B\u0438 \u0430\u0440\u0442\u0438\u043A\u0443\u043B", "aria-label": "\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430 \u0432 \u0431\u0430\u0437\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), databaseSearch ? (_jsx("button", { type: "button", onClick: () => {
                                            setDatabaseSearch('');
                                            setDatabaseMessage(null);
                                        }, title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430", children: _jsx(X, { size: 16, "aria-hidden": "true" }) })) : null] }), databaseMessage ? _jsx("p", { className: "client-request-database-picker__message", children: databaseMessage }) : null, isDatabaseSuggesting ? _jsx("p", { className: "client-request-database-picker__message", children: "\u0418\u0449\u0443 \u0442\u043E\u0432\u0430\u0440\u044B \u0432 \u0431\u0430\u0437\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." }) : null, _jsxs("div", { className: "client-request-database-picker__results", role: "list", children: [databaseSuggestions.map((sku) => {
                                        const key = stockSuggestionKey(sku);
                                        const alreadyInRequest = items.some((item) => (sku.skuId && item.skuId === sku.skuId) || (sku.barcode && item.barcode.trim() === sku.barcode));
                                        return (_jsxs("div", { className: "client-request-database-picker__result", role: "listitem", children: [_jsxs("div", { className: "client-request-database-picker__product", children: [_jsx("strong", { children: sku.internalSku || sku.clientSku || sku.barcode || 'Товар без SKU' }), _jsx("span", { children: sku.name }), _jsx("small", { children: [
                                                                sku.barcode ? `ШК ${sku.barcode}` : 'без штрихкода',
                                                                sku.article,
                                                                sku.color,
                                                                sku.size,
                                                                `остаток ${sku.availableQuantity} шт.`,
                                                                alreadyInRequest ? 'уже в заявке' : '',
                                                            ].filter(Boolean).join(' · ') })] }), _jsx("input", { "aria-label": `Количество для добавления ${sku.internalSku || sku.name}`, min: "1", type: "number", value: databaseQuantities[key] ?? '1', onChange: (event) => setDatabaseQuantities((current) => ({ ...current, [key]: event.target.value })) }), _jsxs("button", { className: "primary-button client-request-database-picker__add", type: "button", onClick: () => addDatabaseItem(sku), children: [_jsx(Plus, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: alreadyInRequest ? 'Добавить еще' : 'Добавить' })] })] }, key));
                                    }), !isDatabaseSuggesting && databaseSuggestions.length === 0 ? (_jsx("div", { className: "client-request-database-picker__empty", role: "status", children: databaseSearch.trim() ? 'Товар не найден в базе клиента.' : 'Введите запрос или выберите товар из списка.' })) : null] })] })) : null] })) : null, showQuickSearch ? (_jsxs("div", { className: "client-request-item-search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { type: "search", value: itemSearch, onChange: (event) => setItemSearch(event.target.value), placeholder: "\u0428\u041A, \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, SKU \u0438\u043B\u0438 \u0430\u0440\u0442\u0438\u043A\u0443\u043B", "aria-label": "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u043F\u043E \u0441\u043E\u0441\u0442\u0430\u0432\u0443 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsx("span", { children: itemSearch.trim() ? `Найдено ${visibleItems.length} из ${items.length}` : `Всего ${items.length}` }), itemSearch ? (_jsx("button", { type: "button", onClick: () => setItemSearch(''), title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", children: _jsx(X, { size: 16, "aria-hidden": "true" }) })) : null] })) : null, _jsxs("div", { className: "client-request-items-grid", role: "table", "aria-label": "\u041F\u043E\u0437\u0438\u0446\u0438\u0438 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsxs("div", { className: "client-request-items-grid__header", role: "row", children: [_jsx("span", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("span", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("span", {})] }), visibleItems.map(({ item, index }) => {
                        const line = availabilityByIndex.get(index);
                        return (_jsxs("div", { className: `client-request-items-grid__row ${availabilityClassName(line)}`, role: "row", children: [_jsx("input", { "aria-label": `Штрихкод позиции ${index + 1}`, value: item.barcode, onChange: (event) => updateItem(index, 'barcode', event.target.value), onFocus: (event) => setActiveSuggest({ index, query: event.currentTarget.value }) }), _jsx("input", { "aria-label": `Товар позиции ${index + 1}`, value: item.name, onChange: (event) => updateItem(index, 'name', event.target.value), onFocus: (event) => setActiveSuggest({ index, query: event.currentTarget.value }) }), _jsx("input", { "aria-label": `Количество позиции ${index + 1}`, min: "1", type: "number", value: item.quantity, onChange: (event) => updateItem(index, 'quantity', event.target.value) }), _jsx("input", { "aria-label": `Комментарий позиции ${index + 1}`, value: item.comment, onChange: (event) => updateItem(index, 'comment', event.target.value) }), _jsx("button", { className: "icon-button client-request-row-remove", disabled: items.length === 1, type: "button", onClick: () => removeItem(index), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", "aria-label": `Удалить позицию ${index + 1}`, children: _jsx(Trash2, { size: 15, "aria-hidden": "true" }) }), activeSuggest?.index === index && suggestions.length > 0 ? (_jsx("div", { className: "client-request-sku-suggestions", children: suggestions.map((sku) => (_jsxs("button", { type: "button", onClick: () => selectSku(index, sku), children: [_jsx("strong", { children: sku.internalSku }), _jsx("span", { children: sku.name }), _jsx("small", { children: [sku.article, sku.barcode || 'без штрихкода', `${sku.availableQuantity} шт.`].filter(Boolean).join(' · ') })] }, sku.skuId))) })) : null, activeSuggest?.index === index && isSuggesting ? (_jsx("small", { className: "client-request-sku-suggestions-status", children: "\u0418\u0449\u0443 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B." })) : null, line ? _jsx("small", { className: "client-request-item-availability", children: availabilityText(line) }) : null] }, index));
                    }), visibleItems.length === 0 ? (_jsxs("div", { className: "client-request-items-grid__empty", role: "status", children: [_jsx("strong", { children: "\u041F\u043E\u0437\u0438\u0446\u0438\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }), _jsx("span", { children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u0435 \u0437\u0430\u043F\u0440\u043E\u0441 \u0438\u043B\u0438 \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u0435 \u043F\u043E\u0438\u0441\u043A." }), _jsx("button", { type: "button", onClick: () => setItemSearch(''), children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0432\u0441\u0435" })] })) : null] }), _jsxs("div", { className: "client-request-paste", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0412\u0441\u0442\u0430\u0432\u043A\u0430 \u0438\u0437 Excel/CSV" }), _jsx("textarea", { value: pasteText, onChange: (event) => setPasteText(event.target.value), placeholder: "\u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434;\u0442\u043E\u0432\u0430\u0440;\u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E;\u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" })] }), _jsxs("button", { className: "secondary-action client-request-small-button", disabled: !pasteText.trim(), type: "button", onClick: applyPaste, children: [_jsx(ClipboardPaste, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438" })] })] })] }));
}
function buildStockSuggestions(result) {
    const quantitiesBySku = new Map(result.products.map((product) => [product.skuId, product.quantity]));
    const suggestions = [
        ...result.products.map((product) => ({
            skuId: product.skuId,
            internalSku: product.internalSku,
            clientSku: product.clientSku,
            article: product.article,
            color: product.color,
            size: product.size,
            name: product.name,
            barcode: product.barcode ?? '',
            availableQuantity: product.quantity,
        })),
        ...result.barcodes.map((barcode) => ({
            skuId: barcode.skuId,
            internalSku: barcode.internalSku,
            clientSku: barcode.clientSku,
            article: barcode.article,
            color: barcode.color,
            size: barcode.size,
            name: barcode.name,
            barcode: barcode.value,
            availableQuantity: quantitiesBySku.get(barcode.skuId) ?? 0,
        })),
    ];
    return uniqueStockSuggestions(suggestions)
        .sort((left, right) => right.availableQuantity - left.availableQuantity);
}
function matchesItemSearch(item, rawQuery) {
    const query = normalizeItemSearch(rawQuery);
    if (!query) {
        return true;
    }
    const values = [
        item.barcode,
        item.name,
        item.internalSku,
        item.clientSku,
        item.article,
        item.color,
        item.size,
    ];
    const searchIndex = normalizeItemSearch(values.filter(Boolean).join(' '));
    const compactQuery = query.replace(/\s+/g, '');
    return searchIndex.includes(query) || searchIndex.replace(/\s+/g, '').includes(compactQuery);
}
function normalizeItemSearch(value) {
    return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}
function normalizeDatabaseQuantity(value) {
    const quantity = Number(value ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return 1;
    }
    return Math.floor(quantity);
}
function stockSuggestionKey(sku) {
    return `${sku.skuId}:${sku.barcode || 'no-barcode'}`;
}
function uniqueStockSuggestions(suggestions) {
    const seen = new Set();
    const result = [];
    for (const suggestion of suggestions) {
        const key = `${suggestion.skuId}:${suggestion.barcode}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(suggestion);
    }
    return result;
}
function availabilityClassName(line) {
    if (!line) {
        return '';
    }
    if (!line.canFulfill) {
        return 'client-request-items-grid__row--shortage';
    }
    return line.conflicts.length > 0 ? 'client-request-items-grid__row--reserved' : 'client-request-items-grid__row--ok';
}
function availabilityText(line) {
    const conflictText = line.conflicts.length
        ? ` Участвует в заявке: ${line.conflicts
            .slice(0, 2)
            .map((conflict) => `${conflict.title} от ${new Date(conflict.createdAt).toLocaleDateString('ru-RU')} (${conflict.type})`)
            .join('; ')}.`
        : '';
    if (!line.skuId) {
        return `Товар не найден в остатках клиента. Удалите строку или укажите другой штрихкод.`;
    }
    if (!line.canFulfill) {
        return `Недостаточно: нужно ${line.requestedQuantity}, доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${conflictText}`;
    }
    return `Доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${conflictText}`;
}
