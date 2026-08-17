import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeft, ChevronRight, KeyRound, Printer, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';
import { useState } from 'react';
import './access.css';
import { TsdDeviceAdminPanel } from './TsdDeviceAdminPanel';
import { UserCreateForm } from './UserCreateForm';
import { UserRoleEditor } from './UserRoleEditor';
import { UserPrinterScopeEditor } from './UserPrinterScopeEditor';
import { UserScopeEditor } from './UserScopeEditor';
const accessTopics = [
    { id: 'create', label: 'Создать сотрудника', text: 'Новый пользователь, роль и стартовые доступы.', icon: UserPlus },
    { id: 'roles', label: 'Роли', text: 'Настройте наборы прав для должностей.', icon: KeyRound },
    { id: 'scopes', label: 'Доступы', text: 'Ограничьте клиентов, филиалы и разделы для сотрудника.', icon: ShieldCheck },
    { id: 'tsd', label: 'ТСД', text: 'Устройства, сотрудники и работа мобильного приложения.', icon: Smartphone },
    { id: 'printers', label: 'Принтеры', text: 'Кому доступна печать и на какие устройства.', icon: Printer },
];
export function AccessAdminPanel({ session }) {
    const [activeTab, setActiveTab] = useState(null);
    if (!canUse(session.user, 'users:write')) {
        return null;
    }
    return (_jsxs("section", { className: "access-panel", "aria-label": "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u044B", children: [_jsx("div", { className: "section-heading access-panel__heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "RBAC" }), _jsx("h2", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u044B" })] }) }), !activeTab ? _jsx("div", { className: "access-topic-grid", "aria-label": "\u0422\u0435\u043C\u044B \u0434\u043E\u0441\u0442\u0443\u043F\u0430", children: accessTopics.map((topic) => _jsxs("button", { className: `access-topic-tile access-topic-tile--${topic.id}`, type: "button", onClick: () => setActiveTab(topic.id), children: [_jsx("span", { className: "access-topic-tile__icon", children: _jsx(topic.icon, { size: 22 }) }), _jsxs("span", { className: "access-topic-tile__content", children: [_jsx("small", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u044B" }), _jsx("strong", { children: topic.label }), _jsx("span", { children: topic.text })] }), _jsx(ChevronRight, { size: 22 })] }, topic.id)) }) : null, activeTab ? _jsxs("div", { className: "access-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B \u0434\u043E\u0441\u0442\u0443\u043F\u0430", children: [_jsxs("button", { className: "access-tabs__back", type: "button", onClick: () => setActiveTab(null), children: [_jsx(ArrowLeft, { size: 16 }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B" })] }), _jsxs("button", { "aria-selected": activeTab === 'create', className: activeTab === 'create' ? 'active' : '', onClick: () => setActiveTab('create'), role: "tab", type: "button", children: [_jsx(UserPlus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C" })] }), _jsxs("button", { "aria-selected": activeTab === 'roles', className: activeTab === 'roles' ? 'active' : '', onClick: () => setActiveTab('roles'), role: "tab", type: "button", children: [_jsx(KeyRound, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u043E\u043B\u0438" })] }), _jsxs("button", { "aria-selected": activeTab === 'scopes', className: activeTab === 'scopes' ? 'active' : '', onClick: () => setActiveTab('scopes'), role: "tab", type: "button", children: [_jsx(ShieldCheck, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u044B" })] }), _jsxs("button", { "aria-selected": activeTab === 'tsd', className: activeTab === 'tsd' ? 'active' : '', onClick: () => setActiveTab('tsd'), role: "tab", type: "button", children: [_jsx(Smartphone, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0422\u0421\u0414" })] }), _jsxs("button", { "aria-selected": activeTab === 'printers', className: activeTab === 'printers' ? 'active' : '', onClick: () => setActiveTab('printers'), role: "tab", type: "button", children: [_jsx(Printer, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u0438\u043D\u0442\u0435\u0440\u044B" })] })] }) : null, activeTab === 'create' ? _jsx(UserCreateForm, { session: session }) : null, activeTab === 'roles' ? _jsx(UserRoleEditor, { session: session }) : null, activeTab === 'scopes' ? _jsx(UserScopeEditor, { session: session }) : null, activeTab === 'printers' ? _jsx(UserPrinterScopeEditor, { session: session }) : null, activeTab === 'tsd' ? _jsx(TsdDeviceAdminPanel, { session: session }) : null] }));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
