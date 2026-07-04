import {
  Archive,
  ArrowRightLeft,
  BarChart3,
  Download,
  History,
  PackagePlus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  downloadTurnoverMovementDocumentXlsx,
  fetchClients,
  fetchTurnoverMovementDocument,
  fetchTurnoverReport,
  fetchTurnoverStatistics,
  fetchTurnoverSuggestions,
  runTurnoverAction,
  type AuthSession,
  type ClientSummary,
  type TurnoverActionKind,
  type TurnoverMovementDocument,
  type TurnoverReport,
  type TurnoverSkuReport,
  type TurnoverStatistics,
  type TurnoverSuggestions,
} from '../../lib/api';
import { KnownValueInput, type KnownValueOption } from '../common/KnownValueInput';
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
  skuText: string;
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
  skuText: '',
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

const MOVEMENT_PAGE_SIZE = 50;

export function TurnoverPanel({ session }: { session: AuthSession }) {
  const [activeTile, setActiveTile] = useState<ActiveTile>('movement');
  const [clients, setClients] = useState<LoadState<ClientSummary[]>>({ status: 'idle', data: [] });
  const [report, setReport] = useState<LoadState<TurnoverReport | null>>({ status: 'idle', data: null });
  const [statistics, setStatistics] = useState<LoadState<TurnoverStatistics | null>>({ status: 'idle', data: null });
  const [suggestions, setSuggestions] = useState<LoadState<TurnoverSuggestions | null>>({ status: 'idle', data: null });
  const [suggestionQuery, setSuggestionQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [kiz, setKiz] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'quarter' | 'year'>('month');
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSubmittingAction, setSubmittingAction] = useState(false);
  const [movementDocument, setMovementDocument] = useState<LoadState<TurnoverMovementDocument | null>>({ status: 'idle', data: null });
  const [isDownloadingMovementDocument, setDownloadingMovementDocument] = useState(false);

  const canSeeStatistics = useMemo(() => canUseStatistics(session.user.roleCodes, session.user.permissionCodes), [session.user]);
  const canUseActions = useMemo(() => canUseTurnoverActions(session.user.roleCodes, session.user.permissionCodes), [session.user]);
  const selectedReportItem = useMemo(() => {
    const items = report.data?.items ?? [];
    return items.find((item) => item.skuId === selectedSkuId) ?? items[0] ?? null;
  }, [report.data, selectedSkuId]);
  const actionReportItem = useMemo(() => {
    const items = report.data?.items ?? [];
    return items.find((item) => item.skuId === actionForm.skuId) ?? null;
  }, [actionForm.skuId, report.data]);
  const sourceCells = (activeTile === 'actions' && actionForm.skuId ? actionReportItem?.currentCells : selectedReportItem?.currentCells) ?? [];
  const allCells = useMemo(() => uniqueValues((report.data?.items ?? []).flatMap((item) => item.currentCells.map((cell) => cell.boxCode))), [report.data]);
  const productOptions = useMemo(() => buildProductOptions(report.data?.items ?? [], suggestions.data?.products ?? []), [report.data, suggestions.data]);
  const barcodeOptions = useMemo(() => buildBarcodeOptions(report.data?.items ?? [], suggestions.data?.barcodes ?? []), [report.data, suggestions.data]);
  const kizOptions = useMemo(() => buildKizOptions(report.data?.items ?? [], suggestions.data?.kiz ?? []), [report.data, suggestions.data]);
  const sourceCellOptions = useMemo(() => buildCellOptions(sourceCells, suggestions.data?.boxes ?? []), [sourceCells, suggestions.data]);
  const targetCellOptions = useMemo(() => buildCellOptions(allCells.map((boxCode) => ({ boxCode, quantity: 0, status: '' })), suggestions.data?.boxes ?? []), [allCells, suggestions.data]);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    void loadTurnover();
    void loadSuggestions('');
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadSuggestions(suggestionQuery);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [selectedClientId, suggestionQuery]);

  useEffect(() => {
    if ((activeTile === 'actions' && !canUseActions) || (activeTile === 'stats' && !canSeeStatistics)) {
      setActiveTile('movement');
    }
  }, [activeTile, canSeeStatistics, canUseActions]);

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
      skuText: items.some((item) => item.skuId === current.skuId) ? current.skuText : productText(items[0]),
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

    const reportFilter = {
      clientId: selectedClientId,
      search: search.trim() || undefined,
      barcode: barcode.trim() || undefined,
      kiz: kiz.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
    const statisticsFilter = { ...reportFilter, groupBy };

    try {
      const [nextReport, nextStatistics] = await Promise.all([
        fetchTurnoverReport(session.accessToken, reportFilter),
        canSeeStatistics ? fetchTurnoverStatistics(session.accessToken, statisticsFilter) : Promise.resolve(null),
      ]);
      setReport({ status: 'ready', data: nextReport });
      setStatistics({ status: nextStatistics ? 'ready' : 'idle', data: nextStatistics });
    } catch (caught) {
      const message = errorMessage(caught);
      setReport((current) => ({ ...current, status: 'error', error: message }));
      setStatistics((current) => ({ ...current, status: 'error', error: message }));
    }
  }

  async function loadSuggestions(query: string) {
    if (!selectedClientId) {
      return;
    }

    setSuggestions((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const loaded = await fetchTurnoverSuggestions(session.accessToken, {
        clientId: selectedClientId,
        search: query.trim() || undefined,
      });
      setSuggestions({ status: 'ready', data: loaded });
    } catch (caught) {
      setSuggestions((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
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

  async function openMovementDocument(movement: TurnoverSkuReport['movements'][number]) {
    if (!isDocumentMovement(movement)) {
      return;
    }

    setMovementDocument({ status: 'loading', data: null, error: undefined });
    try {
      setMovementDocument({
        status: 'ready',
        data: await fetchTurnoverMovementDocument(session.accessToken, movement.id),
      });
    } catch (caught) {
      setMovementDocument({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  async function downloadMovementDocument(movementId: string, fileName?: string) {
    setDownloadingMovementDocument(true);
    try {
      const blob = await downloadTurnoverMovementDocumentXlsx(session.accessToken, movementId);
      downloadBlob(blob, fileName || `movement-${movementId.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setMovementDocument((current) => ({
        ...current,
        status: current.data ? 'ready' : 'error',
        error: errorMessage(caught),
      }));
    } finally {
      setDownloadingMovementDocument(false);
    }
  }

  function closeMovementDocument() {
    setMovementDocument({ status: 'idle', data: null, error: undefined });
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

          <KnownValueInput
            label="Поиск по товару"
            value={search}
            options={productOptions}
            placeholder="Название, SKU, артикул"
            onChange={setSearch}
            onSearch={setSuggestionQuery}
            onSelect={(option) => {
              setSearch(option.label ?? option.value);
              setSuggestionQuery(option.value);
              setBarcode(optionDataString(option, 'barcode'));
              const skuId = optionDataString(option, 'skuId');
              if (skuId) {
                setSelectedSkuId(skuId);
              }
            }}
          />

          <KnownValueInput
            label="Штрихкод"
            value={barcode}
            options={barcodeOptions}
            placeholder="ШК товара"
            onChange={setBarcode}
            onSearch={setSuggestionQuery}
            onSelect={(option) => {
              setBarcode(option.value);
              setSearch(optionDataString(option, 'name') || option.label || option.value);
              const skuId = optionDataString(option, 'skuId');
              if (skuId) {
                setSelectedSkuId(skuId);
              }
            }}
          />

          <KnownValueInput
            label="КИЗ"
            value={kiz}
            options={kizOptions}
            placeholder="Номер или фрагмент"
            onChange={setKiz}
            onSearch={setSuggestionQuery}
            onSelect={(option) => {
              setKiz(option.value);
              setSearch(optionDataString(option, 'name') || option.label || option.value);
              const skuId = optionDataString(option, 'skuId');
              if (skuId) {
                setSelectedSkuId(skuId);
              }
              const barcodeValue = optionDataString(option, 'barcode');
              if (barcodeValue) {
                setBarcode(barcodeValue);
              }
            }}
          />

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
        {canUseActions ? (
          <TurnoverTile
            active={activeTile === 'actions'}
            icon={<ArrowRightLeft size={22} aria-hidden="true" />}
            title="Действия с товарами"
            text="Добавить, списать, перенести, утилизировать или отложить."
            value={selectedClient?.name ?? 'Клиент'}
            onClick={() => setActiveTile('actions')}
          />
        ) : null}
        {canSeeStatistics ? (
          <TurnoverTile
            active={activeTile === 'stats'}
            icon={<BarChart3 size={22} aria-hidden="true" />}
            title="Статистика"
            text="Приход, отгрузка и тенденции по дням, месяцам, кварталам."
            value="Доступно"
            onClick={() => setActiveTile('stats')}
          />
        ) : null}
      </section>

      {report.status === 'loading' ? <p className="inline-status">Загружаю товарооборот.</p> : null}

      {activeTile === 'movement' ? (
        <MovementSection
          items={report.data?.items ?? []}
          selectedSkuId={selectedReportItem?.skuId ?? ''}
          onOpenDocument={(movement) => void openMovementDocument(movement)}
          onSelect={setSelectedSkuId}
        />
      ) : null}
      {activeTile === 'actions' && canUseActions ? (
        <ActionsSection
          form={actionForm}
          items={report.data?.items ?? []}
          sourceCells={sourceCells}
          allCells={allCells}
          productOptions={productOptions}
          sourceCellOptions={sourceCellOptions}
          targetCellOptions={targetCellOptions}
          kizOptions={kizOptions}
          isSubmitting={isSubmittingAction}
          message={actionMessage}
          error={actionError}
          onChange={updateActionForm}
          onSuggest={setSuggestionQuery}
          onSubmit={() => void submitAction()}
        />
      ) : null}
      {activeTile === 'stats' && canSeeStatistics ? (
        <StatisticsSection
          canSee={canSeeStatistics}
          statistics={statistics.data}
          groupBy={groupBy}
          onGroupBy={(value) => setGroupBy(value)}
          onReload={() => void loadTurnover()}
        />
      ) : null}
      {movementDocument.status !== 'idle' ? (
        <TurnoverMovementDocumentModal
          documentState={movementDocument}
          isDownloading={isDownloadingMovementDocument}
          onClose={closeMovementDocument}
          onDownload={(movementId, fileName) => void downloadMovementDocument(movementId, fileName)}
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

function MovementSection({
  items,
  selectedSkuId,
  onOpenDocument,
  onSelect,
}: {
  items: TurnoverSkuReport[];
  selectedSkuId: string;
  onOpenDocument: (movement: TurnoverSkuReport['movements'][number]) => void;
  onSelect: (skuId: string) => void;
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [shippedOnly, setShippedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const receivedItems = useMemo(() => items.filter(hasEverBeenReceived), [items]);
  const filteredItems = useMemo(() => {
    const normalized = normalizeTurnoverSearch(localSearch);
    return receivedItems.filter((item) => (!shippedOnly || hasBeenShipped(item)) && (!normalized || turnoverItemMatches(item, normalized)));
  }, [localSearch, receivedItems, shippedOnly]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / MOVEMENT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filteredItems.slice((currentPage - 1) * MOVEMENT_PAGE_SIZE, currentPage * MOVEMENT_PAGE_SIZE);
  const selected = filteredItems.find((item) => item.skuId === selectedSkuId) ?? pageItems[0] ?? filteredItems[0] ?? null;

  useEffect(() => {
    setPage(1);
  }, [items, localSearch, shippedOnly]);

  if (receivedItems.length === 0) {
    return (
      <section className="turnover-panel">
        <p className="turnover-empty">По фильтру пока нет движения товаров.</p>
      </section>
    );
  }

  return (
    <section className="turnover-panel turnover-movement" aria-label="Товаро-движение">
      <div className="turnover-movement-toolbar">
        <label className="turnover-movement-search">
          <span>Быстрый поиск</span>
          <input
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            placeholder="Товар, ШК, артикул, SKU или КИЗ"
          />
        </label>
        <label className="turnover-movement-toggle">
          <input checked={shippedOnly} type="checkbox" onChange={(event) => setShippedOnly(event.target.checked)} />
          <span>Только отгруженные</span>
        </label>
        <span className="turnover-movement-counter">
          Показано {formatNumber(filteredItems.length)} из {formatNumber(receivedItems.length)}
        </span>
      </div>

      {filteredItems.length === 0 ? <p className="turnover-empty">По поиску и фильтру ничего не найдено.</p> : null}

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
              {pageItems.map((item) => (
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
          <div className="turnover-pagination">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
              Назад
            </button>
            <span>
              Страница {formatNumber(currentPage)} из {formatNumber(pageCount)}, по {formatNumber(MOVEMENT_PAGE_SIZE)}
            </span>
            <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage >= pageCount}>
              Далее
            </button>
          </div>
        </div>

        {selected ? <MovementDetails item={selected} onOpenDocument={onOpenDocument} /> : null}
      </div>
    </section>
  );
}

function MovementDetails({
  item,
  onOpenDocument,
}: {
  item: TurnoverSkuReport;
  onOpenDocument: (movement: TurnoverSkuReport['movements'][number]) => void;
}) {
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
                  {isDocumentMovement(movement) ? (
                    <button className="turnover-movement-action" type="button" onClick={() => onOpenDocument(movement)}>
                      <strong>{movement.typeLabel}</strong>
                      <span>{movement.comment || 'Открыть документ движения'}</span>
                    </button>
                  ) : (
                    <>
                      <strong>{movement.typeLabel}</strong>
                      <span>{movement.comment || movement.statusLabel}</span>
                    </>
                  )}
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

function TurnoverMovementDocumentModal({
  documentState,
  isDownloading,
  onClose,
  onDownload,
}: {
  documentState: LoadState<TurnoverMovementDocument | null>;
  isDownloading: boolean;
  onClose: () => void;
  onDownload: (movementId: string, fileName: string) => void;
}) {
  const document = documentState.data;

  return (
    <div className="turnover-document-modal" role="dialog" aria-modal="true" aria-label="Документ движения">
      <section className="turnover-document-modal__panel">
        <header className="turnover-document-modal__header">
          <div>
            <p className="eyebrow">Документ движения</p>
            <h3>{document ? document.typeLabel : 'Загрузка документа'}</h3>
            <span>{document ? `${document.client.name} · ${document.sourceDocument ?? document.movementId}` : 'Получаю данные из WMS'}</span>
          </div>
          <div className="turnover-document-modal__actions">
            {document ? (
              <button className="primary-button" type="button" onClick={() => onDownload(document.movementId, document.fileName)} disabled={isDownloading}>
                <Download size={16} aria-hidden="true" />
                <span>{isDownloading ? 'Скачиваю' : 'Скачать Excel'}</span>
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {documentState.status === 'loading' ? <p className="inline-status">Загружаю документ движения.</p> : null}
        {documentState.error ? <p className="form-error">{documentState.error}</p> : null}

        {document ? (
          <>
            <div className="turnover-metrics">
              <Metric label="Период" value={`${formatDateTime(document.periodFrom)} - ${formatDateTime(document.periodTo)}`} />
              <Metric label="Строк" value={formatNumber(document.rows.length)} />
              <Metric label="Товаров, шт" value={formatNumber(document.totalQuantity)} />
              <Metric label="Коробов" value={formatNumber(document.boxesCount)} />
            </div>

            <div className="turnover-table-wrap turnover-document-modal__table">
              <table className="turnover-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Дата</th>
                    <th>Короб</th>
                    <th>ШК</th>
                    <th>Товар</th>
                    <th>Кол-во</th>
                    <th>КИЗ</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {document.rows.map((row) => (
                    <tr key={row.movementId}>
                      <td>{row.position}</td>
                      <td>{formatDateTime(row.date)}</td>
                      <td>{row.boxCode ?? 'без короба'}</td>
                      <td>{row.barcode ?? 'нет'}</td>
                      <td>
                        <strong>{row.name}</strong>
                        <span>{[row.article, row.internalSku].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td>{formatNumber(row.quantity)}</td>
                      <td>{row.kiz ?? '-'}</td>
                      <td>{row.comment ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function ActionsSection({
  form,
  items,
  sourceCells,
  allCells,
  productOptions,
  sourceCellOptions,
  targetCellOptions,
  kizOptions,
  isSubmitting,
  message,
  error,
  onChange,
  onSuggest,
  onSubmit,
}: {
  form: ActionForm;
  items: TurnoverSkuReport[];
  sourceCells: TurnoverSkuReport['currentCells'];
  allCells: string[];
  productOptions: KnownValueOption[];
  sourceCellOptions: KnownValueOption[];
  targetCellOptions: KnownValueOption[];
  kizOptions: KnownValueOption[];
  isSubmitting: boolean;
  message: string;
  error: string;
  onChange: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
  onSuggest: (value: string) => void;
  onSubmit: () => void;
}) {
  const selectedAction = actionOptions.find((item) => item.value === form.action) ?? actionOptions[0];
  const needsSource = form.action !== 'ADD';
  const needsTarget = form.action === 'ADD' || form.action === 'TRANSFER' || form.action === 'HOLD';
  const needsReason = form.action === 'WRITE_OFF' || form.action === 'UTILIZE' || form.action === 'HOLD';

  function selectProduct(option: KnownValueOption) {
    onChange('skuText', productTextFromOption(option));
    onChange('skuId', optionDataString(option, 'skuId'));

    const boxCode = optionDataString(option, 'boxCode');
    if (boxCode) {
      onChange('sourceBoxCode', boxCode);
    }
  }

  function selectKiz(option: KnownValueOption) {
    onChange('kiz', option.value);

    const skuId = optionDataString(option, 'skuId');
    if (skuId) {
      onChange('skuId', skuId);
      onChange('skuText', productTextFromOption(option));
    }

    const boxCode = optionDataString(option, 'boxCode');
    if (boxCode) {
      onChange('sourceBoxCode', boxCode);
    }
  }

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

        <KnownValueInput
          label="Товар"
          value={form.skuText}
          options={productOptions}
          placeholder={items.length === 0 ? 'Нет товаров по фильтру' : 'Начните вводить товар, артикул или ШК'}
          onChange={(value) => {
            onChange('skuText', value);
            onChange('skuId', '');
          }}
          onSearch={onSuggest}
          onSelect={selectProduct}
        />

        <label>
          <span>Количество</span>
          <input min="1" type="number" value={form.quantity} onChange={(event) => onChange('quantity', event.target.value)} />
        </label>

        {needsSource ? (
          <KnownValueInput
            label="Откуда"
            value={form.sourceBoxCode}
            options={sourceCellOptions}
            placeholder="Можно оставить пустым"
            onChange={(value) => onChange('sourceBoxCode', value)}
            onSearch={onSuggest}
            onSelect={(option) => onChange('sourceBoxCode', option.value)}
          />
        ) : null}

        {needsTarget ? (
          <KnownValueInput
            label="Куда"
            value={form.targetBoxCode}
            options={targetCellOptions}
            placeholder="Новая или существующая ячейка"
            onChange={(value) => onChange('targetBoxCode', value)}
            onSearch={onSuggest}
            onSelect={(option) => onChange('targetBoxCode', option.value)}
          />
        ) : null}

        {needsReason ? (
          <label>
            <span>Причина</span>
            <input value={form.reason} onChange={(event) => onChange('reason', event.target.value)} placeholder="Коротко, что случилось" />
          </label>
        ) : null}
      </div>

      <div className="turnover-action-grid turnover-action-grid--wide">
        <KnownValueInput
          label="КИЗ"
          value={form.kiz}
          options={kizOptions}
          placeholder="Можно несколько: через запятую или с новой строки"
          multiline
          onChange={(value) => onChange('kiz', value)}
          onSearch={onSuggest}
          onSelect={selectKiz}
        />

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

function productText(item?: TurnoverSkuReport | null) {
  if (!item) {
    return '';
  }

  return [item.name, item.primaryBarcode ? `ШК ${item.primaryBarcode}` : item.internalSku].filter(Boolean).join(' · ');
}

function productTextFromOption(option: KnownValueOption) {
  const name = optionDataString(option, 'name');
  const barcode = optionDataString(option, 'barcode');
  const internalSku = optionDataString(option, 'internalSku');

  return [name || option.label || option.value, barcode ? `ШК ${barcode}` : internalSku].filter(Boolean).join(' · ');
}

function optionDataString(option: KnownValueOption, key: string) {
  const value = option.data?.[key];
  return value === null || value === undefined ? '' : String(value);
}

function buildProductOptions(items: TurnoverSkuReport[], products: TurnoverSuggestions['products']): KnownValueOption[] {
  return uniqueOptions([
    ...items.map((item) => ({
      value: productText(item),
      label: productText(item),
      description: `Остаток ${formatNumber(item.currentQuantity)} шт · ${item.article ?? item.internalSku}`,
      data: {
        skuId: item.skuId,
        name: item.name,
        internalSku: item.internalSku,
        clientSku: item.clientSku,
        article: item.article,
        barcode: item.primaryBarcode,
        boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
      },
    })),
    ...products.map((product) => ({
      value: product.label,
      label: product.label,
      description: `Остаток ${formatNumber(product.quantity)} шт · ${product.article ?? product.internalSku}`,
      data: {
        skuId: product.skuId,
        name: product.name,
        internalSku: product.internalSku,
        clientSku: product.clientSku,
        article: product.article,
        barcode: product.barcode,
        boxCode: product.boxCode,
      },
    })),
  ]);
}

function buildBarcodeOptions(items: TurnoverSkuReport[], barcodes: TurnoverSuggestions['barcodes']): KnownValueOption[] {
  return uniqueOptions([
    ...items.flatMap((item) =>
      item.barcodes.map((barcode) => ({
        value: barcode,
        label: barcode,
        description: `${item.name} · остаток ${formatNumber(item.currentQuantity)} шт`,
        data: {
          skuId: item.skuId,
          name: item.name,
          internalSku: item.internalSku,
          clientSku: item.clientSku,
          article: item.article,
          barcode,
          boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
        },
      })),
    ),
    ...barcodes.map((barcode) => ({
      value: barcode.value,
      label: barcode.value,
      description: `${barcode.name} · ${barcode.internalSku}`,
      data: {
        skuId: barcode.skuId,
        name: barcode.name,
        internalSku: barcode.internalSku,
        clientSku: barcode.clientSku,
        article: barcode.article,
        barcode: barcode.value,
      },
    })),
  ]);
}

function buildKizOptions(items: TurnoverSkuReport[], kiz: TurnoverSuggestions['kiz']): KnownValueOption[] {
  return uniqueOptions([
    ...items.flatMap((item) =>
      item.kiz.map((mark) => ({
        value: mark.value,
        label: mark.value,
        description: `${item.name} · ${mark.status}`,
        data: {
          skuId: item.skuId,
          name: item.name,
          internalSku: item.internalSku,
          clientSku: item.clientSku,
          article: item.article,
          barcode: item.primaryBarcode,
          boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
        },
      })),
    ),
    ...kiz.map((mark) => ({
      value: mark.value,
      label: mark.value,
      description: [mark.name, mark.boxCode ? `ячейка ${mark.boxCode}` : null, mark.status].filter(Boolean).join(' · '),
      data: {
        skuId: mark.skuId,
        name: mark.name,
        internalSku: mark.internalSku,
        article: mark.article,
        barcode: mark.barcode,
        boxCode: mark.boxCode,
      },
    })),
  ]);
}

function buildCellOptions(
  cells: Array<{ boxCode: string; quantity: number; status: string }>,
  boxes: TurnoverSuggestions['boxes'],
): KnownValueOption[] {
  return uniqueOptions([
    ...cells.map((cell) => ({
      value: cell.boxCode,
      label: cell.boxCode,
      description: cell.quantity ? `${formatNumber(cell.quantity)} шт · ${cell.status}` : cell.status || 'ячейка клиента',
    })),
    ...boxes.map((box) => ({
      value: box.code,
      label: box.code,
      description: box.status,
    })),
  ]);
}

function uniqueOptions(options: KnownValueOption[]) {
  const seen = new Set<string>();
  const result: KnownValueOption[] = [];

  for (const option of options) {
    if (!option.value || seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);
    result.push(option);
  }

  return result;
}

function hasEverBeenReceived(item: TurnoverSkuReport) {
  return (
    item.receivedQuantity > 0 ||
    item.currentQuantity > 0 ||
    Boolean(item.firstReceiptAt) ||
    item.movements.some((movement) => movement.quantity > 0 && ['INITIAL_IMPORT', 'RECEIPT', 'RETURN', 'INVENTORY_ADJUSTMENT'].includes(movement.type))
  );
}

function hasBeenShipped(item: TurnoverSkuReport) {
  return item.shippedQuantity > 0 || item.movements.some((movement) => movement.type === 'SHIP' && movement.quantity < 0);
}

function turnoverItemMatches(item: TurnoverSkuReport, normalizedQuery: string) {
  const values = [
    item.name,
    item.internalSku,
    item.clientSku,
    item.article,
    item.primaryBarcode,
    ...item.barcodes,
    ...item.kiz.map((mark) => mark.value),
    ...item.currentCells.map((cell) => cell.boxCode),
    ...item.movements.flatMap((movement) => [
      movement.sourceDocument,
      movement.comment,
      movement.request?.title,
      movement.request?.destinationCity,
      movement.boxCode,
      ...movement.kiz,
    ]),
  ];

  return values.some((value) => normalizeTurnoverSearch(value ?? '').includes(normalizedQuery));
}

function normalizeTurnoverSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function canUseStatistics(roleCodes: string[], permissionCodes: string[]) {
  return permissionCodes.includes('system:admin') || roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

function canUseTurnoverActions(roleCodes: string[], permissionCodes: string[]) {
  if (permissionCodes.includes('system:admin')) {
    return true;
  }

  const hasStaffRole = roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'].includes(role));
  if (!hasStaffRole && roleCodes.includes('CLIENT')) {
    return false;
  }

  return permissionCodes.includes('stock:write') || roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

function isDocumentMovement(movement: TurnoverSkuReport['movements'][number]) {
  if (movement.type === 'SHIP') {
    return movement.quantity < 0;
  }

  return ['INITIAL_IMPORT', 'RECEIPT', 'RETURN'].includes(movement.type) && movement.quantity > 0;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
