import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchRoles,
  fetchUsers,
  updateUserRoles,
  type AuthSession,
  type RoleSummary,
  type UserSummary,
} from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';

type UserRoleEditorProps = {
  session: AuthSession;
};

export function UserRoleEditor({ session }: UserRoleEditorProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [savedUser, setSavedUser] = useState<UserSummary | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const selectedRoleLabel = useMemo(
    () => roleCodes.map((code) => roles.find((role) => role.code === code)?.name ?? code).join(', '),
    [roleCodes, roles],
  );

  useEffect(() => {
    void loadDictionaries();
  }, [session.accessToken]);

  useEffect(() => {
    if (!selectedUser) {
      setRoleCodes([]);
      return;
    }

    setRoleCodes(selectedUser.roles.map((item) => item.role.code));
  }, [selectedUser]);

  async function loadDictionaries() {
    setLoading(true);
    setError('');

    try {
      const [nextUsers, nextRoles] = await Promise.all([
        fetchUsers(session.accessToken),
        fetchRoles(session.accessToken),
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setSelectedUserId((current) => current || nextUsers[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей и роли.');
    } finally {
      setLoading(false);
    }
  }

  function changeUser(userId: string) {
    setSelectedUserId(userId);
    setSavedUser(null);
  }

  function toggleRole(code: string) {
    setSavedUser(null);
    setRoleCodes((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }
      return code === 'CLIENT'
        ? ['CLIENT']
        : [...current.filter((item) => item !== 'CLIENT'), code];
    });
  }

  async function saveRoles() {
    if (!selectedUser || roleCodes.length === 0) {
      return;
    }

    setSubmitting(true);
    setError('');
    setSavedUser(null);

    try {
      const saved = await updateUserRoles(session.accessToken, selectedUser.id, { roleCodes });
      setSavedUser(saved);
      setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить роли пользователя.');
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
          <span>Выбрано ролей</span>
          <strong>{roleCodes.length}</strong>
        </div>
      </div>

      <div className="role-choice-grid" aria-label="Роли пользователя">
        {roles.map((role) => {
          const isSelected = roleCodes.includes(role.code);

          return (
            <label className={isSelected ? 'role-choice role-choice--selected' : 'role-choice'} key={role.code}>
              <input checked={isSelected} type="checkbox" onChange={() => toggleRole(role.code)} />
              <span>
                <strong>{role.code}</strong>
                {role.name}
              </span>
            </label>
          );
        })}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="access-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => void saveRoles()}
          disabled={!selectedUser || isSubmitting || roleCodes.length === 0}
        >
          <Save size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Сохранение' : 'Сохранить роли'}</span>
        </button>
        <button className="primary-button access-secondary" type="button" onClick={() => void loadDictionaries()} disabled={isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить</span>
        </button>
      </div>

      {savedUser ? (
        <AccessResultCard
          title="Роли сохранены"
          lines={[`${savedUser.name} · ${savedUser.email}`, selectedRoleLabel || 'роль не выбрана']}
        />
      ) : null}
    </div>
  );
}
