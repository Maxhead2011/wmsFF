import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Download,
  Eraser,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchClients,
  fetchServiceClientRequestsCleanupPreview,
  fetchServiceClientStockCleanupPreview,
  fetchServiceMaintenance,
  fetchServiceSessions,
  fetchServiceTelegramSettings,
  purgeServiceClientRequests,
  purgeServiceClientStock,
  searchServiceKiz,
  testServiceTelegramClient,
  testServiceTelegramFulfillment,
  updateServiceMaintenance,
  updateServiceTelegramClient,
  updateServiceTelegramGlobal,
  type AuthSession,
  type ClientSummary,
  type ServiceClientRequestsCleanupPreview,
  type ServiceClientStockCleanupPreview,
  type ServiceClientStockCleanupResult,
  type ServiceClientStockSummary,
  type ServiceKizSearchRow,
  type ServiceMaintenanceMode,
  type ServiceSessionSummary,
  type ServiceTelegramSettings,
} from '../../lib/api';
import './service-center.css';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T;
  error?: string;
};

type ServiceCenterPanelProps = {
  session: AuthSession;
};

const emptySummary: ServiceClientStockSummary = {
  balanceRows: 0,
  quantity: 0,
  uniqueSkusInStock: 0,
  movements: 0,
  boxes: 0,
  pallets: 0,
  productMarks: 0,
};

const tabs = [
  { id: 'mode', label: 'Режим', icon: Lock },
  { id: 'sessions', label: 'Сессии', icon: Users },
  { id: 'telegram', label: 'Telegram', icon: Bell },
  { id: 'kiz', label: 'КИЗ', icon: Search },
  { id: 'stock', label: 'Остатки', icon: Database },
  { id: 'requests', label: 'Заявки', icon: Trash2 },
] as const;

type TabId = (typeof tabs)[number]['id'];

export function ServiceCenterPanel({ session }: ServiceCenterPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('mode');
  const [clients, setClients] = useState<LoadState<ClientSummary[]>>({ status: 'idle', data: [] });
  const [selectedClientId, setSelectedClientId] = useState('');
  const [stockPreview, setStockPreview] = useState<LoadState<ServiceClientStockCleanupPreview | null>>({
    status: 'idle',
    data: null,
  });
  const [requestsPreview, setRequestsPreview] = useState<LoadState<ServiceClientRequestsCleanupPreview | null>>({
    status: 'idle',
    data: null,
  });
  const [maintenance, setMaintenance] = useState<LoadState<ServiceMaintenanceMode | null>>({ status: 'idle', data: null });
  const [sessions, setSessions] = useState<LoadState<ServiceSessionSummary[]>>({ status: 'idle', data: [] });
  const [telegram, setTelegram] = useState<LoadState<ServiceTelegramSettings | null>>({ status: 'idle', data: null });
  const [kizRows, setKizRows] = useState<LoadState<ServiceKizSearchRow[]>>({ status: 'idle', data: [] });
  const [stockConfirmation, setStockConfirmation] = useState('');
  const [requestsConfirmation, setRequestsConfirmation] = useState('');
  const [kizSearch, setKizSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const selectedClient = useMemo(
    () => clients.data.find((client) => client.id === selectedClientId) ?? null,
    [clients.data, selectedClientId],
  );
  const currentSummary = stockPreview.data?.summary ?? emptySummary;

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }
    void loadClientDependent(selectedClientId);
  }, [selectedClientId]);

  async function loadBase() {
    await Promise.all([loadClients(), loadMaintenance(), loadSessions()]);
  }

  async function loadClients() {
    setClients((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const loaded = await fetchClients(session.accessToken);
      setClients({ status: 'ready', data: loaded });
      const clientId = selectedClientId || loaded[0]?.id || '';
      if (clientId) {
        setSelectedClientId(clientId);
        await loadClientDependent(clientId);
      }
    } catch (caught) {
      setClients({ status: 'error', data: [], error: errorMessage(caught) });
    }
  }

  async function loadClientDependent(clientId: string) {
    await Promise.all([loadStockPreview(clientId), loadRequestsPreview(clientId), loadTelegram(clientId)]);
  }

  async function loadStockPreview(clientId = selectedClientId) {
    if (!clientId) {
      return;
    }
    setStockPreview((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setStockPreview({ status: 'ready', data: await fetchServiceClientStockCleanupPreview(session.accessToken, clientId) });
      setStockConfirmation('');
    } catch (caught) {
      setStockPreview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
    }
  }

  async function loadRequestsPreview(clientId = selectedClientId) {
    if (!clientId) {
      return;
    }
    setRequestsPreview((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setRequestsPreview({
        status: 'ready',
        data: await fetchServiceClientRequestsCleanupPreview(session.accessToken, clientId),
      });
      setRequestsConfirmation('');
    } catch (caught) {
      setRequestsPreview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
    }
  }

  async function loadMaintenance() {
    setMaintenance((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setMaintenance({ status: 'ready', data: await fetchServiceMaintenance(session.accessToken) });
    } catch (caught) {
      setMaintenance({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  async function loadSessions() {
    setSessions((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setSessions({ status: 'ready', data: await fetchServiceSessions(session.accessToken) });
    } catch (caught) {
      setSessions({ status: 'error', data: [], error: errorMessage(caught) });
    }
  }

  async function loadTelegram(clientId = selectedClientId) {
    setTelegram((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setTelegram({ status: 'ready', data: await fetchServiceTelegramSettings(session.accessToken, clientId || undefined) });
    } catch (caught) {
      setTelegram({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  async function toggleMaintenance(enabled: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateServiceMaintenance(session.accessToken, {
        enabled,
        message: maintenance.data?.message || 'Вход временно закрыт: идут сервисные работы.',
      });
      setMaintenance({ status: 'ready', data: updated });
      setMessage(enabled ? 'Сервисный режим включен.' : 'Сервисный режим выключен.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveTelegramGlobal() {
    if (!telegram.data) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateServiceTelegramGlobal(session.accessToken, telegram.data.global);
      setTelegram((current) => (current.data ? { status: 'ready', data: { ...current.data, global: updated } } : current));
      setMessage('Настройки Telegram сохранены.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveTelegramClient() {
    if (!telegram.data?.client || !selectedClientId) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateServiceTelegramClient(session.accessToken, selectedClientId, telegram.data.client);
      setTelegram((current) => (current.data ? { status: 'ready', data: { ...current.data, client: updated } } : current));
      setMessage('Telegram клиента сохранен.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runKizSearch() {
    setKizRows((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      setKizRows({
        status: 'ready',
        data: await searchServiceKiz(session.accessToken, { clientId: selectedClientId || undefined, search: kizSearch }),
      });
    } catch (caught) {
      setKizRows({ status: 'error', data: [], error: errorMessage(caught) });
    }
  }

  async function purgeStock() {
    if (!selectedClientId || stockConfirmation !== stockPreview.data?.confirmationText) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await purgeServiceClientStock(session.accessToken, selectedClientId, stockConfirmation);
      setStockPreview({
        status: 'ready',
        data: {
          client: result.client,
          summary: result.after,
          confirmationText: stockPreview.data.confirmationText,
          warning: stockPreview.data.warning,
        },
      });
      setStockConfirmation('');
      setMessage(formatStockPurgeResult(result));
      await loadRequestsPreview(selectedClientId);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function purgeRequests() {
    if (!selectedClientId || requestsConfirmation !== requestsPreview.data?.confirmationText) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await purgeServiceClientRequests(session.accessToken, selectedClientId, requestsConfirmation);
      setRequestsConfirmation('');
      setMessage(`Удалено заявок: ${result.deleted.requests}. Отвязано начислений: ${result.deleted.detachedBillingCharges}.`);
      await loadRequestsPreview(selectedClientId);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="service-panel" aria-label="Сервисное меню">
      <div className="panel-heading service-panel__heading">
        <div>
          <p className="eyebrow">Сервисное меню</p>
          <h2>Управление системными данными</h2>
        </div>
        <ShieldAlert size={22} aria-hidden="true" />
      </div>

      <div className="service-mobile-app">
        <span className="service-mobile-app__icon"><Smartphone size={22} aria-hidden="true" /></span>
        <span>
          <strong>LOGOff WMS Mobile</strong>
          <small>Клиентский кабинет и административный инструмент для Android</small>
        </span>
        <a className="secondary-button" href="/downloads/logoff-wms-mobile.apk" download>
          <Download size={16} aria-hidden="true" />
          Скачать APK
        </a>
      </div>

      <div className="service-tabs" role="tablist" aria-label="Разделы сервисного меню">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <Icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <ClientSelector
        clients={clients}
        selectedClientId={selectedClientId}
        onChange={setSelectedClientId}
        onRefresh={() => void loadClients()}
      />

      {message ? <div className="service-message">{message}</div> : null}

      {activeTab === 'mode' ? (
        <Section title="Сервисный режим" icon={<Lock size={18} />}>
          <div className="service-two-columns">
            <div className="service-card">
              <strong>{maintenance.data?.enabled ? 'Вход пользователей заблокирован' : 'Вход открыт'}</strong>
              <span>{maintenance.data?.message || 'Администраторы и владелец смогут войти даже во время обслуживания.'}</span>
              <button
                className={maintenance.data?.enabled ? 'secondary-button' : 'danger-button'}
                type="button"
                disabled={isBusy || maintenance.status === 'loading'}
                onClick={() => void toggleMaintenance(!maintenance.data?.enabled)}
              >
                {maintenance.data?.enabled ? 'Снять блокировку' : 'Заблокировать вход'}
              </button>
            </div>
            <div className="service-card">
              <strong>Что блокируется</strong>
              <span>Новые входы обычных пользователей. Уже открытые токены не удаляются автоматически.</span>
              <small>Последнее изменение: {maintenance.data?.updatedAt ? formatDateTime(maintenance.data.updatedAt) : '-'}</small>
            </div>
          </div>
        </Section>
      ) : null}

      {activeTab === 'sessions' ? (
        <Section title="Последние входы" icon={<Users size={18} />}>
          <button className="secondary-button service-inline-action" type="button" onClick={() => void loadSessions()}>
            <RefreshCw size={16} aria-hidden="true" />
            Обновить
          </button>
          <TableWrap>
            <table className="data-table service-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Клиент</th>
                  <th>IP</th>
                  <th>Браузер / приложение</th>
                  <th>Открыта</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.map((item) => (
                  <tr key={`${item.userId}-${item.openedAt}`}>
                    <td>
                      <strong>{item.name}</strong>
                      <span>{item.email}</span>
                    </td>
                    <td>{item.client}</td>
                    <td>{item.ip || '-'}</td>
                    <td className="service-muted-cell">{item.userAgent || '-'}</td>
                    <td>{formatDateTime(item.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {activeTab === 'telegram' ? (
        <Section title="Telegram-уведомления" icon={<Bell size={18} />}>
          {telegram.data ? (
            <div className="service-two-columns">
              <div className="service-card service-form-card">
                <strong>Фулфилмент</strong>
                <label className="service-check">
                  <input
                    type="checkbox"
                    checked={telegram.data.global.enabled}
                    onChange={(event) =>
                      setTelegram({ status: 'ready', data: { ...telegram.data!, global: { ...telegram.data!.global, enabled: event.target.checked } } })
                    }
                  />
                  <span>Включить отправку в Telegram</span>
                </label>
                <label>
                  <span>Bot token</span>
                  <input
                    value={telegram.data.global.botToken}
                    onChange={(event) =>
                      setTelegram({ status: 'ready', data: { ...telegram.data!, global: { ...telegram.data!.global, botToken: event.target.value } } })
                    }
                    placeholder="123456:ABC..."
                  />
                </label>
                <label>
                  <span>Chat ID фулфилмента, по одному в строке</span>
                  <textarea
                    value={telegram.data.global.fulfillmentChatIds.join('\n')}
                    onChange={(event) =>
                      setTelegram({
                        status: 'ready',
                        data: {
                          ...telegram.data!,
                          global: { ...telegram.data!.global, fulfillmentChatIds: event.target.value.split('\n') },
                        },
                      })
                    }
                  />
                </label>
                <div className="service-actions">
                  <button className="primary-button" type="button" onClick={() => void saveTelegramGlobal()} disabled={isBusy}>
                    Сохранить
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={async () => setMessage(JSON.stringify(await testServiceTelegramFulfillment(session.accessToken)))}
                  >
                    Тест
                  </button>
                </div>
              </div>

              <div className="service-card service-form-card">
                <strong>Клиент</strong>
                <p className="service-help">
                  Как узнать chat_id: клиент пишет любое сообщение боту, затем открывает
                  https://api.telegram.org/botTOKEN/getUpdates и копирует поле chat.id.
                </p>
                <label className="service-check">
                  <input
                    type="checkbox"
                    checked={telegram.data.client?.enabled ?? false}
                    onChange={(event) =>
                      setTelegram({
                        status: 'ready',
                        data: {
                          ...telegram.data!,
                          client: {
                            clientId: selectedClientId,
                            chatId: telegram.data!.client?.chatId ?? '',
                            enabled: event.target.checked,
                          },
                        },
                      })
                    }
                  />
                  <span>Отправлять клиенту</span>
                </label>
                <label>
                  <span>Chat ID клиента</span>
                  <input
                    value={telegram.data.client?.chatId ?? ''}
                    onChange={(event) =>
                      setTelegram({
                        status: 'ready',
                        data: {
                          ...telegram.data!,
                          client: {
                            clientId: selectedClientId,
                            enabled: telegram.data!.client?.enabled ?? false,
                            chatId: event.target.value,
                          },
                        },
                      })
                    }
                    placeholder="123456789"
                  />
                </label>
                <div className="service-actions">
                  <button className="primary-button" type="button" onClick={() => void saveTelegramClient()} disabled={isBusy || !selectedClientId}>
                    Сохранить
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!selectedClientId}
                    onClick={async () => setMessage(JSON.stringify(await testServiceTelegramClient(session.accessToken, selectedClientId)))}
                  >
                    Тест клиенту
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="panel-message">Настройки Telegram загружаются.</p>
          )}
        </Section>
      ) : null}

      {activeTab === 'kiz' ? (
        <Section title="Поиск КИЗ" icon={<Search size={18} />}>
          <div className="service-search-row">
            <input value={kizSearch} onChange={(event) => setKizSearch(event.target.value)} placeholder="Введите номер или фрагмент" />
            <button className="primary-button" type="button" onClick={() => void runKizSearch()} disabled={kizSearch.trim().length < 3}>
              Найти
            </button>
          </div>
          {kizRows.status === 'error' ? <div className="service-message service-message--error">{kizRows.error}</div> : null}
          <TableWrap>
            <table className="data-table service-table service-table--wide">
              <thead>
                <tr>
                  <th>КИЗ</th>
                  <th>Товар</th>
                  <th>Клиент</th>
                  <th>Короб</th>
                  <th>Статус</th>
                  <th>Принят / движение</th>
                </tr>
              </thead>
              <tbody>
                {kizRows.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.value}</strong>
                      <span>{row.sourceDocument ?? '-'}</span>
                    </td>
                    <td>
                      <strong>{row.sku.name}</strong>
                      <span>{row.sku.barcodes.map((barcode) => barcode.value).join(', ') || row.sku.internalSku}</span>
                    </td>
                    <td>{row.client.name}</td>
                    <td>{row.box?.code ?? 'Без короба'}</td>
                    <td>{row.status}</td>
                    <td>
                      <span>{formatDateTime(row.createdAt)}</span>
                      <span>{row.stockMovement?.comment ?? row.stockMovement?.sourceDocument ?? '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {activeTab === 'stock' ? (
        <Section title="Очистка остатков клиента" icon={<Eraser size={18} />}>
          <MetricGrid summary={currentSummary} />
          <DangerZone
            warning={stockPreview.data?.warning ?? 'Выберите клиента, чтобы увидеть данные для очистки.'}
            confirmation={stockConfirmation}
            confirmationText={stockPreview.data?.confirmationText ?? 'ОЧИСТИТЬ'}
            onConfirmation={setStockConfirmation}
            actionLabel="Очистить остатки клиента"
            disabled={isBusy || stockConfirmation !== stockPreview.data?.confirmationText}
            onAction={() => void purgeStock()}
          />
        </Section>
      ) : null}

      {activeTab === 'requests' ? (
        <Section title="Удаление заявок клиента" icon={<Trash2 size={18} />}>
          <div className="service-two-columns">
            <div className="service-card">
              <strong>{requestsPreview.data?.total ?? 0}</strong>
              <span>Всего заявок у выбранного клиента</span>
            </div>
            <div className="service-card">
              <strong>{requestsPreview.data?.statuses.map((item) => `${item.status}: ${item.count}`).join(', ') || '-'}</strong>
              <span>Разбивка по статусам</span>
            </div>
          </div>
          <DangerZone
            warning={requestsPreview.data?.warning ?? 'Выберите клиента, чтобы увидеть заявки.'}
            confirmation={requestsConfirmation}
            confirmationText={requestsPreview.data?.confirmationText ?? 'УДАЛИТЬ ЗАЯВКИ'}
            onConfirmation={setRequestsConfirmation}
            actionLabel="Удалить заявки клиента"
            disabled={isBusy || requestsConfirmation !== requestsPreview.data?.confirmationText}
            onAction={() => void purgeRequests()}
          />
        </Section>
      ) : null}
    </section>
  );
}

function ClientSelector({
  clients,
  selectedClientId,
  onChange,
  onRefresh,
}: {
  clients: LoadState<ClientSummary[]>;
  selectedClientId: string;
  onChange: (clientId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="service-client-selector">
      <label>
        <span>Клиент для операций</span>
        <select value={selectedClientId} onChange={(event) => onChange(event.target.value)}>
          {clients.data.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary-button" type="button" onClick={onRefresh}>
        <RefreshCw size={16} aria-hidden="true" />
        Обновить клиентов
      </button>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="service-section">
      <div className="service-section__heading">
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function MetricGrid({ summary }: { summary: ServiceClientStockSummary }) {
  return (
    <div className="service-metrics">
      <Metric icon={<Database size={17} />} label="Единиц" value={summary.quantity} />
      <Metric icon={<Database size={17} />} label="SKU" value={summary.uniqueSkusInStock} />
      <Metric icon={<Eraser size={17} />} label="Строк остатков" value={summary.balanceRows} />
      <Metric icon={<Eraser size={17} />} label="Движений" value={summary.movements} />
      <Metric icon={<Eraser size={17} />} label="Коробов" value={summary.boxes} />
      <Metric icon={<Eraser size={17} />} label="Паллет" value={summary.pallets} />
      <Metric icon={<Eraser size={17} />} label="КИЗ" value={summary.productMarks} />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <article className="service-metric">
      {icon}
      <span>{label}</span>
      <strong>{new Intl.NumberFormat('ru-RU').format(value)}</strong>
    </article>
  );
}

function DangerZone({
  warning,
  confirmation,
  confirmationText,
  onConfirmation,
  actionLabel,
  disabled,
  onAction,
}: {
  warning: string;
  confirmation: string;
  confirmationText: string;
  onConfirmation: (value: string) => void;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="service-danger-box">
      <div className="service-warning">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{warning}</span>
      </div>
      <div className="service-danger-zone">
        <label>
          <span>Подтверждение</span>
          <input value={confirmation} onChange={(event) => onConfirmation(event.target.value)} placeholder={`Введите ${confirmationText}`} />
        </label>
        <button className="danger-button" type="button" onClick={onAction} disabled={disabled}>
          <Trash2 size={16} aria-hidden="true" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="service-table-wrap">{children}</div>;
}

function formatStockPurgeResult(result: ServiceClientStockCleanupResult) {
  return `Остатки очищены: строк ${result.deleted.balances}, движений ${result.deleted.movements}, коробов ${result.deleted.boxes}, паллет ${result.deleted.pallets}, КИЗ ${result.deleted.productMarks}.`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
