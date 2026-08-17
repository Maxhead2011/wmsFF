import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ImageOff, X } from 'lucide-react';
import './catalog.css';
export function ProductCardModal({ sku, onClose }) {
    return (_jsx("div", { className: "catalog-modal-backdrop", role: "presentation", children: _jsxs("section", { className: "catalog-modal", "aria-label": "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430", role: "dialog", "aria-modal": "true", children: [_jsxs("header", { className: "catalog-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: sku.client ? `${sku.client.code} · ${sku.client.name}` : 'Карточка товара' }), _jsx("h3", { children: sku.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "catalog-modal__body", children: [_jsxs("aside", { className: "catalog-modal__media", children: [_jsx(ProductPhoto, { sku: sku, large: true }), _jsxs("div", { className: "catalog-photo-strip", children: [sku.marketplacePhotos.map((photo, index) => (_jsx("img", { alt: `${sku.name} ${index + 1}`, src: photo, loading: index < 4 ? 'eager' : 'lazy' }, photo))), sku.marketplacePhotos.length === 0 ? _jsx("span", { children: "\u0424\u043E\u0442\u043E \u0438\u0437 API \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }) : null] })] }), _jsxs("div", { className: "catalog-readonly-card", children: [_jsxs("dl", { className: "catalog-readonly-facts", children: [_jsx(Fact, { label: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU", value: sku.internalSku }), _jsx(Fact, { label: "SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430", value: sku.clientSku }), _jsx(Fact, { label: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B", value: sku.article }), _jsx(Fact, { label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434", value: primaryBarcode(sku) }), _jsx(Fact, { label: "\u0411\u0440\u0435\u043D\u0434", value: sku.brand }), _jsx(Fact, { label: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", value: sku.category }), _jsx(Fact, { label: "\u0426\u0432\u0435\u0442", value: sku.color }), _jsx(Fact, { label: "\u0420\u0430\u0437\u043C\u0435\u0440", value: sku.size }), _jsx(Fact, { label: "\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B", value: formatDimensions(sku) }), _jsx(Fact, { label: "\u0412\u0435\u0441", value: formatNumber(sku.weightGrams, 'г') }), _jsx(Fact, { label: "\u041B\u0438\u0442\u0440\u0430\u0436", value: formatNumber(sku.volumeLiters, 'л') }), _jsx(Fact, { label: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441", value: sku.marketplace ?? 'WMS' })] }), _jsxs("section", { className: "catalog-detail-section", children: [_jsx("h4", { children: "\u041F\u0440\u0438\u0437\u043D\u0430\u043A\u0438" }), _jsx("p", { className: "catalog-muted", children: skuFlags(sku).join(', ') || 'Без специальных признаков' })] })] })] })] }) }));
}
function ProductPhoto({ large = false, sku }) {
    const photo = sku.marketplacePhotos[0];
    if (!photo) {
        return (_jsx("span", { className: large ? 'catalog-photo catalog-photo--large catalog-photo--empty' : 'catalog-photo catalog-photo--empty', children: _jsx(ImageOff, { size: large ? 30 : 18, "aria-hidden": "true" }) }));
    }
    return _jsx("img", { className: large ? 'catalog-photo catalog-photo--large' : 'catalog-photo', alt: sku.name, src: photo, loading: large ? 'eager' : 'lazy' });
}
function Fact({ label, value }) {
    return (_jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value === null || value === undefined || value === '' ? '-' : String(value) })] }));
}
function primaryBarcode(sku) {
    return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}
function formatDimensions(sku) {
    if (!sku.lengthCm || !sku.widthCm || !sku.heightCm) {
        return '-';
    }
    return `${sku.lengthCm} x ${sku.widthCm} x ${sku.heightCm} см`;
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
