import {
  Archive,
  ArrowRightLeft,
  BarChart3,
  History,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchTurnoverReport,
  fetchTurnoverStatistics,
  runTurnoverAction,
  type AuthSession,
  type ClientSummary,
  type TurnoverActionKind,
  type TurnoverReport,
  type TurnoverSkuReport,
  type TurnoverStatistics,
} from '../../lib/api';
import './turnover.css';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T;
  error?: string;
};

type ActiveTile = 'movement' | 'actions' | 'stats';

type ActionForm = {
  action: TurnoverActionKind;
  skuId: string;
  quantity: string;
  sourceBoxCode: string;
  targetBoxCode: string;
  reason: string;
  kiz: string;
  photoFileName: string;
  comment: string;
};

const emptyActionForm: ActionForm = {
  action: 'TRANSFER',
  skuId: '',
  quantity: '1',
  sourceBoxCode: '',
  targetBoxCode: '',
  reason: '',
  kiz: '',
  photoFileName: '',
  comment: '',
};

const actionOptions: Array<{ value: TurnoverActionKind; label: string; hint: string }> = [
  { value: 'ADD', label: 'Добавить такой же товар', hint: 'Увеличивает остаток выбранного SKU.' },
  { value: 'WRITE_OFF', label: 'Удалить / списать товар', hint: 'Снимает количество с остатка и оставляет историю.' },
  { value: 'TRANSFER', label: 'Перенести в другую ячейку', hint: 'Перемещает товар между коробами или ячейками.' },
  { value: 'UTILIZE', label: 'Утилизировать', hint: 'Списывает товар с причиной и КИЗ/фото при наличии.' },
  { value: 'HOLD', label: 'Отложить на отдельное хранение', hint: 'Переносит товар в отдельную ячейку со статусом отложено.' },
];

export function TurnoverPanel({ session }: { session: AuthSession }) {
  const [activeTile, setActiveTile] = useState<ActiveTile>('movement');
  const [clients, setClients] = useState<LoadState<ClientSummary[]>>({ status: 'idle', data: [] });
  const [report, setReport] = useState<LoadState<TurnoverReport | null>>({ status: 'idle', data: null });
  const [statistics, setStatistics] = useState<LoadState<TurnoverStatistics | null>>({ status: 'idle', data: null });
  const [selectedClientId, setSelectedClientId] = useState('');
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'quarter' | 'year'>('month');
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSubmittingAction, setSubmittingAction] = useState(false);

  const canSeeStatistics = useMemo(() => canUseStatistics(session.user.roleCodes, session.user.permissionCodes), [session.user]);
  const selectedReportItem = useMemo(() => {
    const items = report.data?.items ?? [];
    return items.find((item) => item.skuId === selectedSkuId) ?? items[0] ?? null;
  }, [report.data, selectedSkuId]);
  const sourceCells = selectedReportItem?.currentCells ?? [];
  const allCells = useMemo(() => uniqueValues((report.data?.items ?? []).flatMap((item) => item.currentCells.map((cell) => cell.boxCode))), [report.data]);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    void loadTurnover();
  }, [selectedClientId]);

  useEffect(() => {
    if (!report.data || report.data.items.length === 0) {
      setSelectedSkuId('');
      setActionForm((current) => ({ ...current, skuId: '' }));
      return;
    }

    const items = report.data.items;
    setSelectedSkuId((current) => (items.some((item) => item.skuId === current) ? current : items[0].skuId));
    setActionForm((current) => ({
      ...current,
      skuId: items.some((item) => item.skuId === current.skuId) ? current.skuId : items[0]?.skuId ?? '',
    }));
  }, [report.data]);

  async function loadClients() {
    setClients((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const loaded = await fetchClients(session.accessToken);
      setClients({ status: 'ready', data: loaded });
      setSelectedClientId((current) => current || loaded[0]?.id || '');
      if (!loaded[0]) {
        setReport({ status: 'ready', data: null });
      }
    } catch (caught) {
      setClients({ status: 'error', data: [], error: errorMessage(caught) });
    }
  }

  async function loadTurnover() {
    if (!selectedClientId) {
      return;
    }

    setReport((current) => ({ ...current, status: 'loading', error: undefined }));
    setStatistics((current) => ({ ...current, status: canSeeStatistics ? 'loading' : 'idle', error: undefined }));
    setActionMessage('');
    setActionError('');

    const filter = {
      clientId: selectedClientId,
      search: search.trim() || undefined,
      barcode: barcode.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      groupBy,
      limit: 80,
    };

    try {
      const [nextReport, nextStatistics] = await Promise.all([
        fetchTurnoverReport(session.accessToken, filter),
        canSeeStatistics ? fetchTurnoverStatistics(session.accessToken, filter) : Promise.resolve(null),
      ]);
      setReport({ status: 'ready', data: nextReport });
      setStatistics({ status: nextStatistics ? 'ready' : 'idle', data: nextStatistics });
    } catch (caught) {
      const message = errorMessage(caught);
      setReport((current) => ({ ...current, status: 'error', error: message }));
      setStatistics((current) => ({ ...current, status: 'error', error: message }));
    }
  }

  function updateActionForm<K extends keyof ActionForm>(key: K, value: ActionForm[K]) {
    setActionForm((current) => ({ ...current, [key]: value }));
    setActionMessage('');
    setActionError('');
  }

  async function submitAction() {
    if (!selectedClientId || !actionForm.skuId) {
      return;
    }

    const quantity = Number(actionForm.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setActionError('Укажите количество целым числом больше нуля.');
      return;
    }

    setSubmittingAction(true);
    setActionMessage('');
    setActionError('');

    try {
      const result = await runTurnoverAction(session.accessToken, {
        clientId: selectedClientId,
        skuId: actionForm.skuId,
        action: actionForm.action,
        quantity,
        sourceBoxCode: actionForm.sourceBoxCode.trim() || undefined,
        targetBoxCode: actionForm.targetBoxCode.trim() || undefined,
        reason: actionForm.reason.trim() || undefined,
        kiz: actionForm.kiz.trim() || undefined,
        photoFileName: actionForm.photoFileName.trim() || undefined,
        comment: actionForm.comment.trim() || undefined,
        idempotencyKey: buildActionKey(actionForm.action, actionForm.skuId),
      });
      setActionMessage(result.status === 'ALREADY_APPLIED' ? 'Операция уже была проведена.' : 'Операция проведена и записана в историю.');
      await loadTurnover();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setSubmittingAction(false);
    }
  }

  const totals = report.data?.totals;
  const selectedClient = clients.data.find((client) => client.id === selectedClientId) ?? null;

  return (
    <div className="turnover-workspace">
      <section className="turnover-panel turnover-panel--filters" aria-label="Фильтр товарооборота">
        <div className="turnover-filter-grid">
          <label>
            <span>Клиент</span>
            <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
              {clients.data.length === 0 ? <option value="">Клиенты не найдены</option> : null}
              {clients.data.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Поиск по товару</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, SKU, артикул" />
          </label>

          <label>
            <span>Штрихкод</span>
            <input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="ШК товара" />
          </label>

          <label>
            <span>Период с</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>

          <label>
            <span>Период по</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>

          <button className="primary-button" type="button" onClick={() => void loadTurnover()} disabled={!selectedClientId || report.status === 'loading'}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Показать</span>
          </button>
        </div>

        {clients.error ? <p className="form-error">{clients.error}</p> : null}
        {report.error ? <p className="form-error">{report.error}</p> : null}
      </section>

      <section className="turnover-tiles" aria-label="Разделы товарооборота">
        <TurnoverTile
          active={activeTile === 'movement'}
          icon={<History size={22} aria-hidden="true" />}
          title="Товаро-движение"
          text="Приемка, ячейки, КИЗ, перемещения, заявки и списание."
          value={totals ? `${formatNumber(totals.currentQuantity)} шт` : '0 шт'}
          onClick={() => setActiveTile('movement')}
        />
        <TurnoverTile
          active={activeTile === 'actions'}
          icon={<ArrowRightLeft size={22} aria-hidden="true" />}
          title="Действия с товарами"
          text="Добавить, списать, перенести, утилизировать или отложить."
          value={selectedClient?.name ?? 'Клиент'}
          onClick={() => setActiveTile('actions')}
        />
        <TurnoverTile
          active={activeTile === 'stats'}
          icon={<BarChart3 size={22} aria-hidden="true" />}
          title="Статистика"
          text="Приход, отгрузка и тенденции по дням, месяцам, кварталам."
          value={canSeeStatistics ? 'Доступно' : 'Только ФФ'}
          onClick={() => setActiveTile('stats')}
        />
      </section>

      {report.status === 'loading' ? <p className="inline-status">Загружаю товарооборот.</p> : null}

      {activeTile === 'movement' ? <MovementSection items={report.data?.items ?? []} selectedSkuId={selectedReportItem?.skuId ?? ''} onSelect={setSelectedSkuId} /> : null}
      {activeTile === 'actions' ? (
        <ActionsSection
          form={actionForm}
          items={report.data?.items ?? []}
          sourceCells={sourceCells}
          allCells={allCells}
          isSubmitting={isSubmittingAction}
          message={actionMessage}
          error={actionError}
          onChange={updateActionForm}
          onSubmit={() => void submitAction()}
        />
      ) : null}
      {activeTile === 'stats' ? (
        <StatisticsSection
          canSee={canSeeStatistics}
          statistics={statistics.data}
          groupBy={groupBy}
          onGroupBy={(value) => setGroupBy(value)}
          onReload={() => void loadTurnover()}
        />
      ) : null}
    </div>
  );
}

function TurnoverTile({
  active,
  icon,
  title,
  text,
  value,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  text: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button className={`turnover-tile ${active ? 'is-active' : ''}`} type="button" onClick={onClick}>
      <span className="turnover-tile__icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <em>{value}</em>
    </button>
  );
}

function MovementSection({ items, selectedSkuId, onSelect }: { items: TurnoverSkuReport[]; selectedSkuId: string; onSelect: (skuId: string) => void }) {
  const selected = items.find((item) => item.skuId === selectedSkuId) ?? items[0] ?? null;

  if (items.length === 0) {
    return (
      <section className="turnover-panel">
        <p className="turnover-empty">По фильтру пока нет движения товаров.</p>
      </section>
    );
  }

  return (
    <section className="turnover-panel turnover-movement" aria-label="Товаро-движение">
      <div className="turnover-two-columns">
        <div className="turnover-table-wrap">
          <table className="turnover-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>ШК</th>
                <th>Остаток</th>
                <th>Принято</th>
                <th>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr className={item.skuId === selected?.skuId ? 'is-active' : ''} key={item.skuId} onClick={() => onSelect(item.skuId)}>
                  <td>
                    <strong>{item.name}</strong>
                    <span>{item.internalSku}</span>
                  </td>
                  <td>{item.primaryBarcode ?? 'нет'}</td>
                  <td>{formatNumber(item.currentQuantity)}</td>
                  <td>{formatNumber(item.receivedQuantity)}</td>
                  <td>{formatNumber(item.shippedQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? <MovementDetails item={selected} /> : null}
      </div>
    </section>
  );
}

function MovementDetails({ item }: { item: TurnoverSkuReport }) {
  return (
    <div className="turnover-details">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Карточка движения</p>
          <h3>{item.name}</h3>
        </div>
        <span>{item.primaryBarcode ?? item.internalSku}</span>
      </div>

      <div className="turnover-metrics">
        <Metric label="Первый приход" value={formatDate(item.firstReceiptAt)} />
        <Metric label="Первая ячейка" value={item.firstCell ?? 'не указана'} />
        <Metric label="Дней хранения" value={String(item.storageDays)} />
        <Metric label="КИЗ" value={String(item.kiz.length)} />
      </div>

      <div className="turnover-cells">
        {item.currentCells.length === 0 ? <span>На складе сейчас нет остатка.</span> : null}
        {item.currentCells.map((cell) => (
          <span key={`${cell.boxCode}-${cell.status}`}>
            {cell.boxCode}: <strong>{formatNumber(cell.quantity)} шт</strong> · {cell.status}
          </span>
        ))}
      </div>

      <div className="turnover-table-wrap turnover-table-wrap--compact">
        <table className="turnover-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Действие</th>
              <th>Кол-во</th>
              <th>Ячейка</th>
              <th>Документ</th>
            </tr>
          </thead>
          <tbody>
            {item.movements.map((movement) => (
              <tr key={movement.id}>
                <td>{formatDateTime(movement.date)}</td>
                <td>
                  <strong>{movement.typeLabel}</strong>
                  <span>{movement.comment || movement.statusLabel}</span>
                </td>
                <td className={movement.quantity < 0 ? 'is-negative' : 'is-positive'}>{formatNumber(movement.quantity)}</td>
                <td>{movement.boxCode ?? 'без ячейки'}</td>
                <td>{movement.request ? `${movement.request.title}${movement.request.destinationCity ? `, ${movement.request.destinationCity}` : ''}` : movement.sourceDocument ?? 'нет'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionsSection({
  form,
  items,
  sourceCells,
  allCells,
  isSubmitting,
  message,
  error,
  onChange,
  onSubmit,
}: {
  form: ActionForm;
  items: TurnoverSkuReport[];
  sourceCells: TurnoverSkuReport['currentCells'];
  allCells: string[];
  isSubmitting: boolean;
  message: string;
  error: string;
  onChange: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
  onSubmit: () => void;
}) {
  const selectedAction = actionOptions.find((item) => item.value === form.action) ?? actionOptions[0];
  const needsSource = form.action !== 'ADD';
  const needsTarget = form.action === 'ADD' || form.action === 'TRANSFER' || form.action === 'HOLD';
  const needsReason = form.action === 'WRITE_OFF' || form.action === 'UTILIZE' || form.action === 'HOLD';

  return (
    <section className="turnover-panel turnover-actions-panel" aria-label="Действия с товарами">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Ручная операция</p>
          <h3>Действия с товарами</h3>
        </div>
        <PackagePlus size={22} aria-hidden="true" />
      </div>

      <div className="turnover-action-grid">
        <label>
          <span>Действие</span>
          <select value={form.action} onChange={(event) => onChange('action', event.target.value as TurnoverActionKind)}>
            {actionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>{selectedAction.hint}</small>
        </label>

        <label>
          <span>Товар</span>
          <select value={form.skuId} onChange={(event) => onChange('skuId', event.target.value)}>
            {items.length === 0 ? <option value="">Нет товаров по фильтру</option> : null}
            {items.map((item) => (
              <option key={item.skuId} value={item.skuId}>
                {item.name} · {item.primaryBarcode ?? item.internalSku} · остаток {item.currentQuantity}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Количество</span>
          <input min="1" type="number" value={form.quantity} onChange={(event) => onChange('quantity', event.target.value)} />
        </label>

        {needsSource ? (
          <label>
            <span>Откуда</span>
            <input
              list="turnover-source-cells"
              value={form.sourceBoxCode}
              onChange={(event) => onChange('sourceBoxCode', event.target.value)}
              placeholder="Можно оставить пустым"
            />
            <datalist id="turnover-source-cells">
              {sourceCells.map((cell) => (
                <option key={`${cell.boxCode}-${cell.status}`} value={cell.boxCode}>
                  {cell.quantity} шт · {cell.status}
                </option>
              ))}
            </datalist>
          </label>
        ) : null}

        {needsTarget ? (
          <label>
            <span>Куда</span>
            <input
              list="turnover-target-cells"
              value={form.targetBoxCode}
              onChange={(event) => onChange('targetBoxCode', event.target.value)}
              placeholder="Новая или существующая ячейка"
            />
            <datalist id="turnover-target-cells">
              {allCells.map((cell) => (
                <option key={cell} value={cell} />
              ))}
            </datalist>
          </label>
        ) : null}

        {needsReason ? (
          <label>
            <span>Причина</span>
            <input value={form.reason} onChange={(event) => onChange('reason', event.target.value)} placeholder="Коротко, что случилось" />
          </label>
        ) : null}
      </div>

      <div className="turnover-action-grid turnover-action-grid--wide">
        <label>
          <span>КИЗ</span>
          <textarea value={form.kiz} onChange={(event) => onChange('kiz', event.target.value)} placeholder="Можно несколько: через запятую или с новой строки" />
        </label>

        <label>
          <span>Фото / файл</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => onChange('photoFileName', event.target.files?.[0]?.name ?? '')}
          />
          <small>{form.photoFileName || 'Файл не выбран. В историю попадет имя файла.'}</small>
        </label>

        <label>
          <span>Комментарий</span>
          <textarea value={form.comment} onChange={(event) => onChange('comment', event.target.value)} placeholder="Дополнительная информация" />
        </label>
      </div>

      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="turnover-actions">
        <button className="primary-button" type="button" onClick={onSubmit} disabled={isSubmitting || !form.skuId}>
          {form.action === 'WRITE_OFF' || form.action === 'UTILIZE' ? <Trash2 size={16} aria-hidden="true" /> : <ArrowRightLeft size={16} aria-hidden="true" />}
          <span>{isSubmitting ? 'Провожу' : 'Провести операцию'}</span>
        </button>
      </div>
    </section>
  );
}

function StatisticsSection({
  canSee,
  statistics,
  groupBy,
  onGroupBy,
  onReload,
}: {
  canSee: boolean;
  statistics: TurnoverStatistics | null;
  groupBy: 'day' | 'month' | 'quarter' | 'year';
  onGroupBy: (value: 'day' | 'month' | 'quarter' | 'year') => void;
  onReload: () => void;
}) {
  if (!canSee) {
    return (
      <section className="turnover-panel turnover-empty-panel">
        <Archive size={26} aria-hidden="true" />
        <div>
          <h3>Статистика скрыта</h3>
          <p>По умолчанию этот блок видят только владелец, администратор и менеджер.</p>
        </div>
      </section>
    );
  }

  if (!statistics) {
    return (
      <section className="turnover-panel">
        <p className="turnover-empty">Нажмите “Показать”, чтобы построить статистику.</p>
      </section>
    );
  }

  return (
    <section className="turnover-panel turnover-stats" aria-label="Статистика товарооборота">
      <div className="turnover-stats__toolbar">
        <div>
          <p className="eyebrow">Статистика</p>
          <h3>Приход и отгрузка по штрихкодам</h3>
        </div>
        <label>
          <span>Группировать</span>
          <select
            value={groupBy}
            onChange={(event) => {
              onGroupBy(event.target.value as 'day' | 'month' | 'quarter' | 'year');
              window.setTimeout(onReload, 0);
            }}
          >
            <option value="day">По дням</option>
            <option value="month">По месяцам</option>
            <option value="quarter">По кварталам</option>
            <option value="year">По годам</option>
          </select>
        </label>
      </div>

      <div className="turnover-metrics">
        <Metric label="Приехало" value={`${formatNumber(statistics.totals.receivedQuantity)} шт`} />
        <Metric label="Отгружено" value={`${formatNumber(statistics.totals.shippedQuantity)} шт`} />
        <Metric label="Списано" value={`${formatNumber(statistics.totals.writtenOffQuantity)} шт`} />
        <Metric label="Остаток" value={`${formatNumber(statistics.totals.currentQuantity)} шт`} />
      </div>

      <div className="turnover-two-columns">
        <div className="turnover-table-wrap">
          <table className="turnover-table">
            <thead>
              <tr>
                <th>Период</th>
                <th>Приход</th>
                <th>Отгрузка</th>
                <th>Списано</th>
              </tr>
            </thead>
            <tbody>
              {statistics.trend.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  <td>{formatNumber(row.receivedQuantity)}</td>
                  <td>{formatNumber(row.shippedQuantity)}</td>
                  <td>{formatNumber(row.writtenOffQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="turnover-table-wrap">
          <table className="turnover-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>ШК</th>
                <th>Приехало</th>
                <th>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {statistics.rows.map((row) => (
                <tr key={row.skuId}>
                  <td>
                    <strong>{row.name}</strong>
                    <span>{row.article ?? row.internalSku}</span>
                  </td>
                  <td>{row.primaryBarcode ?? 'нет'}</td>
                  <td>{formatNumber(row.receivedQuantity)}</td>
                  <td>{formatNumber(row.shippedQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="turnover-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function canUseStatistics(roleCodes: string[], permissionCodes: string[]) {
  return permissionCodes.includes('system:admin') || roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'нет';
  }

  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return 'нет';
  }

  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function buildActionKey(action: string, skuId: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  return `web-turnover:${action}:${skuId}:${suffix}`;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию товарооборота.';
}
