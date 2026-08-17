import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ImageOff, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchNomenclature } from '../../lib/api';
import { NomenclatureEditDialog } from './NomenclatureEditDialog';
export function SkuDirectoryTable({ session, reloadKey }) {
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [localReloadKey, setLocalReloadKey] = useState(0);
    const [skus, setSkus] = useState([]);
    const [selectedSku, setSelectedSku] = useState(null);
    const [editingSku, setEditingSku] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    useEffect(() => {
        let isActive = true;
        async function loadSkus() {
            setLoading(true);
            setError('');
            try {
                const list = await fetchNomenclature(session.accessToken, {
                    search: appliedSearch || undefined,
                });
                if (isActive) {
                    setSkus(list);
                    setSelectedSku((current) => (current ? list.find((sku) => sku.id === current.id) ?? null : null));
                }
            }
            catch (caught) {
                if (isActive) {
                    setError(caught instanceof Error ? caught.message : 'Не удалось загрузить номенклатуру.');
                }
            }
            finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        }
        void loadSkus();
        return () => {
            isActive = false;
        };
    }, [appliedSearch, localReloadKey, reloadKey, session.accessToken]);
    function applySearch(event) {
        event.preventDefault();
        setAppliedSearch(search.trim());
    }
    function acceptEditedSku(saved) {
        setSkus((current) => current.map((sku) => (sku.id === saved.id ? saved : sku)));
        setSelectedSku((current) => (current?.id === saved.id ? saved : current));
        setEditingSku(null);
    }
    return (_jsxs("div", { className: "client-table-block", children: [_jsx("div", { className: "directory-subheading", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430" }), _jsx("span", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 100 \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u043E\u0431\u0449\u0435\u0433\u043E \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0430" })] }) }), _jsxs("form", { className: "sku-table-toolbar", onSubmit: applySearch, children: [_jsxs("label", { className: "directory-select-row", children: [_jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A" }), _jsxs("div", { className: "sku-search-box", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0412\u0411, SKU \u0438\u043B\u0438 \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434" })] })] }), _jsxs("button", { className: "icon-text-button", type: "submit", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), "\u041D\u0430\u0439\u0442\u0438"] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => setLocalReloadKey((current) => current + 1), children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsx("div", { className: "client-table-scroll", children: _jsxs("table", { className: "client-directory-table sku-directory-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU" }), _jsx("th", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B \u0412\u0411" }), _jsx("th", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("th", { children: "\u0415\u0434." }), _jsx("th", { children: "\u0422\u0438\u043F" }), _jsx("th", { children: "\u0426\u0432\u0435\u0442" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { "aria-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsxs("tbody", { children: [skus.map((sku) => (_jsxs("tr", { className: selectedSku?.id === sku.id ? 'selected' : undefined, onClick: () => setSelectedSku(sku), onKeyDown: (event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelectedSku(sku);
                                        }
                                    }, tabIndex: 0, children: [_jsx("td", { children: sku.internalSku }), _jsx("td", { children: sku.article || '-' }), _jsxs("td", { children: [_jsx("strong", { className: "sku-directory-table__name", children: sku.name }), sku.printName ? _jsx("span", { children: sku.printName }) : null] }), _jsx("td", { children: sku.barcode || '-' }), _jsx("td", { children: sku.unit || '-' }), _jsx("td", { children: sku.itemType || '-' }), _jsx("td", { children: sku.color || '-' }), _jsx("td", { children: sku.size || '-' }), _jsx("td", { className: "sku-directory-table__actions", children: _jsx("button", { className: "icon-button", type: "button", onClick: (event) => {
                                                    event.stopPropagation();
                                                    setEditingSku(sku);
                                                }, title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "aria-label": `Редактировать ${sku.name}`, children: _jsx(Pencil, { size: 15, "aria-hidden": "true" }) }) })] }, sku.id))), skus.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 9, children: isLoading ? 'Загрузка...' : 'Номенклатура не найдена' }) })) : null] })] }) }), selectedSku ? (_jsx(SkuDetailsCard, { sku: selectedSku, onClose: () => setSelectedSku(null), onEdit: () => setEditingSku(selectedSku) })) : null, editingSku ? (_jsx(NomenclatureEditDialog, { item: editingSku, session: session, onClose: () => setEditingSku(null), onSaved: acceptEditedSku })) : null] }));
}
function SkuDetailsCard({ sku, onClose, onEdit }) {
    const details = sku;
    const dimensions = [
        { label: 'Длина', value: details.lengthCm, suffix: 'см' },
        { label: 'Ширина', value: details.widthCm, suffix: 'см' },
        { label: 'Высота', value: details.heightCm, suffix: 'см' },
        { label: 'Вес', value: details.weightGrams, suffix: 'г' },
        { label: 'Литраж', value: details.volumeLiters, suffix: 'л' },
    ];
    const properties = normalizeProperties(details.properties);
    return (_jsxs("aside", { className: "sku-details-card", "aria-label": "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430", children: [_jsx("div", { className: "sku-details-card__media", children: details.photoUrl ? (_jsx("img", { alt: details.name, src: details.photoUrl })) : (_jsxs("div", { className: "sku-details-card__placeholder", children: [_jsx(ImageOff, { size: 28, "aria-hidden": "true" }), _jsx("span", { children: "\u0424\u043E\u0442\u043E \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E" })] })) }), _jsxs("div", { className: "sku-details-card__body", children: [_jsxs("div", { className: "sku-details-card__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("h3", { children: details.name }), details.printName ? _jsx("p", { children: details.printName }) : null] }), _jsxs("div", { className: "sku-details-card__actions", children: [_jsx("button", { className: "icon-button", type: "button", onClick: onEdit, title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "aria-label": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0443", children: _jsx(Pencil, { size: 16, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443", children: _jsx(X, { size: 16, "aria-hidden": "true" }) })] })] }), _jsxs("dl", { className: "sku-details-card__facts", children: [_jsx(DetailTerm, { label: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B \u0412\u0411", value: details.article }), _jsx(DetailTerm, { label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", value: details.name }), _jsx(DetailTerm, { label: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU", value: details.internalSku }), _jsx(DetailTerm, { label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434", value: details.barcode }), _jsx(DetailTerm, { label: "\u0411\u0440\u0435\u043D\u0434", value: details.brand }), _jsx(DetailTerm, { label: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", value: details.subjectName ?? details.itemType }), _jsx(DetailTerm, { label: "\u0426\u0432\u0435\u0442", value: details.color }), _jsx(DetailTerm, { label: "\u0420\u0430\u0437\u043C\u0435\u0440", value: details.size }), _jsx(DetailTerm, { label: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430", value: details.unit }), _jsx(DetailTerm, { label: "\u0427\u0435\u0441\u0442\u043D\u044B\u0439 \u0417\u041D\u0410\u041A", value: details.needsChestnyZnak ? 'Да' : 'Нет' })] }), _jsxs("div", { className: "sku-details-card__section", children: [_jsx("h4", { children: "\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B" }), _jsx("div", { className: "sku-details-card__metrics", children: dimensions.map((dimension) => (_jsxs("div", { children: [_jsx("span", { children: dimension.label }), _jsx("strong", { children: formatDetailValue(dimension.value, dimension.suffix) })] }, dimension.label))) })] }), _jsxs("div", { className: "sku-details-card__section", children: [_jsx("h4", { children: "\u0421\u0432\u043E\u0439\u0441\u0442\u0432\u0430" }), properties.length ? (_jsx("dl", { className: "sku-details-card__properties", children: properties.map((property) => (_jsx(DetailTerm, { label: property.name, value: property.value }, property.name))) })) : (_jsx("p", { className: "sku-details-card__empty", children: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B." }))] })] })] }));
}
function DetailTerm({ label, value }) {
    return (_jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: formatDetailValue(value) })] }));
}
function normalizeProperties(properties) {
    if (!properties) {
        return [];
    }
    if (Array.isArray(properties)) {
        return properties
            .map((property) => ({ name: property.name?.trim() ?? '', value: property.value }))
            .filter((property) => property.name);
    }
    return Object.entries(properties).map(([name, value]) => ({ name, value }));
}
function formatDetailValue(value, suffix = '') {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    return `${String(value)}${suffix ? ` ${suffix}` : ''}`;
}
