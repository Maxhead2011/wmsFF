import { BadgePercent, KeyRound, RefreshCw, Save, Search, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchUserReferralClients,
  fetchRoles,
  fetchUsers,
  updateUserClientScopes,
  updateUserProfile,
  updateUserReferralClients,
  updateUserRoles,
  type AuthSession,
  type ClientSummary,
  type RoleSummary,
  type UpdateUserClientScopesPayload,
  type UpdateUserProfilePayload,
  type UpdateUserReferralClientsPayload,
  type UserReferralClientSummary,
  type UserSummary,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';

type UserManagementPanelProps = {
  session: AuthSession;
};

type ClientAccessLevel = 'read' | 'write';
type ClientAccessMap = Record<string, ClientAccessLevel>;
type ReferralAccess = {
  percent: string;
  termMonths: string;
  expiresAt: string | null;
};
type ReferralAccessMap = Record<string, ReferralAccess>;

const emptyProfile = {
  email: '',
  name: '',
  password: '',
  status: 'ACTIVE',
};

const referralTermOptions = [
  { value: '1', label: '1 месяц' },
  { value: '6', label: '6 месяцев' },
  { value: '12', label: '1 год' },
  { value: '24', label: '2 года' },
  { value: 'none', label: 'Без срока' },
];

export function UserManagementPanel({ session }: UserManagementPanelProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [profile, setProfile] = useState(emptyProfile);
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [accessMode, setAccessMode] = useState<'all' | 'limited'>('limited');
  const [clientAccess, setClientAccess] = useState<ClientAccessMap>({});
  const [clientSearch, setClientSearch] = useState('');
  const [clientToAdd, setClientToAdd] = useState('');
  const [clientLevelToAdd, setClientLevelToAdd] = useState<ClientAccessLevel>('read');
  const [referralAccess, setReferralAccess] = useState<ReferralAccessMap>({});
  const [referralClientSearch, setReferralClientSearch] = useState('');
  const [referralClientToAdd, setReferralClientToAdd] = useState('');
  const [referralPercentToAdd, setReferralPercentToAdd] = useState('5');
  const [referralTermToAdd, setReferralTermToAdd] = useState('6');
  const [confirmReasons, setConfirmReasons] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSavingProfile, setSavingProfile] = useState(false);
  const [isSavingAccess, setSavingAccess] = useState(false);
  const [isLoadingReferrals, setLoadingReferrals] = useState(false);
  const [isSavingReferrals, setSavingReferrals] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const filteredUsers = useMemo(() => {
    const normalized = normalizeSearch(userSearch);
    if (!normalized) {
      return users;
    }

    return users.filter(
      (user) =>
        normalizeSearch(user.name).includes(normalized) ||
        normalizeSearch(user.email).includes(normalized) ||
        user.roles.some((item) => normalizeSearch(item.role.code).includes(normalized)),
    );
  }, [userSearch, users]);
  const roleByCode = useMemo(() => new Map(roles.map((role) => [role.code, role])), [roles]);
  const hasClientRole = roleCodes.includes('CLIENT');
  const hasReferralRole = roleCodes.includes('REFERRAL_PARTNER');
  const grantedPermissions = useMemo(() => {
    const permissions = new Map<string, string>();
    roleCodes.forEach((code) => {
      roleByCode.get(code)?.permissions.forEach((permission) => {
        permissions.set(permission.code, permission.name);
      });
    });

    return [...permissions.entries()].sort(([left], [right]) => left.localeCompare(right, 'ru'));
  }, [roleByCode, roleCodes]);
  const visibleAccessRows = useMemo(
    () =>
      Object.entries(clientAccess)
        .map(([clientId, level]) => {
          const client = clients.find((item) => item.id === clientId);
          return client ? { client, level } : null;
        })
        .filter((item): item is { client: ClientSummary; level: ClientAccessLevel } => Boolean(item))
        .sort((left, right) => left.client.name.localeCompare(right.client.name, 'ru')),
    [clientAccess, clients],
  );
  const clientsForAdd = useMemo(() => {
    const normalized = normalizeSearch(clientSearch);
    return clients
      .filter((client) => !clientAccess[client.id])
      .filter(
        (client) =>
          !normalized ||
          normalizeSearch(client.name).includes(normalized) ||
          normalizeSearch(client.code).includes(normalized),
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [clientAccess, clientSearch, clients]);
  const visibleReferralRows = useMemo(
    () =>
      Object.entries(referralAccess)
        .map(([clientId, referral]) => {
          const client = clients.find((item) => item.id === clientId);
          return client ? { client, referral } : null;
        })
        .filter((item): item is { client: ClientSummary; referral: ReferralAccess } => Boolean(item))
        .sort((left, right) => left.client.name.localeCompare(right.client.name, 'ru')),
    [clients, referralAccess],
  );
  const clientsForReferralAdd = useMemo(() => {
    const normalized = normalizeSearch(referralClientSearch);
    return clients
      .filter((client) => !referralAccess[client.id])
      .filter(
        (client) =>
          !normalized ||
          normalizeSearch(client.name).includes(normalized) ||
          normalizeSearch(client.code).includes(normalized),
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [clients, referralAccess, referralClientSearch]);
  const isDirtyProfile = selectedUser
    ? profile.email.trim() !== selectedUser.email ||
      profile.name.trim() !== selectedUser.name ||
      profile.status !== selectedUser.status ||
      profile.password.trim().length > 0 ||
      !sameRoleCodes(roleCodes, selectedUser.roles.map((item) => item.role.code))
    : false;

  useEffect(() => {
    void loadDictionaries();
  }, [session.accessToken]);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }

    applySelectedUser(selectedUser);
    void loadReferralClients(selectedUser.id);
  }, [selectedUser?.id]);

  useEffect(() => {
    if (hasClientRole && accessMode === 'all') {
      setAccessMode('limited');
    }
  }, [accessMode, hasClientRole]);

  useEffect(() => {
    if (!clientToAdd && clientsForAdd[0]) {
      setClientToAdd(clientsForAdd[0].id);
    }
    if (clientToAdd && !clientsForAdd.some((client) => client.id === clientToAdd)) {
      setClientToAdd(clientsForAdd[0]?.id ?? '');
    }
  }, [clientToAdd, clientsForAdd]);

  useEffect(() => {
    if (!referralClientToAdd && clientsForReferralAdd[0]) {
      setReferralClientToAdd(clientsForReferralAdd[0].id);
    }
    if (referralClientToAdd && !clientsForReferralAdd.some((client) => client.id === referralClientToAdd)) {
      setReferralClientToAdd(clientsForReferralAdd[0]?.id ?? '');
    }
  }, [clientsForReferralAdd, referralClientToAdd]);

  async function loadDictionaries() {
    setLoading(true);
    setError('');

    try {
      const [nextUsers, nextRoles, nextClients] = await Promise.all([
        fetchUsers(session.accessToken),
        fetchRoles(session.accessToken),
        fetchClients(session.accessToken),
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setClients(nextClients);
      setSelectedUserId((current) => current || nextUsers[0]?.id || '');
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось загрузить пользователей, роли и клиентов.'));
    } finally {
      setLoading(false);
    }
  }

  function applySelectedUser(user: UserSummary) {
    setProfile({
      email: user.email,
      name: user.name,
      password: '',
      status: user.status,
    });
    const nextRoleCodes = user.roles.map((item) => item.role.code);
    const nextAccess = user.clientScopes.reduce<ClientAccessMap>((acc, scope) => {
      acc[scope.client.id] = scope.canWrite ? 'write' : 'read';
      return acc;
    }, {});
    setRoleCodes(nextRoleCodes);
    setClientAccess(nextAccess);
    setAccessMode(user.clientScopes.length === 0 && !nextRoleCodes.includes('CLIENT') ? 'all' : 'limited');
    setClientSearch('');
    setClientToAdd('');
    setReferralAccess({});
    setReferralClientSearch('');
    setReferralClientToAdd('');
    setMessage('');
    setError('');
  }

  async function loadReferralClients(userId: string) {
    setLoadingReferrals(true);

    try {
      const assignments = await fetchUserReferralClients(session.accessToken, userId);
      setReferralAccess(referralAssignmentsToMap(assignments));
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось загрузить реферальные настройки пользователя.'));
    } finally {
      setLoadingReferrals(false);
    }
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    setMessage('');
    setError('');
  }

  function toggleRole(code: string) {
    setRoleCodes((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  function addClientAccess() {
    if (!clientToAdd) {
      return;
    }

    setAccessMode('limited');
    setClientAccess((current) => ({
      ...current,
      [clientToAdd]: clientLevelToAdd,
    }));
    setClientToAdd('');
  }

  function changeClientAccess(clientId: string, level: ClientAccessLevel) {
    setClientAccess((current) => ({ ...current, [clientId]: level }));
  }

  function removeClientAccess(clientId: string) {
    setClientAccess((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }

  function addReferralClient() {
    if (!referralClientToAdd) {
      return;
    }

    setReferralAccess((current) => ({
      ...current,
      [referralClientToAdd]: {
        percent: referralPercentToAdd,
        termMonths: referralTermToAdd,
        expiresAt: null,
      },
    }));
    setReferralClientToAdd('');
  }

  function changeReferralClient(clientId: string, patch: Partial<ReferralAccess>) {
    setReferralAccess((current) => ({
      ...current,
      [clientId]: {
        ...(current[clientId] ?? { percent: '0', termMonths: '6', expiresAt: null }),
        ...patch,
      },
    }));
  }

  function removeReferralClient(clientId: string) {
    setReferralAccess((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }

  async function saveProfileAndRoles(force = false) {
    if (!selectedUser || roleCodes.length === 0) {
      return;
    }

    const reasons = profileWarnings(selectedUser, profile, roleCodes);
    if (!force && reasons.length > 0) {
      setConfirmReasons(reasons);
      return;
    }

    setSavingProfile(true);
    setError('');
    setMessage('');

    try {
      const payload: UpdateUserProfilePayload = {};
      const email = profile.email.trim();
      const name = profile.name.trim();
      const password = profile.password.trim();

      if (email !== selectedUser.email) {
        payload.email = email;
      }
      if (name !== selectedUser.name) {
        payload.name = name;
      }
      if (profile.status !== selectedUser.status) {
        payload.status = profile.status;
      }
      if (password) {
        payload.password = password;
      }

      let saved = selectedUser;
      if (Object.keys(payload).length > 0) {
        saved = await updateUserProfile(session.accessToken, selectedUser.id, payload);
      }
      if (!sameRoleCodes(roleCodes, saved.roles.map((item) => item.role.code))) {
        saved = await updateUserRoles(session.accessToken, selectedUser.id, { roleCodes });
      }

      setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
      setProfile((current) => ({ ...current, password: '' }));
      setMessage('Профиль, пароль и роли сохранены.');
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось сохранить пользователя.'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveAccess() {
    if (!selectedUser) {
      return;
    }

    setSavingAccess(true);
    setError('');
    setMessage('');

    try {
      const scopes: UpdateUserClientScopesPayload['scopes'] =
        accessMode === 'all'
          ? []
          : Object.entries(clientAccess).map(([clientId, level]) => ({
              clientId,
              canRead: true,
              canWrite: level === 'write',
            }));
      const saved = await updateUserClientScopes(session.accessToken, selectedUser.id, { scopes });
      setUsers((current) =>
        current.map((user) => (user.id === selectedUser.id ? { ...user, clientScopes: saved.clientScopes } : user)),
      );
      setMessage(accessMode === 'all' ? 'Пользователь получил доступ ко всем кабинетам клиентов.' : 'Доступы к клиентам сохранены.');
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось сохранить доступы к клиентам.'));
    } finally {
      setSavingAccess(false);
    }
  }

  async function saveReferrals() {
    if (!selectedUser) {
      return;
    }

    const assignments: UpdateUserReferralClientsPayload['assignments'] = Object.entries(referralAccess).map(
      ([clientId, referral]) => ({
        clientId,
        percent: Number(referral.percent) || 0,
        termMonths: referral.termMonths === 'none' ? null : Number(referral.termMonths),
        isActive: (Number(referral.percent) || 0) > 0,
      }),
    );

    setSavingReferrals(true);
    setError('');
    setMessage('');

    try {
      const saved = await updateUserReferralClients(session.accessToken, selectedUser.id, { assignments });
      setReferralAccess(referralAssignmentsToMap(saved));
      setMessage('Реферальная программа пользователя сохранена.');
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось сохранить реферальную программу.'));
    } finally {
      setSavingReferrals(false);
    }
  }

  return (
    <div className="user-management">
      <aside className="user-management__list" aria-label="Список пользователей">
        <label className="user-management__search">
          <Search size={16} aria-hidden="true" />
          <input
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Найти пользователя"
          />
        </label>
        <div className="user-management__users">
          {filteredUsers.map((user) => (
            <button
              className={user.id === selectedUserId ? 'user-row is-selected' : 'user-row'}
              key={user.id}
              type="button"
              onClick={() => selectUser(user.id)}
            >
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <small>
                {user.roles.map((item) => item.role.code).join(', ') || 'Без роли'} · {statusLabel(user.status)}
              </small>
            </button>
          ))}
          {filteredUsers.length === 0 ? <p className="access-empty">Пользователи не найдены.</p> : null}
        </div>
      </aside>

      <section className="user-management__workspace">
        {selectedUser ? (
          <>
            <header className="user-management__header">
              <div>
                <p className="eyebrow">Карточка пользователя</p>
                <h3>{selectedUser.name}</h3>
                <span>{selectedUser.email}</span>
              </div>
              <button className="primary-button access-secondary" type="button" onClick={() => void loadDictionaries()} disabled={isLoading}>
                <RefreshCw size={16} aria-hidden="true" />
                <span>Обновить</span>
              </button>
            </header>

            <div className="user-management__grid">
              <section className="user-edit-card">
                <header>
                  <UserCog size={18} aria-hidden="true" />
                  <div>
                    <strong>Профиль и пароль</strong>
                    <span>Логин может быть email или простым именем сотрудника.</span>
                  </div>
                </header>
                <div className="user-edit-fields">
                  <label>
                    <span>Логин / email</span>
                    <input value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} />
                  </label>
                  <label>
                    <span>Имя</span>
                    <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
                  </label>
                  <label>
                    <span>Статус</span>
                    <select value={profile.status} onChange={(event) => setProfile({ ...profile, status: event.target.value })}>
                      <option value="ACTIVE">Активен</option>
                      <option value="BLOCKED">Заблокирован</option>
                    </select>
                  </label>
                  <label>
                    <span>Новый пароль</span>
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={profile.password}
                      onChange={(event) => setProfile({ ...profile, password: event.target.value })}
                      placeholder="Заполнить только для смены"
                    />
                  </label>
                </div>
              </section>

              <section className="user-edit-card">
                <header>
                  <KeyRound size={18} aria-hidden="true" />
                  <div>
                    <strong>Роли</strong>
                    <span>Роли задают доступные разделы и действия.</span>
                  </div>
                </header>
                <div className="user-role-table">
                  {roles.map((role) => (
                    <label className={roleCodes.includes(role.code) ? 'is-selected' : undefined} key={role.code}>
                      <input checked={roleCodes.includes(role.code)} type="checkbox" onChange={() => toggleRole(role.code)} />
                      <span>
                        <strong>{role.name}</strong>
                        <small>{role.code}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <details className="user-permissions" open>
                  <summary>Разрешено по выбранным ролям: {grantedPermissions.length}</summary>
                  <div>
                    {grantedPermissions.map(([code, name]) => (
                      <span key={code} title={code}>{name}</span>
                    ))}
                    {grantedPermissions.length === 0 ? <span>Нет разрешений</span> : null}
                  </div>
                </details>
              </section>
            </div>

            <div className="access-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void saveProfileAndRoles()}
                disabled={!isDirtyProfile || isSavingProfile || roleCodes.length === 0}
              >
                <Save size={16} aria-hidden="true" />
                <span>{isSavingProfile ? 'Сохранение' : 'Сохранить профиль, пароль и роли'}</span>
              </button>
            </div>

            <section className="user-edit-card user-access-card">
              <header>
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>Доступ к кабинетам клиентов</strong>
                  <span>В списке ниже только клиенты, к которым доступ уже выдан.</span>
                </div>
              </header>

              <div className="access-segments" role="tablist" aria-label="Режим доступа к клиентам">
                <button className={accessMode === 'all' ? 'active' : ''} type="button" onClick={() => setAccessMode('all')} disabled={hasClientRole}>
                  Все клиенты
                </button>
                <button className={accessMode === 'limited' ? 'active' : ''} type="button" onClick={() => setAccessMode('limited')}>
                  Только выбранные
                </button>
              </div>

              {accessMode === 'all' ? (
                <p className="user-access-note">Пользователь видит все кабинеты клиентов. Для клиентского пользователя выберите режим “Только выбранные”.</p>
              ) : (
                <>
                  <div className="user-access-add">
                    <label>
                      <span>Поиск клиента</span>
                      <input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Название или код" />
                    </label>
                    <label>
                      <span>Клиент</span>
                      <select value={clientToAdd} onChange={(event) => setClientToAdd(event.target.value)}>
                        <option value="">Выберите клиента</option>
                        {clientsForAdd.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name} · {client.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Доступ</span>
                      <select value={clientLevelToAdd} onChange={(event) => setClientLevelToAdd(event.target.value as ClientAccessLevel)}>
                        <option value="read">Просмотр</option>
                        <option value="write">Изменение</option>
                      </select>
                    </label>
                    <button className="primary-button access-secondary" type="button" onClick={addClientAccess} disabled={!clientToAdd}>
                      Добавить
                    </button>
                  </div>

                  <div className="user-access-table-wrap">
                    <table className="user-access-table">
                      <thead>
                        <tr>
                          <th>Клиент</th>
                          <th>Код</th>
                          <th>Доступ</th>
                          <th aria-label="Удалить" />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAccessRows.map(({ client, level }) => (
                          <tr key={client.id}>
                            <td>
                              <strong>{client.name}</strong>
                            </td>
                            <td>{client.code}</td>
                            <td>
                              <select value={level} onChange={(event) => changeClientAccess(client.id, event.target.value as ClientAccessLevel)}>
                                <option value="read">Просмотр</option>
                                <option value="write">Изменение</option>
                              </select>
                            </td>
                            <td>
                              <button className="icon-button" type="button" onClick={() => removeClientAccess(client.id)} aria-label="Убрать доступ">
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {visibleAccessRows.length === 0 ? (
                          <tr>
                            <td colSpan={4}>Доступы к клиентам еще не назначены.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="access-actions">
                <button className="primary-button" type="button" onClick={() => void saveAccess()} disabled={isSavingAccess}>
                  <Save size={16} aria-hidden="true" />
                  <span>{isSavingAccess ? 'Сохранение' : 'Сохранить доступы к клиентам'}</span>
                </button>
              </div>
            </section>

            {hasReferralRole || visibleReferralRows.length > 0 ? (
              <section className="user-edit-card user-referral-card">
                <header>
                  <BadgePercent size={18} aria-hidden="true" />
                  <div>
                    <strong>Реферальная программа</strong>
                    <span>Клиенты, процент и срок действия для партнера. В расчет не входят логистика, хранение и ПРР.</span>
                  </div>
                </header>

                {isLoadingReferrals ? <p className="inline-status">Загружаю реферальные настройки.</p> : null}

                <div className="user-referral-add">
                  <label>
                    <span>Поиск клиента</span>
                    <input value={referralClientSearch} onChange={(event) => setReferralClientSearch(event.target.value)} placeholder="Название или код" />
                  </label>
                  <label>
                    <span>Клиент</span>
                    <select value={referralClientToAdd} onChange={(event) => setReferralClientToAdd(event.target.value)}>
                      <option value="">Выберите клиента</option>
                      {clientsForReferralAdd.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name} · {client.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>%</span>
                    <input
                      min="0"
                      max="100"
                      step="0.01"
                      type="number"
                      value={referralPercentToAdd}
                      onChange={(event) => setReferralPercentToAdd(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Срок</span>
                    <select value={referralTermToAdd} onChange={(event) => setReferralTermToAdd(event.target.value)}>
                      {referralTermOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button access-secondary" type="button" onClick={addReferralClient} disabled={!referralClientToAdd}>
                    Добавить
                  </button>
                </div>

                <div className="user-access-table-wrap">
                  <table className="user-access-table user-referral-table">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Код</th>
                        <th>%</th>
                        <th>Срок</th>
                        <th>Действует до</th>
                        <th aria-label="Убрать" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReferralRows.map(({ client, referral }) => (
                        <tr key={client.id}>
                          <td>
                            <strong>{client.name}</strong>
                          </td>
                          <td>{client.code}</td>
                          <td>
                            <input
                              min="0"
                              max="100"
                              step="0.01"
                              type="number"
                              value={referral.percent}
                              onChange={(event) => changeReferralClient(client.id, { percent: event.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              value={referral.termMonths}
                              onChange={(event) => changeReferralClient(client.id, { termMonths: event.target.value })}
                            >
                              {referralTermOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{referral.expiresAt ? formatDate(referral.expiresAt) : 'Без срока'}</td>
                          <td>
                            <button className="icon-button" type="button" onClick={() => removeReferralClient(client.id)} aria-label="Убрать из рефералки">
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {visibleReferralRows.length === 0 ? (
                        <tr>
                          <td colSpan={6}>Клиенты для реферальной программы еще не назначены.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="access-actions">
                  <button className="primary-button" type="button" onClick={() => void saveReferrals()} disabled={isSavingReferrals}>
                    <Save size={16} aria-hidden="true" />
                    <span>{isSavingReferrals ? 'Сохранение' : 'Сохранить рефералку'}</span>
                  </button>
                </div>
              </section>
            ) : null}

            {message ? <p className="access-success">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </>
        ) : (
          <p className="access-empty">Выберите пользователя слева.</p>
        )}
      </section>

      {confirmReasons ? (
        <ConfirmDialog
          title="Подтвердить изменение пользователя"
          message="Вы меняете чувствительные данные пользователя. Проверьте список и подтвердите действие."
          details={confirmReasons}
          confirmLabel="Сохранить"
          isBusy={isSavingProfile}
          onCancel={() => setConfirmReasons(null)}
          onConfirm={() => {
            setConfirmReasons(null);
            void saveProfileAndRoles(true);
          }}
        />
      ) : null}
    </div>
  );
}

function profileWarnings(user: UserSummary, profile: typeof emptyProfile, roleCodes: string[]) {
  const reasons: string[] = [];
  const login = profile.email.trim();
  const password = profile.password.trim();

  if (login && login !== user.email && !isLikelyEmail(login)) {
    reasons.push('Логин указан не в формате email. Администратор может сохранить такой логин вручную.');
  }
  if (password && password.length < 10) {
    reasons.push('Новый пароль короче обычного требования 10 символов.');
  }
  if (password) {
    reasons.push('Пароль пользователя будет изменен.');
  }
  if (profile.status !== user.status) {
    reasons.push(`Статус изменится: ${statusLabel(user.status)} → ${statusLabel(profile.status)}.`);
  }
  if (!sameRoleCodes(roleCodes, user.roles.map((item) => item.role.code))) {
    reasons.push('Набор ролей пользователя будет изменен.');
  }

  return reasons;
}

function sameRoleCodes(left: string[], right: string[]) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((item, index) => item === rightSorted[index]);
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function statusLabel(status: string) {
  return status === 'ACTIVE' ? 'активен' : 'заблокирован';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function referralAssignmentsToMap(assignments: UserReferralClientSummary[]) {
  return assignments
    .filter((assignment) => assignment.isActive)
    .reduce<ReferralAccessMap>((acc, assignment) => {
      acc[assignment.client.id] = {
        percent: String(assignment.percent),
        termMonths: assignment.termMonths ? String(assignment.termMonths) : 'none',
        expiresAt: assignment.expiresAt,
      };
      return acc;
    }, {});
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}
