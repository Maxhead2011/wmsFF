import {
  Archive,
  ArrowRightLeft,
  BarChart3,
  Download,
  History,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  downloadTurnoverMovementDocumentXlsx,
  downloadTurnoverReceiptPeriodXlsx,
  downloadTurnoverStockXlsx,
  fetchClients,
  fetchTurnoverBoxDetails,
  fetchTurnoverMovementDocument,
  fetchTurnoverReport,
  fetchTurnoverStatistics,
  fetchTurnoverSuggestions,
  runTurnoverAction,
  type AuthSession,
  type ClientSummary,
  type TurnoverActionKind,
  type TurnoverBoxDetails,
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

type ActiveTile = 'movement' | 'receipts' | 'stockExport' | 'actions' | 'stats';

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

export function TurnoverPanel({ session }: { session: AuthSession }) {
  const [activeTile, setActiveTile] = useState<ActiveTile>('movement');
  const [clients, setClients] = useState<LoadState<ClientSummary[]>>({ status: 'idle', data: [] });
  const [report, setReport] = useState<LoadState<TurnoverReport | null>>({ status: 'idle', data: null });
  const [statistics, setStatistics] = useState<LoadState<TurnoverStatistics | null>>({ status: 'idle', data: null });
  const [suggestions, setSuggestions] = useState<LoadState<TurnoverSuggestions | null>>({ status: 'idle', data: null });
  const [suggestionQuery, setSuggestionQuery] = useState('');
  const [suggestionScope, setSuggestionScope] = useState<'client' | 'barcode'>('client');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [search, setSearch] = useState('');
  const [movementSearch, setMovementSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [kiz, setKiz] = useState('');
  const [boxSearch, setBoxSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'quarter' | 'year'>('month');
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSubmittingAction, setSubmittingAction] = useState(false);
  const [movementDocument, setMovementDocument] = useState<LoadState<TurnoverMovementDocument | null>>({ status: 'idle', data: null });
  const [boxDetails, setBoxDetails] = useState<LoadState<TurnoverBoxDetails | null>>({ status: 'idle', data: null });
  const [isDownloadingMovementDocument, setDownloadingMovementDocument] = useState(false);
  const [isDownloadingReceiptPeriod, setDownloadingReceiptPeriod] = useState(false);
  const [receiptPeriodError, setReceiptPeriodError] = useState('');
  const [isDownloadingStockExport, setDownloadingStockExport] = useState(false);
  const [stockExportError, setStockExportError] = useState('');
  const [ignoreActiveStockRequests, setIgnoreActiveStockRequests] = useState(false);

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
  const boxOptions = useMemo(() => buildCellOptions(allCells.map((boxCode) => ({ boxCode, quantity: 0, status: '' })), suggestions.data?.boxes ?? []), [allCells, suggestions.data]);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    setBoxDetails({ status: 'idle', data: null });
    void loadTurnover();
    void loadSuggestions('');
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadSuggestions(suggestionQuery, suggestionScope);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [selectedClientId, suggestionQuery, suggestionScope]);

  useEffect(() => {
    if (
      (activeTile === 'actions' && !canUseActions) ||
      ((activeTile === 'stats' || activeTile === 'stockExport') && !canSeeStatistics)
    ) {
      setActiveTile('movement');
    }
  }, [activeTile, canSeeStatistics, canUseActions]);

  useEffect(() => {
    if (boxDetails.status === 'idle') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBoxDetails({ status: 'idle', data: null });
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [boxDetails.status]);

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
    setReceiptPeriodError('');
    setStockExportError('');

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

  async function loadSuggestions(query: string, scope: 'client' | 'barcode' = 'client') {
    if (!selectedClientId) {
      return;
    }

    setSuggestions((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const loaded = await fetchTurnoverSuggestions(session.accessToken, {
        clientId: selectedClientId,
        search: query.trim() || undefined,
        scope,
      });
      setSuggestions({ status: 'ready', data: loaded });
    } catch (caught) {
      setSuggestions((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
    }
  }

  async function loadBoxDetails(nextBoxCode = boxSearch) {
    const cleanBoxCode = nextBoxCode.trim();
    if (!cleanBoxCode) {
      setBoxDetails({ status: 'error', data: null, error: 'Укажите номер короба.' });
      return;
    }

    setBoxSearch(cleanBoxCode);
    setBoxDetails((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const loaded = await fetchTurnoverBoxDetails(session.accessToken, cleanBoxCode);
      setBoxDetails({ status: 'ready', data: loaded });
    } catch (caught) {
      setBoxDetails({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  function updateActionForm<K extends keyof ActionForm>(key: K, value: ActionForm[K]) {
    setActionForm((current) => ({ ...current, [key]: value }));
    setActionMessage('');
    setActionError('');
  }

  function startBoxAction(item: TurnoverBoxDetails['contents'][number], action: TurnoverActionKind) {
    const currentBox = boxDetails.data?.box.code ?? boxSearch.trim();

    setActiveTile('actions');
    setActionForm((current) => ({
      ...current,
      action,
      skuId: item.skuId,
      skuText: boxContentText(item),
      quantity: String(Math.max(1, item.quantity)),
      sourceBoxCode: action === 'ADD' ? '' : currentBox,
      targetBoxCode: action === 'ADD' || action === 'HOLD' ? currentBox : '',
      reason: '',
      kiz: '',
      photoFileName: '',
      comment: '',
    }));
    setActionMessage('');
    setActionError('');
    setBoxDetails({ status: 'idle', data: null });
  }

  async function submitAction() {
    const actionClientId = actionReportItem?.client.id ?? selectedClientId;
    if (!actionClientId || !actionForm.skuId) {
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
        clientId: actionClientId,
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

  async function downloadReceiptPeriod() {
    if (!selectedClientId) {
      setReceiptPeriodError('Выберите клиента для выгрузки приемки.');
      return;
    }

    setDownloadingReceiptPeriod(true);
    setReceiptPeriodError('');

    try {
      const blob = await downloadTurnoverReceiptPeriodXlsx(session.accessToken, {
        clientId: selectedClientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      const client = clients.data.find((item) => item.id === selectedClientId) ?? null;
      downloadBlob(blob, receiptPeriodFileName(client, dateFrom, dateTo));
    } catch (caught) {
      setReceiptPeriodError(errorMessage(caught));
    } finally {
      setDownloadingReceiptPeriod(false);
    }
  }

  async function downloadStockExport() {
    if (!selectedClientId) {
      setStockExportError('Выберите клиента для выгрузки остатков.');
      return;
    }

    setDownloadingStockExport(true);
    setStockExportError('');

    try {
      const blob = await downloadTurnoverStockXlsx(session.accessToken, {
        clientId: selectedClientId,
        ignoreActiveRequests: ignoreActiveStockRequests,
      });
      const client = clients.data.find((item) => item.id === selectedClientId) ?? null;
      downloadBlob(blob, stockExportFileName(client, ignoreActiveStockRequests));
    } catch (caught) {
      setStockExportError(errorMessage(caught));
    } finally {
      setDownloadingStockExport(false);
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
            onSearch={(value) => {
              setSuggestionScope('client');
              setSuggestionQuery(value);
            }}
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
            onSearch={(value) => {
              setSuggestionScope('barcode');
              setSuggestionQuery(value);
            }}
            onSelect={(option) => {
              setBarcode(option.value);
              setSearch(optionDataString(option, 'name') || option.label || option.value);
              const clientId = optionDataString(option, 'clientId');
              if (clientId) {
                setSelectedClientId(clientId);
              }
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
            onSearch={(value) => {
              setSuggestionScope('client');
              setSuggestionQuery(value);
            }}
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

          <KnownValueInput
            label="Короб"
            value={boxSearch}
            options={boxOptions}
            placeholder="Номер короба или ячейки"
            onChange={setBoxSearch}
            onSearch={(value) => {
              setSuggestionScope('client');
              setSuggestionQuery(value);
            }}
            onSelect={(option) => {
              setBoxSearch(option.value);
              void loadBoxDetails(option.value);
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

          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadBoxDetails()}
            disabled={!boxSearch.trim() || boxDetails.status === 'loading'}
          >
            <Search size={16} aria-hidden="true" />
            <span>Найти короб</span>
          </button>
        </div>

        {clients.error ? <p className="form-error">{clients.error}</p> : null}
        {report.error ? <p className="form-error">{report.error}</p> : null}
        {barcode.trim() ? <p className="inline-status">Поиск по ШК выполняется по всем доступным клиентам.</p> : null}
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
          active={activeTile === 'receipts'}
          icon={<Download size={22} aria-hidden="true" />}
          title="Выгрузка приемки"
          text="Один Excel по выбранному клиенту и периоду."
          value={receiptPeriodLabel(dateFrom, dateTo)}
          onClick={() => setActiveTile('receipts')}
        />
        {canSeeStatistics ? (
          <TurnoverTile
            active={activeTile === 'stockExport'}
            icon={<Archive size={22} aria-hidden="true" />}
            title="Остатки Excel"
            text="Короба, паллеты, SKU, ШК, КИЗ и доступный остаток на текущую дату."
            value={ignoreActiveStockRequests ? 'Полностью' : 'Минус заявки'}
            onClick={() => setActiveTile('stockExport')}
          />
        ) : null}
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
      {boxDetails.status !== 'idle' ? (
        <div
          className="turnover-box-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Содержимое короба"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setBoxDetails({ status: 'idle', data: null });
            }
          }}
        >
          <div className="turnover-box-dialog__panel">
            <BoxDetailsSection
              state={boxDetails}
              canUseActions={canUseActions}
              onClose={() => setBoxDetails({ status: 'idle', data: null })}
              onAction={startBoxAction}
            />
          </div>
        </div>
      ) : null}

      {activeTile === 'receipts' ? (
        <ReceiptExportSection
          client={selectedClient}
          dateFrom={dateFrom}
          dateTo={dateTo}
          error={receiptPeriodError}
          isDownloading={isDownloadingReceiptPeriod}
          onDownload={() => void downloadReceiptPeriod()}
        />
      ) : null}
      {activeTile === 'stockExport' && canSeeStatistics ? (
        <StockExportSection
          client={selectedClient}
          ignoreActiveRequests={ignoreActiveStockRequests}
          error={stockExportError}
          isDownloading={isDownloadingStockExport}
          onIgnoreActiveRequestsChange={setIgnoreActiveStockRequests}
          onDownload={() => void downloadStockExport()}
        />
      ) : null}
      {activeTile === 'movement' ? (
        <MovementSection
          items={report.data?.items ?? []}
          search={movementSearch}
          selectedSkuId={selectedReportItem?.skuId ?? ''}
          onOpenDocument={(movement) => void openMovementDocument(movement)}
          onOpenBox={(boxCode) => void loadBoxDetails(boxCode)}
          onSearch={setMovementSearch}
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

function ReceiptExportSection({
  client,
  dateFrom,
  dateTo,
  isDownloading,
  error,
  onDownload,
}: {
  client: ClientSummary | null;
  dateFrom: string;
  dateTo: string;
  isDownloading: boolean;
  error: string;
  onDownload: () => void;
}) {
  return (
    <section className="turnover-panel turnover-receipt-export" aria-label="Выгрузка приемки">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Выгрузка приемки</p>
          <h3>Все поступления клиента в одном Excel</h3>
        </div>
        <span>{receiptPeriodLabel(dateFrom, dateTo)}</span>
      </div>

      <div className="turnover-receipt-export__body">
        <div>
          <strong>{client?.name ?? 'Клиент не выбран'}</strong>
          <p>
            В файл попадут строки приемки за выбранный период: короб, ШК товара, SKU клиента, КИЗ, наименование,
            цвет, размер, количество и дата приемки.
          </p>
          <small>Если период сверху не указан, WMS выгрузит приемку клиента за весь срок.</small>
        </div>
        <button className="primary-button" type="button" onClick={onDownload} disabled={!client || isDownloading}>
          <Download size={16} aria-hidden="true" />
          <span>{isDownloading ? 'Формирую файл' : 'Скачать приемку Excel'}</span>
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function StockExportSection({
  client,
  ignoreActiveRequests,
  isDownloading,
  error,
  onIgnoreActiveRequestsChange,
  onDownload,
}: {
  client: ClientSummary | null;
  ignoreActiveRequests: boolean;
  isDownloading: boolean;
  error: string;
  onIgnoreActiveRequestsChange: (value: boolean) => void;
  onDownload: () => void;
}) {
  return (
    <section className="turnover-panel turnover-receipt-export turnover-stock-export" aria-label="Выгрузка остатков">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Остатки Excel</p>
          <h3>Остатки клиента с коробами, SKU и штрихкодами</h3>
        </div>
        <span>{ignoreActiveRequests ? 'Полный остаток' : 'За вычетом активных заявок'}</span>
      </div>

      <div className="turnover-receipt-export__body">
        <div>
          <strong>{client?.name ?? 'Клиент не выбран'}</strong>
          <p>
            В файл попадут текущие остатки по коробам: короб, паллета, SKU WMS, SKU клиента, артикул, ШК, все ШК,
            наименование, цвет, размер, статус, КИЗ и количество к выгрузке.
          </p>
          <label className="turnover-stock-export__toggle">
            <input
              type="checkbox"
              checked={ignoreActiveRequests}
              onChange={(event) => onIgnoreActiveRequestsChange(event.target.checked)}
            />
            <span>Игнорировать текущие заявки и скачать полный остаток</span>
          </label>
          <small>
            Если галочка снята, WMS вычтет товары из активных заявок клиента и строки с нулевым доступным остатком не попадут в Excel.
          </small>
        </div>
        <button className="primary-button" type="button" onClick={onDownload} disabled={!client || isDownloading}>
          <Download size={16} aria-hidden="true" />
          <span>{isDownloading ? 'Формирую файл' : 'Скачать остатки Excel'}</span>
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function BoxDetailsSection({
  state,
  canUseActions,
  onClose,
  onAction,
}: {
  state: LoadState<TurnoverBoxDetails | null>;
  canUseActions: boolean;
  onClose: () => void;
  onAction: (item: TurnoverBoxDetails['contents'][number], action: TurnoverActionKind) => void;
}) {
  const details = state.data;

  return (
    <section className="turnover-panel turnover-box-details" aria-label="Содержимое короба">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Поиск по коробу</p>
          <h3>{details ? details.box.code : 'Короб'}</h3>
          {details ? <span>{details.box.client.name} · статус {details.box.status}</span> : null}
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Закрыть короб">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {state.status === 'loading' ? <p className="inline-status">Ищу короб и загружаю содержимое.</p> : null}
      {state.error ? <p className="form-error">{state.error}</p> : null}

      {details ? (
        <>
          <div className="turnover-metrics">
            <Metric label="Позиций" value={formatNumber(details.totals.rows)} />
            <Metric label="SKU" value={formatNumber(details.totals.skuCount)} />
            <Metric label="Единиц" value={formatNumber(details.totals.quantity)} />
            <Metric label="КИЗ" value={formatNumber(details.totals.kizCount)} />
          </div>

          <div className="turnover-table-wrap">
            <table className="turnover-table turnover-box-details__table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>ШК</th>
                  <th>Цвет / размер</th>
                  <th>Статус</th>
                  <th>Кол-во</th>
                  <th>КИЗ</th>
                  {canUseActions ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {details.contents.length === 0 ? (
                  <tr>
                    <td colSpan={canUseActions ? 7 : 6}>В коробе нет текущего остатка.</td>
                  </tr>
                ) : null}
                {details.contents.map((item) => (
                  <tr key={item.balanceId}>
                    <td>
                      <strong>{item.name}</strong>
                      <span>{[item.internalSku, item.clientSku, item.article].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>{item.barcode ?? '-'}</td>
                    <td>{[item.color, item.size].filter(Boolean).join(' / ') || '-'}</td>
                    <td>{item.statusLabel}</td>
                    <td>{formatNumber(item.quantity)}</td>
                    <td>
                      {item.kiz.length > 0 ? (
                        <>
                          <span>{item.kiz.slice(0, 3).join(', ')}</span>
                          {item.kizCount > item.kiz.length ? <small>+ {formatNumber(item.kizCount - item.kiz.length)}</small> : null}
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    {canUseActions ? (
                      <td>
                        <div className="turnover-box-actions">
                          <button type="button" onClick={() => onAction(item, 'TRANSFER')}>Перенести</button>
                          <button type="button" onClick={() => onAction(item, 'WRITE_OFF')}>Списать</button>
                          <button type="button" onClick={() => onAction(item, 'HOLD')}>Отложить</button>
                          <button type="button" onClick={() => onAction(item, 'ADD')}>Добавить</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="turnover-table-wrap turnover-table-wrap--compact">
            <table className="turnover-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Действие</th>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Документ</th>
                </tr>
              </thead>
              <tbody>
                {details.movements.length === 0 ? (
                  <tr>
                    <td colSpan={5}>По коробу пока нет движений.</td>
                  </tr>
                ) : null}
                {details.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDateTime(movement.date)}</td>
                    <td>
                      <strong>{movement.typeLabel}</strong>
                      <span>{movement.comment || movement.statusLabel}</span>
                    </td>
                    <td>
                      <strong>{movement.name}</strong>
                      <span>{movement.barcode ?? '-'}</span>
                    </td>
                    <td className={movement.quantity < 0 ? 'is-negative' : 'is-positive'}>{formatNumber(movement.quantity)}</td>
                    <td>{movement.sourceDocument ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function MovementSection({
  items,
  search,
  selectedSkuId,
  onOpenDocument,
  onOpenBox,
  onSearch,
  onSelect,
}: {
  items: TurnoverSkuReport[];
  search: string;
  selectedSkuId: string;
  onOpenDocument: (movement: TurnoverSkuReport['movements'][number]) => void;
  onOpenBox: (boxCode: string) => void;
  onSearch: (value: string) => void;
  onSelect: (skuId: string) => void;
}) {
  const filteredItems = items.filter((item) => matchesTurnoverItemSearch(item, search));
  const selected = filteredItems.find((item) => item.skuId === selectedSkuId) ?? filteredItems[0] ?? null;

  if (items.length === 0) {
    return (
      <section className="turnover-panel">
        <p className="turnover-empty">По фильтру пока нет движения товаров.</p>
      </section>
    );
  }

  return (
    <section className="turnover-panel turnover-movement" aria-label="Товаро-движение">
      <div className="turnover-search-bar">
        <label>
          <span>Поиск товара</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Название, SKU, артикул или ШК"
          />
        </label>
        <small>
          Найдено: {formatNumber(filteredItems.length)} из {formatNumber(items.length)}
        </small>
      </div>
      <div className="turnover-two-columns">
        <div className="turnover-table-wrap">
          <table className="turnover-table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Товар</th>
                <th>ШК</th>
                <th>Остаток</th>
                <th>Принято</th>
                <th>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6}>По такому запросу товар не найден.</td>
                </tr>
              ) : null}
              {filteredItems.map((item) => (
                <tr className={item.skuId === selected?.skuId ? 'is-active' : ''} key={item.skuId} onClick={() => onSelect(item.skuId)}>
                  <td>
                    <strong>{item.client.name}</strong>
                    <span>{item.client.code}</span>
                  </td>
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

        {selected ? <MovementDetails item={selected} onOpenDocument={onOpenDocument} onOpenBox={onOpenBox} /> : null}
      </div>
    </section>
  );
}

function MovementDetails({
  item,
  onOpenDocument,
  onOpenBox,
}: {
  item: TurnoverSkuReport;
  onOpenDocument: (movement: TurnoverSkuReport['movements'][number]) => void;
  onOpenBox: (boxCode: string) => void;
}) {
  return (
    <div className="turnover-details">
      <div className="turnover-details__heading">
        <div>
          <p className="eyebrow">Карточка движения</p>
          <h3>{item.name}</h3>
          <small>{item.client.name} · {item.client.code}</small>
        </div>
        <span>{item.primaryBarcode ?? item.internalSku}</span>
      </div>

      <div className="turnover-metrics">
        <Metric label="Первый приход" value={formatDate(item.firstReceiptAt)} />
        <Metric
          label="Первая ячейка"
          value={item.firstCell ?? 'не указана'}
          onClick={item.firstCell ? () => onOpenBox(item.firstCell as string) : undefined}
        />
        <Metric label="Дней хранения" value={String(item.storageDays)} />
        <Metric label="КИЗ" value={String(item.kiz.length)} />
      </div>

      <div className="turnover-cells">
        {item.currentCells.length === 0 ? <span>На складе сейчас нет остатка.</span> : null}
        {item.currentCells.map((cell) => (
          <button
            className="turnover-cell-card"
            type="button"
            key={`${cell.boxCode}-${cell.status}`}
            onClick={() => onOpenBox(cell.boxCode)}
            title={`Открыть содержимое короба ${cell.boxCode}`}
          >
            <strong>{cell.boxCode}</strong>
            <small>{formatNumber(cell.quantity)} шт · {stockStatusLabel(cell.status)}</small>
          </button>
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
                <td>
                  {movement.boxCode ? (
                    <button
                      className="turnover-cell-link"
                      type="button"
                      onClick={() => onOpenBox(movement.boxCode as string)}
                      title={`Открыть содержимое короба ${movement.boxCode}`}
                    >
                      {movement.boxCode}
                    </button>
                  ) : (
                    'без ячейки'
                  )}
                </td>
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

function Metric({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div className="turnover-metric">
      <span>{label}</span>
      {onClick ? (
        <button className="turnover-metric__link" type="button" onClick={onClick} title={`Открыть содержимое короба ${value}`}>
          {value}
        </button>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function productText(item?: TurnoverSkuReport | null) {
  if (!item) {
    return '';
  }

  return [item.name, item.primaryBarcode ? `ШК ${item.primaryBarcode}` : item.internalSku].filter(Boolean).join(' · ');
}

function matchesTurnoverItemSearch(item: TurnoverSkuReport, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [
    item.name,
    item.internalSku,
    item.clientSku,
    item.article,
    item.primaryBarcode,
    ...item.barcodes,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function boxContentText(item: TurnoverBoxDetails['contents'][number]) {
  return [item.name, item.barcode ? `ШК ${item.barcode}` : item.internalSku, item.article, item.size].filter(Boolean).join(' · ');
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
          clientId: item.client.id,
          clientName: item.client.name,
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
      description: `${barcode.client.name} · ${barcode.name} · ${barcode.internalSku}`,
      data: {
        clientId: barcode.client.id,
        clientName: barcode.client.name,
        skuId: barcode.skuId,
        name: barcode.name,
        internalSku: barcode.internalSku,
        clientSku: barcode.clientSku,
        article: barcode.article,
        barcode: barcode.value,
      },
    })),
  ], (option) => `${option.value}:${optionDataString(option, 'clientId')}:${optionDataString(option, 'skuId')}`);
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

function uniqueOptions(options: KnownValueOption[], keyOf: (option: KnownValueOption) => string = (option) => option.value) {
  const seen = new Set<string>();
  const result: KnownValueOption[] = [];

  for (const option of options) {
    const key = keyOf(option);
    if (!option.value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(option);
  }

  return result;
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

function receiptPeriodLabel(dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) {
    return 'Весь срок';
  }

  if (dateFrom && dateTo) {
    return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
  }

  return dateFrom ? `с ${formatDate(dateFrom)}` : `по ${formatDate(dateTo)}`;
}

function receiptPeriodFileName(client: ClientSummary | null, dateFrom: string, dateTo: string) {
  const clientCode = safeFileName(client?.code || client?.name || 'client');
  const period = safeFileName([dateFrom || 'all', dateTo || dateFrom || 'all'].join('_'));
  return `priemka-${clientCode}-${period}.xlsx`;
}

function stockExportFileName(client: ClientSummary | null, ignoreActiveRequests: boolean) {
  const clientCode = safeFileName(client?.code || client?.name || 'client');
  const date = new Date().toISOString().slice(0, 10);
  return `ostatki-koroba-${clientCode}-${date}-${ignoreActiveRequests ? 'full' : 'available'}.xlsx`;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || 'file';
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

function stockStatusLabel(status: string) {
  const labels: Record<string, string> = {
    AVAILABLE: 'Доступно',
    RECEIVING: 'Приемка',
    RESERVED: 'Зарезервировано',
    PACKING: 'В сборке',
    SHIPPING: 'К отгрузке',
    HOLD: 'Отложено',
    DAMAGED: 'Повреждено',
    QUARANTINE: 'Карантин',
  };

  return labels[status] ?? status;
}

function buildActionKey(action: string, skuId: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  return `web-turnover:${action}:${skuId}:${suffix}`;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию товарооборота.';
}
