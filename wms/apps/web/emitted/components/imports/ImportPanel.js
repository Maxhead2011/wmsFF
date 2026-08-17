import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Truck, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { LogisticsImportForm } from './LogisticsImportForm';
import { StockImportForm } from './StockImportForm';
const importTabs = [
    { id: 'stock', label: 'Остатки', permission: 'imports:write', icon: Upload },
    { id: 'logistics', label: 'Тарифы логистики', permission: 'logistics:write', icon: Truck },
];
export function ImportPanel({ session }) {
    const [activeTab, setActiveTab] = useState('stock');
    const availableTabs = useMemo(() => importTabs.filter((tab) => canUse(session.user, tab.permission)), [session.user]);
    const activeTabMeta = availableTabs.find((tab) => tab.id === activeTab);
    useEffect(() => {
        if (availableTabs.length > 0 && !activeTabMeta) {
            setActiveTab(availableTabs[0].id);
        }
    }, [activeTabMeta, availableTabs]);
    if (availableTabs.length === 0) {
        return null;
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u043C\u0438", title: "\u0418\u043C\u043F\u043E\u0440\u0442", description: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u043A\u0430\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C. \u0424\u043E\u0440\u043C\u0430\u0442 \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0444\u0430\u0439\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0431\u043E\u0440\u0430 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.", tiles: availableTabs.map((tab) => ({ title: tab.label, description: tab.id === 'stock' ? 'Загрузка остатков из XLSX с проверкой строк.' : 'Загрузка и обновление тарифов доставки.', icon: tab.icon, tone: tab.id === 'stock' ? 'green' : 'orange' })), children: _jsxs("section", { className: "import-panel", "aria-label": "\u0418\u043C\u043F\u043E\u0440\u0442 XLSX", children: [_jsx("div", { className: "section-heading import-panel__heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0418\u043C\u043F\u043E\u0440\u0442 XLSX" }), _jsx("h2", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0434\u0430\u043D\u043D\u044B\u0445" })] }) }), _jsx("div", { className: "import-tabs", role: "tablist", "aria-label": "\u0422\u0438\u043F \u0438\u043C\u043F\u043E\u0440\u0442\u0430", children: availableTabs.map((tab) => (_jsxs("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), role: "tab", type: "button", children: [_jsx(tab.icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id))) }), activeTab === 'stock' ? _jsx(StockImportForm, { session: session }) : null, activeTab === 'logistics' ? _jsx(LogisticsImportForm, { session: session }) : null] }) }));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
