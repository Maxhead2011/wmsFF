import {
  BookOpen,
  Check,
  Clipboard,
  Code2,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createWmsApiCredential,
  fetchWmsApiAccessOptions,
  fetchWmsApiCredentials,
  fetchWmsApiScopes,
  revokeWmsApiCredential,
  rotateWmsApiCredential,
  type AuthSession,
  type IssuedWmsApiKey,
  type WmsApiAccessOptions,
  type WmsApiCredentialSummary,
  type WmsApiScope,
} from '../../lib/api';
import './integration-api.css';

type Props = { session: AuthSession };

const defaultScopes = ['catalog:read', 'stock:read', 'requests:read', 'movements:read'];

export function IntegrationApiPanel({ session }: Props) {
  const [scopes, setScopes] = useState<WmsApiScope[]>([]);
  const [options, setOptions] = useState<WmsApiAccessOptions>({ clients: [], warehouses: [] });
  const [credentials, setCredentials] = useState<WmsApiCredentialSummary[]>([]);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(defaultScopes);
  const [allowedIps, setAllowedIps] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [issued, setIssued] = useState<IssuedWmsApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState('');
  const [busy, setBusy] = useState('load');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const warehouses = useMemo(
    () => options.warehouses.filter((warehouse) => warehouse.clientId === clientId),
    [clientId, options.warehouses],
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (warehouses.some((warehouse) => warehouse.id === warehouseId)) return;
    setWarehouseId(warehouses[0]?.id ?? '');
  }, [warehouseId, warehouses]);

  async function load() {
    setBusy('load');
    setError('');
    try {
      const [nextScopes, nextOptions, nextCredentials] = await Promise.all([
        fetchWmsApiScopes(session.accessToken),
        fetchWmsApiAccessOptions(session.accessToken),
        fetchWmsApiCredentials(session.accessToken),
      ]);
      setScopes(nextScopes);
      setOptions(nextOptions);
      setCredentials(nextCredentials);
      setClientId((current) => current || nextOptions.clients[0]?.id || '');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function createCredential(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    clearFeedback();
    try {
      const result = await createWmsApiCredential(session.accessToken, {
        name: name.trim(),
        clientId,
        warehouseId,
        scopes: selectedScopes,
        allowedIps: allowedIps.split(/[\s,;]+/).filter(Boolean),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setIssued(result);
      setCopied(false);
      setName('');
      setMessage('Ключ выпущен. Скопируйте его сейчас: после закрытия восстановить секрет нельзя.');
      setCredentials(await fetchWmsApiCredentials(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function rotate(credential: WmsApiCredentialSummary) {
    setBusy(`rotate:${credential.id}`);
    clearFeedback();
    try {
      const result = await rotateWmsApiCredential(session.accessToken, credential.id);
      setIssued(result);
      setCopied(false);
      setMessage(`Ключ «${credential.name}» заменён. Старый ключ больше не работает.`);
      setCredentials(await fetchWmsApiCredentials(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function revoke(credential: WmsApiCredentialSummary) {
    setBusy(`revoke:${credential.id}`);
    clearFeedback();
    try {
      await revokeWmsApiCredential(session.accessToken, credential.id);
      setPendingRevoke('');
      setMessage(`Доступ «${credential.name}» отозван.`);
      setCredentials(await fetchWmsApiCredentials(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function copyKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.apiKey);
      setCopied(true);
    } catch {
      setError('Браузер не дал доступ к буферу обмена. Выделите ключ и скопируйте его вручную.');
    }
  }

  function toggleScope(code: string) {
    setSelectedScopes((current) =>
      current.includes(code) ? current.filter((scope) => scope !== code) : [...current, code],
    );
  }

  function clearFeedback() {
    setError('');
    setMessage('');
  }

  return (
    <div className="integration-api">
      <section className="integration-api__hero">
        <div>
          <h2>Внешний API WMS</h2>
          <p>Изолированный доступ внешней учётной системы к одному клиенту и одному складу.</p>
        </div>
        <div className="integration-api__docs">
          <a href="/api/docs" target="_blank" rel="noreferrer"><BookOpen size={17} /> Swagger</a>
          <a href="/api/docs/openapi.json" target="_blank" rel="noreferrer"><Code2 size={17} /> OpenAPI JSON</a>
        </div>
      </section>

      {error && <div className="integration-api__feedback is-error" role="alert">{error}</div>}
      {message && <div className="integration-api__feedback is-success" role="status">{message}</div>}

      {issued && (
        <section className="integration-api__secret" aria-live="polite">
          <ShieldCheck size={25} aria-hidden="true" />
          <div>
            <h3>Сохраните ключ сейчас</h3>
            <p>WMS хранит только SHA-256-хеш. После закрытия этот ключ нельзя показать повторно.</p>
            <code>{issued.apiKey}</code>
          </div>
          <button type="button" onClick={() => void copyKey()}>
            {copied ? <Check size={17} /> : <Clipboard size={17} />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          <button className="is-quiet" type="button" onClick={() => setIssued(null)}>Я сохранил ключ</button>
        </section>
      )}

      <div className="integration-api__layout">
        <form className="integration-api__form" onSubmit={(event) => void createCredential(event)}>
          <header>
            <KeyRound size={22} aria-hidden="true" />
            <div>
              <h3>Новый доступ</h3>
              <p>Секрет будет показан один раз после создания.</p>
            </div>
          </header>

          <label>
            Название подключения
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Например, 1C Ногинск" />
          </label>
          <div className="integration-api__fields">
            <label>
              Клиент
              <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
                {options.clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}
              </select>
            </label>
            <label>
              Склад
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required>
                {warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.city} · {warehouse.name}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend>Разрешённые методы</legend>
            <div className="integration-api__scopes">
              {scopes.map((scope) => (
                <label className={selectedScopes.includes(scope.code) ? 'is-selected' : ''} key={scope.code}>
                  <input type="checkbox" checked={selectedScopes.includes(scope.code)} onChange={() => toggleScope(scope.code)} />
                  <span><strong>{scope.name}</strong><code>{scope.code}</code></span>
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Белый список IP <span className="is-optional">необязательно</span>
            <input value={allowedIps} onChange={(event) => setAllowedIps(event.target.value)} placeholder="159.194.217.147, 10.0.0.12" />
            <small>Пустое поле разрешает запросы с любого IP. Можно указать несколько адресов через запятую.</small>
          </label>
          <label>
            Действует до <span className="is-optional">необязательно</span>
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>

          <button className="integration-api__primary" type="submit" disabled={busy === 'create' || !clientId || !warehouseId || !selectedScopes.length}>
            <KeyRound size={18} /> {busy === 'create' ? 'Создаю…' : 'Сгенерировать ключ'}
          </button>
        </form>

        <section className="integration-api__registry">
          <header>
            <div>
              <h3>Выданные доступы</h3>
              <p>Секреты не отображаются. Видны только безопасные префиксы и журнал использования.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={busy === 'load'} aria-label="Обновить список">
              <RefreshCw size={17} /> Обновить
            </button>
          </header>

          {busy === 'load' && !credentials.length ? (
            <p className="integration-api__empty">Загружаю доступы…</p>
          ) : !credentials.length ? (
            <p className="integration-api__empty">Ключей пока нет. Создайте первый доступ слева.</p>
          ) : (
            <div className="integration-api__list">
              {credentials.map((credential) => {
                const revoked = Boolean(credential.revokedAt);
                const expired = Boolean(credential.expiresAt && new Date(credential.expiresAt).getTime() <= Date.now());
                return (
                  <article key={credential.id} className={revoked || expired ? 'is-inactive' : ''}>
                    <div className="integration-api__credential-title">
                      <div>
                        <h4>{credential.name}</h4>
                        <p>{credential.client.name} · {credential.warehouse.city} / {credential.warehouse.name}</p>
                      </div>
                      <span className={revoked || expired ? 'is-off' : 'is-on'}>{revoked ? 'Отозван' : expired ? 'Истёк' : 'Активен'}</span>
                    </div>
                    <dl>
                      <div><dt>Префикс</dt><dd><code>wms_live_{credential.keyPrefix}_…</code></dd></div>
                      <div><dt>Последний запрос</dt><dd>{credential.lastUsedAt ? formatDate(credential.lastUsedAt) : 'ещё не использовался'}</dd></div>
                      <div><dt>IP</dt><dd>{credential.allowedIps.length ? credential.allowedIps.join(', ') : 'без ограничения'}</dd></div>
                      <div><dt>Срок</dt><dd>{credential.expiresAt ? formatDate(credential.expiresAt) : 'бессрочно'}</dd></div>
                    </dl>
                    <div className="integration-api__scope-tags">{credential.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div>
                    {!revoked && (
                      <div className="integration-api__actions">
                        <button type="button" onClick={() => void rotate(credential)} disabled={Boolean(busy)}><RefreshCw size={16} /> Заменить ключ</button>
                        {pendingRevoke === credential.id ? (
                          <>
                            <button className="is-danger" type="button" onClick={() => void revoke(credential)} disabled={Boolean(busy)}><Trash2 size={16} /> Подтвердить отзыв</button>
                            <button type="button" onClick={() => setPendingRevoke('')}>Отмена</button>
                          </>
                        ) : (
                          <button className="is-danger" type="button" onClick={() => setPendingRevoke(credential.id)}><Trash2 size={16} /> Отозвать</button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : 'Не удалось выполнить операцию.';
}
