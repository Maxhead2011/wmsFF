import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileText, History, Pencil, Plus, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createLabelTemplate, fetchLabelTemplateVersions, fetchLabelTemplates, previewLabelTemplate, updateLabelTemplate, } from '../../lib/api';
import { extractTemplateVariables, sampleVariableValue } from './templateVariables';
import { TsplPreviewCard } from './TsplPreviewCard';
const typeOptions = [
    { value: 'BOX', label: 'Короб' },
    { value: 'SKU', label: 'SKU' },
    { value: 'PALLET', label: 'Паллета' },
    { value: 'CUSTOM', label: 'Произвольный' },
];
const defaultTspl = [
    'SIZE 80 mm,50 mm',
    'GAP 2 mm,0',
    'CLS',
    'TEXT 40,35,"3",0,1,1,"{{clientName}}"',
    'BARCODE 40,95,"128",90,1,0,2,2,"{{boxCode}}"',
    'TEXT 40,205,"3",0,1,1,"Короб: {{boxCode}}"',
    'PRINT 1',
].join('\n');
export function LabelTemplatePanel({ session }) {
    const [templates, setTemplates] = useState([]);
    const [versions, setVersions] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [editingTemplateId, setEditingTemplateId] = useState('');
    const [code, setCode] = useState('BOX_MAIN');
    const [name, setName] = useState('Короб основная');
    const [type, setType] = useState('BOX');
    const [description, setDescription] = useState('');
    const [widthMm, setWidthMm] = useState('80');
    const [heightMm, setHeightMm] = useState('50');
    const [tspl, setTspl] = useState(defaultTspl);
    const [isActive, setIsActive] = useState(true);
    const [changeReason, setChangeReason] = useState('');
    const [variableValues, setVariableValues] = useState({});
    const [preview, setPreview] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSaving, setSaving] = useState(false);
    const [isPreviewing, setPreviewing] = useState(false);
    const [isLoadingVersions, setLoadingVersions] = useState(false);
    const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedId) ?? null, [selectedId, templates]);
    const selectedVariables = useMemo(() => extractTemplateVariables(selectedTemplate?.tspl ?? ''), [selectedTemplate?.tspl]);
    const selectedVariableKey = selectedVariables.join('|');
    useEffect(() => {
        void loadTemplates();
    }, [session.accessToken]);
    useEffect(() => {
        if (selectedId) {
            void loadTemplateVersions(selectedId);
        }
        else {
            setVersions([]);
        }
    }, [selectedId, session.accessToken]);
    useEffect(() => {
        setVariableValues((current) => {
            const nextValues = {};
            selectedVariables.forEach((variable) => {
                nextValues[variable] = current[variable] ?? sampleVariableValue(variable);
            });
            return nextValues;
        });
        setPreview(null);
    }, [selectedVariableKey]);
    async function loadTemplates() {
        setLoading(true);
        setError('');
        setMessage('');
        try {
            const list = await fetchLabelTemplates(session.accessToken);
            setTemplates(list);
            setSelectedId((current) => (current && list.some((template) => template.id === current) ? current : list[0]?.id || ''));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить шаблоны этикеток.');
        }
        finally {
            setLoading(false);
        }
    }
    async function loadTemplateVersions(templateId) {
        setLoadingVersions(true);
        try {
            const list = await fetchLabelTemplateVersions(session.accessToken, templateId);
            setVersions(list);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю версий.');
        }
        finally {
            setLoadingVersions(false);
        }
    }
    async function submitTemplate(event) {
        event.preventDefault();
        setSaving(true);
        setError('');
        setMessage('');
        const payload = {
            code: code.trim(),
            name: name.trim(),
            type,
            description: description.trim() || undefined,
            widthMm: parsePositiveInteger(widthMm, 80),
            heightMm: parsePositiveInteger(heightMm, 50),
            tspl,
            isActive,
        };
        try {
            const saved = editingTemplateId
                ? await updateLabelTemplate(session.accessToken, editingTemplateId, {
                    ...payload,
                    changeReason: changeReason.trim() || 'Изменение шаблона из web-интерфейса',
                })
                : await createLabelTemplate(session.accessToken, payload);
            setTemplates((current) => [saved, ...current.filter((template) => template.id !== saved.id)]);
            setSelectedId(saved.id);
            setEditingTemplateId('');
            setChangeReason('');
            setMessage(`Шаблон сохранен как версия ${saved.version}.`);
            await loadTemplateVersions(saved.id);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить шаблон.');
        }
        finally {
            setSaving(false);
        }
    }
    async function previewSelectedTemplate(event) {
        event.preventDefault();
        if (!selectedTemplate) {
            return;
        }
        setPreviewing(true);
        setError('');
        setMessage('');
        setPreview(null);
        try {
            const nextPreview = await previewLabelTemplate(session.accessToken, selectedTemplate.id, {
                variables: variableValues,
            });
            setPreview(nextPreview);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось подготовить preview шаблона.');
        }
        finally {
            setPreviewing(false);
        }
    }
    function startEdit(template) {
        setEditingTemplateId(template.id);
        setCode(template.code);
        setName(template.name);
        setType(template.type);
        setDescription(template.description ?? '');
        setWidthMm(String(template.widthMm));
        setHeightMm(String(template.heightMm));
        setTspl(template.tspl);
        setIsActive(template.isActive);
        setChangeReason('');
        setPreview(null);
        setMessage(`Редактируется ${template.code}, текущая версия ${template.version}.`);
        setError('');
    }
    function loadVersionIntoForm(version) {
        setEditingTemplateId(version.templateId);
        setCode(version.code);
        setName(version.name);
        setType(version.type);
        setDescription(version.description ?? '');
        setWidthMm(String(version.widthMm));
        setHeightMm(String(version.heightMm));
        setTspl(version.tspl);
        setIsActive(version.isActive);
        setChangeReason(`Возврат к версии ${version.version}`);
        setPreview(null);
    }
    function resetCreateForm() {
        setEditingTemplateId('');
        setCode('BOX_MAIN');
        setName('Короб основная');
        setType('BOX');
        setDescription('');
        setWidthMm('80');
        setHeightMm('50');
        setTspl(defaultTspl);
        setIsActive(true);
        setChangeReason('');
        setPreview(null);
        setMessage('');
        setError('');
    }
    const canSave = Boolean(code.trim() && name.trim() && tspl.trim());
    const canPreview = Boolean(selectedTemplate);
    const safeFileName = `${selectedTemplate?.code ?? 'template'}-v${selectedTemplate?.version ?? 1}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');
    return (_jsxs("div", { className: "print-template-layout", children: [_jsxs("form", { className: "print-form print-template-create", onSubmit: submitTemplate, children: [_jsxs("div", { className: "print-template-header", children: [_jsxs("div", { children: [_jsx("h3", { children: editingTemplateId ? 'Редактирование шаблона' : 'Новый шаблон' }), _jsx("span", { children: editingTemplateId ? 'Сохранение создаст следующую версию' : 'TSPL с переменными вида {{clientName}}' })] }), _jsxs("button", { className: "review-action", type: "button", onClick: resetCreateForm, children: [_jsx(Plus, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u043E\u0432\u044B\u0439" })] })] }), _jsxs("div", { className: "print-fields print-fields--template", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434" }), _jsx("input", { value: code, onChange: (event) => setCode(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F" }), _jsx("select", { value: type, onChange: (event) => setType(event.target.value), children: typeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0428\u0438\u0440\u0438\u043D\u0430, \u043C\u043C" }), _jsx("input", { min: "20", max: "150", step: "1", type: "number", value: widthMm, onChange: (event) => setWidthMm(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u044B\u0441\u043E\u0442\u0430, \u043C\u043C" }), _jsx("input", { min: "20", max: "150", step: "1", type: "number", value: heightMm, onChange: (event) => setHeightMm(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("input", { value: description, onChange: (event) => setDescription(event.target.value) })] })] }), _jsx("div", { className: "print-switches", children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: isActive, onChange: (event) => setIsActive(event.target.checked) }), _jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D" })] }) }), editingTemplateId ? (_jsxs("label", { className: "print-template-editor", children: [_jsx("span", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F" }), _jsx("input", { value: changeReason, onChange: (event) => setChangeReason(event.target.value) })] })) : null, _jsxs("label", { className: "print-template-editor", children: [_jsx("span", { children: "TSPL \u0448\u0430\u0431\u043B\u043E\u043D" }), _jsx("textarea", { value: tspl, onChange: (event) => setTspl(event.target.value), required: true })] }), _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: !canSave || isSaving, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSaving ? 'Сохраняю' : editingTemplateId ? 'Сохранить версию' : 'Сохранить шаблон' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadTemplates(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A" })] })] })] }), _jsxs("form", { className: "print-form print-template-preview", onSubmit: previewSelectedTemplate, children: [_jsx("div", { className: "print-template-header", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0448\u0430\u0431\u043B\u043E\u043D\u0430" }), _jsxs("span", { children: [templates.length, " \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E"] })] }) }), _jsx("div", { className: "print-fields print-fields--template-preview", children: _jsxs("label", { children: [_jsx("span", { children: "\u0428\u0430\u0431\u043B\u043E\u043D" }), _jsxs("select", { value: selectedId, onChange: (event) => setSelectedId(event.target.value), disabled: isLoading, children: [templates.length === 0 ? _jsx("option", { value: "", children: "\u0428\u0430\u0431\u043B\u043E\u043D\u043E\u0432 \u043D\u0435\u0442" }) : null, templates.map((template) => (_jsxs("option", { value: template.id, children: [template.code, " - ", template.name, " \u00B7 v", template.version] }, template.id)))] })] }) }), selectedTemplate ? (_jsxs("div", { className: "print-template-card", children: [_jsxs("div", { className: "print-template-card__top", children: [_jsxs("span", { className: "status status--ready", children: ["v", selectedTemplate.version] }), _jsxs("button", { className: "review-action", type: "button", onClick: () => startEdit(selectedTemplate), children: [_jsx(Pencil, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] })] }), _jsx("strong", { children: selectedTemplate.name }), _jsxs("small", { children: [selectedTemplate.widthMm, " x ", selectedTemplate.heightMm, " \u043C\u043C \u00B7 ", selectedTemplate.type] }), _jsx("small", { children: selectedTemplate.isActive ? 'Активен' : 'Отключен' })] })) : null, selectedVariables.length > 0 ? (_jsx("div", { className: "print-template-vars", children: selectedVariables.map((variable) => (_jsxs("label", { children: [_jsx("span", { children: variable }), _jsx("input", { value: variableValues[variable] ?? '', onChange: (event) => setVariableValues((current) => ({
                                        ...current,
                                        [variable]: event.target.value,
                                    })) })] }, variable))) })) : (_jsx("p", { className: "panel-message", children: "\u0412 \u0448\u0430\u0431\u043B\u043E\u043D\u0435 \u043D\u0435\u0442 \u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445, \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0431\u0435\u0437 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F." })), (error || message) ? _jsx("p", { className: error ? 'form-error' : 'inline-status', children: error || message }) : null, _jsx("div", { className: "print-actions", children: _jsxs("button", { className: "primary-button", type: "submit", disabled: !canPreview || isPreviewing, children: [_jsx(FileText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isPreviewing ? 'Готовлю' : 'Предпросмотр TSPL' })] }) }), preview ? _jsx(TsplPreviewCard, { preview: preview, fileName: safeFileName }) : null, _jsxs("div", { className: "print-template-history", children: [_jsxs("div", { className: "print-template-history__header", children: [_jsx(History, { size: 16, "aria-hidden": "true" }), _jsx("strong", { children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0432\u0435\u0440\u0441\u0438\u0439" }), isLoadingVersions ? _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430" }) : null] }), versions.length === 0 ? _jsx("p", { className: "panel-message", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u0430\u044F." }) : null, versions.map((version) => (_jsxs("div", { className: "print-template-version", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["v", version.version, " \u00B7 ", version.code] }), _jsx("small", { children: formatDate(version.createdAt) }), version.changeReason ? _jsx("small", { children: version.changeReason }) : null] }), _jsxs("button", { className: "review-action", type: "button", onClick: () => loadVersionIntoForm(version), children: [_jsx(Pencil, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0412 \u0444\u043E\u0440\u043C\u0443" })] })] }, version.id)))] })] })] }));
}
function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function formatDate(value) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}
