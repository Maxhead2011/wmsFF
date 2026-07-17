import { Save } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createUser,
  fetchClients,
  fetchRoles,
  type AuthSession,
  type ClientSummary,
  type RoleSummary,
  type UserSummary,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AccessResultCard } from './AccessResultCard';
import { ClientScopePicker, scopeMapToCreatePayload, type ScopeMap } from './ClientScopePicker';

type UserCreateFormProps = {
  session: AuthSession;
};

const emptyUserForm = {
  email: '',
  name: '',
  password: '',
};

export function UserCreateForm({ session }: UserCreateFormProps) {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [form, setForm] = useState(emptyUserForm);
  const [roleCodes, setRoleCodes] = useState<string[]>(['OPERATOR']);
  const [scopeMode, setScopeMode] = useState<'all' | 'limited'>('all');
  const [scopeMap, setScopeMap] = useState<ScopeMap>({});
  const [createdUser, setCreatedUser] = useState<UserSummary | null>(null);
  const [overrideReasons, setOverrideReasons] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [isLoading, setLoading] = useState(false);

  const selectedRoleLabel = useMemo(
    () => roleCodes.map((code) => roles.find((role) => role.code === code)?.name ?? code).join(', '),
    [roleCodes, roles],
  );
  const clientRoleSelected = roleCodes.includes('CLIENT');

  useEffect(() => {
    let isActive = true;

    async function loadDictionaries() {
      setLoading(true);
      setError('');

      try {
        const [nextRoles, nextClients] = await Promise.all([
          fetchRoles(session.accessToken),
          fetchClients(session.accessToken),
        ]);
        if (!isActive) {
          return;
        }

        setRoles(nextRoles);
        setClients(nextClients);
        if (!nextRoles.some((role) => role.code === 'OPERATOR')) {
          setRoleCodes(nextRoles[0] ? [nextRoles[0].code] : []);
        }
      } catch (caught) {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить роли и клиентов.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    void loadDictionaries();

    return () => {
      isActive = false;
    };
  }, [session.accessToken]);

  useEffect(() => {
    if (clientRoleSelected) {
      setScopeMode('limited');
    }
  }, [clientRoleSelected]);

  function toggleRole(code: string) {
    setRoleCodes((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }

      return [...current, code];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reasons = userOverrideReasons(form);
    if (reasons.length > 0) {
      setOverrideReasons(reasons);
      return;
    }

    await createUserFromForm();
  }

  async function createUserFromForm() {
    setSubmitting(true);
    setError('');
    setCreatedUser(null);

    try {
      const scopes = scopeMode === 'limited' ? scopeMapToCreatePayload(scopeMap) : undefined;
      const created = await createUser(session.accessToken, {
        email: form.email.trim(),
        name: form.name.trim(),
        password: form.password,
        roleCodes: roleCodes.length ? roleCodes : undefined,
        clientIds: scopes?.clientIds.length ? scopes.clientIds : undefined,
        writableClientIds: scopes?.writableClientIds.length ? scopes.writableClientIds : undefined,
      });
      setCreatedUser(created);
      setForm(emptyUserForm);
      setScopeMap({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать пользователя.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="access-form" onSubmit={submit}>
      <div className="access-fields">
        <label>
          <span>Логин / email</span>
          <input
            inputMode="text"
            type="text"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Имя</span>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          <span>Пароль</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
        </label>
      </div>

      <div className="role-choice-grid" aria-label="Роли пользователя">
        {roles.map((role) => (
          <label className="role-choice" key={role.code}>
            <input checked={roleCodes.includes(role.code)} type="checkbox" onChange={() => toggleRole(role.code)} />
            <span>
              <strong>{role.code}</strong>
              {role.name}
            </span>
          </label>
        ))}
      </div>

      <div className="access-segments" role="tablist" aria-label="Клиентский доступ">
        <button
          className={scopeMode === 'all' ? 'active' : ''}
          type="button"
          onClick={() => setScopeMode('all')}
          disabled={clientRoleSelected}
        >
          Все клиенты
        </button>
        <button className={scopeMode === 'limited' ? 'active' : ''} type="button" onClick={() => setScopeMode('limited')}>
          Ограничить
        </button>
      </div>

      {scopeMode === 'limited' ? <ClientScopePicker clients={clients} value={scopeMap} onChange={setScopeMap} /> : null}

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button access-submit" type="submit" disabled={isSubmitting || isLoading || roleCodes.length === 0}>
        <Save size={16} aria-hidden="true" />
        <span>{isSubmitting ? 'Сохранение' : 'Создать пользователя'}</span>
      </button>

      {createdUser ? (
        <AccessResultCard
          title="Пользователь создан"
          lines={[`${createdUser.name} · ${createdUser.email}`, selectedRoleLabel || 'роль не выбрана']}
        />
      ) : null}

      {overrideReasons ? (
        <ConfirmDialog
          title="Подтвердить обход ограничений"
          message="Пользователь будет создан с данными, которые обычно система не пропускает автоматически."
          details={overrideReasons}
          confirmLabel="Создать"
          isBusy={isSubmitting}
          onCancel={() => setOverrideReasons(null)}
          onConfirm={() => {
            setOverrideReasons(null);
            void createUserFromForm();
          }}
        />
      ) : null}
    </form>
  );
}

function userOverrideReasons(form: typeof emptyUserForm) {
  const reasons: string[] = [];
  const login = form.email.trim();
  const name = form.name.trim();
  const password = form.password.trim();

  if (!login) {
    reasons.push('Логин / email пустой.');
  } else if (!isLikelyEmail(login)) {
    reasons.push('Логин указан не в формате email.');
  }

  if (!name) {
    reasons.push('Имя пользователя пустое.');
  }

  if (password && password.length < 10) {
    reasons.push('Пароль короче обычного требования 10 символов.');
  }

  return reasons;
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
