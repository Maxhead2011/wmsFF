import {
  Archive,
  ArrowRightLeft,
  Box,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlus,
  PackageOpen,
  RefreshCw,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  fetchBoxes,
  fetchClients,
  fetchFbsBoxStockReport,
  fetchTurnoverBoxDetails,
  runTurnoverAction,
  type AuthSession,
  type ClientSummary,
  type FbsBoxStockReport,
  type TurnoverActionKind,
  type TurnoverBoxDetails,
  type WarehouseBoxSummary,
} from '../../lib/api';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';

type DetailsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: TurnoverBoxDetails | null;
  error?: string;
};

type BoxActionState = {
  item: TurnoverBoxDetails['contents'][number];
  action: TurnoverActionKind;
  quantity: string;
  targetBoxCode: string;
  targetBarcode: string;
  reason: string;
  kiz: string;
  comment: string;
};

type BoxSelection = Pick<WarehouseBoxSummary, 'clientId' | 'code'>;
type WithoutPalletItem = FbsBoxStockReport['withoutPallet']['items'][number];

export type WithoutPalletBoxGroup = Pick<
  WithoutPalletItem,
  'boxCode' | 'warehouse' | 'location' | 'status' | 'boxTotal'
> & {
  contents: WithoutPalletItem[];
};

const numberFormatter = new Intl.NumberFormat('ru-RU');
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const actionLabels: Record<TurnoverActionKind, string> = {
  ADD: 'Добавить',
  WRITE_OFF: 'Списать',
  TRANSFER: 'Перенести',
  UTILIZE: 'Утилизировать',
  HOLD: 'Отложить',
  REPLACE_BARCODE: 'Исправить ШК', // ADDED
};

export function BoxManagementPanel({ session }: { session: AuthSession }) {
  const [showArchive, setShowArchive] = useState(false);
  // ADDED: the third view is read from the existing stock report and never mutates placement.
  const [showWithoutPallet, setShowWithoutPallet] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<WarehouseBoxSummary[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedBox, setSelectedBox] = useState<BoxSelection | null>(null);
  const [details, setDetails] = useState<DetailsState>({ status: 'idle', data: null });
  const [actionState, setActionState] = useState<BoxActionState | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [targetSuggestions, setTargetSuggestions] = useState<WarehouseBoxSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
  const [withoutPalletReport, setWithoutPalletReport] = useState<FbsBoxStockReport | null>(null);
  const [withoutPalletPage, setWithoutPalletPage] = useState(1);
  const [withoutPalletRefresh, setWithoutPalletRefresh] = useState(0);
  const [isLoadingClients, setLoadingClients] = useState(false);
  const [isLoadingWithoutPallet, setLoadingWithoutPallet] = useState(false);
  const [withoutPalletError, setWithoutPalletError] = useState('');

  const visibleSuggestions = useMemo(() => suggestions.slice(0, 14), [suggestions]);

  useEffect(() => {
    if (!showWithoutPallet) {
      return undefined;
    }

    let cancelled = false;
    setLoadingClients(true);
    setWithoutPalletError('');
    fetchClients(session.accessToken)
      .then((items) => {
        if (!cancelled) {
          setClients(items);
          setSelectedClientId((current) => validRememberedClientId(current, items));
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setClients([]);
          setWithoutPalletError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingClients(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session.accessToken, setSelectedClientId, showWithoutPallet]);

  useEffect(() => {
    if (!showWithoutPallet || !selectedClientId || !clients.some((client) => client.id === selectedClientId)) {
      setWithoutPalletReport(null);
      return undefined;
    }

    let cancelled = false;
    setLoadingWithoutPallet(true);
    setWithoutPalletError('');
    fetchFbsBoxStockReport(session.accessToken, {
      clientId: selectedClientId,
      page: withoutPalletPage,
      pageSize: 100,
      palletPage: 1,
      palletPageSize: 10,
    })
      .then((report) => {
        if (!cancelled) {
          setWithoutPalletReport(report);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setWithoutPalletReport(null);
          setWithoutPalletError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingWithoutPallet(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clients, session.accessToken, selectedClientId, showWithoutPallet, withoutPalletPage, withoutPalletRefresh]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!showSuggestions || !cleanQuery) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError('');
      fetchBoxes(session.accessToken, { code: cleanQuery, archive: showArchive })
        .then((boxes) => {
          if (!cancelled) {
            setSuggestions(boxes);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setSuggestions([]);
            setSearchError(errorMessage(caught));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, session.accessToken, showArchive, showSuggestions]);

  useEffect(() => {
    const cleanCode = actionState?.targetBoxCode.trim() ?? '';
    const clientId = details.data?.box.client.id;
    if (!actionState || !clientId || cleanCode.length < 2) {
      setTargetSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchBoxes(session.accessToken, { clientId, code: cleanCode })
        .then((boxes) => {
          if (!cancelled) {
            setTargetSuggestions(boxes.slice(0, 20));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTargetSuggestions([]);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actionState?.targetBoxCode, details.data?.box.client.id, session.accessToken]);

  async function loadBox(box: BoxSelection) {
    setSelectedBox(box);
    setQuery(box.code);
    setShowSuggestions(false);
    setSearchError('');
    setActionMessage('');
    setDetails((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const loaded = await fetchTurnoverBoxDetails(session.accessToken, box.code, { clientId: box.clientId });
      setDetails({ status: 'ready', data: loaded });
    } catch (caught) {
      setDetails({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  async function refreshSelectedBox() {
    if (selectedBox) {
      await loadBox(selectedBox);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    const exactMatches = suggestions.filter((box) => box.code.trim().toLocaleLowerCase('ru-RU') === normalizedQuery);
    const candidate = exactMatches.length === 1 ? exactMatches[0] : suggestions.length === 1 ? suggestions[0] : null;

    if (candidate) {
      void loadBox(candidate);
      return;
    }

    setShowSuggestions(true);
    setSearchError(suggestions.length > 1 ? 'Выберите нужный короб из списка.' : 'Короб не найден.');
  }

  function startAction(item: TurnoverBoxDetails['contents'][number], action: TurnoverActionKind) {
    const currentBox = details.data?.box.code ?? '';
    setActionState({
      item,
      action,
      quantity: '1',
      targetBoxCode: action === 'ADD' || action === 'HOLD' ? currentBox : '',
      targetBarcode: '',
      reason: '',
      kiz: '',
      comment: '',
    });
    setActionError('');
    setActionMessage('');
  }

  function switchArchive(nextArchive: boolean) {
    setShowArchive(nextArchive);
    setShowWithoutPallet(false);
    setQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError('');
    setSelectedBox(null);
    setDetails({ status: 'idle', data: null });
    setActionState(null);
    setActionError('');
    setActionMessage('');
  }

  function switchWithoutPallet() {
    setShowArchive(false);
    setShowWithoutPallet(true);
    setQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError('');
    setSelectedBox(null);
    setDetails({ status: 'idle', data: null });
    setActionState(null);
    setActionError('');
    setActionMessage('');
    setWithoutPalletPage(1);
  }

  function updateAction<K extends keyof Omit<BoxActionState, 'item'>>(key: K, value: BoxActionState[K]) {
    setActionState((current) => (current ? { ...current, [key]: value } : current));
    setActionError('');
  }

  async function submitAction() {
    const box = details.data?.box;
    if (!actionState || !box) {
      return;
    }

    const quantity = Number(actionState.quantity);
    const needsTarget = ['ADD', 'TRANSFER', 'HOLD'].includes(actionState.action);
    const needsReason = ['WRITE_OFF', 'HOLD', 'REPLACE_BARCODE'].includes(actionState.action);
    const targetBoxCode = actionState.targetBoxCode.trim();

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setActionError('Количество должно быть целым числом больше нуля.');
      return;
    }
    if (actionState.action !== 'ADD' && quantity > actionState.item.quantity) {
      setActionError(`В коробе доступно только ${formatNumber(actionState.item.quantity)} шт.`);
      return;
    }
    if (needsTarget && !targetBoxCode) {
      setActionError('Укажите короб назначения.');
      return;
    }
    if (actionState.action === 'REPLACE_BARCODE' && !actionState.targetBarcode.trim()) {
      setActionError('Отсканируйте или введите правильный ШК товара.');
      return;
    }
    if (needsReason && !actionState.reason.trim()) {
      setActionError('Укажите причину операции.');
      return;
    }

    setSubmitting(true);
    setActionError('');

    try {
      await runTurnoverAction(session.accessToken, {
        clientId: box.client.id,
        skuId: actionState.item.skuId,
        action: actionState.action,
        quantity,
        sourceBoxCode: actionState.action === 'ADD' ? undefined : box.code,
        sourceBalanceId: actionState.action === 'REPLACE_BARCODE' ? actionState.item.balanceId : undefined,
        targetBarcode: actionState.action === 'REPLACE_BARCODE' ? actionState.targetBarcode.trim() : undefined,
        targetBoxCode: needsTarget ? targetBoxCode : undefined,
        reason: actionState.reason.trim() || undefined,
        kiz: actionState.kiz.trim() || undefined,
        comment: actionState.comment.trim() || undefined,
        idempotencyKey: `warehouse-box:${box.id}:${actionState.action}:${actionState.item.skuId}:${Date.now()}`,
      });
      setActionState(null);
      setActionMessage(`${actionLabels[actionState.action]}: операция проведена.`);
      await refreshSelectedBox();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="warehouse-box-manager">
      <div className="warehouse-box-view-toggle" role="group" aria-label="Режим просмотра коробов">
        <button
          className={!showArchive && !showWithoutPallet ? 'is-active' : ''}
          type="button"
          onClick={() => switchArchive(false)}
        >
          <Box size={16} aria-hidden="true" />
          Короба на складе
        </button>
        <button
          className={showArchive ? 'is-active' : ''}
          type="button"
          onClick={() => switchArchive(true)}
        >
          <Archive size={16} aria-hidden="true" />
          Архив коробов
        </button>
        <button
          className={showWithoutPallet ? 'is-active' : ''}
          type="button"
          onClick={switchWithoutPallet}
        >
          <Boxes size={16} aria-hidden="true" />
          Без паллет-сорта
        </button>
      </div>
      <p className="warehouse-box-view-note">
        {showWithoutPallet
          ? 'Все короба с фактическим товаром, для которых сейчас не указан паллет-сорт.'
          : showArchive
            ? 'Найдите удалённый или архивный короб по номеру и откройте сохранённую историю его движений.'
            : 'Поиск действующих коробов, просмотр содержимого и складские операции.'}
      </p>
      {!showWithoutPallet ? <form className="warehouse-box-search" onSubmit={submitSearch}>
        <label className="warehouse-box-search__field">
          <span>Номер короба</span>
          <div className="warehouse-box-search__input">
            <Search size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowSuggestions(true);
                setSearchError('');
              }}
              onFocus={() => setShowSuggestions(Boolean(query.trim()))}
              placeholder={showArchive ? 'Номер короба из архива' : 'Начните вводить номер короба…'}
              autoComplete="off"
            />
            {isSearching ? <RefreshCw className="is-spinning" size={16} aria-hidden="true" /> : null}
          </div>

          {showSuggestions && query.trim() ? (
            <div className="warehouse-box-suggestions" role="listbox" aria-label="Найденные короба">
              {visibleSuggestions.map((box) => (
                <button key={box.id} type="button" onClick={() => void loadBox(box)}>
                  <Box size={17} aria-hidden="true" />
                  <span>
                    <strong>{box.code}</strong>
                    <small>
                      {box.client.name} · {boxStatusLabel(box.status)}
                      {box.storagePlacement
                        ? ` · ${box.storagePlacement.pallet.zone?.name ?? 'Без зоны'} / ${box.storagePlacement.pallet.code}`
                        : ' · место не задано'}
                    </small>
                  </span>
                  <em>{box._count.balances} поз.</em>
                </button>
              ))}
              {!isSearching && visibleSuggestions.length === 0 ? <p>Совпадений нет.</p> : null}
            </div>
          ) : null}
        </label>
        <button className="primary-button" type="submit" disabled={!query.trim() || isSearching}>
          <Search size={16} aria-hidden="true" />
          <span>Открыть</span>
        </button>
        {selectedBox ? (
          <button className="secondary-button" type="button" onClick={() => void refreshSelectedBox()} disabled={details.status === 'loading'}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Обновить</span>
          </button>
        ) : null}
      </form> : (
        <WithoutPalletBoxes
          clients={clients}
          clientId={selectedClientId}
          report={withoutPalletReport}
          page={withoutPalletPage}
          isLoading={isLoadingClients || isLoadingWithoutPallet}
          error={withoutPalletError}
          onClientChange={(clientId) => {
            setSelectedClientId(clientId);
            setWithoutPalletPage(1);
            setSelectedBox(null);
            setDetails({ status: 'idle', data: null });
          }}
          onRefresh={() => setWithoutPalletRefresh((current) => current + 1)}
          onPage={setWithoutPalletPage}
          onOpenBox={(boxCode) => void loadBox({ clientId: selectedClientId, code: boxCode })}
        />
      )}

      {!showWithoutPallet && searchError ? <p className="form-error">{searchError}</p> : null}
      {actionMessage ? <p className="form-success">{actionMessage}</p> : null}
      {details.status === 'loading' ? <p className="warehouse-inline">Загружаю короб.</p> : null}
      {details.error ? <p className="form-error">{details.error}</p> : null}

      {details.data ? (
        <BoxCard
          details={details.data}
          readOnly={showArchive}
          onAction={startAction}
          onClose={() => {
            setSelectedBox(null);
            setDetails({ status: 'idle', data: null });
            setQuery('');
          }}
        />
      ) : null}

      {!showArchive && actionState && details.data ? (
        <BoxActionDialog
          state={actionState}
          box={details.data.box.code}
          isSubmitting={isSubmitting}
          error={actionError}
          targetSuggestions={targetSuggestions}
          onChange={updateAction}
          onCancel={() => setActionState(null)}
          onSubmit={() => void submitAction()}
        />
      ) : null}
    </div>
  );
}

// ADDED: one visible group per physical box; every content line remains available.
export function groupWithoutPalletItems(items: WithoutPalletItem[]): WithoutPalletBoxGroup[] {
  const groups = new Map<string, WithoutPalletBoxGroup>();
  for (const item of items) {
    const current = groups.get(item.boxCode);
    if (current) {
      current.contents.push(item);
      continue;
    }
    groups.set(item.boxCode, {
      boxCode: item.boxCode,
      warehouse: item.warehouse,
      location: item.location,
      status: item.status,
      boxTotal: item.boxTotal,
      contents: [item],
    });
  }
  return [...groups.values()];
}

function WithoutPalletBoxes({
  clients,
  clientId,
  report,
  page,
  isLoading,
  error,
  onClientChange,
  onRefresh,
  onPage,
  onOpenBox,
}: {
  clients: ClientSummary[];
  clientId: string;
  report: FbsBoxStockReport | null;
  page: number;
  isLoading: boolean;
  error: string;
  onClientChange: (clientId: string) => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
  onOpenBox: (boxCode: string) => void;
}) {
  const groups = groupWithoutPalletItems(report?.withoutPallet.items ?? []);
  const pages = report?.withoutPallet.pagination.pages ?? 1;

  return (
    <section className="warehouse-unpalleted" aria-label="Короба без паллет-сорта">
      <div className="warehouse-unpalleted__toolbar">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => onClientChange(event.target.value)} disabled={isLoading && clients.length === 0}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!clientId || isLoading}>
          <RefreshCw className={isLoading ? 'is-spinning' : ''} size={16} aria-hidden="true" />
          <span>{isLoading ? 'Проверяю' : 'Обновить список'}</span>
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {report ? (
        <div className="warehouse-unpalleted__summary" aria-live="polite">
          <span><strong>{formatNumber(report.withoutPallet.summary.boxes)}</strong> коробов без паллет-сорта</span>
          <span><strong>{formatNumber(report.withoutPallet.summary.units)}</strong> единиц товара</span>
          <span><strong>{formatNumber(report.withoutPallet.summary.rows)}</strong> товарных позиций</span>
        </div>
      ) : null}

      <div className="warehouse-box-table-wrap warehouse-unpalleted__table-wrap">
        <table className="warehouse-box-table warehouse-unpalleted__table">
          <thead>
            <tr>
              <th>Короб</th>
              <th>Склад / место</th>
              <th>Содержимое</th>
              <th>ШК</th>
              <th>Статус короба</th>
              <th>Кол-во</th>
              <th>Всего в коробе</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && clientId && groups.length === 0 && !error ? (
              <tr><td colSpan={7}>Коробов с товаром без паллет-сорта не найдено.</td></tr>
            ) : null}
            {isLoading && !report ? <tr><td colSpan={7}>Проверяю размещение коробов…</td></tr> : null}
            {!clientId && !isLoading ? <tr><td colSpan={7}>Выберите клиента, чтобы увидеть короба.</td></tr> : null}
            {groups.map((group) => group.contents.map((item, index) => (
              <tr key={`${group.boxCode}:${item.barcode || item.article}:${index}`}>
                {index === 0 ? (
                  <td rowSpan={group.contents.length}>
                    <button className="warehouse-unpalleted__box-link" type="button" onClick={() => onOpenBox(group.boxCode)}>
                      {group.boxCode}
                    </button>
                  </td>
                ) : null}
                {index === 0 ? <td rowSpan={group.contents.length}><strong>{group.warehouse}</strong><span>{group.location}</span></td> : null}
                <td><strong>{item.article || 'Артикул не указан'}</strong></td>
                <td>{item.barcode || '—'}</td>
                {index === 0 ? <td rowSpan={group.contents.length}>{boxStatusLabel(group.status)}</td> : null}
                <td><strong>{formatNumber(item.quantity)}</strong></td>
                {index === 0 ? <td rowSpan={group.contents.length}><strong>{formatNumber(group.boxTotal)}</strong></td> : null}
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      {report && pages > 1 ? (
        <nav className="warehouse-unpalleted__pager" aria-label="Страницы коробов без паллет-сорта">
          <button className="secondary-button" type="button" disabled={isLoading || page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Назад</span>
          </button>
          <span>Страница {page} из {pages}</span>
          <button className="secondary-button" type="button" disabled={isLoading || page >= pages} onClick={() => onPage(page + 1)}>
            <span>Дальше</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function BoxCard({
  details,
  readOnly,
  onAction,
  onClose,
}: {
  details: TurnoverBoxDetails;
  readOnly: boolean;
  onAction: (item: TurnoverBoxDetails['contents'][number], action: TurnoverActionKind) => void;
  onClose: () => void;
}) {
  return (
    <div className="warehouse-box-card">
      <header className="warehouse-box-card__header">
        <div>
          <span>{details.box.client.name}</span>
          <h3>{details.box.code}</h3>
          <small>{boxStatusLabel(details.box.status)}</small>
          <small>
            {details.box.storagePlacement
              ? `Место: ${details.box.storagePlacement.pallet.zone?.name ?? 'без зоны'} / ${details.box.storagePlacement.pallet.code}`
              : 'Место хранения не задано'}
          </small>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Закрыть карточку" aria-label="Закрыть карточку короба">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="warehouse-box-metrics">
        <Metric label="Позиций" value={details.totals.rows} />
        <Metric label="SKU" value={details.totals.skuCount} />
        <Metric label="Единиц" value={details.totals.quantity} />
        <Metric label="КИЗ" value={details.totals.kizCount} />
      </div>

      <div className="warehouse-box-table-wrap">
        <table className="warehouse-box-table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>ШК</th>
              <th>Цвет / размер</th>
              <th>Статус</th>
              <th>Кол-во</th>
              <th>КИЗ</th>
              {!readOnly ? <th>Изменить</th> : null}
            </tr>
          </thead>
          <tbody>
            {details.contents.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 6 : 7}>В коробе нет текущего остатка.</td>
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
                <td><strong>{formatNumber(item.quantity)}</strong></td>
                <td>
                  {item.kiz.length ? (
                    <span className="warehouse-box-kiz" title={item.kiz.join('\n')}>
                      {item.kiz.slice(0, 2).join(', ')}{item.kizCount > 2 ? ` · еще ${formatNumber(item.kizCount - 2)}` : ''}
                    </span>
                  ) : '-'}
                </td>
                {!readOnly ? <td>
                  <div className="warehouse-box-row-actions">
                    <button type="button" onClick={() => onAction(item, 'TRANSFER')} title="Перенести товар">
                      <ArrowRightLeft size={14} aria-hidden="true" />
                      <span>Перенести</span>
                    </button>
                    <button type="button" onClick={() => onAction(item, 'WRITE_OFF')} title="Списать товар">
                      <Trash2 size={14} aria-hidden="true" />
                      <span>Списать</span>
                    </button>
                    <button type="button" onClick={() => onAction(item, 'HOLD')} title="Отложить товар">
                      <CirclePause size={14} aria-hidden="true" />
                      <span>Отложить</span>
                    </button>
                    <button type="button" onClick={() => onAction(item, 'ADD')} title="Добавить количество">
                      <CirclePlus size={14} aria-hidden="true" />
                      <span>Добавить</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(item, 'REPLACE_BARCODE')}
                      disabled={item.kizCount > 0 || !['AVAILABLE', 'RECEIVING', 'UNMARKED', 'NEEDS_LABEL', 'NEEDS_RELABEL'].includes(item.status)}
                      title={item.kizCount > 0 ? 'Для товара с КИЗом автоматическая замена ШК запрещена' : 'Исправить ошибочно принятый ШК'}
                    >
                      <ScanBarcode size={14} aria-hidden="true" />
                      <span>Исправить ШК</span>
                    </button>
                  </div>
                </td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="warehouse-box-history" open={readOnly ? true : undefined}>
        <summary>История движений <span>{details.movements.length}</span></summary>
        <div className="warehouse-box-table-wrap">
          <table className="warehouse-box-table warehouse-box-table--history">
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
                <tr><td colSpan={5}>Движений пока нет.</td></tr>
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
      </details>
    </div>
  );
}

function BoxActionDialog({
  state,
  box,
  isSubmitting,
  error,
  targetSuggestions,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: BoxActionState;
  box: string;
  isSubmitting: boolean;
  error: string;
  targetSuggestions: WarehouseBoxSummary[];
  onChange: <K extends keyof Omit<BoxActionState, 'item'>>(key: K, value: BoxActionState[K]) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const needsTarget = ['ADD', 'TRANSFER', 'HOLD'].includes(state.action);
  const needsReason = ['WRITE_OFF', 'HOLD', 'REPLACE_BARCODE'].includes(state.action);

  return (
    <div className="warehouse-box-dialog-backdrop" role="presentation">
      <section className="warehouse-box-dialog" role="dialog" aria-modal="true" aria-labelledby="warehouse-box-dialog-title">
        <header>
          <span className="warehouse-box-dialog__icon">
            {state.action === 'WRITE_OFF' ? <Trash2 size={20} aria-hidden="true" /> : <PackageOpen size={20} aria-hidden="true" />}
          </span>
          <div>
            <p>{actionLabels[state.action]}</p>
            <h3 id="warehouse-box-dialog-title">{state.item.name}</h3>
            <small>{box} · доступно {formatNumber(state.item.quantity)} шт.</small>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} disabled={isSubmitting} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="warehouse-box-dialog__grid">
          <label>
            <span>Количество</span>
            <input min="1" type="number" value={state.quantity} onChange={(event) => onChange('quantity', event.target.value)} />
          </label>

          {state.action === 'REPLACE_BARCODE' ? (
            <label>
              <span>Новый правильный ШК</span>
              <input
                value={state.targetBarcode}
                onChange={(event) => onChange('targetBarcode', event.target.value)}
                placeholder="Отсканируйте или введите ШК"
                autoComplete="off"
                autoFocus
              />
            </label>
          ) : null}

          {needsTarget ? (
            <label>
              <span>Короб назначения</span>
              <input
                value={state.targetBoxCode}
                onChange={(event) => onChange('targetBoxCode', event.target.value)}
                placeholder="Номер короба назначения"
                list="warehouse-box-target-suggestions"
                autoComplete="off"
              />
              <datalist id="warehouse-box-target-suggestions">
                {targetSuggestions.map((target) => <option key={target.id} value={target.code}>{target.client.name}</option>)}
              </datalist>
            </label>
          ) : null}

          {needsReason ? (
            <label className="warehouse-box-dialog__wide">
              <span>Причина</span>
              <input value={state.reason} onChange={(event) => onChange('reason', event.target.value)} placeholder="Обязательное поле" />
            </label>
          ) : null}

          {state.action !== 'REPLACE_BARCODE' ? (
            <label className="warehouse-box-dialog__wide">
              <span>КИЗ</span>
              <textarea value={state.kiz} onChange={(event) => onChange('kiz', event.target.value)} placeholder="При необходимости: через запятую или с новой строки" />
            </label>
          ) : null}

          <label className="warehouse-box-dialog__wide">
            <span>Комментарий</span>
            <textarea value={state.comment} onChange={(event) => onChange('comment', event.target.value)} placeholder="Комментарий к операции" />
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <footer>
          <button className="secondary-button" type="button" onClick={onCancel} disabled={isSubmitting}>Отмена</button>
          <button className={state.action === 'WRITE_OFF' ? 'danger-button' : 'primary-button'} type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Сохраняю' : actionLabels[state.action]}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function boxStatusLabel(status: string) {
  const labels: Record<string, string> = {
    available: 'На хранении',
    receiving: 'Приемка',
    closed: 'Закрыт',
    packed: 'Упакован',
    shipped: 'Отгружен',
    deleted: 'Удален',
    archived: 'В архиве',
  };
  return labels[status.toLocaleLowerCase('ru-RU')] ?? status;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
