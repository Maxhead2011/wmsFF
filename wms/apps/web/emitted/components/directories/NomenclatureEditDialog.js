import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Save, X } from 'lucide-react';
import { useState } from 'react';
import { updateNomenclatureItem, } from '../../lib/api';
export function NomenclatureEditDialog({ session, item, onClose, onSaved }) {
    const [form, setForm] = useState(() => formFromItem(item));
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const saved = await updateNomenclatureItem(session.accessToken, item.id, payloadFromForm(form));
            onSaved(saved);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить номенклатуру.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx("div", { className: "nomenclature-edit-backdrop", role: "dialog", "aria-modal": "true", "aria-label": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B", children: _jsxs("form", { className: "nomenclature-edit-dialog", onSubmit: (event) => void submit(event), children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "\u041E\u0431\u0449\u0430\u044F \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430" }), _jsx("h3", { children: item.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "nomenclature-edit-dialog__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 SKU" }), _jsx("input", { required: true, value: form.internalSku, onChange: (event) => setForm({ ...form, internalSku: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("input", { value: form.barcode, onChange: (event) => setForm({ ...form, barcode: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" }), _jsx("input", { value: form.article, onChange: (event) => setForm({ ...form, article: event.target.value }) })] }), _jsxs("label", { className: "nomenclature-edit-dialog__wide", children: [_jsx("span", { children: "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u043F\u0435\u0447\u0430\u0442\u0438" }), _jsx("input", { value: form.printName, onChange: (event) => setForm({ ...form, printName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("input", { value: form.unit, onChange: (event) => setForm({ ...form, unit: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B" }), _jsx("input", { value: form.itemType, onChange: (event) => setForm({ ...form, itemType: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0432\u0435\u0442" }), _jsx("input", { value: form.color, onChange: (event) => setForm({ ...form, color: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("input", { value: form.size, onChange: (event) => setForm({ ...form, size: event.target.value }) })] }), _jsxs("label", { className: "directory-checkbox nomenclature-edit-dialog__wide", children: [_jsx("input", { checked: form.needsChestnyZnak, type: "checkbox", onChange: (event) => setForm({ ...form, needsChestnyZnak: event.target.checked }) }), _jsx("span", { children: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u041A\u0418\u0417 \u00AB\u0427\u0435\u0441\u0442\u043D\u044B\u0439 \u0437\u043D\u0430\u043A\u00BB" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", onClick: onClose, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", disabled: isSubmitting, type: "submit", children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохраняю' : 'Сохранить изменения' })] })] })] }) }));
}
function formFromItem(item) {
    return {
        internalSku: item.internalSku,
        article: item.article ?? '',
        barcode: item.barcode ?? '',
        name: item.name,
        printName: item.printName ?? '',
        unit: item.unit ?? '',
        itemType: item.itemType ?? '',
        color: item.color ?? '',
        size: item.size ?? '',
        needsChestnyZnak: item.needsChestnyZnak,
    };
}
function payloadFromForm(form) {
    return {
        internalSku: form.internalSku.trim(),
        article: form.article.trim(),
        barcode: form.barcode.trim(),
        name: form.name.trim(),
        printName: form.printName.trim(),
        unit: form.unit.trim(),
        itemType: form.itemType.trim(),
        color: form.color.trim(),
        size: form.size.trim(),
        needsChestnyZnak: form.needsChestnyZnak,
    };
}
