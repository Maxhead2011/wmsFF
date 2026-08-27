import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchUsers,
  updateUserClientScopes,
  type AuthSession,
  type ClientSummary,
  type UserSummary,
} from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';
import { ClientScopePicker, scopeMapToPayload, type ScopeMap } from './ClientScopePicker';

type UserScopeEditorProps = {
  session: AuthSession;
};

export function UserScopeEditor({ session }: UserScopeEditorProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [scopeMode, setScopeMode] = useState<'all' | 'limited'>('all');
  const [scopeMap, setScopeMap] = useState<ScopeMap>({});
  const [savedUser, setSavedUser] = useState<UserSummary | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const selectedUserHasClientRole = selectedUser ? userHasClientRole(selectedUser) : false;

  useEffect(() => {
    void loadDictionaries();
  }, [session.accessToken]);

  useEffect(() => {
    if (selectedUser) {
      applyUserScopes(selectedUser);
    }
  }, [selectedUserId, users]);

  async function loadDictionaries() {
    setLoading(true);
    setError('');

    try {
      const [nextUsers, nextClients] = await Promise.all([
        fetchUsers(session.accessToken),
        fetchClients(session.accessToken),
      ]);
      setUsers(nextUsers);
      setClients(nextClients);
      setSelectedUserId((current) => current || nextUsers[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей и клиентов.');
    } finally {
      setLoading(false);
    }
  }

  function applyUserScopes(user: UserSummary) {
    const nextMap: ScopeMap = {};
    user.clientScopes.forEach((scope) => {
      nextMap[scope.client.id] = scope.canWrite ? 'write' : 'read';
    });

    setScopeMap(nextMap);
    setScopeMode(user.clientScopes.length === 0 && !userHasClientRole(user) ? 'all' : 'limited');
  }

  function changeUser(userId: string) {
    setSelectedUserId(userId);
    setSavedUser(null);
  }

  async function saveScopes() {
    if (!selectedUser) {
      return;
    }

    setSubmitting(true);
    setError('');
    setSavedUser(null);

    try {
      const saved = await updateUserClientScopes(session.accessToken, selectedUser.id, {
        allClients: scopeMode === 'all',
        scopes: scopeMode === 'all' ? [] : scopeMapToPayload(scopeMap),
      });
      setSavedUser({
        ...selectedUser,
        clientScopes: saved.clientScopes,
      });
      await loadDictionaries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить доступы.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="access-form">
      <div className="access-fields access-fields--editor">
        <label>
          <span>Пользователь</span>
          <select value={selectedUserId} onChange={(event) => changeUser(event.target.value)} disabled={isLoading}>
            {users.length === 0 ? <option value="">Пользователи не найдены</option> : null}
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} - {user.email}
              </option>
            ))}
          </select>
        </label>

        <div className="access-user-summary">
          <span>Роли</span>
          <strong>{selectedUser?.roles.map((item) => item.role.code).join(', ') || '-'}</strong>
        </div>
      </div>

      <div className="access-segments" role="tablist" aria-label="Клиентский доступ пользователя">
        <button
          className={scopeMode === 'all' ? 'active' : ''}
          type="button"
          onClick={() => setScopeMode('all')}
          disabled={selectedUserHasClientRole}
        >
          Все клиенты
        </button>
        <button className={scopeMode === 'limited' ? 'active' : ''} type="button" onClick={() => setScopeMode('limited')}>
          Ограничить
        </button>
      </div>

      {scopeMode === 'limited' ? <ClientScopePicker clients={clients} value={scopeMap} onChange={setScopeMap} /> : null}

      {error ? <p className="form-error">{error}</p> : null}

      <div className="access-actions">
        <button className="primary-button" type="button" onClick={() => void saveScopes()} disabled={!selectedUser || isSubmitting}>
          <Save size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Сохранение' : 'Сохранить доступы'}</span>
        </button>
        <button className="primary-button access-secondary" type="button" onClick={() => void loadDictionaries()} disabled={isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить</span>
        </button>
      </div>

      {savedUser ? (
        <AccessResultCard
          title="Доступы сохранены"
          lines={[`${savedUser.name} · ${savedUser.email}`, scopeMode === 'all' ? 'Все клиенты' : `${savedUser.clientScopes.length} scope`]}
        />
      ) : null}
    </div>
  );
}

function userHasClientRole(user: UserSummary) {
  return user.roles.some((item) => item.role.code === 'CLIENT');
}
