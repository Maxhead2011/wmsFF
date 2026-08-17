import { RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createTsdDevice,
  fetchTsdDevices,
  fetchUsers,
  type AuthSession,
  type CreatedTsdDevice,
  type TsdDeviceSummary,
  type UserSummary,
} from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';

type TsdDeviceAdminPanelProps = {
  session: AuthSession;
};

const emptyForm = {
  code: '',
  name: '',
  userId: '',
};

export function TsdDeviceAdminPanel({ session }: TsdDeviceAdminPanelProps) {
  const [devices, setDevices] = useState<TsdDeviceSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [createdDevice, setCreatedDevice] = useState<CreatedTsdDevice | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const operators = useMemo(
    () => users.filter((user) => user.roles.some((item) => item.role.code !== 'CLIENT')),
    [users],
  );

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.accessToken]);

  async function loadData() {
    setLoading(true);
    setError('');

    try {
      const [nextDevices, nextUsers] = await Promise.all([
        fetchTsdDevices(session.accessToken),
        fetchUsers(session.accessToken),
      ]);
      setDevices(nextDevices);
      setUsers(nextUsers);
      const nextOperators = nextUsers.filter((user) => user.roles.some((item) => item.role.code !== 'CLIENT'));
      setForm((current) => ({ ...current, userId: current.userId || nextOperators[0]?.id || '' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить ТСД.');
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setCreatedDevice(null);

    try {
      const created = await createTsdDevice(session.accessToken, {
        code: form.code.trim(),
        name: form.name.trim(),
        userId: form.userId,
      });
      setCreatedDevice(created);
      setForm({ ...emptyForm, userId: form.userId });
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать ТСД.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="access-form">
      <form className="access-form" onSubmit={submit}>
        <div className="access-fields">
          <label>
            <span>Код ТСД</span>
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="TSD-01"
              required
            />
          </label>
          <label>
            <span>Название</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Терминал приемки"
              required
            />
          </label>
          <label>
            <span>Пользователь</span>
            <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} required>
              {operators.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.name} · {user.email}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="access-actions">
          <button className="primary-button access-submit" type="submit" disabled={isSubmitting || isLoading || !form.userId}>
            <Save size={16} aria-hidden="true" />
            <span>{isSubmitting ? 'Создание' : 'Создать ТСД'}</span>
          </button>
          <button className="primary-button access-secondary" type="button" onClick={loadData} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Обновить</span>
          </button>
        </div>
      </form>

      {createdDevice ? (
        <AccessResultCard
          title="ТСД создан"
          lines={[
            `${createdDevice.name} · ${createdDevice.code}`,
            `Секрет: ${createdDevice.deviceSecret}`,
            'Секрет показывается один раз.',
          ]}
        />
      ) : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Название</th>
              <th>Пользователь</th>
              <th>Статус</th>
              <th>Последний вход</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={5}>ТСД еще не созданы</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    <strong>{device.code}</strong>
                  </td>
                  <td>{device.name}</td>
                  <td>{device.user.name}</td>
                  <td>{device.status}</td>
                  <td>{device.lastLoginAt ? new Date(device.lastLoginAt).toLocaleString('ru-RU') : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
