import { Archive, Ban, CheckCircle2, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  deleteClient,
  fetchClients,
  fetchUsers,
  updateClient,
  updateClientStatus,
  type AuthSession,
  type ClientKind,
  type ClientLogisticsInvoiceMode,
  type ClientStatus,
  type ClientSummary,
  type ClientStorageBillingMode,
  type UpdateClientPayload,
  type UserSummary,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DirectoryResultCard } from './DirectoryResultCard';

type ClientRequisitesFormProps = {
  session: AuthSession;
};

type ClientRequisitesFormState = {
  clientKind: ClientKind;
  name: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  bankName: string;
  bankBik: string;
  bankAccount: string;
  correspondentAccount: string;
  storageAccountingEnabled: boolean;
  logisticsInvoiceMode: ClientLogisticsInvoiceMode;
  storageBillingMode: ClientStorageBillingMode;
  fulfillmentManagerUserId: string;
};

const emptyForm: ClientRequisitesFormState = {
  clientKind: 'LEGAL_ENTITY',
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
  logisticsInvoiceMode: 'SEPARATE',
  storageBillingMode: 'MONTHLY',
  fulfillmentManagerUserId: '',
};

const clientKindOptions: Array<{ value: ClientKind; label: string }> = [
  { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
  { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'Индивидуальный предприниматель' },
  { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
  { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];

const logisticsInvoiceModeOptions: Array<{ value: ClientLogisticsInvoiceMode; label: string }> = [
  { value: 'SEPARATE', label: 'Логистика отдельным счетом' },
  { value: 'SAME_INVOICE', label: 'Логистика в общем счете' },
  { value: 'DISABLED', label: 'Не выставлять автоматически' },
];

const storageBillingModeOptions: Array<{ value: ClientStorageBillingMode; label: string }> = [
  { value: 'MONTHLY', label: 'Хранение раз в месяц' },
  { value: 'ON_SHIPMENT', label: 'Хранение по отгрузке' },
];

export function ClientRequisitesForm({ session }: ClientRequisitesFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [form, setForm] = useState<ClientRequisitesFormState>(emptyForm);
  const [savedClient, setSavedClient] = useState<ClientSummary | null>(null);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isStatusSubmitting, setStatusSubmitting] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [pendingArchiveClient, setPendingArchiveClient] = useState<ClientSummary | null>(null);
  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [session.accessToken]);

  useEffect(() => {
    setForm(selectedClient ? formFromClient(selectedClient) : emptyForm);
  }, [selectedClient]);

  async function loadClients() {
    setLoading(true);
    setError('');

    try {
      const nextClients = await fetchClients(session.accessToken);
      setClients(nextClients);
      setClientId((current) => (nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id ?? ''));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const nextUsers = await fetchUsers(session.accessToken);
      setUsers(nextUsers.filter((user) => !isClientOnlyUser(user)));
    } catch {
      setUsers([]);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClient) {
      return;
    }

    setSubmitting(true);
    setError('');
    setActionMessage('');
    setSavedClient(null);

    try {
      const updated = await updateClient(session.accessToken, selectedClient.id, compactPayload(form));
      setSavedClient(updated);
      setClients((current) => current.map((client) => (client.id === updated.id ? updated : client)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить реквизиты.');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(status: ClientStatus) {
    if (!selectedClient) {
      return;
    }

    setStatusSubmitting(true);
    setError('');
    setActionMessage('');
    try {
      const updated = await updateClientStatus(session.accessToken, selectedClient.id, status);
      const nextClients =
        status === 'ARCHIVED'
          ? clients.filter((client) => client.id !== updated.id)
          : clients.map((client) => (client.id === updated.id ? updated : client));
      setClients(nextClients);
      if (status === 'ARCHIVED') {
        setClientId(nextClients[0]?.id ?? '');
      }
      setActionMessage(clientStatusActionMessage(status));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус клиента.');
    } finally {
      setStatusSubmitting(false);
    }
  }

  async function archiveClientConfirmed() {
    setPendingArchiveClient(null);
    await changeStatus('ARCHIVED');
  }

  async function removeClient() {
    if (!selectedClient) {
      return;
    }

    const confirmed = window.confirm(`Удалить клиента ${selectedClient.code} - ${selectedClient.name}? Если есть связанные данные, WMS не даст удалить его.`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError('');
    setActionMessage('');
    setSavedClient(null);
    try {
      const deleted = await deleteClient(session.accessToken, selectedClient.id);
      const nextClients = clients.filter((client) => client.id !== deleted.id);
      setClients(nextClients);
      setClientId(nextClients[0]?.id ?? '');
      setActionMessage(`Клиент ${deleted.code} - ${deleted.name} удален.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить клиента.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form className="directory-form" onSubmit={submit}>
      <div className="directory-subheading">
        <div>
          <h3>Реквизиты клиента</h3>
          <span>тип клиента, юридические данные и ответственный менеджер</span>
        </div>
        <button className="icon-text-button" type="button" onClick={() => void loadClients()} disabled={isLoading}>
          <RefreshCw size={15} aria-hidden="true" />
          <span>{isLoading ? 'Обновляю' : 'Обновить'}</span>
        </button>
      </div>

      <div className="client-table-block">
        <div className="client-table-scroll">
          <table className="client-directory-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Наименование</th>
                <th>Статус</th>
                <th>ИНН</th>
                <th>Менеджер</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={6}>Клиенты не найдены</td>
                </tr>
              ) : null}
              {clients.map((client) => (
                <tr className={client.id === clientId ? 'selected' : ''} key={client.id} onClick={() => setClientId(client.id)}>
                  <td>{client.code}</td>
                  <td>{client.name}</td>
                  <td>
                    <span className={`client-status client-status--${client.status.toLowerCase()}`}>
                      {clientStatusLabel(client.status)}
                    </span>
                  </td>
                  <td>{client.inn || 'не задан'}</td>
                  <td>{client.fulfillmentManager?.name || 'не назначен'}</td>
                  <td>
                    <button className="icon-text-button client-table-select" type="button" onClick={() => setClientId(client.id)}>
                      <Pencil size={14} aria-hidden="true" />
                      <span>Редактировать</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedClient ? (
        <div className="client-control-panel">
          <div>
            <span>Статус клиента</span>
            <strong className={`client-status client-status--${selectedClient.status.toLowerCase()}`}>
              {clientStatusLabel(selectedClient.status)}
            </strong>
          </div>
          <div className="client-control-actions">
            {selectedClient.status === 'ACTIVE' ? (
              <button
                className="icon-text-button client-action-button"
                disabled={isStatusSubmitting || isDeleting}
                onClick={() => void changeStatus('PAUSED')}
                type="button"
              >
                <Ban size={15} aria-hidden="true" />
                <span>Заблокировать</span>
              </button>
            ) : (
              <button
                className="icon-text-button client-action-button"
                disabled={isStatusSubmitting || isDeleting}
                onClick={() => void changeStatus('ACTIVE')}
                type="button"
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>Активировать</span>
              </button>
            )}
            {selectedClient.status !== 'ARCHIVED' ? (
              <button
                className="icon-text-button client-action-button"
                disabled={isStatusSubmitting || isDeleting}
                onClick={() => setPendingArchiveClient(selectedClient)}
                type="button"
              >
                <Archive size={15} aria-hidden="true" />
                <span>В архив</span>
              </button>
            ) : null}
            <button
              className="icon-text-button client-action-button client-action-button--danger"
              disabled={isDeleting || isStatusSubmitting}
              onClick={() => void removeClient()}
              type="button"
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>{isDeleting ? 'Удаление' : 'Удалить'}</span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="directory-fields directory-fields--client">
        <label>
          <span>Тип клиента</span>
          <select value={form.clientKind} onChange={(event) => setForm({ ...form, clientKind: event.target.value as ClientKind })}>
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
          <input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} />
        </label>
        <label>
          <span>ИНН</span>
          <input value={form.inn} onChange={(event) => setForm({ ...form, inn: event.target.value })} />
        </label>
        <label>
          <span>Менеджер фулфилмента</span>
          <select
            value={form.fulfillmentManagerUserId}
            onChange={(event) => setForm({ ...form, fulfillmentManagerUserId: event.target.value })}
          >
            <option value="">Не назначен</option>
            {users.map((user) => (
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
          <span>Счета логистики</span>
          <select
            value={form.logisticsInvoiceMode}
            onChange={(event) => setForm({ ...form, logisticsInvoiceMode: event.target.value as ClientLogisticsInvoiceMode })}
          >
            {logisticsInvoiceModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Начисление хранения</span>
          <select
            value={form.storageBillingMode}
            onChange={(event) => setForm({ ...form, storageBillingMode: event.target.value as ClientStorageBillingMode })}
          >
            {storageBillingModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
      {actionMessage ? <p className="form-success">{actionMessage}</p> : null}

      <button className="primary-button directory-submit" type="submit" disabled={isSubmitting || !selectedClient}>
        <Save size={16} aria-hidden="true" />
        <span>{isSubmitting ? 'Сохранение' : 'Сохранить реквизиты'}</span>
      </button>

      {pendingArchiveClient ? (
        <ConfirmDialog
          title="Отправить клиента в архив"
          message="Клиент останется в базе, но будет помечен архивным и убран из рабочего контура."
          details={[`${pendingArchiveClient.code} · ${pendingArchiveClient.name}`]}
          confirmLabel="В архив"
          isBusy={isStatusSubmitting}
          onCancel={() => setPendingArchiveClient(null)}
          onConfirm={() => void archiveClientConfirmed()}
        />
      ) : null}

      {savedClient ? (
        <DirectoryResultCard
          title="Реквизиты сохранены"
          lines={[
            `${savedClient.code} - ${savedClient.name}`,
            `${clientKindLabel(savedClient.clientKind)} · ИНН ${savedClient.inn ?? 'не задан'}`,
            savedClient.storageAccountingEnabled ? 'Учет хранения включен' : 'Учет хранения отключен',
            logisticsInvoiceModeLabel(savedClient.logisticsInvoiceMode),
            storageBillingModeLabel(savedClient.storageBillingMode),
          ]}
        />
      ) : null}
    </form>
  );
}

function formFromClient(client: ClientSummary): ClientRequisitesFormState {
  return {
    clientKind: client.clientKind,
    name: client.name,
    legalName: client.legalName ?? '',
    inn: client.inn ?? '',
    kpp: client.kpp ?? '',
    ogrn: client.ogrn ?? '',
    legalAddress: client.legalAddress ?? '',
    actualAddress: client.actualAddress ?? '',
    phone: client.phone ?? '',
    email: client.email ?? '',
    bankName: client.bankName ?? '',
    bankBik: client.bankBik ?? '',
    bankAccount: client.bankAccount ?? '',
    correspondentAccount: client.correspondentAccount ?? '',
    storageAccountingEnabled: client.storageAccountingEnabled,
    logisticsInvoiceMode: client.logisticsInvoiceMode,
    storageBillingMode: client.storageBillingMode,
    fulfillmentManagerUserId: client.fulfillmentManagerUserId ?? '',
  };
}

function compactPayload(form: ClientRequisitesFormState): UpdateClientPayload {
  return {
    clientKind: form.clientKind,
    name: form.name.trim(),
    legalName: form.legalName,
    inn: form.inn,
    kpp: form.kpp,
    ogrn: form.ogrn,
    legalAddress: form.legalAddress,
    actualAddress: form.actualAddress,
    phone: form.phone,
    email: form.email,
    bankName: form.bankName,
    bankBik: form.bankBik,
    bankAccount: form.bankAccount,
    correspondentAccount: form.correspondentAccount,
    storageAccountingEnabled: form.storageAccountingEnabled,
    logisticsInvoiceMode: form.logisticsInvoiceMode,
    storageBillingMode: form.storageBillingMode,
    fulfillmentManagerUserId: form.fulfillmentManagerUserId,
  };
}

function clientKindLabel(kind: ClientKind) {
  return clientKindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function logisticsInvoiceModeLabel(mode: ClientLogisticsInvoiceMode) {
  return logisticsInvoiceModeOptions.find((option) => option.value === mode)?.label ?? mode;
}

function storageBillingModeLabel(mode: ClientStorageBillingMode) {
  return storageBillingModeOptions.find((option) => option.value === mode)?.label ?? mode;
}

function clientStatusLabel(status: ClientStatus) {
  const labels: Record<ClientStatus, string> = {
    ACTIVE: 'Активен',
    PAUSED: 'Заблокирован',
    ARCHIVED: 'В архиве',
  };
  return labels[status];
}

function clientStatusActionMessage(status: ClientStatus) {
  const labels: Record<ClientStatus, string> = {
    ACTIVE: 'Клиент активирован.',
    PAUSED: 'Клиент заблокирован.',
    ARCHIVED: 'Клиент отправлен в архив.',
  };
  return labels[status];
}

function isClientOnlyUser(user: UserSummary) {
  const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'];
  return user.roles.some((item) => item.role.code === 'CLIENT') && !user.roles.some((item) => internalRoles.includes(item.role.code));
}
