import { CheckCircle2, CircleAlert, KeyRound, PlugZap, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  checkMarketplaceConnection,
  createMarketplaceConnection,
  deleteMarketplaceConnection,
  fetchMarketplaceConnections,
  syncMarketplaceProducts,
  updateMarketplaceConnection,
  type ClientSummary,
  type MarketplaceConnectionCheckResult,
  type MarketplaceConnectionSummary,
  type MarketplaceType,
} from '../../lib/api';

type ClientMarketplaceConnectionsProps = {
  accessToken: string;
  client: ClientSummary;
};

type MarketplaceForm = {
  id: string;
  marketplace: MarketplaceType;
  accountName: string;
  sellerId: string;
  apiKey: string;
  isActive: boolean;
  comment: string;
};

const marketplaceOptions: Array<{ value: MarketplaceType; label: string }> = [
  { value: 'WILDBERRIES', label: 'Wildberries' },
  { value: 'OZON', label: 'Ozon' },
  { value: 'YANDEX_MARKET', label: 'Яндекс Маркет' },
  { value: 'SBER_MARKET', label: 'СберМегаМаркет' },
  { value: 'OTHER', label: 'Другое' },
];

const emptyForm: MarketplaceForm = {
  id: '',
  marketplace: 'WILDBERRIES',
  accountName: '',
  sellerId: '',
  apiKey: '',
  isActive: true,
  comment: '',
};

export function ClientMarketplaceConnections({ accessToken, client }: ClientMarketplaceConnectionsProps) {
  const [connections, setConnections] = useState<MarketplaceConnectionSummary[]>([]);
  const [checksById, setChecksById] = useState<Record<string, MarketplaceConnectionCheckResult>>({});
  const [form, setForm] = useState<MarketplaceForm>(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [checkingIds, setCheckingIds] = useState<string[]>([]);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);
  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === form.id) ?? null,
    [connections, form.id],
  );

  useEffect(() => {
    setForm(emptyForm);
    setChecksById({});
    setMessage('');
    setError('');
    setEditorOpen(false);
    void loadConnections();
  }, [client.id]);

  async function loadConnections() {
    setLoading(true);
    setError('');
    try {
      const loaded = await fetchMarketplaceConnections(accessToken, { clientId: client.id });
      setConnections(loaded);
      if (loaded.length === 0) {
        setForm(emptyForm);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить подключения маркетплейсов.');
    } finally {
      setLoading(false);
    }
  }

  function openNewConnection() {
    setForm(emptyForm);
    setMessage('');
    setError('');
    setEditorOpen(true);
  }

  function editConnection(connection: MarketplaceConnectionSummary) {
    setForm({
      id: connection.id,
      marketplace: connection.marketplace,
      accountName: connection.accountName ?? '',
      sellerId: connection.sellerId ?? '',
      apiKey: '',
      isActive: connection.isActive,
      comment: connection.comment ?? '',
    });
    setMessage('Для замены ключа вставьте новый API-ключ. Пустое поле сохранит действующий ключ.');
    setError('');
    setEditorOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        clientId: client.id,
        marketplace: form.marketplace,
        accountName: form.accountName.trim(),
        sellerId: form.sellerId.trim(),
        apiKey: form.apiKey.trim(),
        isActive: form.isActive,
        comment: form.comment.trim(),
      };
      let saved: MarketplaceConnectionSummary;
      if (form.id) {
        const { apiKey, ...withoutApiKey } = payload;
        saved = await updateMarketplaceConnection(accessToken, form.id, apiKey ? payload : withoutApiKey);
        setConnections((current) => current.map((connection) => (connection.id === saved.id ? saved : connection)));
      } else {
        saved = await createMarketplaceConnection(accessToken, payload);
        setConnections((current) => [saved, ...current]);
      }

      setForm(emptyForm);
      setEditorOpen(false);
      await verifyConnection(saved.id, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить подключение.');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyConnection(connectionId: string, syncCardsAfterCheck = false) {
    setCheckingIds((current) => (current.includes(connectionId) ? current : [...current, connectionId]));
    setError('');
    setMessage('');
    try {
      const result = await checkMarketplaceConnection(accessToken, connectionId);
      setChecksById((current) => ({ ...current, [connectionId]: result }));
      const failed = result.checks.filter((check) => !check.ok);
      const productsAvailable = result.checks.find((check) => check.key === 'products')?.ok === true;

      if (syncCardsAfterCheck && productsAvailable) {
        const syncResult = await synchronizeProducts(connectionId);
        if (syncResult) {
          setMessage(
            [
              result.ok ? 'API подключён и полностью проверен.' : 'API сохранён, часть разрешений требует внимания.',
              `Карточки загружены: ${syncResult.productsReceived}.`,
              `Создано: ${syncResult.created}, обновлено: ${syncResult.updated}.`,
              syncResult.mergedDrafts ? `Объединено товаров без карточки: ${syncResult.mergedDrafts}.` : '',
              syncResult.skipped ? `Пропущено: ${syncResult.skipped}.` : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
        }
      } else {
        setMessage(
          result.ok
            ? 'API работает: доступны FBS-заказы, карточки товаров и склады.'
            : syncCardsAfterCheck
              ? 'API-ключ сохранён. Проверьте разрешения ниже; карточки не загружались из-за отсутствия доступа.'
              : 'Проверка API завершена. Часть разрешений требует внимания.',
        );
      }

      if (failed.length > 0) {
        setError(failed.map((check) => `${check.label}: ${check.message}`).join(' '));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось проверить API-подключение.');
    } finally {
      setCheckingIds((current) => current.filter((id) => id !== connectionId));
    }
  }

  async function synchronizeProducts(connectionId: string) {
    setSyncingIds((current) => (current.includes(connectionId) ? current : [...current, connectionId]));
    try {
      return await syncMarketplaceProducts(accessToken, connectionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось синхронизировать товары.');
      return null;
    } finally {
      setSyncingIds((current) => current.filter((id) => id !== connectionId));
    }
  }

  async function runProductSync(connectionId: string) {
    setError('');
    setMessage('');
    const result = await synchronizeProducts(connectionId);
    if (!result) {
      return;
    }
    setMessage(
      [
        'Товары синхронизированы.',
        `Получено: ${result.productsReceived}. Создано: ${result.created}. Обновлено: ${result.updated}.`,
        result.mergedDrafts ? `Объединено товаров без карточки: ${result.mergedDrafts}.` : '',
        result.skipped ? `Пропущено: ${result.skipped}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  async function removeConnection(connection: MarketplaceConnectionSummary) {
    const confirmed = window.confirm(
      `Удалить подключение ${marketplaceLabel(connection.marketplace)} для клиента ${client.name}?`,
    );
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const deleted = await deleteMarketplaceConnection(accessToken, connection.id);
      setConnections((current) => current.filter((item) => item.id !== deleted.id));
      setChecksById((current) => {
        const next = { ...current };
        delete next[deleted.id];
        return next;
      });
      if (form.id === deleted.id) {
        setForm(emptyForm);
        setEditorOpen(false);
      }
      setMessage('Подключение удалено.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить подключение.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="client-marketplace-panel" aria-label="API маркетплейсов">
      <div className="client-marketplace-panel__heading">
        <div>
          <h3>API для FBS и карточек товаров</h3>
          <span>Ключ хранится в карточке клиента и используется всеми модулями WMS</span>
        </div>
        <div className="client-marketplace-panel__heading-actions">
          <button className="icon-text-button" type="button" onClick={() => void loadConnections()} disabled={isLoading}>
            <RefreshCw size={15} aria-hidden="true" />
            <span>{isLoading ? 'Обновляю' : 'Обновить'}</span>
          </button>
          <button className="primary-button" type="button" onClick={openNewConnection}>
            <KeyRound size={16} aria-hidden="true" />
            <span>Подключить API</span>
          </button>
        </div>
      </div>

      {connections.length === 0 && !isLoading ? (
        <button className="client-marketplace-empty" type="button" onClick={openNewConnection}>
          <KeyRound size={24} aria-hidden="true" />
          <strong>API-ключ пока не указан</strong>
          <span>Добавьте ключ — WMS сразу проверит FBS, карточки и склады, затем загрузит товары.</span>
        </button>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {connections.length > 0 ? (
        <div className="client-marketplace-table-wrap">
          <table className="client-marketplace-table">
            <thead>
              <tr>
                <th>Маркетплейс</th>
                <th>Кабинет</th>
                <th>ID</th>
                <th>API-ключ</th>
                <th>Состояние доступа</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const check = checksById[connection.id];
                const isChecking = checkingIds.includes(connection.id);
                const isSyncing = syncingIds.includes(connection.id);
                return (
                  <tr key={connection.id}>
                    <td>{marketplaceLabel(connection.marketplace)}</td>
                    <td>{connection.accountName || 'не задан'}</td>
                    <td>{connection.sellerId || 'не требуется'}</td>
                    <td>
                      <span className="client-marketplace-key">{connection.apiKeyMask}</span>
                    </td>
                    <td>
                      {!connection.isActive ? (
                        <span className="client-marketplace-access is-off">Отключено</span>
                      ) : isChecking ? (
                        <span className="client-marketplace-access is-loading">Проверяю API…</span>
                      ) : check ? (
                        <div className="client-marketplace-checks">
                          {check.checks.map((item) => (
                            <span
                              key={item.key}
                              className={`client-marketplace-access ${item.ok ? 'is-ok' : 'is-error'}`}
                              title={item.message}
                            >
                              {item.ok ? (
                                <CheckCircle2 size={13} aria-hidden="true" />
                              ) : (
                                <CircleAlert size={13} aria-hidden="true" />
                              )}
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="client-marketplace-access is-unknown">Ещё не проверено</span>
                      )}
                    </td>
                    <td>
                      <div className="client-marketplace-row-actions">
                        <button
                          className="icon-text-button"
                          type="button"
                          onClick={() => void verifyConnection(connection.id)}
                          disabled={isChecking || !connection.isActive}
                        >
                          <PlugZap size={14} aria-hidden="true" />
                          <span>{isChecking ? 'Проверка' : 'Проверить API'}</span>
                        </button>
                        <button className="icon-text-button" type="button" onClick={() => editConnection(connection)}>
                          Заменить ключ
                        </button>
                        <button
                          className="icon-text-button"
                          type="button"
                          onClick={() => void runProductSync(connection.id)}
                          disabled={isSyncing || !connection.isActive}
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                          <span>{isSyncing ? 'Загрузка' : 'Загрузить карточки'}</span>
                        </button>
                        <button
                          className="icon-text-button client-cabinet-danger-button"
                          type="button"
                          onClick={() => void removeConnection(connection)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span>Удалить</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {isEditorOpen ? (
        <div className="client-marketplace-dialog-backdrop" role="presentation" onMouseDown={() => !isSubmitting && setEditorOpen(false)}>
          <form
            className="client-marketplace-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? 'Изменение API-ключа' : 'Подключение API'}
            onSubmit={submit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div className="client-marketplace-dialog__icon">
                <KeyRound size={22} aria-hidden="true" />
              </div>
              <div>
                <h3>{form.id ? 'Изменить подключение API' : 'Подключить API клиента'}</h3>
                <p>{client.name}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Закрыть"
                onClick={() => setEditorOpen(false)}
                disabled={isSubmitting}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="client-marketplace-form">
              <label>
                <span>Маркетплейс</span>
                <select
                  value={form.marketplace}
                  onChange={(event) => setForm({ ...form, marketplace: event.target.value as MarketplaceType })}
                >
                  {marketplaceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Название кабинета</span>
                <input
                  value={form.accountName}
                  onChange={(event) => setForm({ ...form, accountName: event.target.value })}
                  placeholder="Например, основной кабинет"
                />
              </label>
              <label>
                <span>{form.marketplace === 'OZON' ? 'Client-Id Ozon' : 'ID продавца / кабинета'}</span>
                <input
                  value={form.sellerId}
                  onChange={(event) => setForm({ ...form, sellerId: event.target.value })}
                  required={form.marketplace === 'OZON'}
                />
              </label>
              <label className="client-marketplace-form__wide">
                <span>{form.id ? 'Новый API-ключ' : 'API-ключ'}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.apiKey}
                  onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                  placeholder={form.id ? selectedConnection?.apiKeyMask ?? '' : 'Вставьте API-ключ'}
                  required={!form.id}
                />
                <small>
                  После сохранения WMS автоматически проверит доступ к FBS, карточкам и складам, а затем загрузит карточки товаров.
                </small>
              </label>
              <label className="client-marketplace-checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                <span>Подключение активно</span>
              </label>
              <label>
                <span>Комментарий</span>
                <input value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
              </label>
            </div>

            <footer>
              <button className="icon-text-button" type="button" onClick={() => setEditorOpen(false)} disabled={isSubmitting}>
                Отмена
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={isSubmitting || (!form.id && form.apiKey.trim().length < 8)}
              >
                <Save size={16} aria-hidden="true" />
                <span>{isSubmitting ? 'Сохраняю и проверяю…' : 'Сохранить и проверить'}</span>
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function marketplaceLabel(type: MarketplaceType) {
  return marketplaceOptions.find((option) => option.value === type)?.label ?? type;
}
