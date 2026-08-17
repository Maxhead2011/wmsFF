import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Download } from 'lucide-react';
export function TsplPreviewCard({ preview, fileName }) {
    function downloadTspl() {
        const blob = new Blob([preview.tspl], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    }
    return (_jsxs("div", { className: "print-preview", children: [_jsxs("div", { className: "print-preview__header", children: [_jsxs("div", { children: [_jsx("strong", { children: preview.printerLanguage }), _jsx("span", { children: "\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043B\u044F TSC/TSPL \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u0430" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: downloadTspl, title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C TSPL", "aria-label": "\u0421\u043A\u0430\u0447\u0430\u0442\u044C TSPL", children: _jsx(Download, { size: 18, "aria-hidden": "true" }) })] }), _jsx("textarea", { readOnly: true, value: preview.tspl, "aria-label": "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 TSPL" })] }));
}
