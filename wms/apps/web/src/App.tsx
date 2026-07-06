import { CheckCircle2, ChevronRight, LogOut, PanelLeft, ShieldCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AccessAdminPanel } from './components/access/AccessAdminPanel';
import { AuthPanel } from './components/AuthPanel';
import { BillingPanel } from './components/billing/BillingPanel';
import { CatalogPanel } from './components/catalog/CatalogPanel';
import { ClientCabinetPanel } from './components/client-cabinet/ClientCabinetPanel';
import { ClientRequestsPanel } from './components/client-requests/ClientRequestsPanel';
import { ClientServicesPanel } from './components/client-services/ClientServicesPanel';
import { DashboardDataPanel } from './components/DashboardDataPanel';
import { DebugPanel } from './components/debug/DebugPanel';
import { DirectoryPanel } from './components/directories/DirectoryPanel';
import { ImportPanel } from './components/imports/ImportPanel';
import { LogisticsQuotePanel } from './components/logistics/LogisticsQuotePanel';
import { OwnCompaniesPanel } from './components/own-companies/OwnCompaniesPanel';
import { PrintPanel } from './components/print/PrintPanel';
import { ReferralPanel } from './components/referrals/ReferralPanel';
import { ServiceCenterPanel } from './components/service/ServiceCenterPanel';
import { TurnoverPanel } from './components/turnover/TurnoverPanel';
import { WarehouseOpsPanel } from './components/warehouse/WarehouseOpsPanel';
import { fetchMe, type AuthSession, type AuthUser } from './lib/api';
import { clearStoredSession, loadStoredSession, storeSession } from './lib/session';
import { canOpenWorkspace, workspaceNav, type WorkspaceId, type WorkspaceNavItem } from './lib/workspaces';

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
] as const;

type WorkspaceSection = (typeof workspaceSections)[number]['id'];

const initialSession = loadStoredSession();

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => initialSession);
  const [isRestoring, setRestoring] = useState(Boolean(session));
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId>(() =>
    initialSession ? defaultWorkspaceForUser(initialSession.user) : 'overview',
  );

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

  const availableWorkspaces = useMemo(() => {
    if (!session) {
      return [];
    }

    return workspaceNav.filter((item) => canOpenWorkspace(session.user, item));
  }, [session]);
  const groupedWorkspaces = useMemo(() => groupWorkspaces(availableWorkspaces), [availableWorkspaces]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (!availableWorkspaces.some((item) => item.id === activeWorkspaceId)) {
      setActiveWorkspaceId(defaultWorkspaceForUser(session.user));
    }
  }, [activeWorkspaceId, availableWorkspaces, session]);

  function acceptSession(nextSession: AuthSession) {
    setSession(nextSession);
    storeSession(nextSession);
    setActiveWorkspaceId(defaultWorkspaceForUser(nextSession.user));
  }

  function logout() {
    clearStoredSession();
    setSession(null);
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
    return <AuthPanel onSession={acceptSession} />;
  }

  const activeWorkspace = availableWorkspaces.find((item) => item.id === activeWorkspaceId) ?? availableWorkspaces[0];

  return (
    <div className="app-layout">
      <aside className="app-sidebar" aria-label="Навигация WMS">
        <div className="app-sidebar__brand">
          <span>LOGOFF</span>
          <strong>WMS</strong>
          <small>Управление фулфилментом</small>
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
            <span className={`status status--${activeWorkspace.status}`}>{statusLabel[activeWorkspace.status]}</span>
            <div className="workspace-user">
              <div>
                <strong>{session.user.name}</strong>
                <span>{session.user.email}</span>
              </div>
              <span className="status status--ready">{session.user.clientScopeMode}</span>
              <button className="icon-button" type="button" onClick={logout} title="Выйти" aria-label="Выйти">
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <section className="workspace-content" aria-label={activeWorkspace.title}>
          {renderWorkspace(activeWorkspace.id, session, availableWorkspaces, setActiveWorkspaceId)}
        </section>

        <footer className="workspace-footer">
          <span>WMS фулфилмента LOGOFF</span>
          <span>Роли: {session.user.roleCodes.join(', ') || 'нет роли'}</span>
        </footer>
      </main>
    </div>
  );
}

function renderWorkspace(
  activeWorkspaceId: WorkspaceId,
  session: AuthSession,
  availableWorkspaces: WorkspaceNavItem[],
  setActiveWorkspaceId: (id: WorkspaceId) => void,
) {
  switch (activeWorkspaceId) {
    case 'cabinet':
      return <ClientCabinetPanel session={session} />;
    case 'referrals':
      return <ReferralPanel session={session} />;
    case 'access':
      return <AccessAdminPanel session={session} />;
    case 'directories':
      return <DirectoryPanel session={session} />;
    case 'imports':
      return <ImportPanel session={session} />;
    case 'logistics':
      return <LogisticsQuotePanel session={session} />;
    case 'warehouse':
      return <WarehouseOpsPanel session={session} onOpenCatalog={() => setActiveWorkspaceId('catalog')} />;
    case 'turnover':
      return <TurnoverPanel session={session} />;
    case 'requests':
      return <ClientRequestsPanel session={session} />;
    case 'catalog':
      return <CatalogPanel session={session} />;
    case 'services':
      return <ClientServicesPanel session={session} />;
    case 'billing':
      return <BillingPanel session={session} />;
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
      return <WorkspaceOverview items={availableWorkspaces} session={session} onOpen={setActiveWorkspaceId} />;
  }
}

function WorkspaceOverview({
  items,
  session,
  onOpen,
}: {
  items: WorkspaceNavItem[];
  session: AuthSession;
  onOpen: (id: WorkspaceId) => void;
}) {
  const workspaces = items.filter((item) => item.id !== 'overview');
  const groups = groupWorkspaces(workspaces);

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

  if (id === 'cabinet' || id === 'referrals' || id === 'requests' || id === 'catalog') {
    return 'client';
  }

  if (id === 'warehouse' || id === 'turnover' || id === 'imports' || id === 'logistics' || id === 'print') {
    return 'operations';
  }

  if (
    id === 'access' ||
    id === 'directories' ||
    id === 'services' ||
    id === 'billing' ||
    id === 'own-companies' ||
    id === 'service' ||
    id === 'debug' ||
    id === 'data'
  ) {
    return 'management';
  }

  return 'management';
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

function defaultWorkspaceForUser(user: AuthUser): WorkspaceId {
  const preferredOrder: WorkspaceId[] = isReferralOnlyUser(user)
    ? ['referrals', 'overview']
    : isClientOnlyUser(user)
    ? ['cabinet', 'requests', 'catalog', 'turnover', 'logistics', 'billing', 'overview']
    : [
        'turnover',
        'warehouse',
        'requests',
        'catalog',
        'access',
        'directories',
        'services',
        'imports',
        'logistics',
        'billing',
        'referrals',
        'own-companies',
        'print',
        'service',
        'debug',
        'data',
        'overview',
      ];

  return preferredOrder.find((id) => canKeepWorkspace(user, id)) ?? 'overview';
}

function canKeepWorkspace(user: AuthUser, workspaceId: WorkspaceId) {
  const item = workspaceNav.find((candidate) => candidate.id === workspaceId);
  return Boolean(item && item.id !== 'overview' && canOpenWorkspace(user, item));
}

function isClientOnlyUser(user: AuthUser) {
  const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR', 'TSD', 'REFERRAL_PARTNER'];
  return user.roleCodes.includes('CLIENT') && !user.roleCodes.some((roleCode) => internalRoles.includes(roleCode));
}

function isReferralOnlyUser(user: AuthUser) {
  const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR', 'TSD', 'CLIENT'];
  return user.roleCodes.includes('REFERRAL_PARTNER') && !user.roleCodes.some((roleCode) => internalRoles.includes(roleCode));
}
