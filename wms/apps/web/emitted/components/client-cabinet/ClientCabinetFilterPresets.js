import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bookmark, Check, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clientCabinetFilterPresetKey, loadClientCabinetFilterPresets, saveClientCabinetFilterPresets, } from './clientCabinetFilterPresetStorage';
export function ClientCabinetFilterPresets({ userId, clientId, value, onApply }) {
    const storageKey = useMemo(() => clientCabinetFilterPresetKey(userId, clientId), [clientId, userId]);
    const [presets, setPresets] = useState([]);
    const [selectedPresetId, setSelectedPresetId] = useState('');
    const [presetName, setPresetName] = useState('');
    const [message, setMessage] = useState('');
    const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
    const hasActiveFilters = Object.values(value).some(Boolean);
    useEffect(() => {
        const nextPresets = loadClientCabinetFilterPresets(storageKey);
        setPresets(nextPresets);
        setSelectedPresetId(nextPresets[0]?.id ?? '');
        setPresetName('');
        setMessage('');
    }, [storageKey]);
    function persist(nextPresets) {
        saveClientCabinetFilterPresets(storageKey, nextPresets);
        setPresets(nextPresets);
    }
    function savePreset() {
        const name = presetName.trim();
        if (!name) {
            setMessage('Введите название представления.');
            return;
        }
        const now = new Date().toISOString();
        const existing = presets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
        const nextPreset = {
            id: existing?.id ?? createPresetId(),
            name,
            filters: value,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        const nextPresets = [nextPreset, ...presets.filter((preset) => preset.id !== nextPreset.id)].slice(0, 12);
        persist(nextPresets);
        setSelectedPresetId(nextPreset.id);
        setMessage(existing ? 'Представление обновлено.' : 'Представление сохранено.');
    }
    function applyPreset() {
        if (!selectedPreset) {
            return;
        }
        onApply(selectedPreset.filters);
        setMessage(`Применено: ${selectedPreset.name}.`);
    }
    function deletePreset() {
        if (!selectedPreset) {
            return;
        }
        const nextPresets = presets.filter((preset) => preset.id !== selectedPreset.id);
        persist(nextPresets);
        setSelectedPresetId(nextPresets[0]?.id ?? '');
        setMessage('Представление удалено.');
    }
    return (_jsxs("section", { className: "client-cabinet-presets", "aria-label": "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0444\u0438\u043B\u044C\u0442\u0440\u043E\u0432", children: [_jsxs("div", { className: "client-cabinet-presets__title", children: [_jsx(Bookmark, { size: 17, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u0438\u044F" }), _jsx("span", { children: presets.length > 0 ? `${presets.length} сохранено` : 'нет сохраненных' })] })] }), _jsxs("label", { className: "client-cabinet-presets__name", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: presetName, onChange: (event) => setPresetName(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0434\u043E\u043B\u0433\u0438 \u0437\u0430 \u043C\u0435\u0441\u044F\u0446" })] }), _jsxs("label", { className: "client-cabinet-presets__select", children: [_jsx("span", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C" }), _jsxs("select", { value: selectedPresetId, onChange: (event) => {
                            setSelectedPresetId(event.target.value);
                            setMessage('');
                        }, disabled: presets.length === 0, children: [presets.length === 0 ? _jsx("option", { value: "", children: "\u041D\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0445" }) : null, presets.map((preset) => (_jsx("option", { value: preset.id, children: preset.name }, preset.id)))] })] }), _jsxs("div", { className: "client-cabinet-presets__actions", children: [_jsxs("button", { className: "icon-text-button", type: "button", onClick: savePreset, disabled: !hasActiveFilters, children: [_jsx(Save, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: applyPreset, disabled: !selectedPreset, children: [_jsx(Check, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: deletePreset, disabled: !selectedPreset, children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] })] }), message ? _jsx("p", { className: "inline-status client-cabinet-presets__message", children: message }) : null] }));
}
function createPresetId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
