import { Link2, RefreshCw, Save, UserPlus } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createClient,
  createUser,
  fetchUsers,
  updateClient,
  updateUserClientScopes,
  type AuthSession,
  type ClientKind,
  type ClientSummary,
  type CreateClientPayload,
  type UserSummary,
} from '../../lib/api';
import { DirectoryResultCard } from './DirectoryResultCard';

type ClientCreateFormProps = {
  session: AuthSession;
};

const clientKindOptions: Array<{ value: ClientKind; label: string }> = [
  { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
  { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'Индивидуальный предприниматель' },
  { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
  { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];

const emptyClientForm = {
  clientKind: 'LEGAL_ENTITY' as ClientKind,
  name: '',
  legalName: '',
  inn: '',
  kpp: '',
  ogrn: '',
  legalAddress: '',
  actualAddress: '',
  phone: '',
  email: '',
  bankName: '',
  bankBik: '',
  bankAccount: '',
  correspondentAccount: '',
  storageAccountingEnabled: false,
  storesWithoutBoxes: false,
  onlineReceiptVisibleToClient: false,
  fulfillmentManagerUserId: '',
};

const emptyClientManagerForm = {
  email: '',
  name: '',
  password: '',
};

export function ClientCreateForm({ session }: ClientCreateFormProps) {
  const [form, setForm] = useState(emptyClientForm);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [fulfillmentUsers, setFulfillmentUsers] = useState<UserSummary[]>([]);
  const [clientManagerForm, setClientManagerForm] = useState(emptyClientManagerForm);
  const [clientManagers, setClientManagers] = useState<UserSummary[]>([]);
  const [existingClientUserId, setExistingClientUserId] = useState('');
  const [createdClient, setCreatedClient] = useState<ClientSummary | null>(null);
  const [createdManager, setCreatedManager] = useState<UserSummary | null>(null);
  const [error, setError] = useState('');
  const [managerError, setManagerError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [isManagerSubmitting, setManagerSubmitting] = useState(false);
  const [isAssigningManager, setAssigningManager] = useState(false);
  const [isLinkingClientUser, setLinkingClientUser] = useState(false);
  const canManageUsers = canUse(session, 'users:write');

  const selectedFulfillmentManager = useMemo(
    () => fulfillmentUsers.find((user) => user.id === (createdClient?.fulfillmentManagerUserId || form.fulfillmentManagerUserId)) ?? null,
    [createdClient?.fulfillmentManagerUserId, form.fulfillmentManagerUserId, fulfillmentUsers],
  );
  const existingClientUserOptions = useMemo(
    () =>
      allUsers.filter(
        (user) =>
          userHasClientRole(user) &&
          user.status === 'ACTIVE' &&
          (!createdClient || !user.clientScopes.some((scope) => scope.client.id === createdClient.id)),
      ),
    [allUsers, createdClient],
  );

  useEffect(() => {
    if (canManageUsers) {
      void loadFulfillmentUsers();
    }
  }, [session.accessToken, canManageUsers]);

  async function loadFulfillmentUsers() {
    try {
      const users = await fetchUsers(session.accessToken);
      setAllUsers(users);
      setFulfillmentUsers(users.filter((user) => !isClientOnlyUser(user)));
    } catch {
      setAllUsers([]);
      setFulfillmentUsers([]);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setCreatedClient(null);
    setCreatedManager(null);
    setClientManagers([]);

    try {
      const created = await createClient(session.accessToken, compactPayload(form));
      setCreatedClient(created);
      setForm(emptyClientForm);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать клиента.');
    } finally {
      setSubmitting(false);
    }
  }

  async function createClientManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createdClient) {
      return;
    }

    setManagerSubmitting(true);
    setManagerError('');
    setCreatedManager(null);

    try {
      const manager = await createUser(session.accessToken, {
        email: clientManagerForm.email.trim(),
        name: clientManagerForm.name.trim(),
        password: clientManagerForm.password,
        roleCodes: ['CLIENT'],
        clientIds: [createdClient.id],
        writableClientIds: [createdClient.id],
      });
      setCreatedManager(manager);
      setAllUsers((current) => [manager, ...current]);
      setClientManagers((current) => [manager, ...current]);
      setClientManagerForm(emptyClientManagerForm);
    } catch (caught) {
      setManagerError(caught instanceof Error ? caught.message : 'Не удалось добавить менеджера клиента.');
    } finally {
      setManagerSubmitting(false);
    }
  }

  async function assignFulfillmentManager(userId: string) {
    if (!createdClient) {
      setForm((current) => ({ ...current, fulfillmentManagerUserId: userId }));
      return;
    }

    setAssigningManager(true);
    setManagerError('');
    try {
      const updated = await updateClient(session.accessToken, createdClient.id, {
        fulfillmentManagerUserId: userId || undefined,
      });
      setCreatedClient(updated);
    } catch (caught) {
      setManagerError(caught instanceof Error ? caught.message : 'Не удалось назначить менеджера фулфилмента.');
    } finally {
      setAssigningManager(false);
    }
  }

  async function linkExistingClientUser() {
    if (!createdClient || !existingClientUserId) {
      return;
    }

    const selectedUser = allUsers.find((user) => user.id === existingClientUserId);
    if (!selectedUser) {
      return;
    }

    setLinkingClientUser(true);
    setManagerError('');
    try {
      const updated = await updateUserClientScopes(session.accessToken, selectedUser.id, {
        scopes: [
          ...selectedUser.clientScopes.map((scope) => ({
            clientId: scope.client.id,
            canRead: scope.canRead,
            canWrite: scope.canWrite,
          })),
          { clientId: createdClient.id, canRead: true, canWrite: true },
        ],
      });

      const nextUser = { ...selectedUser, clientScopes: updated.clientScopes };
      setAllUsers((current) => current.map((user) => (user.id === nextUser.id ? nextUser : user)));
      setClientManagers((current) => [nextUser, ...current.filter((user) => user.id !== nextUser.id)]);
      setExistingClientUserId('');
    } catch (caught) {
      setManagerError(caught instanceof Error ? caught.message : 'Не удалось привязать пользователя к клиенту.');
    } finally {
      setLinkingClientUser(false);
    }
  }

  return (
    <div className="directory-form">
      <form className="directory-form" onSubmit={submit}>
        <div className="directory-subheading directory-subheading--plain">
          <div>
            <h3>Новый клиент</h3>
            <span>код клиента будет создан автоматически</span>
          </div>
        </div>

        <div className="directory-fields directory-fields--client">
          <label>
            <span>Тип клиента</span>
            <select
              value={form.clientKind}
              onChange={(event) => setForm({ ...form, clientKind: event.target.value as ClientKind })}
              required
            >
              {clientKindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Название</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            <span>Юр. название</span>
            <input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required />
          </label>
          <label>
            <span>ИНН</span>
            <input value={form.inn} onChange={(event) => setForm({ ...form, inn: event.target.value })} required />
          </label>
          <label>
            <span>КПП</span>
            <input value={form.kpp} onChange={(event) => setForm({ ...form, kpp: event.target.value })} />
          </label>
          <label>
            <span>ОГРН</span>
            <input value={form.ogrn} onChange={(event) => setForm({ ...form, ogrn: event.target.value })} />
          </label>
          <label>
            <span>Телефон</span>
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            <span>Почта</span>
            <input
              inputMode="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label className="directory-checkbox">
            <input
              checked={form.onlineReceiptVisibleToClient}
              type="checkbox"
              onChange={(event) => setForm({ ...form, onlineReceiptVisibleToClient: event.target.checked })}
            />
            <span>Показывать онлайн-приемку клиенту</span>
          </label>
          <label>
            <span>Вид приемки</span>
            <select
              value={form.storesWithoutBoxes ? 'WITHOUT_BOXES' : 'WITH_BOXES'}
              onChange={(event) => setForm({ ...form, storesWithoutBoxes: event.target.value === 'WITHOUT_BOXES' })}
            >
              <option value="WITH_BOXES">С коробами</option>
              <option value="WITHOUT_BOXES">Без коробов, поштучно</option>
            </select>
          </label>
          <label>
            <span>Менеджер фулфилмента</span>
            <select
              value={form.fulfillmentManagerUserId}
              onChange={(event) => void assignFulfillmentManager(event.target.value)}
              disabled={!canManageUsers || isAssigningManager}
            >
              <option value="">Не назначен</option>
              {fulfillmentUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} - {user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="directory-checkbox">
            <input
              checked={form.storageAccountingEnabled}
              type="checkbox"
              onChange={(event) => setForm({ ...form, storageAccountingEnabled: event.target.checked })}
            />
            <span>Вести учет хранения</span>
          </label>
          <label>
            <span>Юр. адрес</span>
            <input value={form.legalAddress} onChange={(event) => setForm({ ...form, legalAddress: event.target.value })} />
          </label>
          <label>
            <span>Факт. адрес</span>
            <input value={form.actualAddress} onChange={(event) => setForm({ ...form, actualAddress: event.target.value })} />
          </label>
          <label>
            <span>Банк</span>
            <input value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} />
          </label>
          <label>
            <span>БИК</span>
            <input value={form.bankBik} onChange={(event) => setForm({ ...form, bankBik: event.target.value })} />
          </label>
          <label>
            <span>Расчетный счет</span>
            <input value={form.bankAccount} onChange={(event) => setForm({ ...form, bankAccount: event.target.value })} />
          </label>
          <label>
            <span>Корр. счет</span>
            <input
              value={form.correspondentAccount}
              onChange={(event) => setForm({ ...form, correspondentAccount: event.target.value })}
            />
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button directory-submit" type="submit" disabled={isSubmitting}>
          <Save size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Сохранение' : 'Создать клиента'}</span>
        </button>
      </form>

      {createdClient ? (
        <div className="client-after-create">
          <DirectoryResultCard
            title="Клиент создан"
            lines={[
              `${createdClient.code} - ${createdClient.name}`,
              `${clientKindLabel(createdClient.clientKind)} · ИНН ${createdClient.inn}`,
              createdClient.storageAccountingEnabled ? 'Учет хранения включен' : 'Учет хранения отключен',
              selectedFulfillmentManager ? `Менеджер фулфилмента: ${selectedFulfillmentManager.name}` : 'Менеджер фулфилмента не назначен',
            ]}
          />

          {canManageUsers ? (
            <div className="client-manager-grid">
              <form className="client-manager-card" onSubmit={createClientManager}>
                <div className="directory-subheading directory-subheading--plain">
                  <div>
                    <h3>Пользователь клиента</h3>
                    <span>будет работать от имени клиента с остатками, заявками и счетами</span>
                  </div>
                </div>
                <div className="directory-fields directory-fields--manager">
                  <label>
                    <span>Почта</span>
                    <input
                      inputMode="email"
                      type="email"
                      value={clientManagerForm.email}
                      onChange={(event) => setClientManagerForm({ ...clientManagerForm, email: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    <span>Имя</span>
                    <input
                      value={clientManagerForm.name}
                      onChange={(event) => setClientManagerForm({ ...clientManagerForm, name: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    <span>Пароль</span>
                    <input
                      minLength={10}
                      type="password"
                      value={clientManagerForm.password}
                      onChange={(event) => setClientManagerForm({ ...clientManagerForm, password: event.target.value })}
                      required
                    />
                  </label>
                </div>
                <button className="primary-button directory-submit" type="submit" disabled={isManagerSubmitting}>
                  <UserPlus size={16} aria-hidden="true" />
                  <span>{isManagerSubmitting ? 'Добавление' : 'Создать пользователя клиента'}</span>
                </button>
                {createdManager ? (
                  <DirectoryResultCard title="Пользователь клиента добавлен" lines={[`${createdManager.name} - ${createdManager.email}`]} />
                ) : null}
                {clientManagers.length > 0 ? (
                  <div className="client-manager-list">
                    {clientManagers.map((manager) => (
                      <span key={manager.id}>{manager.name} · {manager.email}</span>
                    ))}
                  </div>
                ) : null}
              </form>

              <div className="client-manager-card">
                <div className="directory-subheading directory-subheading--plain">
                  <div>
                    <h3>Привязать существующего</h3>
                    <span>даст выбранному пользователю доступ к клиенту</span>
                  </div>
                  <button className="icon-text-button" type="button" onClick={() => void loadFulfillmentUsers()}>
                    <RefreshCw size={15} aria-hidden="true" />
                    <span>Обновить</span>
                  </button>
                </div>
                <label className="directory-select-row">
                  <span>Пользователь клиента</span>
                  <select
                    value={existingClientUserId}
                    onChange={(event) => setExistingClientUserId(event.target.value)}
                    disabled={isLinkingClientUser || existingClientUserOptions.length === 0}
                  >
                    <option value="">Выберите пользователя</option>
                    {existingClientUserOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} - {user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary-button directory-submit"
                  type="button"
                  onClick={() => void linkExistingClientUser()}
                  disabled={!existingClientUserId || isLinkingClientUser}
                >
                  <Link2 size={16} aria-hidden="true" />
                  <span>{isLinkingClientUser ? 'Привязка' : 'Привязать к клиенту'}</span>
                </button>
              </div>

              <div className="client-manager-card">
                <div className="directory-subheading directory-subheading--plain">
                  <div>
                    <h3>Менеджер фулфилмента</h3>
                    <span>ответственный сотрудник внутри склада</span>
                  </div>
                  <button className="icon-text-button" type="button" onClick={() => void loadFulfillmentUsers()}>
                    <RefreshCw size={15} aria-hidden="true" />
                    <span>Обновить</span>
                  </button>
                </div>
                <label className="directory-select-row">
                  <span>Ответственный</span>
                  <select
                    value={createdClient.fulfillmentManagerUserId ?? ''}
                    onChange={(event) => void assignFulfillmentManager(event.target.value)}
                    disabled={isAssigningManager}
                  >
                    <option value="">Не назначен</option>
                    {fulfillmentUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} - {user.email}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}
          {managerError ? <p className="form-error">{managerError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function compactPayload(form: typeof emptyClientForm): CreateClientPayload {
  return {
    clientKind: form.clientKind,
    name: form.name.trim(),
    legalName: form.legalName.trim(),
    inn: form.inn.trim(),
    ...optionalString('kpp', form.kpp),
    ...optionalString('ogrn', form.ogrn),
    ...optionalString('legalAddress', form.legalAddress),
    ...optionalString('actualAddress', form.actualAddress),
    ...optionalString('phone', form.phone),
    ...optionalString('email', form.email),
    ...optionalString('bankName', form.bankName),
    ...optionalString('bankBik', form.bankBik),
    ...optionalString('bankAccount', form.bankAccount),
    ...optionalString('correspondentAccount', form.correspondentAccount),
    storageAccountingEnabled: form.storageAccountingEnabled,
    storesWithoutBoxes: form.storesWithoutBoxes,
    onlineReceiptVisibleToClient: form.onlineReceiptVisibleToClient,
    ...optionalString('fulfillmentManagerUserId', form.fulfillmentManagerUserId),
  };
}

function optionalString<T extends string>(key: T, value: string): Partial<Record<T, string>> {
  const trimmed = value.trim();
  return trimmed ? ({ [key]: trimmed } as Partial<Record<T, string>>) : {};
}

function clientKindLabel(kind: ClientKind) {
  return clientKindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function canUse(session: AuthSession, permission: string) {
  return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}

function isClientOnlyUser(user: UserSummary) {
  const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'];
  return userHasClientRole(user) && !user.roles.some((item) => internalRoles.includes(item.role.code));
}

function userHasClientRole(user: UserSummary) {
  return user.roles.some((item) => item.role.code === 'CLIENT');
}
