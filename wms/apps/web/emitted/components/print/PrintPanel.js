import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeft, Boxes, ChevronRight, FileText, Layers3, ListChecks, Network, Package, Printer } from 'lucide-react';
import { useState } from 'react';
import { BoxLabelForm } from './BoxLabelForm';
import { LabelTemplatePanel } from './LabelTemplatePanel';
import { PalletLabelForm } from './PalletLabelForm';
import './print.css';
import { PrintJobPanel } from './PrintJobPanel';
import { PrintPrinterPanel } from './PrintPrinterPanel';
import { SkuLabelForm } from './SkuLabelForm';
import { StickerSetPanel } from './StickerSetPanel';
const printTabs = [
    { id: 'box', label: 'Короб', icon: Boxes },
    { id: 'sku', label: 'SKU', icon: Package },
    { id: 'pallet', label: 'Паллета', icon: Layers3 },
    { id: 'sets', label: 'Наборы', icon: Package },
    { id: 'templates', label: 'Шаблоны', icon: FileText },
    { id: 'printers', label: 'Принтеры', icon: Network },
    { id: 'jobs', label: 'Задания', icon: ListChecks },
];
export function PrintPanel({ session }) {
    const [activeTab, setActiveTab] = useState(null);
    if (!canUse(session.user, 'print:write')) {
        return null;
    }
    return (_jsxs("section", { className: "print-panel", "aria-label": "\u041F\u0435\u0447\u0430\u0442\u044C \u044D\u0442\u0438\u043A\u0435\u0442\u043E\u043A", children: [_jsxs("div", { className: "section-heading print-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u0435\u0447\u0430\u0442\u044C" }), _jsx("h2", { children: "\u041F\u0435\u0447\u0430\u0442\u044C \u044D\u0442\u0438\u043A\u0435\u0442\u043E\u043A" })] }), _jsx(Printer, { size: 20, "aria-hidden": "true" })] }), !activeTab ? _jsx("div", { className: "print-topic-grid", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u043F\u0435\u0447\u0430\u0442\u0438", children: printTabs.map((tab) => { const Icon = tab.icon; return _jsxs("button", { className: `print-topic-tile print-topic-tile--${tab.id}`, type: "button", onClick: () => setActiveTab(tab.id), children: [_jsx("span", { className: "print-topic-tile__icon", children: _jsx(Icon, { size: 22 }) }), _jsxs("span", { className: "print-topic-tile__content", children: [_jsx("small", { children: "\u041F\u0435\u0447\u0430\u0442\u044C" }), _jsx("strong", { children: tab.label }), _jsx("span", { children: printTopicDescription(tab.id) })] }), _jsx(ChevronRight, { size: 22 })] }, tab.id); }) }) : null, activeTab ? _jsxs("div", { className: "print-tabs", role: "tablist", "aria-label": "\u0422\u0438\u043F \u044D\u0442\u0438\u043A\u0435\u0442\u043A\u0438", children: [_jsxs("button", { className: "print-tabs__back", type: "button", onClick: () => setActiveTab(null), children: [_jsx(ArrowLeft, { size: 16 }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B" })] }), printTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (_jsxs("button", { className: activeTab === tab.id ? 'active' : '', type: "button", onClick: () => setActiveTab(tab.id), children: [_jsx(Icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id));
                    })] }) : null, activeTab === 'box' ? _jsx(BoxLabelForm, { session: session }) : null, activeTab === 'sku' ? _jsx(SkuLabelForm, { session: session }) : null, activeTab === 'pallet' ? _jsx(PalletLabelForm, { session: session }) : null, activeTab === 'sets' ? _jsx(StickerSetPanel, { session: session }) : null, activeTab === 'templates' ? _jsx(LabelTemplatePanel, { session: session }) : null, activeTab === 'printers' ? _jsx(PrintPrinterPanel, { session: session }) : null, activeTab === 'jobs' ? _jsx(PrintJobPanel, { session: session }) : null] }));
}
function printTopicDescription(tab) {
    if (tab === 'box')
        return 'Создание и печать этикетки для складского короба.';
    if (tab === 'sku')
        return 'Этикетки товара с названием, артикулом и штрихкодом.';
    if (tab === 'pallet')
        return 'Маркировка паллет и паллет-сортов.';
    if (tab === 'sets')
        return 'Серийные ШК и QR для коробов с префиксом и счётчиком.';
    if (tab === 'templates')
        return 'Настройка макетов этикеток для вашей ВМС.';
    if (tab === 'printers')
        return 'Подключённые принтеры и их параметры.';
    return 'Очередь заданий, статус и история печати.';
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
