import {
  BadgeCheck,
  CheckCircle2,
  CloudDownload,
  FileDown,
  KeyRound,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  ShoppingBag,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  checkKizCirculationItems,
  createKizCirculationBatch,
  fetchClients,
  fetchKizCirculationOverview,
  importKizCirculationItems,
  refreshKizCirculationBatch,
  saveKizTrueApiConnection,
  signKizCirculationBatch,
  submitKizCirculationBatch,
  syncKizCirculation,
  updateKizCirculationItem,
  type AuthSession,
  type ClientSummary,
  type KizCirculationBatch,
  type KizCirculationItem,
  type KizCirculationItemStatus,
  type KizCirculationOperation,
  type KizCirculationOverview,
  type MarketplaceType,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
import './kiz-circulation.css';

type Props = { session: AuthSession };
type View = 'queue' | 'batches' | 'settings';

const marketplaceTiles: Array<{
  id: MarketplaceType | 'CHESTNY_ZNAK';
  title: string;
  caption: string;
  tone: string;
}> = [
  { id: 'WILDBERRIES', title: 'Wildberries', caption: 'Продажи и возвраты FBS', tone: 'berry' },
  { id: 'OZON', title: 'Ozon', caption: 'Доставленные отправления', tone: 'blue' },
  { id: 'YANDEX_MARKET', title: 'Яндекс Маркет', caption: 'Доставки и отмены', tone: 'yellow' },
  { id: 'OTHER', title: 'Другие сервисы', caption: 'Ручной импорт выгрузок', tone: 'slate' },
  { id: 'CHESTNY_ZNAK', title: 'Честный знак', caption: 'True API и УКЭП', tone: 'green' },
];

const statusLabels: Record<KizCirculationItemStatus, string> = {
  NEEDS_REVIEW: 'Нужна проверка',
  READY: 'Готов',
  ALREADY_APPLIED: 'Уже выполнено',
  IN_BATCH: 'В пакете',
  SUBMITTED: 'Отправлен',
  APPLIED: 'Выполнено',
  ERROR: 'Ошибка',
  EXCLUDED: 'Исключён',
};

export function KizCirculationPanel({ session }: Props) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [overview, setOverview] = useState<KizCirculationOverview | null>(null);
  const [view, setView] = useState<View>('queue');
  const [operation, setOperation] = useState<KizCirculationOperation>('RETIRE');
  const [marketplace, setMarketplace] = useState<MarketplaceType | 'ALL'>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeBatchId, setActiveBatchId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [manualCodes, setManualCodes] = useState('');
  const [manualMarketplace, setManualMarketplace] = useState<MarketplaceType>('OTHER');
  const [signature, setSignature] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [batchForm, setBatchForm] = useState({
    actionDate: today(),
    documentType: 'OTHER',
    documentNumber: '',
    documentDate: today(),
    primaryDocumentCustomName: 'Отчёт маркетплейса',
    paid: false,
  });
  const [connectionForm, setConnectionForm] = useState({
    inn: '',
    kpp: '',
    fiasId: '',
    productGroup: 'lp',
    apiBaseUrl: 'https://markirovka.crpt.ru/api/v3/true-api',
    apiToken: '',
    tokenExpiresAt: '',
    certificateSubject: '',
    certificateThumbprint: '',
  });

  useEffect(() => {
    void (async () => {
      setBusy('clients');
      try {
        const rows = await fetchClients(session.accessToken);
        setClients(rows.filter((client) => client.status === 'ACTIVE'));
        if (!clientId || !rows.some((client) => client.id === clientId)) setClientId(rows[0]?.id ?? '');
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setBusy('');
      }
    })();
  }, []);

  useEffect(() => {
    if (clientId) void load();
  }, [clientId]);

  async function load(quiet = false) {
    if (!clientId) return;
    if (!quiet) setBusy('load');
    setError('');
    try {
      const data = await fetchKizCirculationOverview(session.accessToken, clientId);
      setOverview(data);
      const connection = data.connection;
      setConnectionForm((current) => ({
        inn: connection?.inn ?? data.client.inn ?? '',
        kpp: connection?.kpp ?? data.client.kpp ?? '',
        fiasId: connection?.fiasId ?? '',
        productGroup: connection?.productGroup ?? current.productGroup,
        apiBaseUrl: connection?.apiBaseUrl ?? current.apiBaseUrl,
        apiToken: '',
        tokenExpiresAt: connection?.tokenExpiresAt?.slice(0, 10) ?? '',
        certificateSubject: connection?.certificateSubject ?? '',
        certificateThumbprint: connection?.certificateThumbprint ?? '',
      }));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      if (!quiet) setBusy('');
    }
  }

  const filteredItems = useMemo(
    () => (overview?.items ?? []).filter((item) =>
      item.operation === operation && (marketplace === 'ALL' || item.marketplace === marketplace)),
    [marketplace, operation, overview],
  );
  const selectedItems = filteredItems.filter((item) => selectedIds.includes(item.id));
  const activeBatch = overview?.batches.find((batch) => batch.id === activeBatchId) ?? null;

  async function run(key: string, action: () => Promise<string | void>) {
    setBusy(key);
    setError('');
    setMessage('');
    try {
      const nextMessage = await action();
      if (nextMessage) setMessage(nextMessage);
      await load(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function sync() {
    await run('sync', async () => {
      const result = await syncKizCirculation(session.accessToken, clientId);
      return `Проверено отгрузок: ${result.scannedShipments}. Новых к погашению: ${result.retireCreated}, к возврату: ${result.returnCreated}.${result.invalidCodes ? ` Не разобрано кодов: ${result.invalidCodes}.` : ''}`;
    });
  }

  async function checkSelected() {
    if (!selectedIds.length) return;
    await run('check', async () => {
      const result = await checkKizCirculationItems(session.accessToken, clientId, selectedIds);
      setSelectedIds([]);
      return `Честный знак проверил ${result.checked} КИЗ. Уже выполненные операции повторно не отправятся.`;
    });
  }

  async function savePrice(item: KizCirculationItem, rubles: string) {
    const value = Math.round(Number(rubles.replace(',', '.')) * 100);
    if (!Number.isFinite(value) || value < 1 || value === item.productCostKopecks) return;
    await run(`price:${item.id}`, async () => {
      await updateKizCirculationItem(session.accessToken, item.id, { productCostKopecks: value });
      return `Цена КИЗ ${shortCis(item.cis)} сохранена.`;
    });
  }

  async function createBatch() {
    if (!selectedIds.length) return;
    await run('batch', async () => {
      const batch = await createKizCirculationBatch(session.accessToken, {
        clientId,
        operation,
        itemIds: selectedIds,
        ...batchForm,
      });
      setSelectedIds([]);
      setActiveBatchId(batch.id);
      setView('batches');
      return 'Черновик создан. Скачайте JSON, подпишите неизменённый файл УКЭП и вставьте отделённую подпись Base64.';
    });
  }

  async function importCodes() {
    const codes = manualCodes.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!codes.length) return;
    await run('import', async () => {
      const result = await importKizCirculationItems(session.accessToken, {
        clientId,
        operation,
        marketplace: manualMarketplace,
        codes,
      });
      setManualCodes('');
      return `Импортировано КИЗ: ${result.imported}. Перед пакетом обязательно выполните проверку в Честном знаке.`;
    });
  }

  async function saveConnection() {
    await run('connection', async () => {
      await saveKizTrueApiConnection(session.accessToken, clientId, {
        ...connectionForm,
        kpp: connectionForm.kpp || undefined,
        fiasId: connectionForm.fiasId || undefined,
        apiToken: connectionForm.apiToken || undefined,
        tokenExpiresAt: connectionForm.tokenExpiresAt || undefined,
        certificateSubject: connectionForm.certificateSubject || undefined,
        certificateThumbprint: connectionForm.certificateThumbprint || undefined,
        isActive: true,
      });
      return 'Подключение True API сохранено. Закрытый ключ УКЭП в WMS не передаётся.';
    });
  }

  async function signBatch(batch: KizCirculationBatch) {
    if (!signature.trim()) return;
    await run(`sign:${batch.id}`, async () => {
      await signKizCirculationBatch(session.accessToken, batch.id, signature);
      setSignature('');
      return 'Подпись сохранена. Перед отправкой WMS повторно сверит статусы всех КИЗ в Честном знаке.';
    });
  }

  async function submitBatch(batch: KizCirculationBatch) {
    await run(`submit:${batch.id}`, async () => {
      const result = await submitKizCirculationBatch(session.accessToken, batch.id, confirmation);
      setConfirmation('');
      return `Документ отправлен. ID Честного знака: ${result.crptDocumentId}. Теперь проверьте итоговый статус.`;
    });
  }

  function chooseTile(id: MarketplaceType | 'CHESTNY_ZNAK') {
    setSelectedIds([]);
    if (id === 'CHESTNY_ZNAK') {
      setView('settings');
      return;
    }
    setMarketplace(id);
    setView('queue');
  }

  if (busy === 'clients' && clients.length === 0) {
    return <div className="kizc-loading"><RefreshCw className="spin" /> Загружаю контур погашения КИЗ…</div>;
  }

  // FIX: keep the primary action before the client selector so the selector
  // remains the last flexible column and cannot be pushed outside the header.
  return (
    <section className="kizc-panel" aria-label="Погашение КИЗ">
      <header className="kizc-header">
        <div className="kizc-header__mark"><BadgeCheck size={27} /></div>
        <div>
          <h2>Погашение КИЗ</h2>
          <p>Сверка продаж маркетплейсов с ГИС МТ, погашение и контролируемый возврат в оборот.</p>
        </div>
        <button className="kizc-primary" type="button" disabled={!clientId || Boolean(busy)} onClick={() => void sync()}>
          <CloudDownload className={busy === 'sync' ? 'spin' : ''} size={18} />
          {busy === 'sync' ? 'Сверяю статусы' : 'Получить продажи'}
        </button>
        <label className="kizc-client-select">
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => { setClientId(event.target.value); setSelectedIds([]); }}>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}
          </select>
        </label>
      </header>

      {error ? <div className="kizc-alert kizc-alert--error"><TriangleAlert size={18} /> <span>{error}</span></div> : null}
      {message ? <div className="kizc-alert kizc-alert--success"><CheckCircle2 size={18} /> <span>{message}</span></div> : null}

      <div className="kizc-sources" aria-label="Источники операций">
        {marketplaceTiles.map((tile) => {
          const connected = tile.id === 'CHESTNY_ZNAK'
            ? Boolean(overview?.connection?.isActive)
            : tile.id === 'OTHER'
              ? true
              : overview?.marketplaceConnections.some((row) => row.marketplace === tile.id && row.isActive);
          const count = tile.id === 'CHESTNY_ZNAK'
            ? overview?.batches.filter((batch) => batch.status === 'SUBMITTED').length ?? 0
            : overview?.items.filter((item) => item.marketplace === tile.id && item.status !== 'APPLIED').length ?? 0;
          return (
            <button key={tile.id} type="button" className={`kizc-source kizc-source--${tile.tone}`} onClick={() => chooseTile(tile.id)}>
              <span className="kizc-source__signal" aria-hidden="true" />
              <strong>{tile.title}</strong>
              <small>{tile.caption}</small>
              <em>{connected ? 'подключено' : 'нет подключения'} · {count}</em>
            </button>
          );
        })}
      </div>

      <nav className="kizc-tabs" aria-label="Разделы погашения КИЗ">
        <button type="button" className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>Очередь</button>
        <button type="button" className={view === 'batches' ? 'active' : ''} onClick={() => setView('batches')}>Пакеты в ЧЗ</button>
        <button type="button" className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Подключение True API</button>
      </nav>

      {view === 'queue' ? (
        <>
          <section className="kizc-workbar">
            <div className="kizc-operation-switch">
              <button type="button" className={operation === 'RETIRE' ? 'active' : ''} onClick={() => { setOperation('RETIRE'); setSelectedIds([]); }}>
                <PackageCheck size={17} /> Погасить
              </button>
              <button type="button" className={operation === 'RETURN' ? 'active' : ''} onClick={() => { setOperation('RETURN'); setSelectedIds([]); }}>
                <RotateCcw size={17} /> Вернуть в оборот
              </button>
            </div>
            <select value={marketplace} onChange={(event) => { setMarketplace(event.target.value as MarketplaceType | 'ALL'); setSelectedIds([]); }}>
              <option value="ALL">Все сервисы</option>
              <option value="WILDBERRIES">Wildberries</option>
              <option value="OZON">Ozon</option>
              <option value="YANDEX_MARKET">Яндекс Маркет</option>
              <option value="OTHER">Другие</option>
            </select>
            <span className="kizc-selection">Выбрано: <strong>{selectedIds.length}</strong></span>
            <button type="button" className="kizc-secondary" disabled={!selectedIds.length || Boolean(busy)} onClick={() => void checkSelected()}>
              <ShieldCheck size={17} /> Проверить в ЧЗ
            </button>
          </section>

          <section className="kizc-queue">
            <header>
              <div>
                <h3>{operation === 'RETIRE' ? 'КИЗ после фактической продажи' : 'Физические возвраты на склад'}</h3>
                <p>{operation === 'RETIRE'
                  ? 'Перед отправкой нужен статус «В обороте» и цена продажи. Одна лишь отгрузка со склада сюда не попадает.'
                  : 'Возврат создаётся только когда ранее погашенный КИЗ снова физически принят в доступный остаток WMS.'}</p>
              </div>
              <strong>{filteredItems.length}</strong>
            </header>
            <div className="kizc-table-wrap">
              <table className="kizc-table">
                <thead><tr><th></th><th>Источник</th><th>Заказ / товар</th><th>КИ</th><th>Статус ЧЗ</th><th>Цена</th><th>Готовность</th></tr></thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const selectable = !['IN_BATCH', 'SUBMITTED', 'APPLIED'].includes(item.status);
                    return (
                      <tr key={item.id}>
                        <td><input type="checkbox" aria-label={`Выбрать КИ ${shortCis(item.cis)}`} disabled={!selectable} checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td>
                        <td><strong>{marketplaceName(item.marketplace)}</strong><small>{formatDate(item.eventAt)}</small></td>
                        <td><strong>№{item.orderId || 'ручной импорт'}</strong><small>{metadataText(item, 'productName') || metadataText(item, 'source')}</small></td>
                        <td><code title={item.cis}>{shortCis(item.cis)}</code><small>{item.productGroup || 'группа не указана'}</small></td>
                        <td><strong>{item.remoteStatus || 'не проверен'}</strong><small className={item.remoteMessage ? 'danger' : ''}>{item.remoteMessage || 'True API'}</small></td>
                        <td>{item.operation === 'RETIRE' ? <PriceInput item={item} disabled={Boolean(busy)} onSave={savePrice} /> : <span>не требуется</span>}</td>
                        <td><span className={`kizc-status kizc-status--${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td>
                      </tr>
                    );
                  })}
                  {!filteredItems.length ? <tr><td colSpan={7}><div className="kizc-empty"><ShoppingBag size={22} /><strong>Очередь пуста</strong><span>Нажмите «Получить продажи» или импортируйте выгрузку другого сервиса.</span></div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="kizc-compose">
            <div className="kizc-compose__batch">
              <h3>Собрать подписываемый пакет</h3>
              <div className="kizc-form-grid">
                <label><span>Номер отчёта / документа</span><input value={batchForm.documentNumber} onChange={(event) => setBatchForm({ ...batchForm, documentNumber: event.target.value })} placeholder="WB-2026-08-18" /></label>
                <label><span>Дата операции</span><input type="date" value={batchForm.actionDate} onChange={(event) => setBatchForm({ ...batchForm, actionDate: event.target.value })} /></label>
                <label><span>Дата документа</span><input type="date" value={batchForm.documentDate} onChange={(event) => setBatchForm({ ...batchForm, documentDate: event.target.value })} /></label>
                <label><span>Тип первичного документа</span><select value={batchForm.documentType} onChange={(event) => setBatchForm({ ...batchForm, documentType: event.target.value })}><option value="OTHER">Прочее</option><option value="RECEIPT">Кассовый чек</option><option value="SALES_RECEIPT">Товарный чек</option><option value="UTD">УПД</option></select></label>
                {batchForm.documentType === 'OTHER' ? <label className="wide"><span>Наименование документа</span><input value={batchForm.primaryDocumentCustomName} onChange={(event) => setBatchForm({ ...batchForm, primaryDocumentCustomName: event.target.value })} /></label> : null}
                {operation === 'RETURN' ? <label className="kizc-check wide"><input type="checkbox" checked={batchForm.paid} onChange={(event) => setBatchForm({ ...batchForm, paid: event.target.checked })} /><span>Возврат был оплачен покупателем</span></label> : null}
              </div>
              <button type="button" className="kizc-primary" disabled={!selectedItems.length || selectedItems.some((item) => item.status !== 'READY') || !batchForm.documentNumber.trim() || Boolean(busy)} onClick={() => void createBatch()}>
                <PackageCheck size={17} /> Создать пакет из {selectedItems.length || 0} КИЗ
              </button>
              {selectedItems.some((item) => item.status !== 'READY') ? <small className="kizc-hint">Сначала проверьте выбранные КИЗ в ЧЗ и заполните цены.</small> : null}
            </div>
            <div className="kizc-compose__import">
              <h3>Импорт другого сервиса</h3>
              <select value={manualMarketplace} onChange={(event) => setManualMarketplace(event.target.value as MarketplaceType)}>
                <option value="OTHER">Другой сервис</option><option value="WILDBERRIES">Wildberries</option><option value="OZON">Ozon</option><option value="YANDEX_MARKET">Яндекс Маркет</option>
              </select>
              <textarea value={manualCodes} onChange={(event) => setManualCodes(event.target.value)} placeholder={'Один полный Data Matrix на строку. Разделитель можно вставить как <GS>.'} />
              <button type="button" className="kizc-secondary" disabled={!manualCodes.trim() || Boolean(busy)} onClick={() => void importCodes()}><Upload size={17} /> Импортировать в очередь</button>
            </div>
          </section>
        </>
      ) : null}

      {view === 'batches' ? (
        <section className="kizc-batches">
          <div className="kizc-batch-list">
            <header><h3>Документы True API</h3><span>Подпись относится к точному SHA‑256 JSON и не переживает изменение файла.</span></header>
            {(overview?.batches ?? []).map((batch) => (
              <button key={batch.id} type="button" className={activeBatchId === batch.id ? 'active' : ''} onClick={() => { setActiveBatchId(batch.id); setSignature(''); setConfirmation(''); }}>
                <span><strong>{batch.documentType}</strong><small>{formatDate(batch.createdAt)} · {batch.itemCount} КИЗ</small></span>
                <span><em>{batch.status}</em><small>{batch.crptStatus || 'ещё не отправлен'}</small></span>
              </button>
            ))}
            {!overview?.batches.length ? <div className="kizc-empty"><FileDown size={22} /><strong>Пакетов пока нет</strong><span>Сначала подготовьте проверенные строки в очереди.</span></div> : null}
          </div>
          <BatchActionPanel
            batch={activeBatch}
            signature={signature}
            confirmation={confirmation}
            busy={busy}
            onSignature={setSignature}
            onConfirmation={setConfirmation}
            onDownload={downloadBatch}
            onSign={signBatch}
            onSubmit={submitBatch}
            onRefresh={(batch) => run(`refresh:${batch.id}`, async () => {
              const result = await refreshKizCirculationBatch(session.accessToken, batch.id);
              return result.applied ? 'Честный знак обработал документ успешно.' : result.error || `Текущий статус ЧЗ: ${result.status}.`;
            })}
          />
        </section>
      ) : null}

      {view === 'settings' ? (
        <section className="kizc-settings">
          <header><KeyRound size={23} /><div><h3>Подключение к True API</h3><p>Токен хранится зашифрованно. Закрытый ключ УКЭП и контейнер сертификата в WMS не загружаются.</p></div></header>
          <div className="kizc-settings-grid">
            <label><span>ИНН владельца КИЗ</span><input value={connectionForm.inn} onChange={(event) => setConnectionForm({ ...connectionForm, inn: event.target.value })} /></label>
            <label><span>Код товарной группы ЧЗ</span><input value={connectionForm.productGroup} onChange={(event) => setConnectionForm({ ...connectionForm, productGroup: event.target.value })} placeholder="lp" /></label>
            <label><span>КПП юридического лица</span><input value={connectionForm.kpp} onChange={(event) => setConnectionForm({ ...connectionForm, kpp: event.target.value, fiasId: event.target.value ? '' : connectionForm.fiasId })} placeholder="9 цифр" /></label>
            <label><span>ФИАС места деятельности ИП</span><input value={connectionForm.fiasId} onChange={(event) => setConnectionForm({ ...connectionForm, fiasId: event.target.value, kpp: event.target.value ? '' : connectionForm.kpp })} placeholder="UUID" /></label>
            <label className="wide"><span>Контур True API</span><select value={connectionForm.apiBaseUrl} onChange={(event) => setConnectionForm({ ...connectionForm, apiBaseUrl: event.target.value })}><option value="https://markirovka.crpt.ru/api/v3/true-api">Промышленный · markirovka.crpt.ru</option><option value="https://markirovka.sandbox.crptech.ru/api/v3/true-api">Тестовый · sandbox.crptech.ru</option></select></label>
            <label className="wide"><span>Токен True API {overview?.connection?.tokenConfigured ? '· уже сохранён, оставьте пустым без замены' : ''}</span><textarea className="token" value={connectionForm.apiToken} onChange={(event) => setConnectionForm({ ...connectionForm, apiToken: event.target.value })} placeholder="Bearer …" /></label>
            <label><span>Срок токена</span><input type="date" value={connectionForm.tokenExpiresAt} onChange={(event) => setConnectionForm({ ...connectionForm, tokenExpiresAt: event.target.value })} /></label>
            <label><span>Отпечаток сертификата</span><input value={connectionForm.certificateThumbprint} onChange={(event) => setConnectionForm({ ...connectionForm, certificateThumbprint: event.target.value })} /></label>
            <label className="wide"><span>Владелец сертификата</span><input value={connectionForm.certificateSubject} onChange={(event) => setConnectionForm({ ...connectionForm, certificateSubject: event.target.value })} /></label>
          </div>
          <div className="kizc-settings__footer">
            <div><ShieldCheck size={18} /><span>{overview?.connection?.lastCheckMessage || 'После сохранения проверьте любой КИЗ из очереди.'}</span></div>
            <button type="button" className="kizc-primary" disabled={!connectionForm.inn || !connectionForm.productGroup || (!overview?.connection?.tokenConfigured && !connectionForm.apiToken.trim()) || Boolean(busy)} onClick={() => void saveConnection()}><Save size={17} /> Сохранить подключение</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function PriceInput({ item, disabled, onSave }: { item: KizCirculationItem; disabled: boolean; onSave: (item: KizCirculationItem, value: string) => Promise<void> }) {
  const [value, setValue] = useState(item.productCostKopecks ? String(item.productCostKopecks / 100) : '');
  useEffect(() => setValue(item.productCostKopecks ? String(item.productCostKopecks / 100) : ''), [item.productCostKopecks]);
  return <label className="kizc-price"><input inputMode="decimal" value={value} disabled={disabled || Boolean(item.batchId)} onChange={(event) => setValue(event.target.value)} onBlur={() => void onSave(item, value)} placeholder="руб." /><span>₽</span></label>;
}

function BatchActionPanel(props: {
  batch: KizCirculationBatch | null;
  signature: string;
  confirmation: string;
  busy: string;
  onSignature: (value: string) => void;
  onConfirmation: (value: string) => void;
  onDownload: (batch: KizCirculationBatch) => void;
  onSign: (batch: KizCirculationBatch) => Promise<void>;
  onSubmit: (batch: KizCirculationBatch) => Promise<void>;
  onRefresh: (batch: KizCirculationBatch) => Promise<void>;
}) {
  if (!props.batch) return <div className="kizc-batch-action kizc-empty"><PackageCheck size={24} /><strong>Выберите пакет</strong><span>Здесь появятся точный JSON, хэш, подпись и отправка.</span></div>;
  const batch = props.batch;
  return (
    <div className="kizc-batch-action">
      <header><div><h3>{batch.documentType}</h3><span>{batch.operation === 'RETIRE' ? 'Погашение' : 'Возврат в оборот'} · {batch.itemCount} КИЗ</span></div><strong>{batch.status}</strong></header>
      <dl><div><dt>SHA‑256</dt><dd><code>{batch.payloadHash}</code></dd></div><div><dt>ID ЧЗ</dt><dd>{batch.crptDocumentId || 'не присвоен'}</dd></div><div><dt>Статус ЧЗ</dt><dd>{batch.crptStatus || 'черновик'}</dd></div></dl>
      <button type="button" className="kizc-secondary" onClick={() => props.onDownload(batch)}><FileDown size={17} /> Скачать JSON для УКЭП</button>
      {batch.status === 'DRAFT' ? <div className="kizc-batch-step"><label><span>Отделённая подпись Base64</span><textarea value={props.signature} onChange={(event) => props.onSignature(event.target.value)} placeholder="Вставьте подпись неизменённого JSON" /></label><button type="button" className="kizc-primary" disabled={props.signature.trim().length < 16 || Boolean(props.busy)} onClick={() => void props.onSign(batch)}><BadgeCheck size={17} /> Закрепить подпись</button></div> : null}
      {batch.status === 'SIGNED' ? <div className="kizc-batch-step kizc-batch-step--danger"><p>Перед отправкой WMS ещё раз запросит статусы КИЗ. Если хотя бы один изменился, пакет будет снят без отправки.</p><label><span>Введите ОТПРАВИТЬ</span><input value={props.confirmation} onChange={(event) => props.onConfirmation(event.target.value)} /></label><button type="button" className="kizc-danger" disabled={props.confirmation.trim().toUpperCase() !== 'ОТПРАВИТЬ' || Boolean(props.busy)} onClick={() => void props.onSubmit(batch)}><Send size={17} /> Отправить в Честный знак</button></div> : null}
      {batch.status === 'SUBMITTED' ? <button type="button" className="kizc-primary" disabled={Boolean(props.busy)} onClick={() => void props.onRefresh(batch)}><RefreshCw size={17} /> Проверить обработку</button> : null}
      {batch.crptError ? <div className="kizc-alert kizc-alert--error"><TriangleAlert size={17} />{batch.crptError}</div> : null}
    </div>
  );
}

function downloadBatch(batch: KizCirculationBatch) {
  // FIX: файл для УКЭП должен побайтно совпадать с product_document в True API.
  const blob = new Blob([batch.payloadJson], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${batch.documentType}-${batch.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function marketplaceName(value: MarketplaceType) {
  return ({ WILDBERRIES: 'Wildberries', OZON: 'Ozon', YANDEX_MARKET: 'Яндекс', SBER_MARKET: 'Мегамаркет', OTHER: 'Другой' } as const)[value];
}

function shortCis(value: string) {
  return value.length > 31 ? `${value.slice(0, 21)}…${value.slice(-7)}` : value;
}

function metadataText(item: KizCirculationItem, key: string) {
  const value = item.metadata?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию с КИЗ.';
}
