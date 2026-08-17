import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2 } from 'lucide-react';
import { stockStatusLabel } from '../client-cabinet/clientCabinetFormat';
export function TransferPreview({ balance, toBoxCode }) {
    return (_jsxs("div", { className: "transfer-preview", children: [_jsxs("div", { children: [_jsx("span", { children: "SKU" }), _jsx("strong", { children: balance.sku.internalSku }), _jsx("p", { children: balance.sku.name })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041E\u0442\u043A\u0443\u0434\u0430" }), _jsx("strong", { children: balance.box?.code ?? '-' }), _jsxs("p", { children: [balance.quantity, " \u0448\u0442. \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E"] })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041A\u0443\u0434\u0430" }), _jsx("strong", { children: toBoxCode.trim() || '-' }), _jsx("p", { children: stockStatusLabel(balance.status) })] })] }));
}
export function TransferResult({ result }) {
    return (_jsxs("div", { className: "transfer-result", children: [_jsx(CheckCircle2, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: result.status === 'APPLIED' ? 'Перенос применен' : 'Операция уже была применена' }), _jsxs("span", { children: [result.fromBox ?? '-', " ", '->', " ", result.toBox ?? '-', " \u00B7 ", result.quantity ?? 0, " \u0448\u0442."] })] })] }));
}
