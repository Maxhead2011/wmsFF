import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeft, ChevronRight, GitCompareArrows, PackagePlus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ArticleMappingPanel } from './ArticleMappingPanel';
import { ClientCreateForm } from './ClientCreateForm';
import { ClientImportForm } from './ClientImportForm';
import { ClientRequisitesForm } from './ClientRequisitesForm';
import './directories.css';
import { SkuCreateForm } from './SkuCreateForm';
import { SkuDirectoryTable } from './SkuDirectoryTable';
import { SkuImportForm } from './SkuImportForm';
const directoryTabs = [
    { id: 'clients', label: 'Клиент', permission: 'clients:write', icon: UserPlus },
    { id: 'skus', label: 'Номенклатура', permission: 'skus:write', icon: PackagePlus },
    { id: 'article-mappings', label: 'Соответствия', permission: 'skus:write', icon: GitCompareArrows },
];
export function DirectoryPanel({ session }) {
    const [activeTab, setActiveTab] = useState(null);
    const [skuReloadKey, setSkuReloadKey] = useState(0);
    const availableTabs = useMemo(() => directoryTabs.filter((tab) => canUse(session.user, tab.permission)), [session.user]);
    if (availableTabs.length === 0) {
        return null;
    }
    return (_jsxs("section", { className: "directory-panel", "aria-label": "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0438", children: [_jsx("div", { className: "section-heading directory-panel__heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0438" }), _jsx("h2", { children: "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0438" })] }) }), !activeTab ? _jsx("div", { className: "directory-topic-grid", "aria-label": "\u0422\u0435\u043C\u044B \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u043E\u0432", children: availableTabs.map((tab) => (_jsxs("button", { className: `directory-topic-tile directory-topic-tile--${tab.id}`, onClick: () => setActiveTab(tab.id), type: "button", children: [_jsx("span", { className: "directory-topic-tile__icon", children: _jsx(tab.icon, { size: 22, "aria-hidden": "true" }) }), _jsxs("span", { className: "directory-topic-tile__content", children: [_jsx("small", { children: "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A" }), _jsx("strong", { children: tab.label }), _jsx("span", { children: directoryTopicDescription(tab.id) })] }), _jsx(ChevronRight, { size: 22, "aria-hidden": "true" })] }, tab.id))) }) : null, activeTab ? _jsxs("div", { className: "directory-tabs", role: "tablist", "aria-label": "\u0422\u0438\u043F \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0430", children: [_jsxs("button", { className: "directory-tabs__back", type: "button", onClick: () => setActiveTab(null), children: [_jsx(ArrowLeft, { size: 16 }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B" })] }), availableTabs.map((tab) => (_jsxs("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), role: "tab", type: "button", children: [_jsx(tab.icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id)))] }) : null, activeTab === 'clients' ? (_jsxs("div", { className: "directory-stack", children: [_jsx(ClientImportForm, { session: session }), _jsx(ClientCreateForm, { session: session }), _jsx(ClientRequisitesForm, { session: session })] })) : null, activeTab === 'skus' ? (_jsxs("div", { className: "directory-stack", children: [_jsx(SkuImportForm, { session: session, onImported: () => setSkuReloadKey((current) => current + 1) }), _jsx(SkuCreateForm, { session: session, onCreated: () => setSkuReloadKey((current) => current + 1) }), _jsx(SkuDirectoryTable, { session: session, reloadKey: skuReloadKey })] })) : null, activeTab === 'article-mappings' ? _jsx(ArticleMappingPanel, { session: session }) : null] }));
}
function directoryTopicDescription(tab) {
    if (tab === 'clients')
        return 'Карточки клиентов, реквизиты и загрузка данных из файлов.';
    if (tab === 'skus')
        return 'Товары, штрихкоды, размеры, карточки и импорт номенклатуры.';
    return 'Связи старых и новых артикулов для корректной переклейки и остатков.';
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
