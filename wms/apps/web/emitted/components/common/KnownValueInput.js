import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
export function KnownValueInput({ label, value, options, placeholder, disabled, multiline, maxVisible = 12, onChange, onSelect, onSearch, }) {
    const [isOpen, setOpen] = useState(false);
    const visibleOptions = useMemo(() => filterOptions(options, value).slice(0, maxVisible), [maxVisible, options, value]);
    const hasOptions = visibleOptions.length > 0;
    function openList(nextValue = value) {
        if (disabled) {
            return;
        }
        setOpen(true);
        onSearch?.(nextValue);
    }
    function changeValue(nextValue) {
        onChange(nextValue);
        setOpen(true);
        onSearch?.(nextValue);
    }
    function selectOption(option) {
        onChange(option.value);
        onSelect?.(option);
        setOpen(false);
    }
    const control = multiline ? (_jsx("textarea", { value: value, placeholder: placeholder, disabled: disabled, onFocus: () => openList(), onChange: (event) => changeValue(event.target.value), onBlur: () => window.setTimeout(() => setOpen(false), 120) })) : (_jsx("input", { value: value, placeholder: placeholder, disabled: disabled, onFocus: () => openList(), onChange: (event) => changeValue(event.target.value), onBlur: () => window.setTimeout(() => setOpen(false), 120) }));
    return (_jsxs("label", { className: "known-value-field", children: [_jsx("span", { children: label }), _jsxs("div", { className: "known-value-control", children: [control, isOpen ? (_jsx("div", { className: "known-value-options", children: hasOptions ? (visibleOptions.map((option) => (_jsxs("button", { type: "button", onMouseDown: (event) => event.preventDefault(), onClick: () => selectOption(option), children: [_jsx("strong", { children: option.label ?? option.value }), option.description ? _jsx("small", { children: option.description }) : null] }, `${option.value}-${option.description ?? ''}`)))) : (_jsx("span", { className: "known-value-options__empty", children: "\u041D\u0435\u0442 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0445 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0439" })) })) : null] })] }));
}
function filterOptions(options, value) {
    const query = value.trim().toLowerCase();
    if (!query) {
        return options;
    }
    return options.filter((option) => [option.value, option.label, option.description].filter(Boolean).some((text) => text.toLowerCase().includes(query)));
}
