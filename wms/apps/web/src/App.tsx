import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  LogOut,
  MapPin,
  Menu,
  Palette,
  PanelLeft,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
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
import {
  activateBranch,
  fetchBranches,
  fetchClientNotifications,
  fetchKizIssues,
  fetchMe,
  logout as closeAuthSession,
  markClientNotificationRead,
  type AuthSession,
  type AuthUser,
  type BranchSummary,
  type ClientNotificationSummary,
} from './lib/api';
import { clearStoredSession, loadStoredSession, storeSession } from './lib/session';
import { canOpenWorkspace, workspaceNav, type WorkspaceId, type WorkspaceNavItem } from './lib/workspaces';

const AnalyticsPanel = lazy(() => import('./components/analytics/AnalyticsPanel').then((module) => ({ default: module.AnalyticsPanel })));
const AdministrationPanel = lazy(() =>
  import('./components/administration/AdministrationPanel').then((module) => ({
    default: module.AdministrationPanel,
  })),
);
const IntegrationApiPanel = lazy(() =>
  import('./components/integration-api/IntegrationApiPanel').then((module) => ({
    default: module.IntegrationApiPanel,
  })),
);
const BillingPanel = lazy(() =>
  import('./components/billing/BillingPanel').then((module) => ({ default: module.BillingPanel })),
);
const ClientRequestsPanel = lazy(() =>
  import('./components/client-requests/ClientRequestsPanel').then((module) => ({
    default: module.ClientRequestsPanel,
  })),
);
const DirectoryPanel = lazy(() =>
  import('./components/directories/DirectoryPanel').then((module) => ({ default: module.DirectoryPanel })),
);
const FbsPanel = lazy(() =>
  import('./components/fbs/FbsPanel').then((module) => ({ default: module.FbsPanel })),
);
const FactoryPanel = lazy(() => import('./components/factory/FactoryPanel').then((module) => ({ default: module.FactoryPanel })));
const FbsPackedItemsPanel = lazy(() =>
  import('./components/fbs-packed/FbsPackedItemsPanel').then((module) => ({ default: module.FbsPackedItemsPanel })),
);
const TsdMonitoringPanel = lazy(() =>
  import('./components/monitoring/TsdMonitoringPanel').then((module) => ({ default: module.TsdMonitoringPanel })),
);
const DbsPanel = lazy(() =>
  import('./components/dbs/DbsPanel').then((module) => ({ default: module.DbsPanel })),
);
const OzonFboPanel = lazy(() =>
  import('./components/ozon-fbo/OzonFboPanel').then((module) => ({ default: module.OzonFboPanel })),
);
const RelabelingPanel = lazy(() =>
  import('./components/relabeling/RelabelingPanel').then((module) => ({ default: module.RelabelingPanel })),
);
const OrderAssemblyPanel = lazy(() =>
  import('./components/order-assembly/OrderAssemblyPanel').then((module) => ({ default: module.OrderAssemblyPanel })),
);

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
] as const;

type WorkspaceSection = (typeof workspaceSections)[number]['id'];
type UiTheme = 'classic' | 'modern' | 'aerospace' | 'obsidian' | 'polar' | 'future3100' | 'winx';
type HeaderNotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt?: string;
  target: WorkspaceId;
  severity: 'info' | 'success' | 'warning' | 'error';
  unread: boolean;
  source?: ClientNotificationSummary;
};

const uiThemeOptions: Array<{ value: UiTheme; label: string; personal?: 'winx' }> = [
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
  const [session, setSession] = useState<AuthSession | null>(() => initialSession);
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => initialTheme);
  const [isRestoring, setRestoring] = useState(Boolean(session));
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId>(() =>
    initialSession ? defaultWorkspaceForUser(initialSession.user) : 'overview',
  );
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchBusy, setBranchBusy] = useState(false);
  const [kizUnread, setKizUnread] = useState(0);
  const [clientNotifications, setClientNotifications] = useState<ClientNotificationSummary[]>([]);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [modernSidebarCollapsed, setModernSidebarCollapsed] = useState(false);
  const workspaceContentRef = useRef<HTMLElement | null>(null);
  const modernSearchRef = useRef<HTMLInputElement | null>(null);
  const notificationCenterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (session) return undefined;
    const syncPublicView = () => setShowAuthPanel(window.location.hash === '#login');
    syncPublicView();
    window.addEventListener('popstate', syncPublicView);
    return () => window.removeEventListener('popstate', syncPublicView);
  }, [session]);

  function openLogin() {
    if (window.location.hash !== '#login') window.history.pushState({ logoffAuth: true }, '', '#login');
    setShowAuthPanel(true);
  }

  function returnToLanding() {
    if (window.location.hash === '#login') window.history.back();
    else setShowAuthPanel(false);
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
      } catch {
        clearStoredSession();
        if (isActive) {
          setSession(null);
        }
      } finally {
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
        if (!isActive) return;
        setBranches(items);
        if (
          items[0] &&
          !items.some((branch) => branch.id === session.user.activeWarehouseId)
        ) {
          const selected = await activateBranch(session.accessToken, items[0].id);
          if (!isActive) return;
          const user = await fetchMe(session.accessToken);
          if (!isActive) return;
          const nextSession = {
            ...session,
            user: { ...user, activeWarehouseId: selected.id },
          };
          setSession(nextSession);
          storeSession(nextSession);
        }
      })
      .catch(() => {
        if (isActive) setBranches([]);
      });

    return () => {
      isActive = false;
    };
  }, [session?.accessToken, session?.user.activeWarehouseId]);

  useEffect(() => {
    if (
      !session?.accessToken ||
      !session.user.permissionCodes.includes('system:admin')
    ) {
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
          if (isActive) setKizUnread(report.summary.unread);
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
    if (
      !session?.accessToken ||
      !session.user.permissionCodes.includes('client-notifications:read')
    ) {
      setClientNotifications([]);
      return;
    }

    let isActive = true;
    const loadNotifications = () => {
      void fetchClientNotifications(session.accessToken)
        .then((items) => {
          if (!isActive) return;
          setClientNotifications(
            [...items]
              .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
              .slice(0, 12),
          );
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
    if (!notificationCenterOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !notificationCenterRef.current?.contains(event.target)
      ) {
        setNotificationCenterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationCenterOpen(false);
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
  const headerNotifications = useMemo<HeaderNotificationItem[]>(() => {
    const workspaceIds = new Set(availableWorkspaces.map((item) => item.id));
    const items: HeaderNotificationItem[] = [];

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
        severity: notification.severity.toLowerCase() as HeaderNotificationItem['severity'],
        unread: !notification.isRead,
        source: notification,
      });
    }

    return items.slice(0, 10);
  }, [availableWorkspaces, clientNotifications, kizUnread]);
  const headerUnreadCount = headerNotifications.reduce(
    (total, item) => total + (item.id === 'kiz-open-issues' ? kizUnread : item.unread ? 1 : 0),
    0,
  );

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
    if (!isAdvancedTheme(uiTheme)) return;

    const focusWorkspaceSearch = (event: KeyboardEvent) => {
      if (event.altKey && event.key === '/') {
        event.preventDefault();
        modernSearchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', focusWorkspaceSearch);
    return () => window.removeEventListener('keydown', focusWorkspaceSearch);
  }, [uiTheme]);

  function acceptSession(nextSession: AuthSession) {
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
      } catch {
        // Локальный выход должен сработать даже при недоступном API или уже закрытой сессии.
      }
    }
    clearStoredSession();
    setSession(null);
    window.history.replaceState(null, '', window.location.pathname);
    setShowAuthPanel(false);
  }

  async function selectBranch(branchId: string) {
    if (!session || branchId === session.user.activeWarehouseId) return;
    setBranchBusy(true);
    try {
      await activateBranch(session.accessToken, branchId);
      const user = await fetchMe(session.accessToken);
      const nextSession = {
        ...session,
        user,
      };
      setSession(nextSession);
      storeSession(nextSession);
      setActiveWorkspaceId((current) => (
        canKeepWorkspace(user, current) ? current : defaultWorkspaceForUser(user)
      ));
    } finally {
      setBranchBusy(false);
    }
  }

  function openHeaderNotification(item: HeaderNotificationItem) {
    setNotificationCenterOpen(false);
    setActiveWorkspaceId(item.target);

    if (!item.source || item.source.isRead || !session?.accessToken) return;

    setClientNotifications((current) => current.map((notification) => (
      notification.id === item.source?.id
        ? { ...notification, isRead: true, readAt: new Date().toISOString() }
        : notification
    )));
    void markClientNotificationRead(session.accessToken, item.source.id)
      .catch(() => {
        setClientNotifications((current) => current.map((notification) => (
          notification.id === item.source?.id ? item.source : notification
        )));
      });
  }

  if (isRestoring) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-panel--loading" aria-live="polite">
          <p className="eyebrow">Фулфилмент LOGOFF</p>
          <h1>Проверка сессии</h1>
        </section>
      </main>
    );
  }

  if (!session) {
    return showAuthPanel
      ? <AuthPanel onSession={acceptSession} onBack={returnToLanding} />
      : <MarketingLanding onLogin={openLogin} />;
  }

  const activeWorkspace = availableWorkspaces.find((item) => item.id === activeWorkspaceId) ?? availableWorkspaces[0];
  const appLayoutClassName = [
    'app-layout',
    hasWinxCursor(session.user) ? 'winx-cursor' : '',
    isAdvancedTheme(uiTheme) && modernSidebarCollapsed ? 'app-layout--sidebar-collapsed' : '',
  ].filter(Boolean).join(' ');
  const baseUiTheme = uiThemeBase(uiTheme);
  const availableThemeOptions = uiThemeOptions.filter((option) => !option.personal || hasWinxCursor(session.user));

  function openWorkspaceFromSearch(value: string) {
    const normalized = value.trim().toLocaleLowerCase('ru-RU');
    if (!normalized) return;

    const match = availableWorkspaces.find((item) => (
      item.title.toLocaleLowerCase('ru-RU').includes(normalized)
      || item.description.toLocaleLowerCase('ru-RU').includes(normalized)
    ));
    if (match) {
      setActiveWorkspaceId(match.id);
      if (modernSearchRef.current) modernSearchRef.current.value = '';
    }
  }

  return (
    <div
      className={appLayoutClassName}
      data-ui-theme={baseUiTheme}
      data-ui-variant={uiTheme}
      data-workspace={activeWorkspace.id}
    >
      <aside className="app-sidebar" aria-label="Навигация WMS">
        <div className="app-sidebar__brand">
          <span className="app-sidebar__brand-name">LOGOFF</span>
          <strong>WMS</strong>
          <small>Управление фулфилментом</small>
          <button
            className="modern-sidebar-toggle"
            type="button"
            aria-label={modernSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={modernSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            onClick={() => setModernSidebarCollapsed((current) => !current)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
        </div>

        <nav className="workspace-nav">
          {groupedWorkspaces.map((group) => (
            <section className="workspace-nav__group" key={group.id}>
              <p>{group.title}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeWorkspace.id;

                return (
                  <button
                    className={isActive ? 'active' : ''}
                    key={item.id}
                    type="button"
                    onClick={() => setActiveWorkspaceId(item.id)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.title}</span>
                    {item.id === 'kiz' && kizUnread > 0 ? (
                      <strong
                        className="workspace-nav__badge"
                        aria-label={`Непрочитанных проблем КИЗ: ${kizUnread}`}
                      >
                        {kizUnread > 99 ? '99+' : kizUnread}
                      </strong>
                    ) : null}
                  </button>
                );
              })}
            </section>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <span>Доступно разделов</span>
          <strong>{Math.max(availableWorkspaces.length - 1, 0)}</strong>
        </div>
      </aside>

      <main className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-header__title">
            <p className="eyebrow">{activeWorkspace.eyebrow}</p>
            <h1>{activeWorkspace.title}</h1>
            <p className="workspace-header__description">{activeWorkspace.description}</p>
          </div>

          <div className="workspace-header__meta">
            <label className="workspace-global-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={modernSearchRef}
                type="search"
                list="workspace-search-options"
                placeholder="Найти раздел или операцию"
                aria-label="Глобальный поиск по разделам"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openWorkspaceFromSearch(event.currentTarget.value);
                }}
              />
              <kbd>Alt + /</kbd>
              <datalist id="workspace-search-options">
                {availableWorkspaces.map((item) => <option key={item.id} value={item.title} />)}
              </datalist>
            </label>
            {branches.length ? (
              <label className="workspace-branch-select">
                <MapPin className="workspace-branch-select__icon" size={17} aria-hidden="true" />
                <span>Город работы</span>
                <select
                  value={session.user.activeWarehouseId || ''}
                  disabled={branchBusy || branches.length === 1}
                  onChange={(event) => void selectBranch(event.target.value)}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.city} · {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="header-notification-center" ref={notificationCenterRef}>
              <button
                className="modern-header-action"
                type="button"
                title="Уведомления"
                aria-label={headerUnreadCount ? `Уведомления: ${headerUnreadCount} непрочитанных` : 'Уведомления'}
                aria-haspopup="dialog"
                aria-expanded={notificationCenterOpen}
                onClick={() => setNotificationCenterOpen((current) => !current)}
              >
                <Bell size={18} aria-hidden="true" />
                {headerUnreadCount > 0 ? <span>{headerUnreadCount > 99 ? '99+' : headerUnreadCount}</span> : null}
              </button>

              {notificationCenterOpen ? (
                <section className="header-notification-popover" role="dialog" aria-label="Центр уведомлений">
                  <header>
                    <div>
                      <strong>Уведомления</strong>
                      <span>
                        {headerUnreadCount
                          ? `${headerUnreadCount} ${pluralizeNotificationCount(headerUnreadCount, 'непрочитанное', 'непрочитанных', 'непрочитанных')}`
                          : 'Новых уведомлений нет'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="header-notification-popover__close"
                      aria-label="Закрыть уведомления"
                      onClick={() => setNotificationCenterOpen(false)}
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </header>

                  {headerNotifications.length ? (
                    <div className="header-notification-list">
                      {headerNotifications.map((notification) => (
                        <button
                          className={`header-notification-item header-notification-item--${notification.severity}${notification.unread ? ' is-unread' : ''}`}
                          key={notification.id}
                          type="button"
                          onClick={() => openHeaderNotification(notification)}
                        >
                          <span className="header-notification-item__icon">
                            {notification.severity === 'warning' || notification.severity === 'error'
                              ? <AlertTriangle size={17} aria-hidden="true" />
                              : <Bell size={17} aria-hidden="true" />}
                          </span>
                          <span className="header-notification-item__body">
                            <strong>{notification.title}</strong>
                            <span>{notification.body}</span>
                            <small>
                              {notification.createdAt ? formatHeaderNotificationDate(notification.createdAt) : 'Открыть раздел'}
                            </small>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="header-notification-empty">
                      <Bell size={22} aria-hidden="true" />
                      <strong>Всё спокойно</strong>
                      <span>Новых уведомлений и проблем нет.</span>
                    </div>
                  )}
                </section>
              ) : null}
            </div>
            {availableWorkspaces.some((item) => item.id === 'ai') ? (
              <button
                className="modern-header-action"
                type="button"
                title="Помощник ИИ"
                aria-label="Открыть помощника ИИ"
                onClick={() => setActiveWorkspaceId('ai')}
              >
                <CircleHelp size={18} aria-hidden="true" />
              </button>
            ) : null}
            <span className={`status status--${activeWorkspace.status}`}>{statusLabel[activeWorkspace.status]}</span>
            <label className="ui-theme-switcher" title="Выбрать тему интерфейса">
              <Palette size={16} aria-hidden="true" />
              <span>Тема</span>
              <select
                aria-label="Тема интерфейса"
                value={uiTheme}
                onChange={(event) => setUiTheme(event.target.value as UiTheme)}
              >
                {availableThemeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="workspace-user">
              <span className="workspace-user__avatar" aria-hidden="true">
                {session.user.name.trim().charAt(0).toUpperCase() || 'W'}
              </span>
              <div>
                <strong>{session.user.name}</strong>
                <span>{session.user.email}</span>
              </div>
              <span className="status status--ready">{sessionModeLabel(session.user)}</span>
              <button className="icon-button" type="button" onClick={() => void logout()} title="Закрыть сессию" aria-label="Закрыть сессию">
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <section
          ref={workspaceContentRef}
          className={`workspace-content workspace-content--${activeWorkspace.id}`}
          aria-label={activeWorkspace.title}
        >
          {renderWorkspace(
            activeWorkspace.id,
            session,
            availableWorkspaces,
            setActiveWorkspaceId,
            uiTheme,
            branches,
            kizUnread,
          )}
        </section>

        <footer className="workspace-footer">
          <span>WMS фулфилмента LOGOFF</span>
          <span>Роли: {session.user.roleCodes.join(', ') || 'нет роли'}</span>
        </footer>
      </main>
    </div>
  );
}

function uiThemeStorageKey(userId: string) {
  return `logoff-wms-ui-theme:${userId}`;
}

function loadUiTheme(user: AuthUser): UiTheme {
  const stored = window.localStorage.getItem(uiThemeStorageKey(user.id));
  const matched = uiThemeOptions.find((option) => option.value === stored);
  if (!matched || (matched.personal === 'winx' && !hasWinxCursor(user))) {
    return 'classic';
  }
  return matched.value;
}

function isAdvancedTheme(theme: UiTheme) {
  return theme !== 'classic';
}

function uiThemeBase(theme: UiTheme) {
  return isAdvancedTheme(theme) ? 'modern' : 'classic';
}

function hasWinxCursor(user: AuthUser) {
  return wingXUserIds.has(user.id);
}

function formatHeaderNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function pluralizeNotificationCount(count: number, one: string, few: string, many: string) {
  const absolute = Math.abs(count);
  const lastTwo = absolute % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = absolute % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function resolveHeaderNotificationTarget(
  notification: ClientNotificationSummary,
  workspaceIds: Set<WorkspaceId>,
): WorkspaceId {
  if (notification.requestId && workspaceIds.has('requests')) return 'requests';

  const text = `${notification.title} ${notification.body || ''}`.toLocaleLowerCase('ru-RU');
  const routes: Array<{ pattern: RegExp; target: WorkspaceId }> = [
    { pattern: /киз|маркировк|этикетк/, target: 'kiz' },
    { pattern: /сч[её]т|оплат|начислен|задолж/, target: 'billing' },
    { pattern: /достав|логист|машин|курьер/, target: 'logistics' },
    { pattern: /fbs|wildberries|ozon|маркетплейс|отгрузк/, target: 'fbs' },
  ];

  const matched = routes.find((route) => route.pattern.test(text) && workspaceIds.has(route.target));
  if (matched) return matched.target;
  if (workspaceIds.has('cabinet')) return 'cabinet';
  return 'overview';
}

function sessionModeLabel(user: AuthUser) {
  if (user.isDemo && user.roleCodes.includes('DEMO_PLUS')) {
    return 'ДЕМО ПЛЮС';
  }

  if (user.isDemo) {
    return 'ДЕМО';
  }
  return user.clientScopeMode;
}

function renderWorkspace(
  activeWorkspaceId: WorkspaceId,
  session: AuthSession,
  availableWorkspaces: WorkspaceNavItem[],
  setActiveWorkspaceId: (id: WorkspaceId) => void,
  uiTheme: UiTheme,
  branches: BranchSummary[],
  kizUnread: number,
) {
  switch (activeWorkspaceId) {
    case 'ai':
      return <WmsAiPanel session={session} />;
    case 'cabinet':
      return <ClientCabinetPanel session={session} />;
    case 'analytics':
      return <Suspense fallback={<div className="workspace-loading">Загружаю аналитику…</div>}><AnalyticsPanel session={session} /></Suspense>;
    case 'access':
      return <AccessAdminPanel session={session} />;
    case 'administration':
      return (
        <Suspense fallback={<div className="workspace-loading">Загружаю защищённый контур…</div>}>
          <AdministrationPanel session={session} onOpenWorkspace={setActiveWorkspaceId} />
        </Suspense>
      );
    case 'integration-api':
      return (
        <Suspense fallback={<div className="workspace-loading">Загружаю API WMS…</div>}>
          <IntegrationApiPanel session={session} />
        </Suspense>
      );
    case 'directories':
      return <Suspense fallback={<div className="workspace-loading">Загружаю справочники…</div>}><DirectoryPanel session={session} /></Suspense>;
    case 'imports':
      return <ImportPanel session={session} />;
    case 'logistics':
      return <LogisticsQuotePanel session={session} />;
    case 'warehouse':
      return <WarehouseOpsPanel session={session} />;
    case 'branches':
      return <BranchesPanel session={session} />;
    case 'storage-zones':
      return <StorageZonesPanel session={session} />;
    case 'inventory':
      return <InventoryPanel session={session} />;
    case 'kiz':
      return <KizIssuesPanel session={session} />;
    case 'turnover':
      return <TurnoverPanel session={session} />;
    case 'requests':
      return <Suspense fallback={<div className="workspace-loading">Загружаю заявки…</div>}><ClientRequestsPanel session={session} onOpenFbsOrders={() => setActiveWorkspaceId('fbs')} /></Suspense>;
    case 'order-assembly':
      return <Suspense fallback={<div className="workspace-loading">Загружаю сборку заказов…</div>}><OrderAssemblyPanel session={session} /></Suspense>;
    case 'contracts':
      return <ContractsPanel session={session} />;
    case 'fbs':
      return <Suspense fallback={<div className="workspace-loading">Загружаю FBS…</div>}><FbsPanel session={session} /></Suspense>;
    case 'factory':
      return <Suspense fallback={<div className="workspace-loading">Загружаю фабрику…</div>}><FactoryPanel session={session} /></Suspense>;
    case 'fbs-packed':
      return <Suspense fallback={<div className="workspace-loading">Загружаю журнал упаковки…</div>}><FbsPackedItemsPanel session={session} /></Suspense>;
    case 'monitoring':
      return <Suspense fallback={<div className="workspace-loading">Подключаю ТСД…</div>}><TsdMonitoringPanel session={session} /></Suspense>;
    case 'dbs':
      return <Suspense fallback={<div className="workspace-loading">Загружаю DBS…</div>}><DbsPanel session={session} /></Suspense>;
    case 'fbo-ozon':
      return <Suspense fallback={<div className="workspace-loading">Загружаю FBO Ozon…</div>}><OzonFboPanel session={session} /></Suspense>;
    case 'relabeling':
      return <Suspense fallback={<div className="workspace-loading">Загружаю переклейку…</div>}><RelabelingPanel session={session} /></Suspense>;
    case 'catalog':
      return <CatalogPanel session={session} />;
    case 'billing':
      return <Suspense fallback={<div className="workspace-loading">Загружаю биллинг…</div>}><BillingPanel session={session} /></Suspense>;
    case 'expenses':
      return <ExpensesPanel session={session} />;
    case 'services':
      return <ServicesWorkspacePanel session={session} />;
    case 'own-companies':
      return <OwnCompaniesPanel session={session} />;
    case 'print':
      return <PrintPanel session={session} />;
    case 'service':
      return <ServiceCenterPanel session={session} />;
    case 'debug':
      return <DebugPanel session={session} onOpenWorkspace={setActiveWorkspaceId} />;
    case 'data':
      return <DashboardDataPanel session={session} />;
    case 'overview':
    default:
      return (
        <WorkspaceOverview
          items={availableWorkspaces}
          session={session}
          theme={uiTheme}
          branches={branches}
          kizUnread={kizUnread}
          onOpen={setActiveWorkspaceId}
        />
      );
  }
}

function WorkspaceOverview({
  items,
  session,
  theme,
  branches,
  kizUnread,
  onOpen,
}: {
  items: WorkspaceNavItem[];
  session: AuthSession;
  theme: UiTheme;
  branches: BranchSummary[];
  kizUnread: number;
  onOpen: (id: WorkspaceId) => void;
}) {
  const workspaces = items.filter((item) => item.id !== 'overview');
  const groups = groupWorkspaces(workspaces);

  if (isAdvancedTheme(theme)) {
    return (
      <ModernWorkspaceOverview
        items={workspaces}
        session={session}
        branches={branches}
        kizUnread={kizUnread}
        onOpen={onOpen}
      />
    );
  }

  return (
    <div className="workspace-overview">
      <section className="workspace-summary" aria-label="Профиль доступа">
        <article>
          <PanelLeft size={18} aria-hidden="true" />
          <span>Рабочие зоны</span>
          <strong>{workspaces.length}</strong>
        </article>
        <article>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Контур доступа</span>
          <strong>{session.user.clientScopeMode}</strong>
        </article>
        <article>
          <UsersRound size={18} aria-hidden="true" />
          <span>Роли</span>
          <strong>{session.user.roleCodes.join(', ') || 'нет роли'}</strong>
        </article>
      </section>

      {groups.map((group) => (
        <section className="workspace-group" key={group.id} aria-label={group.title}>
          <div className="workspace-group__heading">
            <h2>{group.title}</h2>
            <span>{group.items.length}</span>
          </div>

          <div className="workspace-tiles">
            {group.items.map((item) => {
              const Icon = item.icon;

              return (
                <button className="workspace-tile" key={item.id} type="button" onClick={() => onOpen(item.id)}>
                  <span className="workspace-tile__icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="workspace-tile__body">
                    <span className="workspace-tile__meta">
                      <span>{audienceLabel(item)}</span>
                      <span className={`status status--${item.status}`}>{statusLabel[item.status]}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                    <span className="workspace-tile__access" title={permissionTitle(item)}>
                      <CheckCircle2 size={14} aria-hidden="true" />
                      {permissionLabel(item)}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModernWorkspaceOverview({
  items,
  session,
  branches,
  kizUnread,
  onOpen,
}: {
  items: WorkspaceNavItem[];
  session: AuthSession;
  branches: BranchSummary[];
  kizUnread: number;
  onOpen: (id: WorkspaceId) => void;
}) {
  const activeBranch = branches.find((branch) => branch.id === session.user.activeWarehouseId);
  const attentionIds: WorkspaceId[] = ['kiz', 'fbs', 'requests', 'warehouse'];
  const quickAccessIds: WorkspaceId[] = ['billing', 'branches', 'storage-zones', 'analytics', 'imports'];
  const attentionItems = attentionIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is WorkspaceNavItem => Boolean(item));
  const quickAccessItems = quickAccessIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is WorkspaceNavItem => Boolean(item));

  return (
    <div className="modern-dashboard">
      <header className="modern-dashboard__heading">
        <div>
          <span>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date())}</span>
          <h1>Сегодня</h1>
        </div>
        <span className="modern-dashboard__branch">
          <MapPin size={16} aria-hidden="true" />
          {activeBranch ? `${activeBranch.city} · ${activeBranch.name}` : 'Доступные филиалы'}
        </span>
      </header>

      <section className="modern-dashboard__metrics" aria-label="Сводка WMS">
        <article>
          <span className="modern-dashboard__metric-icon modern-dashboard__metric-icon--blue">
            <PanelLeft size={19} aria-hidden="true" />
          </span>
          <div><span>Рабочие модули</span><strong>{items.length}</strong><small>доступно пользователю</small></div>
        </article>
        <article>
          <span className="modern-dashboard__metric-icon modern-dashboard__metric-icon--green">
            <Building2 size={19} aria-hidden="true" />
          </span>
          <div><span>Филиалы</span><strong>{branches.length}</strong><small>{activeBranch?.city || 'текущий контур'}</small></div>
        </article>
        <article>
          <span className="modern-dashboard__metric-icon modern-dashboard__metric-icon--orange">
            <AlertTriangle size={19} aria-hidden="true" />
          </span>
          <div><span>Проблемы КИЗ</span><strong>{kizUnread}</strong><small>{kizUnread ? 'требуют внимания' : 'непрочитанных нет'}</small></div>
        </article>
        <article>
          <span className="modern-dashboard__metric-icon modern-dashboard__metric-icon--violet">
            <ShieldCheck size={19} aria-hidden="true" />
          </span>
          <div><span>Контур доступа</span><strong>{session.user.clientScopeMode}</strong><small>активные ограничения</small></div>
        </article>
        <article>
          <span className="modern-dashboard__metric-icon modern-dashboard__metric-icon--teal">
            <UsersRound size={19} aria-hidden="true" />
          </span>
          <div><span>Роль</span><strong>{session.user.roleCodes[0] || 'USER'}</strong><small>{sessionModeLabel(session.user)}</small></div>
        </article>
      </section>

      <div className="modern-dashboard__columns">
        <section className="modern-dashboard__panel">
          <header><h2>Требуют внимания</h2><span>{kizUnread}</span></header>
          <div className="modern-dashboard__queue">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              const isKiz = item.id === 'kiz';
              return (
                <button key={item.id} type="button" onClick={() => onOpen(item.id)}>
                  <span className={`modern-dashboard__queue-icon${isKiz && kizUnread ? ' is-danger' : ''}`}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span><strong>{item.title}</strong><small>{isKiz ? (kizUnread ? `${kizUnread} непрочитанных проблем` : 'Нет непрочитанных проблем') : item.description}</small></span>
                  <span className={`modern-dashboard__queue-status${isKiz && kizUnread ? ' is-danger' : ''}`}>
                    {isKiz && kizUnread ? 'Проверить' : 'Открыть'}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="modern-dashboard__panel">
          <header><h2>Филиалы</h2><span>{branches.length}</span></header>
          <div className="modern-dashboard__branches">
            {branches.map((branch) => (
              <article className={branch.id === session.user.activeWarehouseId ? 'is-active' : ''} key={branch.id}>
                <div>
                  <strong>{branch.city} · {branch.name}</strong>
                  <span>{branch.ownCompany?.shortName || branch.address || branch.code}</span>
                </div>
                <span className="modern-dashboard__branch-status">
                  {branch.id === session.user.activeWarehouseId ? 'Выбран' : branch.isActive ? 'Активен' : 'Отключён'}
                </span>
                <dl>
                  <div><dt>Клиенты</dt><dd>{branch._count?.clients ?? '—'}</dd></div>
                  <div><dt>Короба</dt><dd>{branch._count?.boxes ?? '—'}</dd></div>
                  <div><dt>Заявки</dt><dd>{branch._count?.requests ?? '—'}</dd></div>
                </dl>
              </article>
            ))}
            {!branches.length ? <p className="modern-dashboard__empty">Филиалы недоступны для этой роли.</p> : null}
          </div>
        </section>

        <section className="modern-dashboard__panel">
          <header><h2>Быстрый доступ</h2><span>{quickAccessItems.length}</span></header>
          <div className="modern-dashboard__quick">
            {quickAccessItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" onClick={() => onOpen(item.id)}>
                  <span><Icon size={18} aria-hidden="true" /></span>
                  <div><strong>{item.title}</strong><small>{item.description}</small></div>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function groupWorkspaces(items: WorkspaceNavItem[]) {
  return workspaceSections
    .map((section) => ({
      ...section,
      items: items.filter((item) => sectionForWorkspace(item.id) === section.id),
    }))
    .filter((section) => section.items.length > 0);
}

function sectionForWorkspace(id: WorkspaceId): WorkspaceSection {
  if (id === 'overview') {
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

  if (id === 'access' || id === 'integration-api' || id === 'branches' || id === 'directories' || id === 'imports' || id === 'services' || id === 'billing' || id === 'expenses' || id === 'own-companies') {
    return 'management';
  }

  return 'control';
}

function audienceLabel(item: WorkspaceNavItem) {
  if (item.audience === 'client') {
    return 'Клиент';
  }

  if (item.audience === 'internal') {
    return 'Внутренний';
  }

  return 'Общий';
}

function permissionLabel(item: WorkspaceNavItem) {
  if (item.permissions.length === 0) {
    return 'доступен всем';
  }

  if (item.permissionMode === 'all') {
    return 'строгий доступ';
  }

  return 'доступ по роли';
}

function permissionTitle(item: WorkspaceNavItem) {
  if (item.permissions.length === 0) {
    return 'Раздел доступен всем авторизованным пользователям';
  }

  return item.permissions.join(', ');
}

function defaultWorkspaceForUser(_user: AuthUser): WorkspaceId {
  return 'overview';
}

function canKeepWorkspace(user: AuthUser, workspaceId: WorkspaceId) {
  const item = workspaceNav.find((candidate) => candidate.id === workspaceId);
  return Boolean(item && canOpenWorkspace(user, item));
}
