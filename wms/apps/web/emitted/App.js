import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Bell, Building2, CheckCircle2, ChevronRight, CircleHelp, LogOut, MapPin, Menu, Palette, PanelLeft, Search, ShieldCheck, UsersRound, X, } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AccessAdminPanel } from './components/access/AccessAdminPanel';
import { AuthPanel } from './components/AuthPanel';
import { MarketingLanding } from './components/MarketingLanding';
import { BranchesPanel } from './components/branches/BranchesPanel';
import { ServicesWorkspacePanel } from './components/billing/ServicesWorkspacePanel';
import { CatalogPanel } from './components/catalog/CatalogPanel';
import { ClientCabinetPanel } from './components/client-cabinet/ClientCabinetPanel';
import { ContractsPanel } from './components/contracts/ContractsPanel';
import { DashboardDataPanel } from './components/DashboardDataPanel';
import { DebugPanel } from './components/debug/DebugPanel';
import { ExpensesPanel } from './components/expenses/ExpensesPanel';
import { ImportPanel } from './components/imports/ImportPanel';
import { InventoryPanel } from './components/inventory/InventoryPanel';
import { KizIssuesPanel } from './components/kiz/KizIssuesPanel';
import { WmsAiPanel } from './components/wms-ai/WmsAiPanel';
import { LogisticsQuotePanel } from './components/logistics/LogisticsQuotePanel';
import { OwnCompaniesPanel } from './components/own-companies/OwnCompaniesPanel';
import { PrintPanel } from './components/print/PrintPanel';
import { ServiceCenterPanel } from './components/service/ServiceCenterPanel';
import { TurnoverPanel } from './components/turnover/TurnoverPanel';
import { WarehouseOpsPanel } from './components/warehouse/WarehouseOpsPanel';
import { StorageZonesPanel } from './components/warehouse/StorageZonesPanel';
import { activateBranch, fetchBranches, fetchClientNotifications, fetchKizIssues, fetchMe, logout as closeAuthSession, markClientNotificationRead, } from './lib/api';
import { clearStoredSession, loadStoredSession, storeSession } from './lib/session';
import { canOpenWorkspace, workspaceNav } from './lib/workspaces';
const AnalyticsPanel = lazy(() => import('./components/analytics/AnalyticsPanel').then((module) => ({ default: module.AnalyticsPanel })));
const AdministrationPanel = lazy(() => import('./components/administration/AdministrationPanel').then((module) => ({
    default: module.AdministrationPanel,
})));
const BillingPanel = lazy(() => import('./components/billing/BillingPanel').then((module) => ({ default: module.BillingPanel })));
const ClientRequestsPanel = lazy(() => import('./components/client-requests/ClientRequestsPanel').then((module) => ({
    default: module.ClientRequestsPanel,
})));
const DirectoryPanel = lazy(() => import('./components/directories/DirectoryPanel').then((module) => ({ default: module.DirectoryPanel })));
const FbsPanel = lazy(() => import('./components/fbs/FbsPanel').then((module) => ({ default: module.FbsPanel })));
const FactoryPanel = lazy(() => import('./components/factory/FactoryPanel').then((module) => ({ default: module.FactoryPanel })));
const FbsPackedItemsPanel = lazy(() => import('./components/fbs-packed/FbsPackedItemsPanel').then((module) => ({ default: module.FbsPackedItemsPanel })));
const TsdMonitoringPanel = lazy(() => import('./components/monitoring/TsdMonitoringPanel').then((module) => ({ default: module.TsdMonitoringPanel })));
const DbsPanel = lazy(() => import('./components/dbs/DbsPanel').then((module) => ({ default: module.DbsPanel })));
const OzonFboPanel = lazy(() => import('./components/ozon-fbo/OzonFboPanel').then((module) => ({ default: module.OzonFboPanel })));
const RelabelingPanel = lazy(() => import('./components/relabeling/RelabelingPanel').then((module) => ({ default: module.RelabelingPanel })));
const statusLabel = {
    ready: 'готово',
    'in-progress': 'в работе',
    planned: 'план',
};
const workspaceSections = [
    { id: 'main', title: 'Главное' },
    { id: 'client', title: 'Клиентский контур' },
    { id: 'operations', title: 'Склад и операции' },
    { id: 'management', title: 'Управление' },
    { id: 'control', title: 'Контроль' },
];
const uiThemeOptions = [
    { value: 'classic', label: 'Классическая' },
    { value: 'modern', label: 'Современная' },
    { value: 'aerospace', label: 'Aerospace Light' },
    { value: 'obsidian', label: 'Obsidian Command' },
    { value: 'polar', label: 'Polar Grid' },
    { value: 'future3100', label: 'Future' },
    { value: 'winx', label: 'WingX · Эля', personal: 'winx' },
];
const wingXUserIds = new Set(['d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82']);
const initialSession = loadStoredSession();
const initialTheme = initialSession ? loadUiTheme(initialSession.user) : 'classic';
export function App() {
    const [session, setSession] = useState(() => initialSession);
    const [showAuthPanel, setShowAuthPanel] = useState(false);
    const [uiTheme, setUiTheme] = useState(() => initialTheme);
    const [isRestoring, setRestoring] = useState(Boolean(session));
    const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => initialSession ? defaultWorkspaceForUser(initialSession.user) : 'overview');
    const [branches, setBranches] = useState([]);
    const [branchBusy, setBranchBusy] = useState(false);
    const [kizUnread, setKizUnread] = useState(0);
    const [clientNotifications, setClientNotifications] = useState([]);
    const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
    const [modernSidebarCollapsed, setModernSidebarCollapsed] = useState(false);
    const workspaceContentRef = useRef(null);
    const modernSearchRef = useRef(null);
    const notificationCenterRef = useRef(null);
    useEffect(() => {
        if (session)
            return undefined;
        const syncPublicView = () => setShowAuthPanel(window.location.hash === '#login');
        syncPublicView();
        window.addEventListener('popstate', syncPublicView);
        return () => window.removeEventListener('popstate', syncPublicView);
    }, [session]);
    function openLogin() {
        if (window.location.hash !== '#login')
            window.history.pushState({ logoffAuth: true }, '', '#login');
        setShowAuthPanel(true);
    }
    function returnToLanding() {
        if (window.location.hash === '#login')
            window.history.back();
        else
            setShowAuthPanel(false);
    }
    useEffect(() => {
        document.documentElement.dataset.uiTheme = uiThemeBase(uiTheme);
        document.documentElement.dataset.uiVariant = uiTheme;
        if (session?.user.id) {
            window.localStorage.setItem(uiThemeStorageKey(session.user.id), uiTheme);
        }
    }, [session?.user.id, uiTheme]);
    useEffect(() => {
        setUiTheme(session ? loadUiTheme(session.user) : 'classic');
    }, [session?.user.id]);
    useEffect(() => {
        setModernSidebarCollapsed(uiTheme === 'obsidian');
    }, [uiTheme]);
    useEffect(() => {
        let isActive = true;
        async function restore() {
            if (!session?.accessToken) {
                setRestoring(false);
                return;
            }
            try {
                const user = await fetchMe(session.accessToken);
                if (isActive) {
                    const nextSession = { ...session, user };
                    setSession(nextSession);
                    storeSession(nextSession);
                    setActiveWorkspaceId((current) => (canKeepWorkspace(user, current) ? current : defaultWorkspaceForUser(user)));
                }
            }
            catch {
                clearStoredSession();
                if (isActive) {
                    setSession(null);
                }
            }
            finally {
                if (isActive) {
                    setRestoring(false);
                }
            }
        }
        void restore();
        return () => {
            isActive = false;
        };
    }, []);
    useEffect(() => {
        if (!session?.accessToken || session.user.roleCodes.includes('CLIENT')) {
            setBranches([]);
            return;
        }
        let isActive = true;
        void fetchBranches(session.accessToken)
            .then(async (items) => {
            if (!isActive)
                return;
            setBranches(items);
            if (!session.user.activeWarehouseId && items[0]) {
                const selected = await activateBranch(session.accessToken, items[0].id);
                if (!isActive)
                    return;
                const nextSession = {
                    ...session,
                    user: { ...session.user, activeWarehouseId: selected.id },
                };
                setSession(nextSession);
                storeSession(nextSession);
            }
        })
            .catch(() => {
            if (isActive)
                setBranches([]);
        });
        return () => {
            isActive = false;
        };
    }, [session?.accessToken, session?.user.activeWarehouseId]);
    useEffect(() => {
        if (!session?.accessToken ||
            !session.user.permissionCodes.includes('system:admin')) {
            setKizUnread(0);
            return;
        }
        let isActive = true;
        const loadUnread = () => {
            void fetchKizIssues(session.accessToken, {
                status: 'open',
                limit: 25,
            })
                .then((report) => {
                if (isActive)
                    setKizUnread(report.summary.unread);
            })
                .catch(() => undefined);
        };
        loadUnread();
        const timer = window.setInterval(loadUnread, 30_000);
        window.addEventListener('kiz-issues-changed', loadUnread);
        return () => {
            isActive = false;
            window.clearInterval(timer);
            window.removeEventListener('kiz-issues-changed', loadUnread);
        };
    }, [
        session?.accessToken,
        session?.user.activeWarehouseId,
        session?.user.permissionCodes,
    ]);
    useEffect(() => {
        if (!session?.accessToken ||
            !session.user.permissionCodes.includes('client-notifications:read')) {
            setClientNotifications([]);
            return;
        }
        let isActive = true;
        const loadNotifications = () => {
            void fetchClientNotifications(session.accessToken)
                .then((items) => {
                if (!isActive)
                    return;
                setClientNotifications([...items]
                    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
                    .slice(0, 12));
            })
                .catch(() => undefined);
        };
        loadNotifications();
        const timer = window.setInterval(loadNotifications, 30_000);
        window.addEventListener('client-notifications-changed', loadNotifications);
        return () => {
            isActive = false;
            window.clearInterval(timer);
            window.removeEventListener('client-notifications-changed', loadNotifications);
        };
    }, [
        session?.accessToken,
        session?.user.activeWarehouseId,
        session?.user.permissionCodes,
    ]);
    useEffect(() => {
        if (!notificationCenterOpen)
            return;
        const closeOnOutsideClick = (event) => {
            if (event.target instanceof Node &&
                !notificationCenterRef.current?.contains(event.target)) {
                setNotificationCenterOpen(false);
            }
        };
        const closeOnEscape = (event) => {
            if (event.key === 'Escape')
                setNotificationCenterOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [notificationCenterOpen]);
    const availableWorkspaces = useMemo(() => {
        if (!session) {
            return [];
        }
        return workspaceNav.filter((item) => canOpenWorkspace(session.user, item));
    }, [session]);
    const groupedWorkspaces = useMemo(() => groupWorkspaces(availableWorkspaces), [availableWorkspaces]);
    const headerNotifications = useMemo(() => {
        const workspaceIds = new Set(availableWorkspaces.map((item) => item.id));
        const items = [];
        if (kizUnread > 0 && workspaceIds.has('kiz')) {
            items.push({
                id: 'kiz-open-issues',
                title: 'Проблемы КИЗ',
                body: `${kizUnread} ${pluralizeNotificationCount(kizUnread, 'непрочитанная проблема', 'непрочитанные проблемы', 'непрочитанных проблем')}`,
                target: 'kiz',
                severity: 'warning',
                unread: true,
            });
        }
        for (const notification of clientNotifications) {
            items.push({
                id: notification.id,
                title: notification.title || 'Уведомление WMS',
                body: notification.body || notification.request?.title || notification.client.name,
                createdAt: notification.createdAt,
                target: resolveHeaderNotificationTarget(notification, workspaceIds),
                severity: notification.severity.toLowerCase(),
                unread: !notification.isRead,
                source: notification,
            });
        }
        return items.slice(0, 10);
    }, [availableWorkspaces, clientNotifications, kizUnread]);
    const headerUnreadCount = headerNotifications.reduce((total, item) => total + (item.id === 'kiz-open-issues' ? kizUnread : item.unread ? 1 : 0), 0);
    useEffect(() => {
        if (!session) {
            return;
        }
        if (!availableWorkspaces.some((item) => item.id === activeWorkspaceId)) {
            setActiveWorkspaceId(defaultWorkspaceForUser(session.user));
        }
    }, [activeWorkspaceId, availableWorkspaces, session]);
    useEffect(() => {
        workspaceContentRef.current?.scrollTo({ top: 0, left: 0 });
    }, [activeWorkspaceId]);
    useEffect(() => {
        if (!isAdvancedTheme(uiTheme))
            return;
        const focusWorkspaceSearch = (event) => {
            if (event.altKey && event.key === '/') {
                event.preventDefault();
                modernSearchRef.current?.focus();
            }
        };
        window.addEventListener('keydown', focusWorkspaceSearch);
        return () => window.removeEventListener('keydown', focusWorkspaceSearch);
    }, [uiTheme]);
    function acceptSession(nextSession) {
        setSession(nextSession);
        setUiTheme(loadUiTheme(nextSession.user));
        storeSession(nextSession);
        setActiveWorkspaceId(defaultWorkspaceForUser(nextSession.user));
    }
    async function logout() {
        const accessToken = session?.accessToken;
        if (accessToken) {
            try {
                await closeAuthSession(accessToken);
            }
            catch {
                // Локальный выход должен сработать даже при недоступном API или уже закрытой сессии.
            }
        }
        clearStoredSession();
        setSession(null);
        window.history.replaceState(null, '', window.location.pathname);
        setShowAuthPanel(false);
    }
    async function selectBranch(branchId) {
        if (!session || branchId === session.user.activeWarehouseId)
            return;
        setBranchBusy(true);
        try {
            const selected = await activateBranch(session.accessToken, branchId);
            const nextSession = {
                ...session,
                user: { ...session.user, activeWarehouseId: selected.id },
            };
            setSession(nextSession);
            storeSession(nextSession);
        }
        finally {
            setBranchBusy(false);
        }
    }
    function openHeaderNotification(item) {
        setNotificationCenterOpen(false);
        setActiveWorkspaceId(item.target);
        if (!item.source || item.source.isRead || !session?.accessToken)
            return;
        setClientNotifications((current) => current.map((notification) => (notification.id === item.source?.id
            ? { ...notification, isRead: true, readAt: new Date().toISOString() }
            : notification)));
        void markClientNotificationRead(session.accessToken, item.source.id)
            .catch(() => {
            setClientNotifications((current) => current.map((notification) => (notification.id === item.source?.id ? item.source : notification)));
        });
    }
    if (isRestoring) {
        return (_jsx("main", { className: "auth-shell", children: _jsxs("section", { className: "auth-panel auth-panel--loading", "aria-live": "polite", children: [_jsx("p", { className: "eyebrow", children: "\u0424\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442 LOGOFF" }), _jsx("h1", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0435\u0441\u0441\u0438\u0438" })] }) }));
    }
    if (!session) {
        return showAuthPanel
            ? _jsx(AuthPanel, { onSession: acceptSession, onBack: returnToLanding })
            : _jsx(MarketingLanding, { onLogin: openLogin });
    }
    const activeWorkspace = availableWorkspaces.find((item) => item.id === activeWorkspaceId) ?? availableWorkspaces[0];
    const appLayoutClassName = [
        'app-layout',
        hasWinxCursor(session.user) ? 'winx-cursor' : '',
        isAdvancedTheme(uiTheme) && modernSidebarCollapsed ? 'app-layout--sidebar-collapsed' : '',
    ].filter(Boolean).join(' ');
    const baseUiTheme = uiThemeBase(uiTheme);
    const availableThemeOptions = uiThemeOptions.filter((option) => !option.personal || hasWinxCursor(session.user));
    function openWorkspaceFromSearch(value) {
        const normalized = value.trim().toLocaleLowerCase('ru-RU');
        if (!normalized)
            return;
        const match = availableWorkspaces.find((item) => (item.title.toLocaleLowerCase('ru-RU').includes(normalized)
            || item.description.toLocaleLowerCase('ru-RU').includes(normalized)));
        if (match) {
            setActiveWorkspaceId(match.id);
            if (modernSearchRef.current)
                modernSearchRef.current.value = '';
        }
    }
    return (_jsxs("div", { className: appLayoutClassName, "data-ui-theme": baseUiTheme, "data-ui-variant": uiTheme, "data-workspace": activeWorkspace.id, children: [_jsxs("aside", { className: "app-sidebar", "aria-label": "\u041D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F WMS", children: [_jsxs("div", { className: "app-sidebar__brand", children: [_jsx("span", { className: "app-sidebar__brand-name", children: "LOGOFF" }), _jsx("strong", { children: "WMS" }), _jsx("small", { children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u043E\u043C" }), _jsx("button", { className: "modern-sidebar-toggle", type: "button", "aria-label": modernSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню', title: modernSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню', onClick: () => setModernSidebarCollapsed((current) => !current), children: _jsx(Menu, { size: 19, "aria-hidden": "true" }) })] }), _jsx("nav", { className: "workspace-nav", children: groupedWorkspaces.map((group) => (_jsxs("section", { className: "workspace-nav__group", children: [_jsx("p", { children: group.title }), group.items.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = item.id === activeWorkspace.id;
                                    return (_jsxs("button", { className: isActive ? 'active' : '', type: "button", onClick: () => setActiveWorkspaceId(item.id), children: [_jsx(Icon, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: item.title }), item.id === 'kiz' && kizUnread > 0 ? (_jsx("strong", { className: "workspace-nav__badge", "aria-label": `Непрочитанных проблем КИЗ: ${kizUnread}`, children: kizUnread > 99 ? '99+' : kizUnread })) : null] }, item.id));
                                })] }, group.id))) }), _jsxs("div", { className: "app-sidebar__footer", children: [_jsx("span", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u043E\u0432" }), _jsx("strong", { children: Math.max(availableWorkspaces.length - 1, 0) })] })] }), _jsxs("main", { className: "workspace-shell", children: [_jsxs("header", { className: "workspace-header", children: [_jsxs("div", { className: "workspace-header__title", children: [_jsx("p", { className: "eyebrow", children: activeWorkspace.eyebrow }), _jsx("h1", { children: activeWorkspace.title }), _jsx("p", { className: "workspace-header__description", children: activeWorkspace.description })] }), _jsxs("div", { className: "workspace-header__meta", children: [_jsxs("label", { className: "workspace-global-search", children: [_jsx(Search, { size: 18, "aria-hidden": "true" }), _jsx("input", { ref: modernSearchRef, type: "search", list: "workspace-search-options", placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0440\u0430\u0437\u0434\u0435\u043B \u0438\u043B\u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E", "aria-label": "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u043F\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u0430\u043C", onKeyDown: (event) => {
                                                    if (event.key === 'Enter')
                                                        openWorkspaceFromSearch(event.currentTarget.value);
                                                } }), _jsx("kbd", { children: "Alt + /" }), _jsx("datalist", { id: "workspace-search-options", children: availableWorkspaces.map((item) => _jsx("option", { value: item.title }, item.id)) })] }), branches.length ? (_jsxs("label", { className: "workspace-branch-select", children: [_jsx(MapPin, { className: "workspace-branch-select__icon", size: 17, "aria-hidden": "true" }), _jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u0440\u0430\u0431\u043E\u0442\u044B" }), _jsx("select", { value: session.user.activeWarehouseId || '', disabled: branchBusy || branches.length === 1, onChange: (event) => void selectBranch(event.target.value), children: branches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id))) })] })) : null, _jsxs("div", { className: "header-notification-center", ref: notificationCenterRef, children: [_jsxs("button", { className: "modern-header-action", type: "button", title: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F", "aria-label": headerUnreadCount ? `Уведомления: ${headerUnreadCount} непрочитанных` : 'Уведомления', "aria-haspopup": "dialog", "aria-expanded": notificationCenterOpen, onClick: () => setNotificationCenterOpen((current) => !current), children: [_jsx(Bell, { size: 18, "aria-hidden": "true" }), headerUnreadCount > 0 ? _jsx("span", { children: headerUnreadCount > 99 ? '99+' : headerUnreadCount }) : null] }), notificationCenterOpen ? (_jsxs("section", { className: "header-notification-popover", role: "dialog", "aria-label": "\u0426\u0435\u043D\u0442\u0440 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }), _jsx("span", { children: headerUnreadCount
                                                                            ? `${headerUnreadCount} ${pluralizeNotificationCount(headerUnreadCount, 'непрочитанное', 'непрочитанных', 'непрочитанных')}`
                                                                            : 'Новых уведомлений нет' })] }), _jsx("button", { type: "button", className: "header-notification-popover__close", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F", onClick: () => setNotificationCenterOpen(false), children: _jsx(X, { size: 17, "aria-hidden": "true" }) })] }), headerNotifications.length ? (_jsx("div", { className: "header-notification-list", children: headerNotifications.map((notification) => (_jsxs("button", { className: `header-notification-item header-notification-item--${notification.severity}${notification.unread ? ' is-unread' : ''}`, type: "button", onClick: () => openHeaderNotification(notification), children: [_jsx("span", { className: "header-notification-item__icon", children: notification.severity === 'warning' || notification.severity === 'error'
                                                                        ? _jsx(AlertTriangle, { size: 17, "aria-hidden": "true" })
                                                                        : _jsx(Bell, { size: 17, "aria-hidden": "true" }) }), _jsxs("span", { className: "header-notification-item__body", children: [_jsx("strong", { children: notification.title }), _jsx("span", { children: notification.body }), _jsx("small", { children: notification.createdAt ? formatHeaderNotificationDate(notification.createdAt) : 'Открыть раздел' })] }), _jsx(ChevronRight, { size: 16, "aria-hidden": "true" })] }, notification.id))) })) : (_jsxs("div", { className: "header-notification-empty", children: [_jsx(Bell, { size: 22, "aria-hidden": "true" }), _jsx("strong", { children: "\u0412\u0441\u0451 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E" }), _jsx("span", { children: "\u041D\u043E\u0432\u044B\u0445 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439 \u0438 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u043D\u0435\u0442." })] }))] })) : null] }), availableWorkspaces.some((item) => item.id === 'ai') ? (_jsx("button", { className: "modern-header-action", type: "button", title: "\u041F\u043E\u043C\u043E\u0449\u043D\u0438\u043A \u0418\u0418", "aria-label": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u043C\u043E\u0449\u043D\u0438\u043A\u0430 \u0418\u0418", onClick: () => setActiveWorkspaceId('ai'), children: _jsx(CircleHelp, { size: 18, "aria-hidden": "true" }) })) : null, _jsx("span", { className: `status status--${activeWorkspace.status}`, children: statusLabel[activeWorkspace.status] }), _jsxs("label", { className: "ui-theme-switcher", title: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0442\u0435\u043C\u0443 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430", children: [_jsx(Palette, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0422\u0435\u043C\u0430" }), _jsx("select", { "aria-label": "\u0422\u0435\u043C\u0430 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430", value: uiTheme, onChange: (event) => setUiTheme(event.target.value), children: availableThemeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("div", { className: "workspace-user", children: [_jsx("span", { className: "workspace-user__avatar", "aria-hidden": "true", children: session.user.name.trim().charAt(0).toUpperCase() || 'W' }), _jsxs("div", { children: [_jsx("strong", { children: session.user.name }), _jsx("span", { children: session.user.email })] }), _jsx("span", { className: "status status--ready", children: sessionModeLabel(session.user) }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void logout(), title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u0435\u0441\u0441\u0438\u044E", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u0435\u0441\u0441\u0438\u044E", children: _jsx(LogOut, { size: 18, "aria-hidden": "true" }) })] })] })] }), _jsx("section", { ref: workspaceContentRef, className: `workspace-content workspace-content--${activeWorkspace.id}`, "aria-label": activeWorkspace.title, children: renderWorkspace(activeWorkspace.id, session, availableWorkspaces, setActiveWorkspaceId, uiTheme, branches, kizUnread) }), _jsxs("footer", { className: "workspace-footer", children: [_jsx("span", { children: "WMS \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0430 LOGOFF" }), _jsxs("span", { children: ["\u0420\u043E\u043B\u0438: ", session.user.roleCodes.join(', ') || 'нет роли'] })] })] })] }));
}
function uiThemeStorageKey(userId) {
    return `logoff-wms-ui-theme:${userId}`;
}
function loadUiTheme(user) {
    const stored = window.localStorage.getItem(uiThemeStorageKey(user.id));
    const matched = uiThemeOptions.find((option) => option.value === stored);
    if (!matched || (matched.personal === 'winx' && !hasWinxCursor(user))) {
        return 'classic';
    }
    return matched.value;
}
function isAdvancedTheme(theme) {
    return theme !== 'classic';
}
function uiThemeBase(theme) {
    return isAdvancedTheme(theme) ? 'modern' : 'classic';
}
function hasWinxCursor(user) {
    return wingXUserIds.has(user.id);
}
function formatHeaderNotificationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}
function pluralizeNotificationCount(count, one, few, many) {
    const absolute = Math.abs(count);
    const lastTwo = absolute % 100;
    if (lastTwo >= 11 && lastTwo <= 14)
        return many;
    const last = absolute % 10;
    if (last === 1)
        return one;
    if (last >= 2 && last <= 4)
        return few;
    return many;
}
function resolveHeaderNotificationTarget(notification, workspaceIds) {
    if (notification.requestId && workspaceIds.has('requests'))
        return 'requests';
    const text = `${notification.title} ${notification.body || ''}`.toLocaleLowerCase('ru-RU');
    const routes = [
        { pattern: /киз|маркировк|этикетк/, target: 'kiz' },
        { pattern: /сч[её]т|оплат|начислен|задолж/, target: 'billing' },
        { pattern: /достав|логист|машин|курьер/, target: 'logistics' },
        { pattern: /fbs|wildberries|ozon|маркетплейс|отгрузк/, target: 'fbs' },
    ];
    const matched = routes.find((route) => route.pattern.test(text) && workspaceIds.has(route.target));
    if (matched)
        return matched.target;
    if (workspaceIds.has('cabinet'))
        return 'cabinet';
    return 'overview';
}
function sessionModeLabel(user) {
    if (user.isDemo && user.roleCodes.includes('DEMO_PLUS')) {
        return 'ДЕМО ПЛЮС';
    }
    if (user.isDemo) {
        return 'ДЕМО';
    }
    return user.clientScopeMode;
}
function renderWorkspace(activeWorkspaceId, session, availableWorkspaces, setActiveWorkspaceId, uiTheme, branches, kizUnread) {
    switch (activeWorkspaceId) {
        case 'ai':
            return _jsx(WmsAiPanel, { session: session });
        case 'cabinet':
            return _jsx(ClientCabinetPanel, { session: session });
        case 'analytics':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0443\u2026" }), children: _jsx(AnalyticsPanel, { session: session }) });
        case 'access':
            return _jsx(AccessAdminPanel, { session: session });
        case 'administration':
            return (_jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0437\u0430\u0449\u0438\u0449\u0451\u043D\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0443\u0440\u2026" }), children: _jsx(AdministrationPanel, { session: session, onOpenWorkspace: setActiveWorkspaceId }) }));
        case 'directories':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0438\u2026" }), children: _jsx(DirectoryPanel, { session: session }) });
        case 'imports':
            return _jsx(ImportPanel, { session: session });
        case 'logistics':
            return _jsx(LogisticsQuotePanel, { session: session });
        case 'warehouse':
            return _jsx(WarehouseOpsPanel, { session: session });
        case 'branches':
            return _jsx(BranchesPanel, { session: session });
        case 'storage-zones':
            return _jsx(StorageZonesPanel, { session: session });
        case 'inventory':
            return _jsx(InventoryPanel, { session: session });
        case 'kiz':
            return _jsx(KizIssuesPanel, { session: session });
        case 'turnover':
            return _jsx(TurnoverPanel, { session: session });
        case 'requests':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0437\u0430\u044F\u0432\u043A\u0438\u2026" }), children: _jsx(ClientRequestsPanel, { session: session }) });
        case 'contracts':
            return _jsx(ContractsPanel, { session: session });
        case 'fbs':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E FBS\u2026" }), children: _jsx(FbsPanel, { session: session }) });
        case 'factory':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0444\u0430\u0431\u0440\u0438\u043A\u0443\u2026" }), children: _jsx(FactoryPanel, { session: session }) });
        case 'fbs-packed':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0436\u0443\u0440\u043D\u0430\u043B \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438\u2026" }), children: _jsx(FbsPackedItemsPanel, { session: session }) });
        case 'monitoring':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u044E \u0422\u0421\u0414\u2026" }), children: _jsx(TsdMonitoringPanel, { session: session }) });
        case 'dbs':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E DBS\u2026" }), children: _jsx(DbsPanel, { session: session }) });
        case 'fbo-ozon':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E FBO Ozon\u2026" }), children: _jsx(OzonFboPanel, { session: session }) });
        case 'relabeling':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0443\u2026" }), children: _jsx(RelabelingPanel, { session: session }) });
        case 'catalog':
            return _jsx(CatalogPanel, { session: session });
        case 'billing':
            return _jsx(Suspense, { fallback: _jsx("div", { className: "workspace-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u2026" }), children: _jsx(BillingPanel, { session: session }) });
        case 'expenses':
            return _jsx(ExpensesPanel, { session: session });
        case 'services':
            return _jsx(ServicesWorkspacePanel, { session: session });
        case 'own-companies':
            return _jsx(OwnCompaniesPanel, { session: session });
        case 'print':
            return _jsx(PrintPanel, { session: session });
        case 'service':
            return _jsx(ServiceCenterPanel, { session: session });
        case 'debug':
            return _jsx(DebugPanel, { session: session, onOpenWorkspace: setActiveWorkspaceId });
        case 'data':
            return _jsx(DashboardDataPanel, { session: session });
        case 'overview':
        default:
            return (_jsx(WorkspaceOverview, { items: availableWorkspaces, session: session, theme: uiTheme, branches: branches, kizUnread: kizUnread, onOpen: setActiveWorkspaceId }));
    }
}
function WorkspaceOverview({ items, session, theme, branches, kizUnread, onOpen, }) {
    const workspaces = items.filter((item) => item.id !== 'overview');
    const groups = groupWorkspaces(workspaces);
    if (isAdvancedTheme(theme)) {
        return (_jsx(ModernWorkspaceOverview, { items: workspaces, session: session, branches: branches, kizUnread: kizUnread, onOpen: onOpen }));
    }
    return (_jsxs("div", { className: "workspace-overview", children: [_jsxs("section", { className: "workspace-summary", "aria-label": "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0434\u043E\u0441\u0442\u0443\u043F\u0430", children: [_jsxs("article", { children: [_jsx(PanelLeft, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0431\u043E\u0447\u0438\u0435 \u0437\u043E\u043D\u044B" }), _jsx("strong", { children: workspaces.length })] }), _jsxs("article", { children: [_jsx(ShieldCheck, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u041A\u043E\u043D\u0442\u0443\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }), _jsx("strong", { children: session.user.clientScopeMode })] }), _jsxs("article", { children: [_jsx(UsersRound, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u043E\u043B\u0438" }), _jsx("strong", { children: session.user.roleCodes.join(', ') || 'нет роли' })] })] }), groups.map((group) => (_jsxs("section", { className: "workspace-group", "aria-label": group.title, children: [_jsxs("div", { className: "workspace-group__heading", children: [_jsx("h2", { children: group.title }), _jsx("span", { children: group.items.length })] }), _jsx("div", { className: "workspace-tiles", children: group.items.map((item) => {
                            const Icon = item.icon;
                            return (_jsxs("button", { className: "workspace-tile", type: "button", onClick: () => onOpen(item.id), children: [_jsx("span", { className: "workspace-tile__icon", children: _jsx(Icon, { size: 20, "aria-hidden": "true" }) }), _jsxs("span", { className: "workspace-tile__body", children: [_jsxs("span", { className: "workspace-tile__meta", children: [_jsx("span", { children: audienceLabel(item) }), _jsx("span", { className: `status status--${item.status}`, children: statusLabel[item.status] })] }), _jsx("strong", { children: item.title }), _jsx("small", { children: item.description }), _jsxs("span", { className: "workspace-tile__access", title: permissionTitle(item), children: [_jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }), permissionLabel(item)] })] }), _jsx(ChevronRight, { size: 16, "aria-hidden": "true" })] }, item.id));
                        }) })] }, group.id)))] }));
}
function ModernWorkspaceOverview({ items, session, branches, kizUnread, onOpen, }) {
    const activeBranch = branches.find((branch) => branch.id === session.user.activeWarehouseId);
    const attentionIds = ['kiz', 'fbs', 'requests', 'warehouse'];
    const quickAccessIds = ['billing', 'branches', 'storage-zones', 'analytics', 'imports'];
    const attentionItems = attentionIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item) => Boolean(item));
    const quickAccessItems = quickAccessIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item) => Boolean(item));
    return (_jsxs("div", { className: "modern-dashboard", children: [_jsxs("header", { className: "modern-dashboard__heading", children: [_jsxs("div", { children: [_jsx("span", { children: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date()) }), _jsx("h1", { children: "\u0421\u0435\u0433\u043E\u0434\u043D\u044F" })] }), _jsxs("span", { className: "modern-dashboard__branch", children: [_jsx(MapPin, { size: 16, "aria-hidden": "true" }), activeBranch ? `${activeBranch.city} · ${activeBranch.name}` : 'Доступные филиалы'] })] }), _jsxs("section", { className: "modern-dashboard__metrics", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 WMS", children: [_jsxs("article", { children: [_jsx("span", { className: "modern-dashboard__metric-icon modern-dashboard__metric-icon--blue", children: _jsx(PanelLeft, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "\u0420\u0430\u0431\u043E\u0447\u0438\u0435 \u043C\u043E\u0434\u0443\u043B\u0438" }), _jsx("strong", { children: items.length }), _jsx("small", { children: "\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E" })] })] }), _jsxs("article", { children: [_jsx("span", { className: "modern-dashboard__metric-icon modern-dashboard__metric-icon--green", children: _jsx(Building2, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B" }), _jsx("strong", { children: branches.length }), _jsx("small", { children: activeBranch?.city || 'текущий контур' })] })] }), _jsxs("article", { children: [_jsx("span", { className: "modern-dashboard__metric-icon modern-dashboard__metric-icon--orange", children: _jsx(AlertTriangle, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u041A\u0418\u0417" }), _jsx("strong", { children: kizUnread }), _jsx("small", { children: kizUnread ? 'требуют внимания' : 'непрочитанных нет' })] })] }), _jsxs("article", { children: [_jsx("span", { className: "modern-dashboard__metric-icon modern-dashboard__metric-icon--violet", children: _jsx(ShieldCheck, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0443\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }), _jsx("strong", { children: session.user.clientScopeMode }), _jsx("small", { children: "\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F" })] })] }), _jsxs("article", { children: [_jsx("span", { className: "modern-dashboard__metric-icon modern-dashboard__metric-icon--teal", children: _jsx(UsersRound, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "\u0420\u043E\u043B\u044C" }), _jsx("strong", { children: session.user.roleCodes[0] || 'USER' }), _jsx("small", { children: sessionModeLabel(session.user) })] })] })] }), _jsxs("div", { className: "modern-dashboard__columns", children: [_jsxs("section", { className: "modern-dashboard__panel", children: [_jsxs("header", { children: [_jsx("h2", { children: "\u0422\u0440\u0435\u0431\u0443\u044E\u0442 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u044F" }), _jsx("span", { children: kizUnread })] }), _jsx("div", { className: "modern-dashboard__queue", children: attentionItems.map((item) => {
                                    const Icon = item.icon;
                                    const isKiz = item.id === 'kiz';
                                    return (_jsxs("button", { type: "button", onClick: () => onOpen(item.id), children: [_jsx("span", { className: `modern-dashboard__queue-icon${isKiz && kizUnread ? ' is-danger' : ''}`, children: _jsx(Icon, { size: 18, "aria-hidden": "true" }) }), _jsxs("span", { children: [_jsx("strong", { children: item.title }), _jsx("small", { children: isKiz ? (kizUnread ? `${kizUnread} непрочитанных проблем` : 'Нет непрочитанных проблем') : item.description })] }), _jsx("span", { className: `modern-dashboard__queue-status${isKiz && kizUnread ? ' is-danger' : ''}`, children: isKiz && kizUnread ? 'Проверить' : 'Открыть' }), _jsx(ChevronRight, { size: 16, "aria-hidden": "true" })] }, item.id));
                                }) })] }), _jsxs("section", { className: "modern-dashboard__panel", children: [_jsxs("header", { children: [_jsx("h2", { children: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B" }), _jsx("span", { children: branches.length })] }), _jsxs("div", { className: "modern-dashboard__branches", children: [branches.map((branch) => (_jsxs("article", { className: branch.id === session.user.activeWarehouseId ? 'is-active' : '', children: [_jsxs("div", { children: [_jsxs("strong", { children: [branch.city, " \u00B7 ", branch.name] }), _jsx("span", { children: branch.ownCompany?.shortName || branch.address || branch.code })] }), _jsx("span", { className: "modern-dashboard__branch-status", children: branch.id === session.user.activeWarehouseId ? 'Выбран' : branch.isActive ? 'Активен' : 'Отключён' }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B" }), _jsx("dd", { children: branch._count?.clients ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("dd", { children: branch._count?.boxes ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0417\u0430\u044F\u0432\u043A\u0438" }), _jsx("dd", { children: branch._count?.requests ?? '—' })] })] })] }, branch.id))), !branches.length ? _jsx("p", { className: "modern-dashboard__empty", children: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u0440\u043E\u043B\u0438." }) : null] })] }), _jsxs("section", { className: "modern-dashboard__panel", children: [_jsxs("header", { children: [_jsx("h2", { children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F" }), _jsx("span", { children: quickAccessItems.length })] }), _jsx("div", { className: "modern-dashboard__quick", children: quickAccessItems.map((item) => {
                                    const Icon = item.icon;
                                    return (_jsxs("button", { type: "button", onClick: () => onOpen(item.id), children: [_jsx("span", { children: _jsx(Icon, { size: 18, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("strong", { children: item.title }), _jsx("small", { children: item.description })] }), _jsx(ChevronRight, { size: 16, "aria-hidden": "true" })] }, item.id));
                                }) })] })] })] }));
}
function groupWorkspaces(items) {
    return workspaceSections
        .map((section) => ({
        ...section,
        items: items.filter((item) => sectionForWorkspace(item.id) === section.id),
    }))
        .filter((section) => section.items.length > 0);
}
function sectionForWorkspace(id) {
    if (id === 'overview' || id === 'factory') {
        return 'main';
    }
    if (id === 'ai' || id === 'monitoring') {
        return 'control';
    }
    if (id === 'cabinet' || id === 'analytics' || id === 'requests' || id === 'contracts' || id === 'fbs' || id === 'dbs' || id === 'fbo-ozon' || id === 'relabeling' || id === 'catalog') {
        return 'client';
    }
    if (id === 'warehouse' || id === 'storage-zones' || id === 'inventory' || id === 'kiz' || id === 'turnover' || id === 'fbs-packed' || id === 'logistics' || id === 'print') {
        return 'operations';
    }
    if (id === 'access' || id === 'branches' || id === 'directories' || id === 'imports' || id === 'services' || id === 'billing' || id === 'expenses' || id === 'own-companies') {
        return 'management';
    }
    return 'control';
}
function audienceLabel(item) {
    if (item.audience === 'client') {
        return 'Клиент';
    }
    if (item.audience === 'internal') {
        return 'Внутренний';
    }
    return 'Общий';
}
function permissionLabel(item) {
    if (item.permissions.length === 0) {
        return 'доступен всем';
    }
    if (item.permissionMode === 'all') {
        return 'строгий доступ';
    }
    return 'доступ по роли';
}
function permissionTitle(item) {
    if (item.permissions.length === 0) {
        return 'Раздел доступен всем авторизованным пользователям';
    }
    return item.permissions.join(', ');
}
function defaultWorkspaceForUser(_user) {
    return 'overview';
}
function canKeepWorkspace(user, workspaceId) {
    const item = workspaceNav.find((candidate) => candidate.id === workspaceId);
    return Boolean(item && canOpenWorkspace(user, item));
}
