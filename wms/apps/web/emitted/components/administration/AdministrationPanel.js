import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Activity, AlertTriangle, BookOpen, Bot, Boxes, CheckCircle2, ChevronRight, CircleGauge, CloudCog, Code2, Crown, Database, Eye, EyeOff, FileClock, FileSpreadsheet, LoaderCircle, Network, Play, RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Tablet, Users, WandSparkles, Wrench, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { applyAdministrationAssistant, fetchAdministrationAudit, fetchAdministrationDocumentation, fetchAdministrationOverview, fetchAdministrationPhantomStocks, fetchAdministrationSettings, fetchAdministrationWorkspaceVisibility, optimizeAdministrationPerformance, previewAdministrationAssistant, runAdministrationMarketplaceDiagnostics, updateAdministrationSetting, updateAdministrationWorkspaceVisibility, } from '../../lib/api';
import { workspaceNav } from '../../lib/workspaces';
import './administration.css';
import { AdministrationStockCheck } from './AdministrationStockCheck';
import { AdministrationPhantomStockPanel } from './AdministrationPhantomStock';
import { AdministrationTsdWorkloadsPanel } from './AdministrationTsdWorkloads';
import { AdministrationFbsErrorCorrection } from './AdministrationFbsErrorCorrection';
const tabs = [
    { id: 'overview', label: 'Центр управления', icon: Crown },
    { id: 'error-correction', label: 'Исправление ошибок', icon: Wrench },
    { id: 'tsd-workloads', label: 'Занятые ТСД', icon: Tablet },
    { id: 'phantom-stock', label: 'Фантомные остатки', icon: AlertTriangle },
    { id: 'stock-check', label: 'Проверка остатков', icon: FileSpreadsheet },
    { id: 'settings', label: 'Настройки', icon: Settings2 },
    { id: 'integrations', label: 'API и склады', icon: CloudCog },
    { id: 'visibility', label: 'Видимость', icon: Eye },
    { id: 'assistant', label: 'ИИ-помощник', icon: Bot },
    { id: 'documentation', label: 'Схемы и инструкции', icon: BookOpen },
    { id: 'audit', label: 'Журнал изменений', icon: FileClock },
];
const metricLabels = {
    users: 'Пользователи',
    clients: 'Клиенты',
    skus: 'Карточки SKU',
    activeBoxes: 'Активные короба',
    requests: 'Заявки',
    connections: 'API-подключения',
    pendingInventory: 'Ожидают решения',
    recentChanges: 'Изменения админки',
};
const workspaceLabels = new Map(workspaceNav.map((item) => [item.id, item.title]));
export function AdministrationPanel({ session, onOpenWorkspace }) {
    const [activeTab, setActiveTab] = useState('overview');
    const [overview, setOverview] = useState(null);
    const [settings, setSettings] = useState([]);
    const [visibility, setVisibility] = useState(null);
    const [documentation, setDocumentation] = useState(null);
    const [audit, setAudit] = useState([]);
    const [diagnostics, setDiagnostics] = useState(null);
    const [optimization, setOptimization] = useState(null);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [visibilityDraft, setVisibilityDraft] = useState({});
    const [visibilityReason, setVisibilityReason] = useState('Настройка видимости рабочих разделов');
    const [assistantPrompt, setAssistantPrompt] = useState('');
    const [assistantPreview, setAssistantPreview] = useState(null);
    const [assistantConfirmation, setAssistantConfirmation] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(true);
    const [busyAction, setBusyAction] = useState('');
    const [phantomCount, setPhantomCount] = useState(0);
    const selectedUser = useMemo(() => visibility?.users.find((item) => item.id === selectedUserId) ?? null, [selectedUserId, visibility]);
    useEffect(() => {
        void loadAll();
    }, []);
    useEffect(() => {
        if (!selectedUser)
            return;
        setVisibilityDraft({ ...selectedUser.overrides });
    }, [selectedUser]);
    async function loadAll() {
        setLoading(true);
        setError('');
        try {
            const [nextOverview, nextSettings, nextVisibility, nextDocumentation, nextAudit, phantomStock] = await Promise.all([
                fetchAdministrationOverview(session.accessToken),
                fetchAdministrationSettings(session.accessToken),
                fetchAdministrationWorkspaceVisibility(session.accessToken),
                fetchAdministrationDocumentation(session.accessToken),
                fetchAdministrationAudit(session.accessToken),
                fetchAdministrationPhantomStocks(session.accessToken),
            ]);
            setOverview(nextOverview);
            setSettings(nextSettings);
            setVisibility(nextVisibility);
            setDocumentation(nextDocumentation);
            setAudit(nextAudit);
            setPhantomCount(phantomStock.summary.findings);
            setSelectedUserId((current) => current || nextVisibility.users[0]?.id || '');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function saveSetting(setting, value, reason) {
        setBusyAction(`setting:${setting.key}`);
        clearFeedback();
        try {
            await updateAdministrationSetting(session.accessToken, setting.key, value, reason);
            setMessage(`Настройка «${setting.title}» сохранена и записана в аудит.`);
            const [nextSettings, nextOverview, nextAudit] = await Promise.all([
                fetchAdministrationSettings(session.accessToken),
                fetchAdministrationOverview(session.accessToken),
                fetchAdministrationAudit(session.accessToken),
            ]);
            setSettings(nextSettings);
            setOverview(nextOverview);
            setAudit(nextAudit);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    async function runDiagnostics() {
        setBusyAction('diagnostics');
        clearFeedback();
        try {
            const result = await runAdministrationMarketplaceDiagnostics(session.accessToken);
            setDiagnostics(result);
            setMessage(`Проверено подключений: ${result.summary.checked}. Исправны: ${result.summary.healthy}.`);
            setAudit(await fetchAdministrationAudit(session.accessToken));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    async function optimizePerformance() {
        setBusyAction('optimization');
        clearFeedback();
        try {
            const result = await optimizeAdministrationPerformance(session.accessToken);
            setOptimization(result);
            setMessage(`WMS оптимизирована за ${formatMilliseconds(result.durationMs)}. Рабочие данные не изменялись.`);
            const [nextOverview, nextAudit] = await Promise.all([
                fetchAdministrationOverview(session.accessToken),
                fetchAdministrationAudit(session.accessToken),
            ]);
            setOverview(nextOverview);
            setAudit(nextAudit);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    async function saveVisibility() {
        if (!selectedUserId)
            return;
        setBusyAction('visibility');
        clearFeedback();
        try {
            const result = await updateAdministrationWorkspaceVisibility(session.accessToken, selectedUserId, visibilityDraft, visibilityReason);
            setMessage(`Видимость разделов для ${result.user.name} сохранена.`);
            const next = await fetchAdministrationWorkspaceVisibility(session.accessToken);
            setVisibility(next);
            setAudit(await fetchAdministrationAudit(session.accessToken));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    async function buildAssistantPreview() {
        setBusyAction('assistant-preview');
        clearFeedback();
        setAssistantPreview(null);
        setAssistantConfirmation('');
        try {
            setAssistantPreview(await previewAdministrationAssistant(session.accessToken, assistantPrompt));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    async function applyAssistantPreview() {
        if (!assistantPreview)
            return;
        setBusyAction('assistant-apply');
        clearFeedback();
        try {
            await applyAdministrationAssistant(session.accessToken, assistantPreview.previewId, assistantConfirmation);
            setMessage('Разрешённые действия выполнены. Результат записан в журнал.');
            setAssistantPreview(null);
            setAssistantConfirmation('');
            await loadAll();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyAction('');
        }
    }
    function clearFeedback() {
        setMessage('');
        setError('');
    }
    if (isLoading) {
        return (_jsxs("div", { className: "admin-loading", children: [_jsx(LoaderCircle, { className: "spin", size: 28 }), _jsx("strong", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0437\u0430\u0449\u0438\u0449\u0451\u043D\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0443\u0440 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F\u2026" })] }));
    }
    return (_jsxs("div", { className: "administration", children: [_jsxs("section", { className: "admin-hero", children: [_jsx("div", { className: "admin-hero__mark", children: _jsx(Crown, { size: 28 }) }), _jsxs("div", { children: [_jsx("span", { children: "\u0414\u043E\u0441\u0442\u0443\u043F \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0443" }), _jsx("h2", { children: "\u0426\u0435\u043D\u0442\u0440 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F WMS" }), _jsx("p", { children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u0438\u0441\u0442\u0435\u043C\u044B, API, \u043F\u0440\u0430\u0432\u0430 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430, \u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C\u044B \u0438 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u043F\u043E\u043C\u043E\u0449\u043D\u0438\u043A \u2014 \u0432 \u043E\u0434\u043D\u043E\u043C \u043A\u043E\u043D\u0442\u0443\u0440\u0435." })] }), _jsxs("button", { type: "button", className: "admin-button admin-button--ghost", onClick: () => void loadAll(), children: [_jsx(RefreshCw, { size: 16 }), " \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), _jsx("nav", { className: "admin-tabs", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F", children: tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (_jsxs("button", { type: "button", className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), children: [_jsx(Icon, { size: 17 }), _jsx("span", { children: tab.label }), tab.id === 'phantom-stock' && phantomCount > 0 ? (_jsx("b", { className: "admin-tabs__badge", children: phantomCount })) : null] }, tab.id));
                }) }), phantomCount > 0 && activeTab !== 'phantom-stock' ? (_jsxs("button", { type: "button", className: "admin-phantom-alert", onClick: () => setActiveTab('phantom-stock'), children: [_jsx(AlertTriangle, { size: 19 }), _jsxs("span", { children: [_jsxs("strong", { children: ["\u041E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u044B \u0444\u0430\u043D\u0442\u043E\u043C\u043D\u044B\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438: ", phantomCount] }), _jsx("small", { children: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u0438 \u0443\u0434\u0430\u043B\u0438\u0442\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F." })] }), _jsx(ChevronRight, { size: 18 })] })) : null, message ? _jsxs("div", { className: "admin-message admin-message--ok", children: [_jsx(CheckCircle2, { size: 18 }), message] }) : null, error ? _jsxs("div", { className: "admin-message admin-message--error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null, activeTab === 'overview' && overview ? (_jsx(OverviewTab, { overview: overview, optimization: optimization, isOptimizing: busyAction === 'optimization', onOptimize: optimizePerformance, onOpenWorkspace: onOpenWorkspace })) : null, activeTab === 'stock-check' ? _jsx(AdministrationStockCheck, { session: session }) : null, activeTab === 'error-correction' ? _jsx(AdministrationFbsErrorCorrection, { session: session }) : null, activeTab === 'tsd-workloads' ? _jsx(AdministrationTsdWorkloadsPanel, { session: session }) : null, activeTab === 'phantom-stock' ? (_jsx(AdministrationPhantomStockPanel, { session: session, onCountChange: setPhantomCount })) : null, activeTab === 'settings' ? (_jsx(SettingsTab, { settings: settings, busyAction: busyAction, onSave: saveSetting })) : null, activeTab === 'integrations' ? (_jsx(IntegrationsTab, { diagnostics: diagnostics, isBusy: busyAction === 'diagnostics', onRun: runDiagnostics })) : null, activeTab === 'visibility' && visibility ? (_jsx(VisibilityTab, { visibility: visibility, selectedUserId: selectedUserId, draft: visibilityDraft, reason: visibilityReason, isBusy: busyAction === 'visibility', onSelectUser: setSelectedUserId, onChangeDraft: setVisibilityDraft, onChangeReason: setVisibilityReason, onSave: saveVisibility })) : null, activeTab === 'assistant' && overview ? (_jsx(AssistantTab, { overview: overview, prompt: assistantPrompt, preview: assistantPreview, confirmation: assistantConfirmation, busyAction: busyAction, onChangePrompt: setAssistantPrompt, onChangeConfirmation: setAssistantConfirmation, onPreview: buildAssistantPreview, onApply: applyAssistantPreview })) : null, activeTab === 'documentation' ? (_jsx(DocumentationTab, { documentation: documentation })) : null, activeTab === 'audit' ? _jsx(AuditTab, { rows: audit }) : null] }));
}
function OverviewTab({ overview, optimization, isOptimizing, onOptimize, onOpenWorkspace, }) {
    const shortcuts = [
        { id: 'directories', title: 'Клиенты, товары и SKU', description: 'Карточки, штрихкоды, литраж и реквизиты.', icon: Boxes },
        { id: 'warehouse', title: 'Короба и операции', description: 'Состав, перемещения и ручные складские действия.', icon: Database },
        { id: 'services', title: 'Услуги и калькуляторы', description: 'Тарифы клиентов, FBS и правила начислений.', icon: CircleGauge },
        { id: 'access', title: 'Роли и доступы', description: 'Пользователи, роли, клиенты и ТСД.', icon: Users },
        { id: 'service', title: 'Сервисные операции', description: 'Режим обслуживания, очистки и диагностика.', icon: ShieldCheck },
        { id: 'debug', title: 'Точное редактирование', description: 'Служебные поля, режимы и данные.', icon: Code2 },
    ];
    return (_jsxs("div", { className: "admin-stack", children: [_jsx("section", { className: "admin-metrics", children: Object.entries(overview.metrics).map(([key, value]) => (_jsxs("article", { children: [_jsx("span", { children: metricLabels[key] || key }), _jsx("strong", { children: formatNumber(value) })] }, key))) }), _jsxs("section", { className: "admin-grid admin-grid--overview", children: [_jsx(AdminCard, { title: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 API", icon: _jsx(Activity, { size: 18 }), tone: "dark", children: _jsxs("dl", { className: "admin-facts", children: [_jsxs("div", { children: [_jsx("dt", { children: "\u0421\u0440\u0435\u0434\u0430" }), _jsx("dd", { children: overview.system.environment })] }), _jsxs("div", { children: [_jsx("dt", { children: "Uptime" }), _jsx("dd", { children: formatDuration(overview.system.apiUptimeSeconds) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0430\u043C\u044F\u0442\u044C API" }), _jsxs("dd", { children: [overview.system.memoryMb, " \u041C\u0411"] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Node.js" }), _jsx("dd", { children: overview.system.nodeVersion })] })] }) }), _jsx(AdminCard, { title: "\u0417\u0430\u0449\u0438\u0442\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0443\u0440", icon: _jsx(ShieldCheck, { size: 18 }), tone: "green", children: _jsxs("ul", { className: "admin-checklist", children: [_jsxs("li", { children: [_jsx(CheckCircle2, { size: 15 }), " \u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0434\u043E \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F"] }), _jsxs("li", { children: [_jsx(CheckCircle2, { size: 15 }), " \u042F\u0432\u043D\u043E\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430"] }), _jsxs("li", { children: [_jsx(CheckCircle2, { size: 15 }), " \u0410\u0443\u0434\u0438\u0442 \u0432\u0441\u0435\u0445 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439"] }), _jsxs("li", { children: [_jsx(CheckCircle2, { size: 15 }), " \u041F\u0440\u043E\u0438\u0437\u0432\u043E\u043B\u044C\u043D\u044B\u0435 SQL \u0438 shell \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u044B"] })] }) }), _jsx(AdminCard, { title: "\u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432", icon: _jsx(Boxes, { size: 18 }), children: _jsxs("dl", { className: "admin-facts", children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439" }), _jsx("dd", { children: overview.boxCodePolicy.primaryPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0440\u0438\u0451\u043C\u043A\u0430" }), _jsx("dd", { children: overview.boxCodePolicy.receiptPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0411\u0430\u043B\u0430\u043D\u0441" }), _jsx("dd", { children: overview.boxCodePolicy.balancePrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0411\u0435\u043B\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434" }), _jsx("dd", { children: overview.boxCodePolicy.whiteReceiptPrefixes.join(', ') })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0421\u0435\u0440\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434" }), _jsx("dd", { children: overview.boxCodePolicy.grayReceiptPrefixes.join(', ') })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" }), _jsx("dd", { children: overview.boxCodePolicy.palletPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u042F\u0447\u0435\u0439\u043A\u0438" }), _jsx("dd", { children: overview.boxCodePolicy.storageCellPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041C\u0435\u0441\u0442\u0430 \u043D\u0430 \u0441\u0442\u0435\u043B\u043B\u0430\u0436\u0435" }), _jsx("dd", { children: overview.boxCodePolicy.rackSlotPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0421\u0442\u0435\u043B\u043B\u0430\u0436\u0438" }), _jsx("dd", { children: overview.boxCodePolicy.rackPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0411\u043E\u043A\u0441\u044B \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("dd", { children: overview.boxCodePolicy.storageBoxPrefix })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u043E" }), _jsx("dd", { children: overview.boxCodePolicy.allowedPrefixes.join(', ') })] })] }) })] }), _jsxs("section", { className: "admin-performance", children: [_jsx("div", { className: "admin-performance__icon", children: _jsx(WandSparkles, { size: 24 }) }), _jsxs("div", { className: "admin-performance__copy", children: [_jsx("span", { children: "\u0411\u044B\u0441\u0442\u0440\u043E\u0435 \u043E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u0435" }), _jsx("h3", { children: "\u041E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u044F \u0438 \u0443\u0441\u043A\u043E\u0440\u0435\u043D\u0438\u0435 WMS" }), _jsx("p", { children: "\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0437\u0430\u043F\u0438\u0441\u0438, \u043E\u0441\u0432\u043E\u0431\u043E\u0436\u0434\u0430\u0435\u0442 \u0438\u0441\u0442\u0451\u043A\u0448\u0438\u0439 \u043A\u044D\u0448 \u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 \u0431\u0430\u0437\u044B. \u0417\u0430\u043A\u0430\u0437\u044B, \u043E\u0441\u0442\u0430\u0442\u043A\u0438, \u041A\u0418\u0417\u044B, \u0441\u0447\u0435\u0442\u0430 \u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F." })] }), optimization ? (_jsxs("dl", { className: "admin-performance__result", children: [_jsxs("div", { children: [_jsx("dt", { children: "\u0412\u0440\u0435\u043C\u044F" }), _jsx("dd", { children: formatMilliseconds(optimization.durationMs) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041E\u0447\u0438\u0449\u0435\u043D\u043E \u0437\u0430\u043F\u0438\u0441\u0435\u0439" }), _jsx("dd", { children: formatNumber(optimization.cleanup.expiredMobileCommands + optimization.cleanup.expiredMobileSessions) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0418\u0441\u0442\u0451\u043A\u0448\u0438\u0439 \u043A\u044D\u0448" }), _jsx("dd", { children: formatNumber(optimization.runtime.expiredCacheEntries) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B" }), _jsxs("dd", { children: [formatNumber(optimization.files.deleted), " \u00B7 ", optimization.files.freedMb.toLocaleString('ru-RU'), " \u041C\u0411"] })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0411\u0414" }), _jsx("dd", { children: optimization.database.statisticsUpdated ? 'обновлена' : 'без изменений' })] })] })) : null, _jsxs("button", { type: "button", className: "admin-button admin-button--primary admin-performance__button", onClick: () => void onOptimize(), disabled: isOptimizing, children: [isOptimizing ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(WandSparkles, { size: 17 }), isOptimizing ? 'Оптимизирую…' : 'Оптимизировать WMS'] })] }), _jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u044F\u043C\u0438" }), _jsx("h3", { children: "\u0412\u0441\u0435 \u0440\u0430\u0431\u043E\u0447\u0438\u0435 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B" })] }), _jsx("p", { children: "\u0410\u0434\u043C\u0438\u043D\u043A\u0430 \u0432\u0435\u0434\u0451\u0442 \u0432 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u044B, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u0438\u0445 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438 \u0430\u0443\u0434\u0438\u0442." })] }), _jsx("div", { className: "admin-shortcuts", children: shortcuts.map((shortcut) => {
                            const Icon = shortcut.icon;
                            return (_jsxs("button", { type: "button", onClick: () => onOpenWorkspace(shortcut.id), children: [_jsx("span", { children: _jsx(Icon, { size: 19 }) }), _jsxs("div", { children: [_jsx("strong", { children: shortcut.title }), _jsx("small", { children: shortcut.description })] }), _jsx(ChevronRight, { size: 17 })] }, shortcut.id));
                        }) })] })] }));
}
function SettingsTab({ settings, busyAction, onSave, }) {
    return (_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u044B\u0439 \u0440\u0435\u0435\u0441\u0442\u0440" }), _jsx("h3", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438" })] }), _jsx("p", { children: "\u041A\u0430\u0436\u0434\u043E\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u0438\u0447\u0438\u043D\u0443, \u0432\u0430\u043B\u0438\u0434\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0438 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0432 \u0436\u0443\u0440\u043D\u0430\u043B." })] }), _jsx("div", { className: "admin-setting-list", children: settings.filter((item) => item.editable).map((setting) => setting.key === 'warehouse.boxCodePolicy' ? (_jsx(BoxPolicyEditor, { setting: setting, isBusy: busyAction === `setting:${setting.key}`, onSave: onSave }, setting.key)) : (_jsx(JsonSettingEditor, { setting: setting, isBusy: busyAction === `setting:${setting.key}`, onSave: onSave }, setting.key))) })] }));
}
function BoxPolicyEditor({ setting, isBusy, onSave, }) {
    const source = setting.value;
    const [primaryPrefix, setPrimaryPrefix] = useState(source.primaryPrefix);
    const [allowedPrefixes, setAllowedPrefixes] = useState(source.allowedPrefixes.join(', '));
    const [receiptPrefix, setReceiptPrefix] = useState(source.receiptPrefix);
    const [balancePrefix, setBalancePrefix] = useState(source.balancePrefix);
    const [whiteReceiptPrefixes, setWhiteReceiptPrefixes] = useState(source.whiteReceiptPrefixes.join(', '));
    const [grayReceiptPrefixes, setGrayReceiptPrefixes] = useState(source.grayReceiptPrefixes.join(', '));
    const [palletPrefix, setPalletPrefix] = useState(source.palletPrefix);
    const [storageCellPrefix, setStorageCellPrefix] = useState(source.storageCellPrefix);
    const [rackSlotPrefix, setRackSlotPrefix] = useState(source.rackSlotPrefix);
    const [rackPrefix, setRackPrefix] = useState(source.rackPrefix);
    const [storageBoxPrefix, setStorageBoxPrefix] = useState(source.storageBoxPrefix);
    const [corrections, setCorrections] = useState(Object.entries(source.autoCorrections).map(([from, to]) => `${from}=${to}`).join('\n'));
    const [reason, setReason] = useState('Изменение политики нумерации коробов');
    function value() {
        return {
            primaryPrefix,
            allowedPrefixes: allowedPrefixes.split(',').map((item) => item.trim()).filter(Boolean),
            receiptPrefix,
            balancePrefix,
            whiteReceiptPrefixes: whiteReceiptPrefixes.split(',').map((item) => item.trim()).filter(Boolean),
            grayReceiptPrefixes: grayReceiptPrefixes.split(',').map((item) => item.trim()).filter(Boolean),
            palletPrefix,
            storageCellPrefix,
            rackSlotPrefix,
            rackPrefix,
            storageBoxPrefix,
            autoCorrections: Object.fromEntries(corrections.split('\n').map((line) => line.split('=')).filter((parts) => parts.length === 2)
                .map(([from, to]) => [from.trim(), to.trim()]).filter(([from, to]) => from && to)),
        };
    }
    return (_jsxs("article", { className: "admin-setting admin-setting--critical", children: [_jsx(SettingHeading, { setting: setting }), _jsxs("div", { className: "admin-form-grid", children: [_jsx(Field, { label: "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u043F\u0440\u0435\u0444\u0438\u043A\u0441", children: _jsx("input", { value: primaryPrefix, onChange: (event) => setPrimaryPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u043F\u0440\u0438\u0451\u043C\u043A\u0438", children: _jsx("input", { value: receiptPrefix, onChange: (event) => setReceiptPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u0431\u0430\u043B\u0430\u043D\u0441-\u043A\u043E\u0440\u043E\u0431\u043E\u0432", children: _jsx("input", { value: balancePrefix, onChange: (event) => setBalancePrefix(event.target.value) }) }), _jsx(Field, { label: "\u0420\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0435, \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E", children: _jsx("input", { value: allowedPrefixes, onChange: (event) => setAllowedPrefixes(event.target.value) }) }), _jsx(Field, { label: "\u0411\u0435\u043B\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434 \u2014 \u043F\u0440\u0435\u0444\u0438\u043A\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E", children: _jsx("input", { value: whiteReceiptPrefixes, onChange: (event) => setWhiteReceiptPrefixes(event.target.value) }) }), _jsx(Field, { label: "\u0421\u0435\u0440\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434 \u2014 \u043F\u0440\u0435\u0444\u0438\u043A\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E", children: _jsx("input", { value: grayReceiptPrefixes, onChange: (event) => setGrayReceiptPrefixes(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u043F\u0430\u043B\u043B\u0435\u0442\u043E\u0432", children: _jsx("input", { value: palletPrefix, onChange: (event) => setPalletPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u044F\u0447\u0435\u0435\u043A \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F", children: _jsx("input", { value: storageCellPrefix, onChange: (event) => setStorageCellPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u043C\u0435\u0441\u0442\u0430 \u043D\u0430 \u0441\u0442\u0435\u043B\u043B\u0430\u0436\u0435", children: _jsx("input", { value: rackSlotPrefix, onChange: (event) => setRackSlotPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u0441\u0442\u0435\u043B\u043B\u0430\u0436\u0435\u0439", children: _jsx("input", { value: rackPrefix, onChange: (event) => setRackPrefix(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u0431\u043E\u043A\u0441\u043E\u0432 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F", children: _jsx("input", { value: storageBoxPrefix, onChange: (event) => setStorageBoxPrefix(event.target.value) }) }), _jsx(Field, { label: "\u0410\u0432\u0442\u043E\u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F: \u041E\u0428\u0418\u0411\u041A\u0410=\u0412\u0415\u0420\u041D\u041E", wide: true, children: _jsx("textarea", { rows: 3, value: corrections, onChange: (event) => setCorrections(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F", wide: true, children: _jsx("input", { value: reason, onChange: (event) => setReason(event.target.value) }) })] }), _jsxs("button", { className: "admin-button admin-button--primary", type: "button", disabled: isBusy, onClick: () => void onSave(setting, value(), reason), children: [isBusy ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(Save, { size: 16 }), " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043F\u043E\u043B\u0438\u0442\u0438\u043A\u0443"] })] }));
}
function JsonSettingEditor({ setting, isBusy, onSave, }) {
    const [value, setValue] = useState(typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value, null, 2));
    const [reason, setReason] = useState(`Изменение настройки: ${setting.title}`);
    const [localError, setLocalError] = useState('');
    function save() {
        try {
            const parsed = typeof setting.value === 'number' ? Number(value) : JSON.parse(value);
            setLocalError('');
            void onSave(setting, parsed, reason);
        }
        catch {
            setLocalError('Значение должно быть корректным JSON.');
        }
    }
    return (_jsxs("article", { className: "admin-setting", children: [_jsx(SettingHeading, { setting: setting }), _jsx(Field, { label: "\u0417\u043D\u0430\u0447\u0435\u043D\u0438\u0435 JSON", children: _jsx("textarea", { rows: Math.min(12, Math.max(3, value.split('\n').length + 1)), value: value, onChange: (event) => setValue(event.target.value) }) }), _jsx(Field, { label: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F", children: _jsx("input", { value: reason, onChange: (event) => setReason(event.target.value) }) }), localError ? _jsx("small", { className: "admin-inline-error", children: localError }) : null, _jsxs("button", { className: "admin-button admin-button--primary", type: "button", disabled: isBusy, onClick: save, children: [isBusy ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(Save, { size: 16 }), " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"] })] }));
}
function SettingHeading({ setting }) {
    return (_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: setting.group }), _jsx("h4", { children: setting.title }), _jsx("p", { children: setting.description })] }), _jsxs("em", { className: `admin-risk admin-risk--${setting.risk.toLowerCase()}`, children: ["\u0420\u0438\u0441\u043A: ", riskLabel(setting.risk)] })] }));
}
function IntegrationsTab({ diagnostics, isBusy, onRun, }) {
    return (_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0410\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u0430\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430" }), _jsx("h3", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F WB \u0438 Ozon" })] }), _jsxs("button", { type: "button", className: "admin-button admin-button--primary", disabled: isBusy, onClick: () => void onRun(), children: [isBusy ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(Play, { size: 16 }), " \u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432\u0441\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F"] })] }), _jsxs("div", { className: "admin-callout", children: [_jsx(Network, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043D\u0435 \u043C\u0435\u043D\u044F\u0435\u0442 \u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0438." }), _jsx("p", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u0442\u043E\u043A\u0435\u043D, \u0441\u043F\u0438\u0441\u043E\u043A \u0441\u043A\u043B\u0430\u0434\u043E\u0432, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u043D\u043E\u0432\u044B\u0445 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0438 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0437\u0430\u043A\u0430\u0437\u043E\u0432." })] })] }), diagnostics ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "admin-metrics admin-metrics--compact", children: [_jsxs("article", { children: [_jsx("span", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E" }), _jsx("strong", { children: diagnostics.summary.checked })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0418\u0441\u043F\u0440\u0430\u0432\u043D\u044B" }), _jsx("strong", { className: "is-ok", children: diagnostics.summary.healthy })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0421 \u043E\u0448\u0438\u0431\u043A\u043E\u0439" }), _jsx("strong", { className: "is-danger", children: diagnostics.summary.failed })] })] }), _jsx("div", { className: "admin-diagnostic-list", children: diagnostics.results.map((result) => (_jsxs("article", { className: result.healthy ? 'is-healthy' : 'is-failed', children: [_jsx("div", { className: "admin-diagnostic-list__status", children: result.healthy ? _jsx(CheckCircle2, {}) : _jsx(AlertTriangle, {}) }), _jsxs("div", { children: [_jsxs("span", { children: [result.marketplace, " \u00B7 ", result.client?.code] }), _jsx("h4", { children: result.client?.name || result.accountName }), _jsx("p", { children: diagnosticSummary(result) })] }), _jsxs("details", { children: [_jsx("summary", { children: "\u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }), _jsx("pre", { children: JSON.stringify(result, null, 2) })] })] }, result.connectionId))) })] })) : _jsx("div", { className: "admin-empty", children: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u2014 \u0437\u0434\u0435\u0441\u044C \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u043D\u044F\u0442\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 \u043F\u043E \u043A\u0430\u0436\u0434\u043E\u043C\u0443 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0443 \u0438 \u0441\u043A\u043B\u0430\u0434\u0443." })] }));
}
function VisibilityTab({ visibility, selectedUserId, draft, reason, isBusy, onSelectUser, onChangeDraft, onChangeReason, onSave, }) {
    return (_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441" }), _jsx("h3", { children: "\u0412\u0438\u0434\u0438\u043C\u043E\u0441\u0442\u044C \u043F\u043B\u0438\u0442\u043E\u043A \u0438 \u0440\u0430\u0437\u0434\u0435\u043B\u043E\u0432" })] }), _jsx("p", { children: "\u0421\u043A\u0440\u044B\u0442\u0438\u0435 \u043C\u0435\u043D\u044F\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441. \u0420\u043E\u043B\u0438 \u0438 \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u044B\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u043C\u0438." })] }), _jsxs("div", { className: "admin-visibility-toolbar", children: [_jsx(Field, { label: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C", children: _jsx("select", { value: selectedUserId, onChange: (event) => onSelectUser(event.target.value), children: visibility.users.map((user) => _jsxs("option", { value: user.id, children: [user.name, " \u00B7 ", user.email] }, user.id)) }) }), _jsx(Field, { label: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430", children: _jsx("input", { value: reason, onChange: (event) => onChangeReason(event.target.value) }) })] }), _jsx("div", { className: "admin-visibility-grid", children: visibility.workspaces.filter((id) => id !== 'administration').map((workspaceId) => {
                    const hidden = draft[workspaceId] === false;
                    return (_jsxs("button", { type: "button", className: hidden ? 'is-hidden' : '', onClick: () => {
                            const next = { ...draft };
                            if (hidden)
                                delete next[workspaceId];
                            else
                                next[workspaceId] = false;
                            onChangeDraft(next);
                        }, children: [hidden ? _jsx(EyeOff, { size: 18 }) : _jsx(Eye, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: workspaceLabels.get(workspaceId) || workspaceId }), _jsx("small", { children: hidden ? 'Скрыт персонально' : 'По ролям пользователя' })] })] }, workspaceId));
                }) }), _jsxs("button", { className: "admin-button admin-button--primary", type: "button", disabled: isBusy, onClick: () => void onSave(), children: [isBusy ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(Save, { size: 16 }), " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u043E\u0441\u0442\u044C"] })] }));
}
function AssistantTab({ overview, prompt, preview, confirmation, busyAction, onChangePrompt, onChangeConfirmation, onPreview, onApply, }) {
    const canApply = preview?.actions.length && preview.actions.every((action) => action.executable);
    return (_jsxs("section", { className: "admin-section admin-assistant", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C" }), _jsx("h3", { children: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u043C \u044F\u0437\u044B\u043A\u043E\u043C" })] }), _jsxs("em", { className: overview.ai.liveProviderAvailable ? 'is-online' : '', children: [_jsx(Sparkles, { size: 15 }), " ", overview.ai.liveProviderAvailable ? 'OpenAI подключён' : 'Локальный планировщик'] })] }), _jsxs("div", { className: "admin-callout admin-callout--warning", children: [_jsx(AlertTriangle, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u043E\u043C\u043E\u0449\u043D\u0438\u043A \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u0434 \u043D\u0430 production." }), _jsx("p", { children: "\u0420\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430 \u0438 \u0441\u043B\u043E\u0432\u0430 \u00AB\u041F\u0420\u0418\u041C\u0415\u041D\u0418\u0422\u042C\u00BB. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u043D\u043E\u0439 \u043B\u043E\u0433\u0438\u043A\u0438 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u044E\u0442\u0441\u044F \u0432 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043F\u043B\u0430\u043D \u0441 \u0442\u0435\u0441\u0442\u0430\u043C\u0438 \u0438 \u043E\u0442\u043A\u0430\u0442\u043E\u043C." })] })] }), _jsx("textarea", { className: "admin-assistant__prompt", rows: 6, value: prompt, onChange: (event) => onChangePrompt(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0438\u0437\u043C\u0435\u043D\u0438 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u043F\u0440\u0435\u0444\u0438\u043A\u0441 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u043D\u0430 LOGOFF_ \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438 \u0441\u0442\u0430\u0440\u044B\u0439 FFL_ \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u043C\u2026" }), _jsxs("button", { className: "admin-button admin-button--primary", type: "button", disabled: busyAction === 'assistant-preview' || prompt.trim().length < 5, onClick: () => void onPreview(), children: [busyAction === 'assistant-preview' ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(WandSparkles, { size: 16 }), " \u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u043F\u043B\u0430\u043D"] }), preview ? (_jsxs("article", { className: "admin-preview", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: preview.provider }), _jsx("h4", { children: preview.title })] }), _jsxs("em", { className: `admin-risk admin-risk--${preview.risk.toLowerCase()}`, children: ["\u0420\u0438\u0441\u043A: ", riskLabel(preview.risk)] })] }), _jsx("p", { children: preview.summary }), _jsx("ol", { children: preview.recommendations.map((item) => _jsx("li", { children: item }, item)) }), _jsxs("div", { className: "admin-preview__rollback", children: [_jsx(RefreshCw, { size: 16 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041E\u0442\u043A\u0430\u0442" }), preview.rollback] })] }), _jsx("div", { className: "admin-preview__actions", children: preview.actions.map((action, index) => (_jsxs("span", { className: action.executable ? 'is-executable' : '', children: [action.executable ? _jsx(CheckCircle2, { size: 14 }) : _jsx(Code2, { size: 14 }), action.type] }, `${action.type}-${index}`))) }), canApply ? (_jsxs("div", { className: "admin-confirm", children: [_jsx(Field, { label: "\u0414\u043B\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u041F\u0420\u0418\u041C\u0415\u041D\u0418\u0422\u042C", children: _jsx("input", { value: confirmation, onChange: (event) => onChangeConfirmation(event.target.value) }) }), _jsxs("button", { className: "admin-button admin-button--danger", type: "button", disabled: busyAction === 'assistant-apply' || confirmation !== 'ПРИМЕНИТЬ', onClick: () => void onApply(), children: [busyAction === 'assistant-apply' ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(Play, { size: 16 }), " \u0412\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F"] })] })) : _jsx("div", { className: "admin-empty", children: "\u042D\u0442\u043E \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u0430\u0432\u043A\u0438 \u0438 \u0442\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0433\u043E \u043A\u043E\u0434\u0430. \u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E." })] })) : null] }));
}
function DocumentationTab({ documentation }) {
    const flows = [
        { title: 'Приёмка', nodes: ['Клиент и партия', 'Короб или товар', 'ШК / КИЗ', 'Остаток и история'] },
        { title: 'FBS', nodes: ['API-заказы', 'WMS-заявка', 'Сборка ТСД', 'Упаковка / грузоместа', 'Передача WB'] },
        { title: 'Инвентаризация', nodes: ['Сессия', 'Короб', 'Факт по ШК', 'Расхождение', 'Решение менеджера'] },
        { title: 'Биллинг', nodes: ['События WMS', 'Тариф клиента', 'Начисления', 'Счёт и акт', 'Оплата'] },
    ];
    return (_jsxs("div", { className: "admin-stack", children: [_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u0430\u0440\u0442\u0430 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u043E\u0432" }), _jsx("h3", { children: "\u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C\u044B WMS" })] }), _jsx("p", { children: "\u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0435\u0440\u0435\u0445\u043E\u0434 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u0443\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E; \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u0430\u0443\u0434\u0438\u0442." })] }), _jsx("div", { className: "admin-flows", children: flows.map((flow) => (_jsxs("article", { children: [_jsx("h4", { children: flow.title }), _jsx("div", { children: flow.nodes.map((node, index) => _jsxs("span", { children: [node, index < flow.nodes.length - 1 ? _jsx(ChevronRight, { size: 14 }) : null] }, node)) })] }, flow.title))) })] }), _jsxs("section", { className: "admin-section", children: [_jsx("div", { className: "admin-section__heading", children: _jsxs("div", { children: [_jsx("span", { children: "\u0411\u0430\u0437\u0430 \u0437\u043D\u0430\u043D\u0438\u0439" }), _jsx("h3", { children: "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u0438 \u0438 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u0446\u0438\u044F" })] }) }), _jsx("div", { className: "admin-docs", children: documentation?.sections.map((section) => (_jsxs("article", { children: [_jsx(BookOpen, { size: 19 }), _jsxs("div", { children: [_jsx("h4", { children: section.title }), _jsx("p", { children: section.summary })] })] }, section.id))) }), documentation?.references.length ? (_jsxs("div", { className: "admin-reference-list", children: [_jsx("strong", { children: "\u041F\u043E\u043B\u043D\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0432 \u043F\u0440\u043E\u0435\u043A\u0442\u0435 \u0438 \u0440\u0435\u0437\u0435\u0440\u0432\u043D\u044B\u0445 \u043A\u043E\u043F\u0438\u044F\u0445:" }), documentation.references.map((reference) => _jsxs("code", { children: [reference.title, ": ", reference.path] }, reference.path))] })) : null] })] }));
}
function AuditTab({ rows }) {
    const [search, setSearch] = useState('');
    const filtered = rows.filter((row) => `${row.action} ${row.entity} ${row.entityId || ''} ${row.user?.name || ''}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')));
    return (_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041D\u0435\u0438\u0437\u043C\u0435\u043D\u044F\u0435\u043C\u0430\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F" }), _jsx("h3", { children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u0438\u0432\u043D\u044B\u0445 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439" })] }), _jsx("input", { className: "admin-search", value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044E \u0438\u043B\u0438 \u043E\u0431\u044A\u0435\u043A\u0442\u0443" })] }), _jsxs("div", { className: "admin-audit", children: [filtered.map((row) => (_jsxs("article", { children: [_jsx(FileClock, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: auditActionLabel(row.action) }), _jsxs("span", { children: [row.entity, row.entityId ? ` · ${row.entityId}` : ''] })] }), _jsxs("div", { children: [_jsx("strong", { children: row.user?.name || 'Система' }), _jsx("time", { children: formatDateTime(row.createdAt) })] }), _jsxs("details", { children: [_jsx("summary", { children: "\u0414\u0430\u043D\u043D\u044B\u0435" }), _jsx("pre", { children: JSON.stringify(row.payload, null, 2) })] })] }, row.id))), filtered.length === 0 ? _jsx("div", { className: "admin-empty", children: "\u0417\u0430\u043F\u0438\u0441\u0435\u0439 \u043F\u043E \u044D\u0442\u043E\u043C\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u043D\u0435\u0442." }) : null] })] }));
}
function AdminCard({ title, icon, tone = 'light', children }) {
    return _jsxs("article", { className: `admin-card admin-card--${tone}`, children: [_jsxs("header", { children: [icon, _jsx("h3", { children: title })] }), children] });
}
function Field({ label, wide = false, children }) {
    return _jsxs("label", { className: wide ? 'admin-field admin-field--wide' : 'admin-field', children: [_jsx("span", { children: label }), children] });
}
function riskLabel(risk) {
    return risk === 'HIGH' ? 'высокий' : risk === 'MEDIUM' ? 'средний' : 'низкий';
}
function diagnosticSummary(result) {
    if (result.healthy)
        return 'Токен действует, доступные методы отвечают, подключение готово к работе.';
    const error = typeof result.error === 'string' ? result.error : '';
    return error || 'Один или несколько обязательных методов API недоступны. Откройте технические данные.';
}
function auditActionLabel(action) {
    const labels = {
        'administration.performance.optimize': 'Выполнена оптимизация WMS',
        'administration.setting.update': 'Изменена системная настройка',
        'administration.workspace-visibility.update': 'Изменена видимость интерфейса',
        'administration.marketplace.diagnostics': 'Проверены API-подключения',
        'administration.ai.preview': 'ИИ подготовил план',
        'administration.ai.apply': 'Применён план ИИ',
    };
    return labels[action] || action;
}
function formatNumber(value) {
    return new Intl.NumberFormat('ru-RU').format(value);
}
function formatDuration(seconds) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    return days ? `${days} д ${hours} ч` : `${hours} ч`;
}
function formatMilliseconds(value) {
    if (value < 1000)
        return `${value} мс`;
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} сек.`;
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
