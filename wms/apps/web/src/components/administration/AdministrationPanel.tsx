import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  CloudCog,
  Code2,
  Crown,
  Database,
  Eye,
  EyeOff,
  FileClock,
  FileSpreadsheet,
  LoaderCircle,
  Network,
  Play,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tablet,
  Users,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyAdministrationAssistant,
  fetchAdministrationAudit,
  fetchAdministrationDocumentation,
  fetchAdministrationOverview,
  fetchAdministrationPhantomStocks,
  fetchAdministrationSettings,
  fetchAdministrationWorkspaceVisibility,
  optimizeAdministrationPerformance,
  previewAdministrationAssistant,
  runAdministrationMarketplaceDiagnostics,
  updateAdministrationSetting,
  updateAdministrationWorkspaceVisibility,
  type AdministrationAssistantPreview,
  type AdministrationAuditEntry,
  type AdministrationDocumentation,
  type AdministrationOverview,
  type AdministrationPerformanceOptimization,
  type AdministrationSetting,
  type AdministrationWorkspaceVisibility,
  type AuthSession,
  type BoxCodePolicy,
  type MarketplaceDiagnostics,
} from '../../lib/api';
import { workspaceNav, type WorkspaceId } from '../../lib/workspaces';
import './administration.css';
import { AdministrationStockCheck } from './AdministrationStockCheck';
import { AdministrationPhantomStockPanel } from './AdministrationPhantomStock';
import { AdministrationTsdWorkloadsPanel } from './AdministrationTsdWorkloads';
import { AdministrationFbsErrorCorrection } from './AdministrationFbsErrorCorrection';
import { AdministrationTechnicalWork } from './AdministrationTechnicalWork';

type AdministrationPanelProps = {
  session: AuthSession;
  onOpenWorkspace: (id: WorkspaceId) => void;
};

type TabId = 'overview' | 'technical-work' | 'error-correction' | 'tsd-workloads' | 'phantom-stock' | 'stock-check' | 'settings' | 'integrations' | 'visibility' | 'assistant' | 'documentation' | 'audit';

const tabs: Array<{ id: TabId; label: string; icon: typeof Crown }> = [
  { id: 'overview', label: 'Центр управления', icon: Crown },
  // ADDED: One entry point for diagnostics and verified repair actions.
  { id: 'technical-work', label: 'Тех. работы', icon: Wrench },
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

const metricLabels: Record<string, string> = {
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

export function AdministrationPanel({ session, onOpenWorkspace }: AdministrationPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [overview, setOverview] = useState<AdministrationOverview | null>(null);
  const [settings, setSettings] = useState<AdministrationSetting[]>([]);
  const [visibility, setVisibility] = useState<AdministrationWorkspaceVisibility | null>(null);
  const [documentation, setDocumentation] = useState<AdministrationDocumentation | null>(null);
  const [audit, setAudit] = useState<AdministrationAuditEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<MarketplaceDiagnostics | null>(null);
  const [optimization, setOptimization] = useState<AdministrationPerformanceOptimization | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [visibilityDraft, setVisibilityDraft] = useState<Record<string, boolean>>({});
  const [visibilityReason, setVisibilityReason] = useState('Настройка видимости рабочих разделов');
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantPreview, setAssistantPreview] = useState<AdministrationAssistantPreview | null>(null);
  const [assistantConfirmation, setAssistantConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [phantomCount, setPhantomCount] = useState(0);

  const selectedUser = useMemo(
    () => visibility?.users.find((item) => item.id === selectedUserId) ?? null,
    [selectedUserId, visibility],
  );

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(setting: AdministrationSetting, value: unknown, reason: string) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction('');
    }
  }

  async function saveVisibility() {
    if (!selectedUserId) return;
    setBusyAction('visibility');
    clearFeedback();
    try {
      const result = await updateAdministrationWorkspaceVisibility(
        session.accessToken,
        selectedUserId,
        visibilityDraft,
        visibilityReason,
      );
      setMessage(`Видимость разделов для ${result.user.name} сохранена.`);
      const next = await fetchAdministrationWorkspaceVisibility(session.accessToken);
      setVisibility(next);
      setAudit(await fetchAdministrationAudit(session.accessToken));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction('');
    }
  }

  async function applyAssistantPreview() {
    if (!assistantPreview) return;
    setBusyAction('assistant-apply');
    clearFeedback();
    try {
      await applyAdministrationAssistant(
        session.accessToken,
        assistantPreview.previewId,
        assistantConfirmation,
      );
      setMessage('Разрешённые действия выполнены. Результат записан в журнал.');
      setAssistantPreview(null);
      setAssistantConfirmation('');
      await loadAll();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction('');
    }
  }

  function clearFeedback() {
    setMessage('');
    setError('');
  }

  if (isLoading) {
    return (
      <div className="admin-loading">
        <LoaderCircle className="spin" size={28} />
        <strong>Загружаю защищённый контур администрирования…</strong>
      </div>
    );
  }

  return (
    <div className="administration">
      <section className="admin-hero">
        <div className="admin-hero__mark"><Crown size={28} /></div>
        <div>
          <span>Доступ только владельцу</span>
          <h2>Центр управления WMS</h2>
          <p>Настройки системы, API, права интерфейса, алгоритмы и безопасный помощник — в одном контуре.</p>
        </div>
        <button type="button" className="admin-button admin-button--ghost" onClick={() => void loadAll()}>
          <RefreshCw size={16} /> Обновить
        </button>
      </section>

      <nav className="admin-tabs" aria-label="Разделы администрирования">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={17} /><span>{tab.label}</span>
              {tab.id === 'phantom-stock' && phantomCount > 0 ? (
                <b className="admin-tabs__badge">{phantomCount}</b>
              ) : null}
            </button>
          );
        })}
      </nav>

      {phantomCount > 0 && activeTab !== 'phantom-stock' ? (
        <button type="button" className="admin-phantom-alert" onClick={() => setActiveTab('phantom-stock')}>
          <AlertTriangle size={19} />
          <span><strong>Обнаружены фантомные остатки: {phantomCount}</strong><small>Откройте контроль и удалите подтверждённые расхождения.</small></span>
          <ChevronRight size={18} />
        </button>
      ) : null}

      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}

      {activeTab === 'overview' && overview ? (
        <OverviewTab
          overview={overview}
          optimization={optimization}
          isOptimizing={busyAction === 'optimization'}
          onOptimize={optimizePerformance}
          onOpenWorkspace={onOpenWorkspace}
        />
      ) : null}
      {activeTab === 'stock-check' ? <AdministrationStockCheck session={session} /> : null}
      {activeTab === 'technical-work' ? <AdministrationTechnicalWork session={session} /> : null}
      {activeTab === 'error-correction' ? <AdministrationFbsErrorCorrection session={session} /> : null}
      {activeTab === 'tsd-workloads' ? <AdministrationTsdWorkloadsPanel session={session} /> : null}
      {activeTab === 'phantom-stock' ? (
        <AdministrationPhantomStockPanel session={session} onCountChange={setPhantomCount} />
      ) : null}
      {activeTab === 'settings' ? (
        <SettingsTab settings={settings} busyAction={busyAction} onSave={saveSetting} />
      ) : null}
      {activeTab === 'integrations' ? (
        <IntegrationsTab diagnostics={diagnostics} isBusy={busyAction === 'diagnostics'} onRun={runDiagnostics} />
      ) : null}
      {activeTab === 'visibility' && visibility ? (
        <VisibilityTab
          visibility={visibility}
          selectedUserId={selectedUserId}
          draft={visibilityDraft}
          reason={visibilityReason}
          isBusy={busyAction === 'visibility'}
          onSelectUser={setSelectedUserId}
          onChangeDraft={setVisibilityDraft}
          onChangeReason={setVisibilityReason}
          onSave={saveVisibility}
        />
      ) : null}
      {activeTab === 'assistant' && overview ? (
        <AssistantTab
          overview={overview}
          prompt={assistantPrompt}
          preview={assistantPreview}
          confirmation={assistantConfirmation}
          busyAction={busyAction}
          onChangePrompt={setAssistantPrompt}
          onChangeConfirmation={setAssistantConfirmation}
          onPreview={buildAssistantPreview}
          onApply={applyAssistantPreview}
        />
      ) : null}
      {activeTab === 'documentation' ? (
        <DocumentationTab documentation={documentation} />
      ) : null}
      {activeTab === 'audit' ? <AuditTab rows={audit} /> : null}
    </div>
  );
}

function OverviewTab({
  overview,
  optimization,
  isOptimizing,
  onOptimize,
  onOpenWorkspace,
}: {
  overview: AdministrationOverview;
  optimization: AdministrationPerformanceOptimization | null;
  isOptimizing: boolean;
  onOptimize: () => Promise<void>;
  onOpenWorkspace: (id: WorkspaceId) => void;
}) {
  const shortcuts: Array<{ id: WorkspaceId; title: string; description: string; icon: typeof Boxes }> = [
    { id: 'directories', title: 'Клиенты, товары и SKU', description: 'Карточки, штрихкоды, литраж и реквизиты.', icon: Boxes },
    { id: 'warehouse', title: 'Короба и операции', description: 'Состав, перемещения и ручные складские действия.', icon: Database },
    { id: 'services', title: 'Услуги и калькуляторы', description: 'Тарифы клиентов, FBS и правила начислений.', icon: CircleGauge },
    { id: 'access', title: 'Роли и доступы', description: 'Пользователи, роли, клиенты и ТСД.', icon: Users },
    { id: 'service', title: 'Сервисные операции', description: 'Режим обслуживания, очистки и диагностика.', icon: ShieldCheck },
    { id: 'debug', title: 'Точное редактирование', description: 'Служебные поля, режимы и данные.', icon: Code2 },
  ];
  return (
    <div className="admin-stack">
      <section className="admin-metrics">
        {Object.entries(overview.metrics).map(([key, value]) => (
          <article key={key}>
            <span>{metricLabels[key] || key}</span>
            <strong>{formatNumber(value)}</strong>
          </article>
        ))}
      </section>

      <section className="admin-grid admin-grid--overview">
        <AdminCard title="Состояние API" icon={<Activity size={18} />} tone="dark">
          <dl className="admin-facts">
            <div><dt>Среда</dt><dd>{overview.system.environment}</dd></div>
            <div><dt>Uptime</dt><dd>{formatDuration(overview.system.apiUptimeSeconds)}</dd></div>
            <div><dt>Память API</dt><dd>{overview.system.memoryMb} МБ</dd></div>
            <div><dt>Node.js</dt><dd>{overview.system.nodeVersion}</dd></div>
          </dl>
        </AdminCard>
        <AdminCard title="Защитный контур" icon={<ShieldCheck size={18} />} tone="green">
          <ul className="admin-checklist">
            <li><CheckCircle2 size={15} /> Предпросмотр до изменения</li>
            <li><CheckCircle2 size={15} /> Явное подтверждение владельца</li>
            <li><CheckCircle2 size={15} /> Аудит всех действий</li>
            <li><CheckCircle2 size={15} /> Произвольные SQL и shell запрещены</li>
          </ul>
        </AdminCard>
        <AdminCard title="Политика коробов" icon={<Boxes size={18} />}>
          <dl className="admin-facts">
            <div><dt>Основной</dt><dd>{overview.boxCodePolicy.primaryPrefix}</dd></div>
            <div><dt>Приёмка</dt><dd>{overview.boxCodePolicy.receiptPrefix}</dd></div>
            <div><dt>Баланс</dt><dd>{overview.boxCodePolicy.balancePrefix}</dd></div>
            <div><dt>Белый приход</dt><dd>{overview.boxCodePolicy.whiteReceiptPrefixes.join(', ')}</dd></div>
            <div><dt>Серый приход</dt><dd>{overview.boxCodePolicy.grayReceiptPrefixes.join(', ')}</dd></div>
            <div><dt>Паллеты</dt><dd>{overview.boxCodePolicy.palletPrefix}</dd></div>
            <div><dt>Ячейки</dt><dd>{overview.boxCodePolicy.storageCellPrefix}</dd></div>
            <div><dt>Места на стеллаже</dt><dd>{overview.boxCodePolicy.rackSlotPrefix}</dd></div>
            <div><dt>Стеллажи</dt><dd>{overview.boxCodePolicy.rackPrefix}</dd></div>
            <div><dt>Боксы хранения</dt><dd>{overview.boxCodePolicy.storageBoxPrefix}</dd></div>
            <div><dt>Разрешено</dt><dd>{overview.boxCodePolicy.allowedPrefixes.join(', ')}</dd></div>
          </dl>
        </AdminCard>
      </section>

      <section className="admin-performance">
        <div className="admin-performance__icon"><WandSparkles size={24} /></div>
        <div className="admin-performance__copy">
          <span>Быстрое обслуживание</span>
          <h3>Оптимизация и ускорение WMS</h3>
          <p>Удаляет только просроченные технические записи, освобождает истёкший кэш и обновляет статистику базы. Заказы, остатки, КИЗы, счета и документы не удаляются.</p>
        </div>
        {optimization ? (
          <dl className="admin-performance__result">
            <div><dt>Время</dt><dd>{formatMilliseconds(optimization.durationMs)}</dd></div>
            <div><dt>Очищено записей</dt><dd>{formatNumber(optimization.cleanup.expiredMobileCommands + optimization.cleanup.expiredMobileSessions)}</dd></div>
            <div><dt>Истёкший кэш</dt><dd>{formatNumber(optimization.runtime.expiredCacheEntries)}</dd></div>
            <div><dt>Временные файлы</dt><dd>{formatNumber(optimization.files.deleted)} · {optimization.files.freedMb.toLocaleString('ru-RU')} МБ</dd></div>
            <div><dt>Статистика БД</dt><dd>{optimization.database.statisticsUpdated ? 'обновлена' : 'без изменений'}</dd></div>
          </dl>
        ) : null}
        <button
          type="button"
          className="admin-button admin-button--primary admin-performance__button"
          onClick={() => void onOptimize()}
          disabled={isOptimizing}
        >
          {isOptimizing ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}
          {isOptimizing ? 'Оптимизирую…' : 'Оптимизировать WMS'}
        </button>
      </section>

      <section className="admin-section">
        <div className="admin-section__heading">
          <div><span>Управление сущностями</span><h3>Все рабочие инструменты</h3></div>
          <p>Админка ведёт в существующие специализированные редакторы, чтобы сохранять их проверки и аудит.</p>
        </div>
        <div className="admin-shortcuts">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <button type="button" key={shortcut.id} onClick={() => onOpenWorkspace(shortcut.id)}>
                <span><Icon size={19} /></span>
                <div><strong>{shortcut.title}</strong><small>{shortcut.description}</small></div>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SettingsTab({
  settings,
  busyAction,
  onSave,
}: {
  settings: AdministrationSetting[];
  busyAction: string;
  onSave: (setting: AdministrationSetting, value: unknown, reason: string) => Promise<void>;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section__heading">
        <div><span>Единый реестр</span><h3>Системные настройки</h3></div>
        <p>Каждое изменение требует причину, валидируется сервером и записывается в журнал.</p>
      </div>
      <div className="admin-setting-list">
        {settings.filter((item) => item.editable).map((setting) =>
          setting.key === 'warehouse.boxCodePolicy' ? (
            <BoxPolicyEditor
              key={setting.key}
              setting={setting}
              isBusy={busyAction === `setting:${setting.key}`}
              onSave={onSave}
            />
          ) : (
            <JsonSettingEditor
              key={setting.key}
              setting={setting}
              isBusy={busyAction === `setting:${setting.key}`}
              onSave={onSave}
            />
          ),
        )}
      </div>
    </section>
  );
}

function BoxPolicyEditor({
  setting,
  isBusy,
  onSave,
}: {
  setting: AdministrationSetting;
  isBusy: boolean;
  onSave: (setting: AdministrationSetting, value: unknown, reason: string) => Promise<void>;
}) {
  const source = setting.value as BoxCodePolicy;
  const [primaryPrefix, setPrimaryPrefix] = useState(source.primaryPrefix);
  const [allowedPrefixes, setAllowedPrefixes] = useState(source.allowedPrefixes.join(', '));
  const [receiptPrefix, setReceiptPrefix] = useState(source.receiptPrefix);
  const [balancePrefix, setBalancePrefix] = useState(source.balancePrefix);
  const [whiteReceiptPrefixes, setWhiteReceiptPrefixes] = useState(
    source.whiteReceiptPrefixes.join(', '),
  );
  const [grayReceiptPrefixes, setGrayReceiptPrefixes] = useState(
    source.grayReceiptPrefixes.join(', '),
  );
  const [palletPrefix, setPalletPrefix] = useState(source.palletPrefix);
  const [storageCellPrefix, setStorageCellPrefix] = useState(source.storageCellPrefix);
  const [rackSlotPrefix, setRackSlotPrefix] = useState(source.rackSlotPrefix);
  const [rackPrefix, setRackPrefix] = useState(source.rackPrefix);
  const [storageBoxPrefix, setStorageBoxPrefix] = useState(source.storageBoxPrefix);
  const [corrections, setCorrections] = useState(
    Object.entries(source.autoCorrections).map(([from, to]) => `${from}=${to}`).join('\n'),
  );
  const [reason, setReason] = useState('Изменение политики нумерации коробов');

  function value(): BoxCodePolicy {
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
      autoCorrections: Object.fromEntries(
        corrections.split('\n').map((line) => line.split('=')).filter((parts) => parts.length === 2)
          .map(([from, to]) => [from.trim(), to.trim()]).filter(([from, to]) => from && to),
      ),
    };
  }

  return (
    <article className="admin-setting admin-setting--critical">
      <SettingHeading setting={setting} />
      <div className="admin-form-grid">
        <Field label="Основной префикс"><input value={primaryPrefix} onChange={(event) => setPrimaryPrefix(event.target.value)} /></Field>
        <Field label="Префикс приёмки"><input value={receiptPrefix} onChange={(event) => setReceiptPrefix(event.target.value)} /></Field>
        <Field label="Префикс баланс-коробов"><input value={balancePrefix} onChange={(event) => setBalancePrefix(event.target.value)} /></Field>
        <Field label="Разрешённые, через запятую"><input value={allowedPrefixes} onChange={(event) => setAllowedPrefixes(event.target.value)} /></Field>
        <Field label="Белый приход — префиксы через запятую">
          <input
            value={whiteReceiptPrefixes}
            onChange={(event) => setWhiteReceiptPrefixes(event.target.value)}
          />
        </Field>
        <Field label="Серый приход — префиксы через запятую">
          <input
            value={grayReceiptPrefixes}
            onChange={(event) => setGrayReceiptPrefixes(event.target.value)}
          />
        </Field>
        <Field label="Префикс паллетов">
          <input value={palletPrefix} onChange={(event) => setPalletPrefix(event.target.value)} />
        </Field>
        <Field label="Префикс ячеек хранения">
          <input
            value={storageCellPrefix}
            onChange={(event) => setStorageCellPrefix(event.target.value)}
          />
        </Field>
        <Field label="Префикс места на стеллаже">
          <input
            value={rackSlotPrefix}
            onChange={(event) => setRackSlotPrefix(event.target.value)}
          />
        </Field>
        <Field label="Префикс стеллажей">
          <input value={rackPrefix} onChange={(event) => setRackPrefix(event.target.value)} />
        </Field>
        <Field label="Префикс боксов хранения">
          <input
            value={storageBoxPrefix}
            onChange={(event) => setStorageBoxPrefix(event.target.value)}
          />
        </Field>
        <Field label="Автоисправления: ОШИБКА=ВЕРНО" wide>
          <textarea rows={3} value={corrections} onChange={(event) => setCorrections(event.target.value)} />
        </Field>
        <Field label="Причина изменения" wide>
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
      <button className="admin-button admin-button--primary" type="button" disabled={isBusy} onClick={() => void onSave(setting, value(), reason)}>
        {isBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Сохранить политику
      </button>
    </article>
  );
}

function JsonSettingEditor({
  setting,
  isBusy,
  onSave,
}: {
  setting: AdministrationSetting;
  isBusy: boolean;
  onSave: (setting: AdministrationSetting, value: unknown, reason: string) => Promise<void>;
}) {
  const [value, setValue] = useState(
    typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value, null, 2),
  );
  const [reason, setReason] = useState(`Изменение настройки: ${setting.title}`);
  const [localError, setLocalError] = useState('');

  function save() {
    try {
      const parsed = typeof setting.value === 'number' ? Number(value) : JSON.parse(value);
      setLocalError('');
      void onSave(setting, parsed, reason);
    } catch {
      setLocalError('Значение должно быть корректным JSON.');
    }
  }

  return (
    <article className="admin-setting">
      <SettingHeading setting={setting} />
      <Field label="Значение JSON">
        <textarea rows={Math.min(12, Math.max(3, value.split('\n').length + 1))} value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      <Field label="Причина изменения"><input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      {localError ? <small className="admin-inline-error">{localError}</small> : null}
      <button className="admin-button admin-button--primary" type="button" disabled={isBusy} onClick={save}>
        {isBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Сохранить
      </button>
    </article>
  );
}

function SettingHeading({ setting }: { setting: AdministrationSetting }) {
  return (
    <header>
      <div><span>{setting.group}</span><h4>{setting.title}</h4><p>{setting.description}</p></div>
      <em className={`admin-risk admin-risk--${setting.risk.toLowerCase()}`}>Риск: {riskLabel(setting.risk)}</em>
    </header>
  );
}

function IntegrationsTab({
  diagnostics,
  isBusy,
  onRun,
}: {
  diagnostics: MarketplaceDiagnostics | null;
  isBusy: boolean;
  onRun: () => Promise<void>;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section__heading">
        <div><span>Автономная проверка</span><h3>Подключения WB и Ozon</h3></div>
        <button type="button" className="admin-button admin-button--primary" disabled={isBusy} onClick={() => void onRun()}>
          {isBusy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Проверить все подключения
        </button>
      </div>
      <div className="admin-callout">
        <Network size={20} />
        <div><strong>Проверка не меняет заказы и остатки.</strong><p>Система проверяет токен, список складов, получение новых FBS-заказов и историю заказов.</p></div>
      </div>
      {diagnostics ? (
        <>
          <section className="admin-metrics admin-metrics--compact">
            <article><span>Проверено</span><strong>{diagnostics.summary.checked}</strong></article>
            <article><span>Исправны</span><strong className="is-ok">{diagnostics.summary.healthy}</strong></article>
            <article><span>С ошибкой</span><strong className="is-danger">{diagnostics.summary.failed}</strong></article>
          </section>
          <div className="admin-diagnostic-list">
            {diagnostics.results.map((result) => (
              <article key={result.connectionId} className={result.healthy ? 'is-healthy' : 'is-failed'}>
                <div className="admin-diagnostic-list__status">{result.healthy ? <CheckCircle2 /> : <AlertTriangle />}</div>
                <div>
                  <span>{result.marketplace} · {result.client?.code}</span>
                  <h4>{result.client?.name || result.accountName}</h4>
                  <p>{diagnosticSummary(result)}</p>
                </div>
                <details><summary>Технические данные</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
              </article>
            ))}
          </div>
        </>
      ) : <div className="admin-empty">Запустите проверку — здесь появится понятный отчёт по каждому кабинету и складу.</div>}
    </section>
  );
}

function VisibilityTab({
  visibility,
  selectedUserId,
  draft,
  reason,
  isBusy,
  onSelectUser,
  onChangeDraft,
  onChangeReason,
  onSave,
}: {
  visibility: AdministrationWorkspaceVisibility;
  selectedUserId: string;
  draft: Record<string, boolean>;
  reason: string;
  isBusy: boolean;
  onSelectUser: (value: string) => void;
  onChangeDraft: (value: Record<string, boolean>) => void;
  onChangeReason: (value: string) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section__heading">
        <div><span>Персональный интерфейс</span><h3>Видимость плиток и разделов</h3></div>
        <p>Скрытие меняет только интерфейс. Роли и серверные разрешения остаются обязательными.</p>
      </div>
      <div className="admin-visibility-toolbar">
        <Field label="Пользователь">
          <select value={selectedUserId} onChange={(event) => onSelectUser(event.target.value)}>
            {visibility.users.map((user) => <option value={user.id} key={user.id}>{user.name} · {user.email}</option>)}
          </select>
        </Field>
        <Field label="Причина">
          <input value={reason} onChange={(event) => onChangeReason(event.target.value)} />
        </Field>
      </div>
      <div className="admin-visibility-grid">
        {visibility.workspaces.filter((id) => id !== 'administration').map((workspaceId) => {
          const hidden = draft[workspaceId] === false;
          return (
            <button
              type="button"
              key={workspaceId}
              className={hidden ? 'is-hidden' : ''}
              onClick={() => {
                const next = { ...draft };
                if (hidden) delete next[workspaceId];
                else next[workspaceId] = false;
                onChangeDraft(next);
              }}
            >
              {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
              <span><strong>{workspaceLabels.get(workspaceId as WorkspaceId) || workspaceId}</strong><small>{hidden ? 'Скрыт персонально' : 'По ролям пользователя'}</small></span>
            </button>
          );
        })}
      </div>
      <button className="admin-button admin-button--primary" type="button" disabled={isBusy} onClick={() => void onSave()}>
        {isBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Сохранить видимость
      </button>
    </section>
  );
}

function AssistantTab({
  overview,
  prompt,
  preview,
  confirmation,
  busyAction,
  onChangePrompt,
  onChangeConfirmation,
  onPreview,
  onApply,
}: {
  overview: AdministrationOverview;
  prompt: string;
  preview: AdministrationAssistantPreview | null;
  confirmation: string;
  busyAction: string;
  onChangePrompt: (value: string) => void;
  onChangeConfirmation: (value: string) => void;
  onPreview: () => Promise<void>;
  onApply: () => Promise<void>;
}) {
  const canApply = preview?.actions.length && preview.actions.every((action) => action.executable);
  return (
    <section className="admin-section admin-assistant">
      <div className="admin-section__heading">
        <div><span>Безопасный режим</span><h3>Опишите изменение обычным языком</h3></div>
        <em className={overview.ai.liveProviderAvailable ? 'is-online' : ''}>
          <Sparkles size={15} /> {overview.ai.liveProviderAvailable ? 'OpenAI подключён' : 'Локальный планировщик'}
        </em>
      </div>
      <div className="admin-callout admin-callout--warning">
        <AlertTriangle size={20} />
        <div>
          <strong>Помощник не исполняет произвольный код на production.</strong>
          <p>Разрешённые настройки применяются только после предпросмотра и слова «ПРИМЕНИТЬ». Изменения программной логики превращаются в технический план с тестами и откатом.</p>
        </div>
      </div>
      <textarea
        className="admin-assistant__prompt"
        rows={6}
        value={prompt}
        onChange={(event) => onChangePrompt(event.target.value)}
        placeholder="Например: измени основной префикс коробов на LOGOFF_ и сохрани старый FFL_ разрешённым…"
      />
      <button className="admin-button admin-button--primary" type="button" disabled={busyAction === 'assistant-preview' || prompt.trim().length < 5} onClick={() => void onPreview()}>
        {busyAction === 'assistant-preview' ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} Подготовить безопасный план
      </button>
      {preview ? (
        <article className="admin-preview">
          <header><div><span>{preview.provider}</span><h4>{preview.title}</h4></div><em className={`admin-risk admin-risk--${preview.risk.toLowerCase()}`}>Риск: {riskLabel(preview.risk)}</em></header>
          <p>{preview.summary}</p>
          <ol>{preview.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
          <div className="admin-preview__rollback"><RefreshCw size={16} /><span><strong>Откат</strong>{preview.rollback}</span></div>
          <div className="admin-preview__actions">
            {preview.actions.map((action, index) => (
              <span key={`${action.type}-${index}`} className={action.executable ? 'is-executable' : ''}>
                {action.executable ? <CheckCircle2 size={14} /> : <Code2 size={14} />}{action.type}
              </span>
            ))}
          </div>
          {canApply ? (
            <div className="admin-confirm">
              <Field label="Для выполнения введите ПРИМЕНИТЬ">
                <input value={confirmation} onChange={(event) => onChangeConfirmation(event.target.value)} />
              </Field>
              <button className="admin-button admin-button--danger" type="button" disabled={busyAction === 'assistant-apply' || confirmation !== 'ПРИМЕНИТЬ'} onClick={() => void onApply()}>
                {busyAction === 'assistant-apply' ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Выполнить действия
              </button>
            </div>
          ) : <div className="admin-empty">Это изменение требует правки и тестирования исходного кода. Автоматическое применение отключено.</div>}
        </article>
      ) : null}
    </section>
  );
}

function DocumentationTab({ documentation }: { documentation: AdministrationDocumentation | null }) {
  const flows = [
    { title: 'Приёмка', nodes: ['Клиент и партия', 'Короб или товар', 'ШК / КИЗ', 'Остаток и история'] },
    { title: 'FBS', nodes: ['API-заказы', 'WMS-заявка', 'Сборка ТСД', 'Упаковка / грузоместа', 'Передача WB'] },
    { title: 'Инвентаризация', nodes: ['Сессия', 'Короб', 'Факт по ШК', 'Расхождение', 'Решение менеджера'] },
    { title: 'Биллинг', nodes: ['События WMS', 'Тариф клиента', 'Начисления', 'Счёт и акт', 'Оплата'] },
  ];
  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section__heading">
          <div><span>Карта процессов</span><h3>Основные алгоритмы WMS</h3></div>
          <p>Каждый переход сохраняет операционную историю; финансовые действия дополнительно попадают в аудит.</p>
        </div>
        <div className="admin-flows">
          {flows.map((flow) => (
            <article key={flow.title}><h4>{flow.title}</h4><div>{flow.nodes.map((node, index) => <span key={node}>{node}{index < flow.nodes.length - 1 ? <ChevronRight size={14} /> : null}</span>)}</div></article>
          ))}
        </div>
      </section>
      <section className="admin-section">
        <div className="admin-section__heading">
          <div><span>База знаний</span><h3>Инструкции и техническая документация</h3></div>
        </div>
        <div className="admin-docs">
          {documentation?.sections.map((section) => (
            <article key={section.id}><BookOpen size={19} /><div><h4>{section.title}</h4><p>{section.summary}</p></div></article>
          ))}
        </div>
        {documentation?.references.length ? (
          <div className="admin-reference-list">
            <strong>Полные документы в проекте и резервных копиях:</strong>
            {documentation.references.map((reference) => <code key={reference.path}>{reference.title}: {reference.path}</code>)}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AuditTab({ rows }: { rows: AdministrationAuditEntry[] }) {
  const [search, setSearch] = useState('');
  const filtered = rows.filter((row) => `${row.action} ${row.entity} ${row.entityId || ''} ${row.user?.name || ''}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')));
  return (
    <section className="admin-section">
      <div className="admin-section__heading">
        <div><span>Неизменяемая история</span><h3>Журнал административных действий</h3></div>
        <input className="admin-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по действию или объекту" />
      </div>
      <div className="admin-audit">
        {filtered.map((row) => (
          <article key={row.id}>
            <FileClock size={18} />
            <div><strong>{auditActionLabel(row.action)}</strong><span>{row.entity}{row.entityId ? ` · ${row.entityId}` : ''}</span></div>
            <div><strong>{row.user?.name || 'Система'}</strong><time>{formatDateTime(row.createdAt)}</time></div>
            <details><summary>Данные</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details>
          </article>
        ))}
        {filtered.length === 0 ? <div className="admin-empty">Записей по этому запросу нет.</div> : null}
      </div>
    </section>
  );
}

function AdminCard({ title, icon, tone = 'light', children }: { title: string; icon: ReactNode; tone?: 'light' | 'dark' | 'green'; children: ReactNode }) {
  return <article className={`admin-card admin-card--${tone}`}><header>{icon}<h3>{title}</h3></header>{children}</article>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? 'admin-field admin-field--wide' : 'admin-field'}><span>{label}</span>{children}</label>;
}

function riskLabel(risk: string) {
  return risk === 'HIGH' ? 'высокий' : risk === 'MEDIUM' ? 'средний' : 'низкий';
}

function diagnosticSummary(result: MarketplaceDiagnostics['results'][number]) {
  if (result.healthy) return 'Токен действует, доступные методы отвечают, подключение готово к работе.';
  const error = typeof result.error === 'string' ? result.error : '';
  return error || 'Один или несколько обязательных методов API недоступны. Откройте технические данные.';
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'administration.performance.optimize': 'Выполнена оптимизация WMS',
    'administration.setting.update': 'Изменена системная настройка',
    'administration.workspace-visibility.update': 'Изменена видимость интерфейса',
    'administration.marketplace.diagnostics': 'Проверены API-подключения',
    'administration.ai.preview': 'ИИ подготовил план',
    'administration.ai.apply': 'Применён план ИИ',
  };
  return labels[action] || action;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days ? `${days} д ${hours} ч` : `${hours} ч`;
}

function formatMilliseconds(value: number) {
  if (value < 1000) return `${value} мс`;
  return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} сек.`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
