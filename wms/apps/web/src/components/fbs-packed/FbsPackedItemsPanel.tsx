import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardCopy,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Warehouse,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchFbsPackedItems,
  reconcileFbsPackedItems,
  type AuthSession,
  type ClientSummary,
  type FbsPackedItem,
  type FbsPackedItemsReport,
} from '../../lib/api';
import './fbs-packed.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';

type Props = { session: AuthSession };

const CLIENT_STORAGE_KEY = 'wms:fbs-packed-items:client';

export function FbsPackedItemsPanel({ session }: Props) {
  const initialPeriod = useMemo(() => packedPeriod(), []);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState(() => localStorage.getItem(CLIENT_STORAGE_KEY) ?? '');
  const [marketplace, setMarketplace] = useState<'ALL' | 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET'>('ALL');
  const [dateFrom, setDateFrom] = useState(initialPeriod.from);
  const [dateTo, setDateTo] = useState(initialPeriod.to);
  const [search, setSearch] = useState('');
  const [requiresKiz, setRequiresKiz] = useState(false);
  const [report, setReport] = useState<FbsPackedItemsReport | null>(null);
  const [selected, setSelected] = useState<FbsPackedItem | null>(null);
  const [viewMode, setViewMode] = useState<'requests' | 'items'>('requests');
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchFbsPackedItems(session.accessToken, {
        clientId: clientId || undefined,
        marketplace,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
        requiresKiz,
        page,
        pageSize: 100,
      });
      setReport(next);
      if (selected) {
        setSelected(next.items.find((row) => row.id === selected.id) ?? selected);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить журнал упаковки ТСД.');
    } finally {
      setLoading(false);
    }
  }, [clientId, dateFrom, dateTo, marketplace, requiresKiz, search, selected, session.accessToken]);

  useEffect(() => {
    void fetchClients(session.accessToken)
      .then(setClients)
      .catch(() => setClients([]));
    void load(1);
    // Начальная загрузка выполняется один раз; остальные изменения применяются кнопкой формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.accessToken, session.user.activeWarehouseId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(1);
  }

  function changeClient(value: string) {
    setClientId(value);
    if (value) localStorage.setItem(CLIENT_STORAGE_KEY, value);
    else localStorage.removeItem(CLIENT_STORAGE_KEY);
  }

  const warningCount = report?.items.filter((row) =>
    Boolean(row.assembly.marketplaceSubmitError || row.assembly.errorMessage),
  ).length ?? 0;
  const withoutBoxCount = report?.items.filter((row) => !row.source.boxCode).length ?? 0;
  const stickerMismatchCount = report?.items.filter((row) => row.comparison?.status === 'STICKER_MISMATCH').length ?? 0;
  const requestGroups = useMemo(() => groupPackedItemsByRequest(report?.items ?? []), [report?.items]);
  const actualPackedUnits = report?.items.reduce((sum, row) => sum + Math.max(1, row.product.quantity), 0) ?? 0;

  async function reconcile() {
    if (!clientId) {
      setError('Для сверки с WB или Ozon сначала выберите клиента.');
      return;
    }
    if (!report?.items.length) return;
    setReconciling(true);
    setError('');
    try {
      const result = await reconcileFbsPackedItems(session.accessToken, {
        clientId,
        assemblyIds: report.items.map((row) => row.id),
      });
      const comparisons = new Map(result.items.map((row) => [row.id, row.comparison]));
      setReport((current) => current ? {
        ...current,
        items: current.items.map((row) => ({ ...row, comparison: comparisons.get(row.id) ?? row.comparison })),
      } : current);
      setSelected((current) => current ? { ...current, comparison: comparisons.get(current.id) ?? current.comparison } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить сверку с маркетплейсом.');
    } finally {
      setReconciling(false);
    }
  }

  async function copyDetails(row: FbsPackedItem) {
    const text = packedItemText(row);
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage('Данные скопированы');
      window.setTimeout(() => setCopyMessage(''), 1800);
    } catch {
      setCopyMessage('Не удалось скопировать');
    }
  }

  return (
    <WorkspaceTileGate
      eyebrow="Контроль ТСД"
      title="Упаковка FBS"
      description="Проверьте, что реально отсканировано на ТСД, сопоставьте с заказами и найдите неверно наклеенные стикеры."
      tiles={[
        { title: 'По заявкам', description: 'Свернутая проверка фактически упакованных товаров по каждой заявке.', icon: PackageCheck, tone: 'blue' },
        { title: 'Все сканы', description: 'Полный журнал каждого товара, короба, КИЗ и стикера.', icon: Search, tone: 'violet' },
        { title: 'Сверка WB / Ozon', description: 'Найти ошибки наклейки и расхождения с реальными заказами.', icon: ShieldCheck, tone: 'green' },
      ]}
    >
    <section className="packed-audit">
      <header className="packed-audit__hero">
        <div className="packed-audit__hero-icon"><PackageCheck size={26} /></div>
        <div>
          <span className="packed-audit__eyebrow">КОНТРОЛЬ ТСД</span>
          <h1>Упакованные товары FBS</h1>
          <p>Фактический журнал каждой единицы, собранной на ТСД. Нажмите строку, чтобы увидеть все связи.</p>
        </div>
        <div className="packed-audit__hero-actions">
          <button type="button" className="packed-audit__reconcile" onClick={() => void reconcile()} disabled={loading || reconciling || !report?.items.length} title={clientId ? 'Сверить текущую страницу с реальными заказами WB / Ozon' : 'Сначала выберите клиента'}>
            <ShieldCheck size={17} className={reconciling ? 'is-spinning' : undefined} />
            {reconciling ? 'Сверяю…' : 'Сверить с WB / Ozon'}
          </button>
          <button type="button" className="packed-audit__refresh" onClick={() => void load(report?.page ?? 1)} disabled={loading || reconciling}>
            <RefreshCw size={17} className={loading ? 'is-spinning' : undefined} />
            Обновить
          </button>
        </div>
      </header>

      <form className="packed-audit__filters" onSubmit={submit}>
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => changeClient(event.target.value)}>
            <option value="">Все доступные клиенты</option>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Маркетплейс</span>
          <select value={marketplace} onChange={(event) => setMarketplace(event.target.value as typeof marketplace)}>
            <option value="ALL">Все</option>
            <option value="WILDBERRIES">Wildberries</option>
            <option value="OZON">Ozon</option>
            <option value="YANDEX_MARKET">Яндекс Маркет</option>
          </select>
        </label>
        <label><span>С даты</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>По дату</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label className="packed-audit__search">
          <span>Быстрый поиск</span>
          <div><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="заказ, заявка, короб, КИЗ, стикер, палетсорт" /></div>
        </label>
        <label className="packed-audit__check">
          <input type="checkbox" checked={requiresKiz} onChange={(event) => setRequiresKiz(event.target.checked)} />
          <span>Только товары с КИЗ</span>
        </label>
        <button type="submit" className="packed-audit__apply" disabled={loading}>Показать</button>
      </form>

      <div className="packed-audit__stats">
        <AuditStat icon={PackageCheck} label="Реально отпикано, шт." value={actualPackedUnits} tone="blue" />
        <AuditStat icon={ShieldCheck} label="FBS-заявок с фактом" value={requestGroups.length} tone="green" />
        <AuditStat icon={Box} label="Без исходного короба" value={withoutBoxCount} tone={withoutBoxCount ? 'amber' : 'green'} />
        <AuditStat icon={AlertTriangle} label="Неверная наклейка" value={stickerMismatchCount || warningCount} tone={stickerMismatchCount || warningCount ? 'red' : 'green'} />
      </div>

      <div className="packed-audit__viewbar">
        <div>
          <b>Фактический результат ТСД</b>
          <span>Заявка раскрывается в список реально отсканированных товаров, размеров и коробов.</span>
        </div>
        <div className="packed-audit__view-switch" role="tablist" aria-label="Вид журнала упаковки">
          <button type="button" role="tab" aria-selected={viewMode === 'requests'} className={viewMode === 'requests' ? 'is-active' : ''} onClick={() => setViewMode('requests')}>По заявкам</button>
          <button type="button" role="tab" aria-selected={viewMode === 'items'} className={viewMode === 'items' ? 'is-active' : ''} onClick={() => setViewMode('items')}>Все сканы</button>
        </div>
      </div>

      {error ? <div className="packed-audit__error"><AlertTriangle size={18} />{error}</div> : null}

      {viewMode === 'requests' ? (
        <div className="packed-audit__requests" aria-busy={loading}>
          {loading && !report ? <div className="packed-audit__empty">Загружаю фактические сканы ТСД…</div> : null}
          {!loading && requestGroups.length === 0 ? <div className="packed-audit__empty">За выбранный период в ТСД ещё не подтверждено ни одного товара.</div> : null}
          {requestGroups.map((group) => <PackedRequestCard key={group.id} group={group} expanded={expandedRequest === group.id} onToggle={() => setExpandedRequest((current) => current === group.id ? null : group.id)} onItemOpen={setSelected} />)}
        </div>
      ) : (
      <div className="packed-audit__table" aria-busy={loading}>
        <div className="packed-audit__table-head">
          <span>Время / ТСД</span><span>Заявка / заказ</span><span>Товар</span><span>Хранение / короб упаковки</span><span>Стикер / КИЗ</span><span>Склад / сотрудник</span>
        </div>
        {loading && !report ? <div className="packed-audit__empty">Загружаю журнал…</div> : null}
        {!loading && report?.items.length === 0 ? <div className="packed-audit__empty">За выбранный период упакованных товаров не найдено.</div> : null}
        {report?.items.map((row) => (
          <button type="button" className={`packed-audit__row${row.comparison?.status === 'STICKER_MISMATCH' ? ' is-sticker-mismatch' : row.comparison && row.comparison.status !== 'MATCHED' ? ' is-comparison-issue' : ''}`} key={row.id} onClick={() => setSelected(row)}>
            <span className="packed-audit__time">
              <b>{formatDateTime(row.assembly.completedAt)}</b>
              <small>{row.assembly.deviceCode}</small>
              <MarketplaceBadge marketplace={row.marketplace} />
            </span>
            <span>
              <b>№{row.request?.number ?? '—'}</b>
              <small className="packed-audit__mono">{row.orderId}</small>
              <small>{row.supplyId || 'Без поставки'}</small>
            </span>
            <span className="packed-audit__product">
              <b>{row.product.name || 'Товар без названия'}{row.product.size ? ` · ${row.product.size}` : ''}</b>
              <small>{row.product.article || row.product.internalSku || 'Без артикула'}</small>
              <small>ШК: {row.product.barcode || '—'} · {row.product.quantity} шт.</small>
            </span>
            <span>
              <b>{row.source.boxCode || 'Без короба'}</b>
              <small>Палетсорт: {row.source.palletSort?.code || '—'}</small>
              <small>Зона: {row.source.zone?.name || row.source.zone?.code || '—'}</small>
              <small className={row.cargoPlace ? 'packed-audit__packing-box' : 'packed-audit__packing-box is-empty'}>Короб упаковки: {row.cargoPlace?.id || 'ещё не указан'}</small>
            </span>
            <span>
              <b>{row.sticker.partB || row.sticker.barcode || 'Стикер не записан'}</b>
              <small className="packed-audit__mono">КИЗ: {shortCode(row.product.kiz)}</small>
              {row.comparison?.status === 'STICKER_MISMATCH' ? <em className="packed-audit__sticker-error">Наклейка другого заказа</em> : null}
              {row.relabeling ? <small className="packed-audit__relabel">Переклейка: {row.relabeling.sourceArticle || row.relabeling.sourceInternalSku}</small> : null}
            </span>
            <span>
              <b>{row.marketplaceWarehouse.name || row.executionWarehouse?.name || 'Склад не указан'}</b>
              <small>{row.client?.name || 'Клиент не найден'}</small>
              <small>{row.assembly.workerName || 'Сотрудник не записан'}</small>
              {(row.assembly.marketplaceSubmitError || row.assembly.errorMessage)
                ? <em className="packed-audit__problem">Есть сообщение об ошибке</em>
                : row.comparison?.status === 'MATCHED'
                  ? <em className="packed-audit__ok"><CheckCircle2 size={13} /> Сверено</em>
                : <em className="packed-audit__ok"><CheckCircle2 size={13} /> Собрано</em>}
            </span>
          </button>
        ))}
      </div>
      )}

      {report && report.pages > 1 ? (
        <div className="packed-audit__pager">
          <button type="button" disabled={loading || report.page <= 1} onClick={() => void load(report.page - 1)}>Назад</button>
          <span>Страница {report.page} из {report.pages} · всего {report.total}</span>
          <button type="button" disabled={loading || report.page >= report.pages} onClick={() => void load(report.page + 1)}>Дальше</button>
        </div>
      ) : null}

      {selected ? (
        <div className="packed-audit__backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <aside className="packed-audit__drawer" role="dialog" aria-modal="true" aria-label="Карточка упакованного товара">
            <header>
              <div><span>УПАКОВАННАЯ ЕДИНИЦА</span><h2>{selected.product.name || 'Товар'}</h2></div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Закрыть"><X size={20} /></button>
            </header>
            <div className="packed-audit__drawer-actions">
              <button type="button" onClick={() => void copyDetails(selected)}><ClipboardCopy size={16} /> Скопировать всё</button>
              {copyMessage ? <small>{copyMessage}</small> : null}
            </div>
            <AuditDetails row={selected} />
          </aside>
        </div>
      ) : null}
    </section>
    </WorkspaceTileGate>
  );
}

function AuditStat({ icon: Icon, label, value, tone }: { icon: typeof PackageCheck; label: string; value: number; tone: string }) {
  return <article className={`packed-audit__stat is-${tone}`}><Icon size={19} /><span><b>{value.toLocaleString('ru-RU')}</b><small>{label}</small></span></article>;
}

function MarketplaceBadge({ marketplace }: { marketplace: FbsPackedItem['marketplace'] }) {
  const label = marketplace === 'WILDBERRIES' ? 'WB' : marketplace === 'OZON' ? 'OZON' : 'YM';
  return <em className={`packed-audit__market is-${marketplace.toLowerCase()}`}>{label}</em>;
}

type PackedRequestGroup = {
  id: string;
  request: FbsPackedItem['request'];
  items: FbsPackedItem[];
  actualUnits: number;
  orderCount: number;
  productCount: number;
  completedAt: string | null;
  warehouseName: string | null;
  clientName: string | null;
  packingBoxes: string[];
  products: Array<{ key: string; label: string; quantity: number }>;
};

function groupPackedItemsByRequest(items: FbsPackedItem[]): PackedRequestGroup[] {
  const groups = new Map<string, FbsPackedItem[]>();
  for (const item of items) {
    const key = item.request?.id ?? `unlinked:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([id, rows]) => {
    const products = new Map<string, { key: string; label: string; quantity: number }>();
    for (const row of rows) {
      const label = [row.product.name || 'Товар без названия', row.product.size].filter(Boolean).join(' · ');
      const key = [row.product.skuId, row.product.barcode || '', label].join('|');
      const current = products.get(key) ?? { key, label, quantity: 0 };
      current.quantity += Math.max(1, row.product.quantity);
      products.set(key, current);
    }
    return {
      id,
      request: rows[0].request,
      items: rows,
      actualUnits: rows.reduce((sum, row) => sum + Math.max(1, row.product.quantity), 0),
      orderCount: new Set(rows.map((row) => row.orderId)).size,
      productCount: products.size,
      completedAt: rows.reduce<string | null>((latest, row) => !latest || (row.assembly.completedAt && row.assembly.completedAt > latest) ? row.assembly.completedAt : latest, null),
      warehouseName: rows[0].marketplaceWarehouse.name || rows[0].executionWarehouse?.name || null,
      clientName: rows[0].client?.name || null,
      packingBoxes: [...new Set(rows.map((row) => row.cargoPlace?.id).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'ru')),
      products: [...products.values()].sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, 'ru')),
    };
  }).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
}

function PackedRequestCard({
  group,
  expanded,
  onToggle,
  onItemOpen,
}: {
  group: PackedRequestGroup;
  expanded: boolean;
  onToggle: () => void;
  onItemOpen: (row: FbsPackedItem) => void;
}) {
  const requestLabel = group.request ? `Заявка №${group.request.number}` : 'Заявка не определена';
  return <article className={`packed-request${expanded ? ' is-expanded' : ''}`}>
    <button type="button" className="packed-request__summary" onClick={onToggle} aria-expanded={expanded}>
      <span className="packed-request__identity">
        <small>ФАКТ ТСД</small>
        <b>{requestLabel}</b>
        <em>{group.clientName || 'Клиент не указан'} · {group.warehouseName || 'Склад не указан'}</em>
      </span>
      <span className="packed-request__metrics">
        <strong>{group.actualUnits} <small>шт.</small></strong><em>реально отпикано</em>
      </span>
      <span className="packed-request__metrics"><strong>{group.orderCount}</strong><em>заказов</em></span>
      <span className="packed-request__metrics"><strong>{group.productCount}</strong><em>товарных поз.</em></span>
      <span className={`packed-request__metrics packed-request__box-metric${group.packingBoxes.length === 0 ? ' is-empty' : ''}`}>
        <strong>{group.packingBoxes.length}</strong>
        <em>{group.packingBoxes.length > 0 ? 'коробов FFL_FBS' : 'ещё не упаковано'}</em>
      </span>
      <span className="packed-request__updated">{formatDateTime(group.completedAt)}<i>{expanded ? 'Свернуть' : 'Показать товары'}</i></span>
    </button>
    {expanded ? <div className="packed-request__body">
      <div className="packed-request__products">
        {group.products.map((product) => <span key={product.key}><b>{product.quantity} шт.</b>{product.label}</span>)}
      </div>
      <div className="packed-request__items">
        {group.items.map((row) => <button type="button" key={row.id} onClick={() => onItemOpen(row)}>
          <span><b>{row.product.name || 'Товар'}</b><small>{row.product.size ? `Размер: ${row.product.size}` : 'Размер не указан'} · ШК: {row.product.barcode || '—'}</small></span>
          <span><b>{row.product.quantity} шт.</b><small>факт ТСД</small></span>
          <span><small className="packed-request__column-label">Откуда взят</small><b>{row.source.boxCode || 'Без короба хранения'}</b><small>{row.source.palletSort?.code || 'Без паллетсорта'} · {row.source.zone?.name || row.source.zone?.code || 'Без зоны'}</small></span>
          <span className={`packed-request__packing${row.cargoPlace ? '' : ' is-empty'}`}>
            <small className="packed-request__column-label">Короб упаковки</small>
            <b>{row.cargoPlace?.id || 'Ещё не упакован'}</b>
            <small>{row.cargoPlace?.status === 'CLOSED' ? 'короб закрыт' : row.cargoPlace ? 'короб открыт' : 'FFL_FBS-короб не указан'}</small>
          </span>
          <span><b>{row.orderId}</b><small>заказ · {row.sticker.partB || row.sticker.barcode || 'стикер не записан'}</small></span>
        </button>)}
      </div>
    </div> : null}
  </article>;
}

function AuditDetails({ row }: { row: FbsPackedItem }) {
  return (
    <div className="packed-audit__details">
      <DetailSection title="Заказ и клиент" icon={PackageCheck}>
        <Detail label="Клиент" value={row.client ? `${row.client.code} · ${row.client.name}` : null} />
        <Detail label="Заявка WMS" value={row.request ? `№${row.request.number} · ${row.request.title}` : null} />
        <Detail label="Заказ" value={row.orderId} mono />
        <Detail label="Поставка" value={row.supplyId} mono />
        <Detail label="Аккаунт" value={row.accountName} />
      </DetailSection>
      <DetailSection title="Товар" icon={ShieldCheck}>
        <Detail label="Название" value={row.product.name} />
        <Detail label="Артикул / SKU" value={[row.product.article, row.product.internalSku, row.product.clientSku].filter(Boolean).join(' · ')} />
        <Detail label="Цвет / размер" value={[row.product.color, row.product.size].filter(Boolean).join(' · ')} />
        <Detail label="Штрихкод товара" value={row.product.barcode} mono />
        <Detail label="КИЗ" value={row.product.kiz} mono wide />
        <Detail label="Количество" value={`${row.product.quantity} шт.`} />
      </DetailSection>
      {row.relabeling ? <DetailSection title="Переклейка" icon={RefreshCw}>
        <Detail label="Исходный товар" value={row.relabeling.sourceProductName} />
        <Detail label="Исходный артикул / SKU" value={[row.relabeling.sourceArticle, row.relabeling.sourceInternalSku].filter(Boolean).join(' · ')} />
        <Detail label="Исходный ШК" value={row.relabeling.sourceBarcode} mono />
      </DetailSection> : null}
      <DetailSection title="Источник на складе" icon={Box}>
        <Detail label="Короб" value={row.source.boxCode} mono />
        <Detail label="Статус короба" value={row.source.boxStatus} />
        <Detail label="Палетсорт" value={row.source.palletSort?.code} mono />
        <Detail label="Зона" value={row.source.zone ? `${row.source.zone.code} · ${row.source.zone.name}` : null} />
        <Detail label="Фактический склад" value={row.executionWarehouse ? `${row.executionWarehouse.city} · ${row.executionWarehouse.name}` : null} />
      </DetailSection>
      <DetailSection title="Стикер маркетплейса" icon={Warehouse}>
        <Detail label="Склад маркетплейса" value={[row.marketplaceWarehouse.name, row.marketplaceWarehouse.id].filter(Boolean).join(' · ')} />
        <Detail label="Стикер, часть A" value={row.sticker.partA} mono />
        <Detail label="Стикер, часть B" value={row.sticker.partB} mono />
        <Detail label="ШК стикера" value={row.sticker.barcode} mono wide />
        <Detail label="Грузоместо" value={row.cargoPlace ? `${row.cargoPlace.id}${row.cargoPlace.barcode ? ` · ${row.cargoPlace.barcode}` : ''}` : null} mono />
        <Detail label="Короб упаковки" value={row.cargoPlace?.id} mono />
      </DetailSection>
      {row.comparison ? <DetailSection title="Сверка с реальным заказом" icon={ShieldCheck}>
        <Detail label="Результат" value={comparisonLabel(row.comparison.status)} danger={row.comparison.status !== 'MATCHED'} />
        <Detail label="Статус на маркетплейсе" value={row.comparison.order?.statusLabel} />
        <Detail label="Текущая поставка" value={row.comparison.order?.supplyId} mono />
        <Detail label="Наклеен стикер" value={stickerReference(row.comparison.actualSticker)} mono wide danger={row.comparison.status === 'STICKER_MISMATCH'} />
        <Detail label="Должен быть стикер" value={stickerReference(row.comparison.expectedSticker)} mono wide danger={row.comparison.status === 'STICKER_MISMATCH'} />
        <Detail label="Найденные расхождения" value={row.comparison.issues.join(' ')} wide danger={row.comparison.issues.length > 0} />
      </DetailSection> : null}
      <DetailSection title="Кто и когда" icon={PackageCheck}>
        <Detail label="Сотрудник" value={row.assembly.workerName} />
        <Detail label="ТСД" value={row.assembly.deviceCode} mono />
        <Detail label="Собрано" value={formatDateTime(row.assembly.completedAt)} />
        <Detail label="Упаковано в грузоместо" value={formatDateTime(row.assembly.cargoPackedAt)} />
        <Detail label="Передано маркетплейсу" value={formatDateTime(row.assembly.marketplaceSubmittedAt)} />
        <Detail label="Статус метаданных" value={row.assembly.wbMetaStatus} />
        <Detail label="Ошибка передачи" value={row.assembly.marketplaceSubmitError} wide danger />
        <Detail label="Системное сообщение" value={row.assembly.errorMessage} wide danger />
      </DetailSection>
    </div>
  );
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof PackageCheck; children: React.ReactNode }) {
  return <section className="packed-audit__detail-section"><h3><Icon size={17} />{title}</h3><dl>{children}</dl></section>;
}

function Detail({ label, value, mono, wide, danger }: { label: string; value?: string | null; mono?: boolean; wide?: boolean; danger?: boolean }) {
  return <div className={`${wide ? 'is-wide ' : ''}${danger && value ? 'is-danger' : ''}`}><dt>{label}</dt><dd className={mono ? 'packed-audit__mono' : undefined}>{value || '—'}</dd></div>;
}

function packedPeriod() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: localIsoDate(from), to: localIsoDate(to) };
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

function shortCode(value: string | null) {
  if (!value) return '—';
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function stickerReference(value: { partA: string | null; partB: string | null; barcode: string | null } | null) {
  if (!value) return null;
  return value.partB || value.barcode || value.partA || null;
}

function comparisonLabel(status: NonNullable<FbsPackedItem['comparison']>['status']) {
  const labels = {
    MATCHED: 'Заказ, товар и наклейка совпадают',
    STICKER_MISMATCH: 'Наклейка относится к другому заказу',
    ORDER_CANCELLED: 'Заказ отменён',
    ORDER_NOT_FOUND: 'Заказ не найден в актуальном списке',
    ISSUES: 'Нужна проверка',
    CHECK_ERROR: 'Не удалось запросить маркетплейс',
    NOT_AVAILABLE: 'Запись упаковки недоступна',
  } as const;
  return labels[status];
}

function packedItemText(row: FbsPackedItem) {
  return [
    `Клиент: ${row.client ? `${row.client.code} · ${row.client.name}` : '—'}`,
    `Заявка: №${row.request?.number ?? '—'}`,
    `Заказ: ${row.orderId}`,
    `Поставка: ${row.supplyId ?? '—'}`,
    `Товар: ${row.product.name ?? '—'} · ${row.product.size ?? '—'}`,
    `Артикул: ${row.product.article ?? row.product.internalSku ?? '—'}`,
    `ШК товара: ${row.product.barcode ?? '—'}`,
    `КИЗ: ${row.product.kiz ?? '—'}`,
    `Короб хранения: ${row.source.boxCode ?? '—'}`,
    `Короб упаковки: ${row.cargoPlace?.id ?? 'ещё не упакован'}`,
    `Палетсорт: ${row.source.palletSort?.code ?? '—'}`,
    `Зона: ${row.source.zone?.name ?? row.source.zone?.code ?? '—'}`,
    `Склад: ${row.marketplaceWarehouse.name ?? row.executionWarehouse?.name ?? '—'}`,
    `Стикер: ${row.sticker.partB ?? row.sticker.barcode ?? '—'}`,
    `ТСД: ${row.assembly.deviceCode}`,
    `Сотрудник: ${row.assembly.workerName ?? '—'}`,
    `Собрано: ${formatDateTime(row.assembly.completedAt)}`,
    `Ошибка: ${row.assembly.marketplaceSubmitError ?? row.assembly.errorMessage ?? 'нет'}`,
  ].join('\n');
}
