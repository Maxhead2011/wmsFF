import { AlertTriangle, CheckCircle2, Copy, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acknowledgeFbsStockAllocationChange,
  createFbsStockIntegrationKey,
  fetchFbsStockAllocation,
  revokeFbsStockIntegrationKey,
  syncFbsStockAllocation,
  updateFbsStockAllocation,
  type AuthSession,
  type FbsStockAllocationResponse,
} from '../../lib/api';

type DraftShare = FbsStockAllocationResponse['shares'][number];

export function FbsStockAllocationView({
  session,
  clientId,
  connectionId,
}: {
  session: AuthSession;
  clientId: string;
  connectionId: string;
}) {
  const [data, setData] = useState<FbsStockAllocationResponse | null>(null);
  const [shares, setShares] = useState<DraftShare[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(10);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'syncing'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [keyName, setKeyName] = useState('Внешняя система учёта');
  const [generatedKey, setGeneratedKey] = useState('');
  const isClient = session.user.roleCodes.includes('CLIENT');

  const load = useCallback(async () => {
    if (!clientId || !connectionId) return;
    setStatus('loading');
    setError('');
    try {
      const response = await fetchFbsStockAllocation(session.accessToken, clientId, connectionId);
      setData(response);
      setShares(response.shares);
      setEnabled(response.policy.enabled);
      setThreshold(response.policy.lowStockThreshold);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить распределение остатков.');
    } finally {
      setStatus('idle');
    }
  }, [clientId, connectionId, session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPercent = useMemo(
    () => shares.reduce((sum, share) => sum + (Number.isFinite(share.percent) ? share.percent : 0), 0),
    [shares],
  );

  if (!connectionId) {
    return <div className="fbs-allocation-empty">Сначала подключите кабинет Wildberries для выбранного клиента.</div>;
  }

  async function saveSettings() {
    if (totalPercent !== 100) {
      setError(`Сумма распределения должна быть 100%, сейчас ${totalPercent}%.`);
      return;
    }
    if (shares.filter((share) => share.isPrimary).length !== 1) {
      setError('Выберите один основной склад для остатка 10 единиц и менее.');
      return;
    }
    setStatus('saving');
    setError('');
    setMessage('');
    try {
      await updateFbsStockAllocation(session.accessToken, {
        clientId,
        connectionId,
        enabled,
        lowStockThreshold: threshold,
        recommendationDays: data?.policy.recommendationDays ?? 30,
        shares: shares.map((share) => ({
          warehouseId: share.warehouseId,
          warehouseName: share.warehouseName,
          percent: share.percent,
          isPrimary: share.isPrimary,
        })),
      });
      setMessage('Настройки сохранены. Остатки распределены без превышения свободного остатка WMS.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить распределение.');
    } finally {
      setStatus('idle');
    }
  }

  async function runSync() {
    setStatus('syncing');
    setError('');
    setMessage('');
    try {
      const result = await syncFbsStockAllocation(session.accessToken, { clientId, connectionId });
      setMessage(
        `Синхронизировано позиций: ${result.synced}. На складах WB опубликовано: ${result.publishedAmount}.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось синхронизировать остатки.');
    } finally {
      setStatus('idle');
    }
  }

  async function createKey() {
    setError('');
    try {
      const result = await createFbsStockIntegrationKey(session.accessToken, {
        clientId,
        name: keyName.trim() || 'Внешняя система учёта',
      });
      setGeneratedKey(result.apiKey);
      setMessage('Ключ создан. Скопируйте его сейчас: повторно он показан не будет.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать API-ключ.');
    }
  }

  async function revokeKey(keyId: string) {
    if (!window.confirm('Отключить этот интеграционный ключ? Внешняя система сразу потеряет доступ.')) return;
    try {
      await revokeFbsStockIntegrationKey(session.accessToken, clientId, keyId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отключить API-ключ.');
    }
  }

  async function acknowledge(changeId: string) {
    try {
      await acknowledgeFbsStockAllocationChange(session.accessToken, clientId, changeId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подтвердить изменение.');
    }
  }

  function applyRecommendation() {
    setShares((current) => current.map((share) => ({ ...share, percent: share.recommendedPercent })));
    setMessage('Рекомендация перенесена в поля. Нажмите «Сохранить», чтобы применить её.');
  }

  return (
    <section className="fbs-allocation">
      <header className="fbs-allocation__header">
        <div>
          <p className="eyebrow">Распределение остатков WB</p>
          <h3>Один физический остаток — несколько рабочих складов</h3>
          <p>Склады берутся из маршрутизации FBS. Суммарная публикация никогда не превышает свободный остаток WMS.</p>
        </div>
        <label className="fbs-allocation__switch">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>{enabled ? 'Автораспределение включено' : 'Автораспределение выключено'}</span>
        </label>
      </header>

      {data?.policy.changedByClientAt ? (
        <div className="fbs-allocation__client-change">
          <AlertTriangle size={20} />
          <div>
            <strong>Остатки изменены клиентом</strong>
            <span>{formatDate(data.policy.changedByClientAt)} · источник {data.policy.updatedSource}</span>
          </div>
          <b>{data.unacknowledgedChanges} не просмотрено</b>
        </div>
      ) : null}

      <div className="fbs-allocation__rules">
        <label>
          <span>При остатке не более</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={threshold}
            onChange={(event) => setThreshold(Math.max(0, Math.trunc(Number(event.target.value) || 0)))}
          />
          <small>весь остаток остаётся на основном складе Москва</small>
        </label>
        <div>
          <span>Рекомендация WB за {data?.recommendation.periodDays ?? 30} дней</span>
          <strong>{data?.recommendation.basedOnOrders ?? 0} заказов в расчёте</strong>
          <button className="secondary-button" type="button" onClick={applyRecommendation} disabled={!shares.length}>
            Применить рекомендацию
          </button>
        </div>
      </div>

      <div className="fbs-allocation__table-wrap">
        <table className="fbs-allocation__table">
          <thead><tr><th>Рабочий склад WB</th><th>Основной</th><th>Рекомендация</th><th>Установлено</th></tr></thead>
          <tbody>
            {shares.map((share) => (
              <tr key={share.warehouseId}>
                <td><strong>{share.warehouseName}</strong><small>{share.warehouseId} · {share.routeMode}</small></td>
                <td>
                  <input
                    aria-label={`Основной склад ${share.warehouseName}`}
                    type="radio"
                    name="fbs-primary-warehouse"
                    checked={share.isPrimary}
                    onChange={() => setShares((current) => current.map((row) => ({ ...row, isPrimary: row.warehouseId === share.warehouseId })))}
                  />
                </td>
                <td><span className="fbs-allocation__recommended">{share.recommendedPercent}%</span></td>
                <td>
                  <label className="fbs-allocation__percent">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={share.percent}
                      onChange={(event) => {
                        const percent = Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0)));
                        setShares((current) => current.map((row) => row.warehouseId === share.warehouseId ? { ...row, percent } : row));
                      }}
                    />
                    <span>%</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`fbs-allocation__total${totalPercent === 100 ? ' is-valid' : ' is-invalid'}`}>
        {totalPercent === 100 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        Сумма: <strong>{totalPercent}%</strong>
      </div>

      <div className="fbs-allocation__actions">
        <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={status !== 'idle' || totalPercent !== 100}>
          <Save size={17} /> {status === 'saving' ? 'Сохраняю…' : 'Сохранить распределение'}
        </button>
        <button className="secondary-button" type="button" onClick={() => void runSync()} disabled={status !== 'idle' || !data?.policy.enabled}>
          <RefreshCw size={17} className={status === 'syncing' ? 'spin' : ''} /> Синхронизировать сейчас
        </button>
      </div>

      <section className="fbs-allocation__api">
        <div className="fbs-allocation__api-heading">
          <KeyRound size={22} />
          <div><h4>API внешней системы учёта</h4><p>Ключ имеет доступ только к остаткам этого клиента. Физический остаток WMS через API не меняется.</p></div>
        </div>
        <div className="fbs-allocation__api-create">
          <input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Название интеграции" />
          <button className="secondary-button" type="button" onClick={() => void createKey()}><KeyRound size={16} /> Создать ключ</button>
        </div>
        {generatedKey ? (
          <div className="fbs-allocation__secret">
            <code>{generatedKey}</code>
            <button type="button" onClick={() => void navigator.clipboard.writeText(generatedKey)}><Copy size={16} /> Копировать</button>
          </div>
        ) : null}
        <div className="fbs-allocation__endpoints">
          <code>GET /external/v1/fbs/stock-allocation?connectionId=...</code>
          <code>PUT /external/v1/fbs/stock-allocation</code>
          <code>PUT /external/v1/fbs/stocks</code>
          <span>Заголовок: X-WMS-API-Key</span>
        </div>
        <div className="fbs-allocation__keys">
          {data?.integrationKeys.map((key) => (
            <div key={key.id} className={!key.isActive ? 'is-revoked' : ''}>
              <ShieldCheck size={17} /><span><strong>{key.name}</strong><small>{key.keyPrefix}… · использован {formatDate(key.lastUsedAt)}</small></span>
              {key.isActive ? <button type="button" onClick={() => void revokeKey(key.id)}><Trash2 size={15} /> Отключить</button> : <b>Отключён</b>}
            </div>
          ))}
        </div>
      </section>

      {data?.changes.length ? (
        <section className="fbs-allocation__changes">
          <h4>Изменения из внешних систем</h4>
          {data.changes.slice(0, 10).map((change) => (
            <article key={change.id} className={change.acknowledged ? 'is-acknowledged' : ''}>
              <div><strong>{change.changeType === 'STOCK_LIMITS_UPDATED' ? 'Изменены остатки товаров' : 'Изменены проценты распределения'}</strong><span>{formatDate(change.createdAt)} · {change.integration?.name || change.source}</span></div>
              {!change.acknowledged && !isClient ? <button type="button" onClick={() => void acknowledge(change.id)}>Просмотрено</button> : <b>{change.acknowledged ? 'Просмотрено' : 'Ожидает менеджера'}</b>}
            </article>
          ))}
        </section>
      ) : null}

      {message ? <div className="fbs-allocation__message">{message}</div> : null}
      {error ? <div className="fbs-allocation__error">{error}</div> : null}
      {status === 'loading' && !data ? <div className="fbs-allocation-empty">Загружаю настройки…</div> : null}
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'ещё не использован';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
