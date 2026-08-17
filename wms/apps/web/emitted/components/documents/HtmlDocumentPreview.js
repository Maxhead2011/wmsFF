import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Download, Printer, X } from 'lucide-react';
import './document-preview.css';
export function HtmlDocumentPreview({ title, fileName, html, onClose }) {
    function openPrintableDocument() {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            return;
        }
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
    }
    function downloadHtml() {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        window.URL.revokeObjectURL(url);
    }
    return (_jsx("div", { className: "document-preview-backdrop", role: "dialog", "aria-modal": "true", "aria-label": title, children: _jsxs("section", { className: "document-preview-modal", children: [_jsxs("header", { className: "document-preview-modal__header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" }), _jsx("h2", { children: title })] }), _jsxs("div", { className: "document-preview-modal__actions", children: [_jsx("button", { className: "icon-button", type: "button", onClick: downloadHtml, title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C HTML", "aria-label": "\u0421\u043A\u0430\u0447\u0430\u0442\u044C HTML", children: _jsx(Download, { size: 18, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button", type: "button", onClick: openPrintableDocument, title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0435\u0447\u0430\u0442\u044C", "aria-label": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0435\u0447\u0430\u0442\u043D\u044B\u0439 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442", children: _jsx(Printer, { size: 18, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] })] }), _jsx("iframe", { className: "document-preview-frame", title: title, srcDoc: html })] }) }));
}
