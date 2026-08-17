import {
  Archive,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  Link as LinkIcon,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  clearUserTsdActivationCode,
  fetchBranches,
  fetchClients,
  fetchRoles,
  fetchUsers,
  setUserTsdActivationCode,
  updateClient,
  updateClientStatus,
  updateStorageTariff,
  updateUserProfile,
  updateUserRoles,
  updateUserClientScopes,
  type AuthSession,
  type BranchSummary,
  type ClientKind,
  type ClientStatus,
  type ClientSummary,
  type RoleSummary,
  type UserSummary,
} from '../../lib/api';
import type { WorkspaceId } from '../../lib/workspaces';
import { ConfirmDialog } from '../common/ConfirmDialog';
import './debug.css';
import { useRememberedClientId } from '../../lib/rememberedClient';

type DebugPanelProps = {
  session: AuthSession;
  onOpenWorkspace?: (id: WorkspaceId) => void;
};

type DebugTab = 'clients' | 'archive' | 'users' | 'data';

type ClientDraft = {
  name: string;
  legalName: string;
  inn: string;
  clientKind: ClientKind;
  status: ClientStatus;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  telegramChatId: string;
  email: string;
  bankName: string;
  bankBik: string;
  bankAccount: string;
  correspondentAccount: string;
  storageAccountingEnabled: boolean;
  storesWithoutBoxes: boolean;
  storagePriceRubPerLiterDay: string;
  fulfillmentManagerUserId: string;
};

type UserDraft = {
  email: string;
  name: string;
  password: string;
  status: string;
  analyticsEnabled: boolean;
  warehouseId: string;
};

const tabs: Array<{ id: DebugTab; label: string; icon: typeof Building2 }> = [
  { id: 'clients', label: 'Клиенты', icon: Building2 },
  { id: 'archive', label: 'Архив', icon: Archive },
  { id: 'users', label: 'Пользователи', icon: UserCog },
  { id: 'data', label: 'Данные и режимы', icon: Database },
];

const clientKinds: Array<{ value: ClientKind; label: string }> = [
  { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
  { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'ИП' },
  { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
  { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];

const clientStatuses: Array<{ value: ClientStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'PAUSED', label: 'Заблокирован' },
  { value: 'ARCHIVED', label: 'Архив' },
];

const userStatuses = [
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'BLOCKED', label: 'Заблокирован' },
];

const workspaceShortcuts: Array<{
  id: WorkspaceId;
  title: string;
  text: string;
  icon: typeof Settings2;
}> = [
  {
    id: 'service',
    title: 'Сервис',
    text: 'Режим обслуживания, сессии, КИЗ, очистка остатков и заявок по клиенту.',
    icon: Settings2,
  },
  {
    id: 'data',
    title: 'Данные',
    text: 'Быстрый просмотр таблиц остатков, клиентов, SKU и очередей разбора.',
    icon: Database,
  },
  {
    id: 'directories',
    title: 'Справочники',
    text: 'Создание клиентов, загрузка номенклатуры, карточки товаров и соответствия.',
    icon: Building2,
  },
  {
    id: 'access',
    title: 'Доступы',
    text: 'Роли, клиентские доступы, принтеры и пользователи, работающие с ТСД.',
    icon: ShieldCheck,
  },
];

const emptyClientDraft: ClientDraft = {
  name: '',
  legalName: '',
  inn: '',
  clientKind: 'LEGAL_ENTITY',
  status: 'ACTIVE',
  kpp: '',
  ogrn: '',
  legalAddress: '',
  actualAddress: '',
  phone: '',
  telegramChatId: '',
  email: '',
  bankName: '',
  bankBik: '',
  bankAccount: '',
  correspondentAccount: '',
  storageAccountingEnabled: false,
  storesWithoutBoxes: false,
  storagePriceRubPerLiterDay: '',
  fulfillmentManagerUserId: '',
};

const emptyUserDraft: UserDraft = {
  email: '',
  name: '',
  password: '',
  status: 'ACTIVE',
  analyticsEnabled: false,
  warehouseId: '',
};

export function DebugPanel({ session, onOpenWorkspace }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState<DebugTab>('clients');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [clientDraft, setClientDraft] = useState<ClientDraft>(emptyClientDraft);
  const [userDraft, setUserDraft] = useState<UserDraft>(emptyUserDraft);
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [userClientMode, setUserClientMode] = useState<'all' | 'limited'>('all');
  const [userClientIds, setUserClientIds] = useState<string[]>([]);
  const [tsdCode, setTsdCode] = useState('');
  const [pendingUserOverrideReasons, setPendingUserOverrideReasons] = useState<string[] | null>(null);
  const [pendingArchiveClient, setPendingArchiveClient] = useState<ClientSummary | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSavingClient, setSavingClient] = useState(false);
  const [isSavingUser, setSavingUser] = useState(false);
  const [isSavingCode, setSavingCode] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);
  const workingClients = useMemo(() => clients.filter((client) => client.status !== 'ARCHIVED'), [clients]);
  const archivedClients = useMemo(() => clients.filter((client) => client.status === 'ARCHIVED'), [clients]);
  const activeClientItems = activeTab === 'archive' ? archivedClients : workingClients;
  const filteredClients = useMemo(() => filterClients(workingClients, clientSearch), [workingClients, clientSearch]);
  const filteredArchivedClients = useMemo(() => filterClients(archivedClients, archiveSearch), [archivedClients, archiveSearch]);
  const isArchiveTab = activeTab === 'archive';
  const clientListForTab = isArchiveTab ? filteredArchivedClients : filteredClients;
  const filteredUsers = useMemo(() => filterUsers(users, userSearch), [users, userSearch]);
  const managerOptions = useMemo(
    () =>
      users.filter((user) =>
        user.roles.some((item) => ['OWNER', 'ADMIN', 'MANAGER'].includes(item.role.code)),
      ),
    [users],
  );

  useEffect(() => {
    void loadAll();
  }, [session.accessToken]);

  useEffect(() => {
    if (activeTab !== 'clients' && activeTab !== 'archive') {
      return;
    }

    if (!activeClientItems.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(activeClientItems[0]?.id ?? '');
    }
  }, [activeTab, activeClientItems, selectedClientId]);

  useEffect(() => {
    if (!selectedUser && users[0]) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUser]);

  useEffect(() => {
    setClientDraft(selectedClient ? clientToDraft(selectedClient) : emptyClientDraft);
  }, [selectedClient]);

  useEffect(() => {
    setUserDraft(selectedUser ? userToDraft(selectedUser) : emptyUserDraft);
    setRoleCodes(selectedUser?.roles.map((item) => item.role.code) ?? []);
    setUserClientMode(selectedUser && selectedUser.clientScopes.length > 0 ? 'limited' : 'all');
    setUserClientIds(selectedUser?.clientScopes.map((scope) => scope.client.id) ?? []);
    setTsdCode('');
  }, [selectedUser]);

  async function loadAll() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const [nextClients, nextUsers, nextRoles, nextBranches] = await Promise.all([
        fetchClients(session.accessToken, { includeArchived: true }),
        fetchUsers(session.accessToken),
        fetchRoles(session.accessToken),
        fetchBranches(session.accessToken),
      ]);
      setClients(nextClients);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setBranches(nextBranches);
      setSelectedClientId((current) => current || nextClients.find((client) => client.status !== 'ARCHIVED')?.id || nextClients[0]?.id || '');
      setSelectedUserId((current) => current || nextUsers[0]?.id || '');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function saveClient() {
    if (!selectedClient) {
      return;
    }

    setSavingClient(true);
    setError('');
    setMessage('');
    try {
      let saved = await updateClient(session.accessToken, selectedClient.id, {
        clientKind: clientDraft.clientKind,
        name: clientDraft.name,
        legalName: clientDraft.legalName,
        inn: clientDraft.inn,
        kpp: clientDraft.kpp,
        ogrn: clientDraft.ogrn,
        legalAddress: clientDraft.legalAddress,
        actualAddress: clientDraft.actualAddress,
        phone: clientDraft.phone,
        telegramChatId: clientDraft.telegramChatId,
        email: clientDraft.email,
        bankName: clientDraft.bankName,
        bankBik: clientDraft.bankBik,
        bankAccount: clientDraft.bankAccount,
        correspondentAccount: clientDraft.correspondentAccount,
        storageAccountingEnabled: clientDraft.storageAccountingEnabled,
        storesWithoutBoxes: clientDraft.storesWithoutBoxes,
        fulfillmentManagerUserId: clientDraft.fulfillmentManagerUserId,
      });

      if (clientDraft.status !== selectedClient.status) {
        saved = await updateClientStatus(session.accessToken, selectedClient.id, clientDraft.status);
      }

      const tariffText = clientDraft.storagePriceRubPerLiterDay.trim();
      if (tariffText) {
        const tariff = Number(tariffText.replace(',', '.'));
        if (!Number.isNaN(tariff) && tariff >= 0 && String(selectedClient.storagePriceRubPerLiterDay ?? '') !== String(tariff)) {
          saved = {
            ...saved,
            ...(await updateStorageTariff(session.accessToken, selectedClient.id, {
              storagePriceRubPerLiterDay: tariff,
            })),
          };
        }
      }

      setClients((current) => current.map((client) => (client.id === saved.id ? saved : client)));
      setClientDraft(clientToDraft(saved));
      setSelectedClientId(saved.id);
      if (saved.status === 'ARCHIVED') {
        setActiveTab('archive');
      } else if (activeTab === 'archive') {
        setActiveTab('clients');
      }
      setMessage('Данные клиента сохранены.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingClient(false);
    }
  }

  async function archiveClientConfirmed() {
    if (!pendingArchiveClient) {
      return;
    }

    setSavingClient(true);
    setError('');
    setMessage('');
    try {
      const archived = await updateClientStatus(session.accessToken, pendingArchiveClient.id, 'ARCHIVED');
      setClients((current) => current.map((client) => (client.id === archived.id ? archived : client)));
      if (archived.id === selectedClientId) {
        setClientDraft(clientToDraft(archived));
      }
      setSelectedClientId(archived.id);
      setActiveTab('archive');
      setMessage('Клиент отправлен в архив.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingArchiveClient(null);
      setSavingClient(false);
    }
  }

  async function restoreArchivedClient() {
    if (!selectedClient || selectedClient.status !== 'ARCHIVED') {
      return;
    }

    setSavingClient(true);
    setError('');
    setMessage('');
    try {
      const restored = await updateClientStatus(session.accessToken, selectedClient.id, 'ACTIVE');
      setClients((current) => current.map((client) => (client.id === restored.id ? restored : client)));
      setClientDraft(clientToDraft(restored));
      setSelectedClientId(restored.id);
      setActiveTab('clients');
      setMessage('Клиент возвращен в рабочий список.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingClient(false);
    }
  }

  async function saveUser() {
    if (!selectedUser) {
      return;
    }
    if (roleCodes.length === 0) {
      setError('Нужно оставить хотя бы одну роль пользователя.');
      return;
    }

    const reasons = userOverrideReasons(userDraft);
    if (reasons.length > 0) {
      setPendingUserOverrideReasons(reasons);
      return;
    }

    await saveUserConfirmed();
  }

  async function saveUserConfirmed() {
    if (!selectedUser) {
      return;
    }

    setSavingUser(true);
    setError('');
    setMessage('');
    try {
      let saved = await updateUserProfile(session.accessToken, selectedUser.id, {
        email: userDraft.email,
        name: userDraft.name,
        status: userDraft.status,
        analyticsEnabled: userDraft.analyticsEnabled,
        warehouseId: userDraft.warehouseId || null,
        ...(userDraft.password.trim() ? { password: userDraft.password.trim() } : {}),
      });
      const currentRoleCodes = selectedUser.roles.map((item) => item.role.code).sort().join('|');
      const nextRoleCodes = [...roleCodes].sort().join('|');
      if (currentRoleCodes !== nextRoleCodes) {
        saved = await updateUserRoles(session.accessToken, selectedUser.id, { roleCodes });
      }
      const savedScopes = await updateUserClientScopes(session.accessToken, selectedUser.id, {
        allClients: userClientMode === 'all',
        scopes: userClientMode === 'all' ? [] : userClientIds.map((clientId) => ({ clientId, canRead: true, canWrite: true })),
      });
      saved = { ...saved, clientScopes: savedScopes.clientScopes };
      setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
      setUserDraft(userToDraft(saved));
      setMessage('Данные пользователя сохранены.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingUser(false);
    }
  }

  async function saveTsdCode() {
    if (!selectedUser) {
      return;
    }
    if (!/^\d{4}$/.test(tsdCode)) {
      setError('Супер код должен состоять ровно из 4 цифр.');
      return;
    }

    setSavingCode(true);
    setError('');
    setMessage('');
    try {
      const saved = await setUserTsdActivationCode(session.accessToken, selectedUser.id, tsdCode);
      setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
      setTsdCode('');
      setMessage('4-значный код подтверждения сохранён.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingCode(false);
    }
  }

  async function clearTsdCode() {
    if (!selectedUser) {
      return;
    }

    setSavingCode(true);
    setError('');
    setMessage('');
    try {
      const saved = await clearUserTsdActivationCode(session.accessToken, selectedUser.id);
      setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
      setTsdCode('');
      setMessage('Код подтверждения сброшен.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingCode(false);
    }
  }

  function toggleRole(code: string) {
    setRoleCodes((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  return (
    <section className="debug-panel" aria-label="Отладка">
      <div className="debug-heading">
        <div>
          <p className="eyebrow">Контроль</p>
          <h2>Отладка</h2>
          <p>Быстрая правка клиентов, пользователей, операторов и системных параметров.</p>
        </div>
        <button className="primary-button debug-secondary" type="button" onClick={() => void loadAll()} disabled={isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{isLoading ? 'Обновление' : 'Обновить'}</span>
        </button>
      </div>

      <div className="debug-tabs" role="tablist" aria-label="Разделы отладки">
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <tab.icon size={16} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {message ? (
        <div className="debug-message">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{message}</span>
        </div>
      ) : null}
      {error ? <p className="debug-message debug-message--error">{error}</p> : null}

      {activeTab === 'clients' || activeTab === 'archive' ? (
        <div className="debug-split">
          <DebugList
            count={clientListForTab.length}
            emptyText={isArchiveTab ? 'В архиве пока нет клиентов' : 'Клиенты не найдены'}
            onSearch={isArchiveTab ? setArchiveSearch : setClientSearch}
            search={isArchiveTab ? archiveSearch : clientSearch}
            searchPlaceholder={isArchiveTab ? 'Поиск в архиве' : 'Поиск клиента, ИНН, кода'}
            title={isArchiveTab ? 'Архив клиентов' : 'Клиенты'}
          >
            {clientListForTab.map((client) => (
              <button
                className={[
                  'debug-list-item',
                  client.id === selectedClientId ? 'active' : '',
                  client.status === 'ARCHIVED' ? 'archived' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={client.id}
                type="button"
                onClick={() => setSelectedClientId(client.id)}
              >
                <strong>{client.name}</strong>
                <span>{client.legalName || client.inn || client.code}</span>
                <small>{clientStatusLabel(client.status)}</small>
              </button>
            ))}
          </DebugList>

          <div className="debug-editor">
            <div className="debug-editor__title">
              <Building2 size={18} aria-hidden="true" />
              <div>
                <h3>{selectedClient?.name || 'Выберите клиента'}</h3>
                <span>{selectedClient ? `${selectedClient.code} · ${clientKindLabel(selectedClient.clientKind)}` : 'Карточка клиента'}</span>
              </div>
            </div>

            <div className="debug-fields debug-fields--three">
              <label>
                <span>Название</span>
                <input value={clientDraft.name} onChange={(event) => setClientField('name', event.target.value)} />
              </label>
              <label>
                <span>Юр. название</span>
                <input value={clientDraft.legalName} onChange={(event) => setClientField('legalName', event.target.value)} />
              </label>
              <label>
                <span>ИНН</span>
                <input value={clientDraft.inn} onChange={(event) => setClientField('inn', event.target.value)} />
              </label>
              <label>
                <span>Тип клиента</span>
                <select value={clientDraft.clientKind} onChange={(event) => setClientField('clientKind', event.target.value as ClientKind)}>
                  {clientKinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Статус</span>
                <select value={clientDraft.status} onChange={(event) => setClientField('status', event.target.value as ClientStatus)}>
                  {clientStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Менеджер ФФ</span>
                <select
                  value={clientDraft.fulfillmentManagerUserId}
                  onChange={(event) => setClientField('fulfillmentManagerUserId', event.target.value)}
                >
                  <option value="">Не назначен</option>
                  {managerOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="debug-fields debug-fields--three">
              <label>
                <span>Телефон</span>
                <input value={clientDraft.phone} onChange={(event) => setClientField('phone', event.target.value)} />
              </label>
              <label>
                <span>Email</span>
                <input value={clientDraft.email} onChange={(event) => setClientField('email', event.target.value)} />
              </label>
              <label>
                <span>Telegram chat_id</span>
                <input value={clientDraft.telegramChatId} onChange={(event) => setClientField('telegramChatId', event.target.value)} />
              </label>
              <label>
                <span>КПП</span>
                <input value={clientDraft.kpp} onChange={(event) => setClientField('kpp', event.target.value)} />
              </label>
              <label>
                <span>ОГРН</span>
                <input value={clientDraft.ogrn} onChange={(event) => setClientField('ogrn', event.target.value)} />
              </label>
              <label>
                <span>Тариф хранения, ₽/л/сутки</span>
                <input
                  inputMode="decimal"
                  value={clientDraft.storagePriceRubPerLiterDay}
                  onChange={(event) => setClientField('storagePriceRubPerLiterDay', event.target.value)}
                />
              </label>
            </div>

            <div className="debug-fields debug-fields--two">
              <label>
                <span>Юридический адрес</span>
                <textarea value={clientDraft.legalAddress} onChange={(event) => setClientField('legalAddress', event.target.value)} />
              </label>
              <label>
                <span>Фактический адрес</span>
                <textarea value={clientDraft.actualAddress} onChange={(event) => setClientField('actualAddress', event.target.value)} />
              </label>
            </div>

            <div className="debug-fields debug-fields--four">
              <label>
                <span>Банк</span>
                <input value={clientDraft.bankName} onChange={(event) => setClientField('bankName', event.target.value)} />
              </label>
              <label>
                <span>БИК</span>
                <input value={clientDraft.bankBik} onChange={(event) => setClientField('bankBik', event.target.value)} />
              </label>
              <label>
                <span>Расчётный счёт</span>
                <input value={clientDraft.bankAccount} onChange={(event) => setClientField('bankAccount', event.target.value)} />
              </label>
              <label>
                <span>Корр. счёт</span>
                <input
                  value={clientDraft.correspondentAccount}
                  onChange={(event) => setClientField('correspondentAccount', event.target.value)}
                />
              </label>
            </div>

            <div className="debug-switches">
              <label>
                <input
                  checked={clientDraft.storageAccountingEnabled}
                  type="checkbox"
                  onChange={(event) => setClientField('storageAccountingEnabled', event.target.checked)}
                />
                <span>Считать хранение</span>
              </label>
              <label>
                <span>Вид приемки</span>
                <select
                  value={clientDraft.storesWithoutBoxes ? 'WITHOUT_BOXES' : 'WITH_BOXES'}
                  onChange={(event) => setClientField('storesWithoutBoxes', event.target.value === 'WITHOUT_BOXES')}
                >
                  <option value="WITH_BOXES">С коробами</option>
                  <option value="WITHOUT_BOXES">Без коробов, поштучно</option>
                </select>
              </label>
            </div>

            <div className="debug-actions">
              <button className="primary-button" type="button" onClick={() => void saveClient()} disabled={!selectedClient || isSavingClient}>
                <Save size={16} aria-hidden="true" />
                <span>{isSavingClient ? 'Сохранение' : 'Сохранить клиента'}</span>
              </button>
              {selectedClient?.status === 'ARCHIVED' ? (
                <button
                  className="primary-button debug-secondary"
                  type="button"
                  onClick={() => void restoreArchivedClient()}
                  disabled={isSavingClient}
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Вернуть в работу</span>
                </button>
              ) : (
                <button
                  className="primary-button debug-secondary"
                  type="button"
                  onClick={() => selectedClient && setPendingArchiveClient(selectedClient)}
                  disabled={!selectedClient || isSavingClient}
                >
                  <Archive size={16} aria-hidden="true" />
                  <span>В архив</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <div className="debug-split">
          <DebugList
            count={filteredUsers.length}
            emptyText="Пользователи не найдены"
            onSearch={setUserSearch}
            search={userSearch}
            searchPlaceholder="Поиск пользователя, логина, роли"
            title="Пользователи и операторы"
          >
            {filteredUsers.map((user) => (
              <button
                className={user.id === selectedUserId ? 'debug-list-item active' : 'debug-list-item'}
                key={user.id}
                type="button"
                onClick={() => setSelectedUserId(user.id)}
              >
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <small>{user.roles.map((item) => item.role.code).join(', ') || 'Без роли'}</small>
              </button>
            ))}
          </DebugList>

          <div className="debug-editor">
            <div className="debug-editor__title">
              <UserCog size={18} aria-hidden="true" />
              <div>
                <h3>{selectedUser?.name || 'Выберите пользователя'}</h3>
                <span>{selectedUser ? `${selectedUser.email} · ${selectedUser.status}` : 'Карточка пользователя'}</span>
              </div>
            </div>

            <div className="debug-fields debug-fields--three">
              <label>
                <span>Имя</span>
                <input value={userDraft.name} onChange={(event) => setUserField('name', event.target.value)} />
              </label>
              <label>
                <span>Логин / email</span>
                <input value={userDraft.email} onChange={(event) => setUserField('email', event.target.value)} />
              </label>
              <label>
                <span>Статус</span>
                <select value={userDraft.status} onChange={(event) => setUserField('status', event.target.value)}>
                  {userStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Новый пароль</span>
                <input
                  autoComplete="new-password"
                  placeholder="Оставь пустым, если не менять"
                  type="password"
                  value={userDraft.password}
                  onChange={(event) => setUserField('password', event.target.value)}
                />
              </label>
              <label className="debug-access-toggle">
                <span>Доступ к аналитике</span>
                <span className="debug-access-toggle__control">
                  <input
                    checked={userDraft.analyticsEnabled}
                    type="checkbox"
                    onChange={(event) => setUserField('analyticsEnabled', event.target.checked)}
                  />
                  <strong>{userDraft.analyticsEnabled ? 'Плитка видна' : 'Плитка скрыта'}</strong>
                </span>
              </label>
              <label>
                <span>Закреплённый филиал</span>
                <select value={userDraft.warehouseId} onChange={(event) => setUserField('warehouseId', event.target.value)}>
                  <option value="">Все филиалы (только администратор/владелец)</option>
                  {branches.filter((branch) => branch.isActive).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.city} · {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="debug-role-grid">
              {roles.map((role) => {
                const isSelected = roleCodes.includes(role.code);
                return (
                  <label className={isSelected ? 'debug-role active' : 'debug-role'} key={role.code}>
                    <input checked={isSelected} type="checkbox" onChange={() => toggleRole(role.code)} />
                    <span>
                      <strong>{role.code}</strong>
                      {role.name}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="debug-code-box">
              <div>
                <ShieldCheck size={18} aria-hidden="true" />
                <strong>Доступные клиенты</strong>
                <span>Выберите всех клиентов филиала или только конкретных.</span>
              </div>
              <div className="debug-access-toggle__control">
                <label><input type="radio" checked={userClientMode === 'all'} onChange={() => setUserClientMode('all')} /> Все клиенты филиала</label>
                <label><input type="radio" checked={userClientMode === 'limited'} onChange={() => setUserClientMode('limited')} /> Выбранные</label>
              </div>
              {userClientMode === 'limited' ? <div className="debug-role-grid">
                {clients.filter((client) => client.status === 'ACTIVE').map((client) => <label className={userClientIds.includes(client.id) ? 'debug-role active' : 'debug-role'} key={client.id}>
                  <input type="checkbox" checked={userClientIds.includes(client.id)} onChange={() => setUserClientIds((current) => current.includes(client.id) ? current.filter((id) => id !== client.id) : [...current, client.id])} />
                  <span><strong>{client.code}</strong>{client.name}</span>
                </label>)}
              </div> : null}
            </div>

            <div className="debug-actions">
              <button className="primary-button" type="button" onClick={() => void saveUser()} disabled={!selectedUser || isSavingUser}>
                <Save size={16} aria-hidden="true" />
                <span>{isSavingUser ? 'Сохранение' : 'Сохранить пользователя'}</span>
              </button>
            </div>

            <div className="debug-code-box">
              <div>
                <KeyRound size={18} aria-hidden="true" />
                <strong>4-значный супер код менеджера</strong>
                <span>
                  Нужен для разблокировки шагов и подтверждений на ТСД. Сейчас:{' '}
                  {selectedUser?.hasTsdActivationCode ? 'код задан' : 'код не задан'}.
                </span>
              </div>
              <div className="debug-code-actions">
                <input
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0000"
                  value={tsdCode}
                  onChange={(event) => setTsdCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <button className="primary-button" type="button" onClick={() => void saveTsdCode()} disabled={!selectedUser || isSavingCode}>
                  <Save size={16} aria-hidden="true" />
                  <span>Назначить</span>
                </button>
                <button
                  className="primary-button debug-secondary"
                  type="button"
                  onClick={() => void clearTsdCode()}
                  disabled={!selectedUser || isSavingCode || !selectedUser.hasTsdActivationCode}
                >
                  Сбросить
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'data' ? (
        <div className="debug-shortcuts">
          {workspaceShortcuts.map((item) => (
            <button className="debug-shortcut" key={item.id} type="button" onClick={() => onOpenWorkspace?.(item.id)}>
              <item.icon size={20} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <LinkIcon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {pendingUserOverrideReasons ? (
        <ConfirmDialog
          title="Подтвердить обход ограничений"
          message="Пользователь будет сохранён с данными, которые обычно система не пропускает автоматически."
          details={pendingUserOverrideReasons}
          confirmLabel="Сохранить"
          isBusy={isSavingUser}
          onCancel={() => setPendingUserOverrideReasons(null)}
          onConfirm={() => {
            setPendingUserOverrideReasons(null);
            void saveUserConfirmed();
          }}
        />
      ) : null}

      {pendingArchiveClient ? (
        <ConfirmDialog
          title="Отправить клиента в архив"
          message="Клиент останется в базе, но будет помечен архивным и убран из рабочего контура."
          details={[`${pendingArchiveClient.code} · ${pendingArchiveClient.name}`]}
          confirmLabel="В архив"
          isBusy={isSavingClient}
          onCancel={() => setPendingArchiveClient(null)}
          onConfirm={() => void archiveClientConfirmed()}
        />
      ) : null}
    </section>
  );

  function setClientField<K extends keyof ClientDraft>(field: K, value: ClientDraft[K]) {
    setClientDraft((current) => ({ ...current, [field]: value }));
  }

  function setUserField<K extends keyof UserDraft>(field: K, value: UserDraft[K]) {
    setUserDraft((current) => ({ ...current, [field]: value }));
  }
}

function DebugList({
  children,
  count,
  emptyText,
  onSearch,
  search,
  searchPlaceholder,
  title,
}: {
  children: ReactNode;
  count: number;
  emptyText: string;
  onSearch: (value: string) => void;
  search: string;
  searchPlaceholder: string;
  title: string;
}) {
  return (
    <aside className="debug-list">
      <div className="debug-list__head">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      <input placeholder={searchPlaceholder} value={search} onChange={(event) => onSearch(event.target.value)} />
      <div className="debug-list__items">{count > 0 ? children : <p className="debug-empty">{emptyText}</p>}</div>
    </aside>
  );
}

function clientToDraft(client: ClientSummary): ClientDraft {
  return {
    name: client.name ?? '',
    legalName: client.legalName ?? '',
    inn: client.inn ?? '',
    clientKind: client.clientKind,
    status: client.status,
    kpp: client.kpp ?? '',
    ogrn: client.ogrn ?? '',
    legalAddress: client.legalAddress ?? '',
    actualAddress: client.actualAddress ?? '',
    phone: client.phone ?? '',
    telegramChatId: client.telegramChatId ?? '',
    email: client.email ?? '',
    bankName: client.bankName ?? '',
    bankBik: client.bankBik ?? '',
    bankAccount: client.bankAccount ?? '',
    correspondentAccount: client.correspondentAccount ?? '',
    storageAccountingEnabled: client.storageAccountingEnabled,
    storesWithoutBoxes: Boolean(client.storesWithoutBoxes),
    storagePriceRubPerLiterDay: client.storagePriceRubPerLiterDay === null ? '' : String(client.storagePriceRubPerLiterDay),
    fulfillmentManagerUserId: client.fulfillmentManagerUserId ?? '',
  };
}

function userToDraft(user: UserSummary): UserDraft {
  return {
    email: user.email,
    name: user.name,
    password: '',
    status: user.status,
    analyticsEnabled: user.analyticsEnabled,
    warehouseId: user.activeWarehouseId ?? user.warehouseScopes?.find((scope) => scope.canRead)?.warehouse.id ?? '',
  };
}

function filterClients(clients: ClientSummary[], search: string) {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  if (!query) {
    return clients;
  }
  return clients.filter((client) =>
    [client.name, client.legalName, client.inn, client.code, client.email, client.phone]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query)),
  );
}

function filterUsers(users: UserSummary[], search: string) {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  if (!query) {
    return users;
  }
  return users.filter((user) =>
    [user.name, user.email, user.status, ...user.roles.map((item) => item.role.code)]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query)),
  );
}

function userOverrideReasons(user: UserDraft) {
  const reasons: string[] = [];
  const login = user.email.trim();
  const name = user.name.trim();
  const password = user.password.trim();

  if (!login) {
    reasons.push('Логин / email пустой.');
  } else if (!isLikelyEmail(login)) {
    reasons.push('Логин указан не в формате email.');
  }

  if (!name) {
    reasons.push('Имя пользователя пустое.');
  }

  if (password && password.length < 10) {
    reasons.push('Новый пароль короче обычного требования 10 символов.');
  }

  return reasons;
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clientKindLabel(kind: ClientKind) {
  return clientKinds.find((item) => item.value === kind)?.label ?? kind;
}

function clientStatusLabel(status: ClientStatus) {
  return clientStatuses.find((item) => item.value === status)?.label ?? status;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить действие.';
}
