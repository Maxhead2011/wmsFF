import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Save } from 'lucide-react';
import { useState } from 'react';
import { createNomenclatureItem, } from '../../lib/api';
import { DirectoryResultCard } from './DirectoryResultCard';
const emptySkuForm = {
    internalSku: '',
    article: '',
    name: '',
    barcode: '',
    printName: '',
    unit: 'шт',
    itemType: '',
    color: '',
    size: '',
    needsChestnyZnak: false,
};
export function SkuCreateForm({ session, onCreated }) {
    const [form, setForm] = useState(emptySkuForm);
    const [createdSku, setCreatedSku] = useState(null);
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setCreatedSku(null);
        try {
            const created = await createNomenclatureItem(session.accessToken, compactPayload(form));
            setCreatedSku(created);
            setForm(emptySkuForm);
            onCreated?.();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать SKU.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "directory-form", onSubmit: submit, children: [_jsx("div", { className: "directory-subheading", children: _jsxs("div", { children: [_jsx("h3", { children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0443 \u0432\u0440\u0443\u0447\u043D\u0443\u044E" }), _jsx("span", { children: "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u0430 \u0441\u043E\u0437\u0434\u0430\u0435\u0442\u0441\u044F \u0432 \u043E\u0431\u0449\u0435\u043C \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0435" })] }) }), _jsxs("div", { className: "directory-fields directory-fields--sku", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU" }), _jsx("input", { value: form.internalSku, onChange: (event) => setForm({ ...form, internalSku: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("input", { value: form.barcode, onChange: (event) => setForm({ ...form, barcode: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u043F\u0435\u0447\u0430\u0442\u0438" }), _jsx("input", { value: form.printName, onChange: (event) => setForm({ ...form, printName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" }), _jsx("input", { value: form.article, onChange: (event) => setForm({ ...form, article: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("input", { value: form.unit, onChange: (event) => setForm({ ...form, unit: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B" }), _jsx("input", { value: form.itemType, onChange: (event) => setForm({ ...form, itemType: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0432\u0435\u0442" }), _jsx("input", { value: form.color, onChange: (event) => setForm({ ...form, color: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("input", { value: form.size, onChange: (event) => setForm({ ...form, size: event.target.value }) })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.needsChestnyZnak, type: "checkbox", onChange: (event) => setForm({ ...form, needsChestnyZnak: event.target.checked }) }), _jsx("span", { children: "\u0427\u0435\u0441\u0442\u043D\u044B\u0439 \u0437\u043D\u0430\u043A" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button directory-submit", type: "submit", disabled: isSubmitting, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Создать номенклатуру' })] }), createdSku ? (_jsx(DirectoryResultCard, { title: "\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430", lines: [
                    `${createdSku.internalSku} - ${createdSku.name}`,
                    createdSku.barcode ? `ШК: ${createdSku.barcode}` : 'штрихкод не задан',
                ] })) : null] }));
}
function compactPayload(form) {
    return {
        name: form.name.trim(),
        needsChestnyZnak: form.needsChestnyZnak,
        ...optionalString('internalSku', form.internalSku),
        ...optionalString('article', form.article),
        ...optionalString('barcode', form.barcode),
        ...optionalString('printName', form.printName),
        ...optionalString('unit', form.unit),
        ...optionalString('itemType', form.itemType),
        ...optionalString('color', form.color),
        ...optionalString('size', form.size),
    };
}
function optionalString(key, value) {
    const trimmed = value.trim();
    return trimmed ? { [key]: trimmed } : {};
}
