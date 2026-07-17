import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  TsdReceiptReviewBoxCheck,
  TsdReceiptReviewDashboard,
  TsdReceiptReviewItem,
  TsdReceiptReviewResult,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import './tsd-receipt-review.css';

type TsdReceiptReviewPanelProps = {
  dashboard: TsdReceiptReviewDashboard | null;
  error?: string;
  isLoading: boolean;
  onAcceptWithError: (item: TsdReceiptReviewItem) => Promise<void>;
  onDownloadBoxesXlsx: (clientId?: string) => Promise<Blob>;
  onRefresh: () => void;
};

type ReviewFilter = 'ALL' | 'NOT_RECEIVED' | TsdReceiptReviewResult;

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function TsdReceiptReviewPanel({
  dashboard,
  error,
  isLoading,
  onAcceptWithError,
  onDownloadBoxesXlsx,
  onRefresh,
}: TsdReceiptReviewPanelProps) {
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pendingItem, setPendingItem] = useState<TsdReceiptReviewItem | null>(null);
  const [isConfirming, setConfirming] = useState(false);
  const [expandedBoxKey, setExpandedBoxKey] = useState<string | null>(null);
  const [showAllBoxesToCheck, setShowAllBoxesToCheck] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const clients = useMemo(() => {
    const map = new Map<string, TsdReceiptReviewItem['client']>();
    dashboard?.items.forEach((item) => map.set(item.client.id, item.client));
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [dashboard]);

  const boxIssuesByKey = useMemo(() => {
    const map = new Map<string, TsdReceiptReviewItem[]>();
    dashboard?.items.forEach((item) => {
      if ((item.result !== 'NOT_ACCEPTED' && item.result !== 'REJECTED') || !item.boxCode) {
        return;
      }
      const key = reviewBoxKey(item.client.id, item.boxCode);
      map.set(key, [...(map.get(key) ?? []), item]);
    });
    return map;
  }, [dashboard]);

  const filteredBoxesToCheck = useMemo(
    () => (dashboard?.boxesToCheck ?? []).filter((box) => !clientId || box.client.id === clientId),
    [clientId, dashboard],
  );
  const visibleBoxesToCheck = showAllBoxesToCheck ? filteredBoxesToCheck : filteredBoxesToCheck.slice(0, 20);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    return (dashboard?.items ?? []).filter((item) => {
      if (clientId && item.client.id !== clientId) {
        return false;
      }
      if (
        filter !== 'ALL' &&
        !(filter === 'NOT_RECEIVED' && (item.result === 'NOT_ACCEPTED' || item.result === 'REJECTED')) &&
        item.result !== filter
      ) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return searchableText(item).includes(normalizedQuery);
    });
  }, [clientId, dashboard, filter, query]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visiblePage = Math.min(page, pageCount);
  const pageItems = filteredItems.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [clientId, filter, pageSize, query]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  async function confirmAcceptance() {
    if (!pendingItem) {
      return;
    }
    setConfirming(true);
    try {
      await onAcceptWithError(pendingItem);
      setPendingItem(null);
    } catch {
      // Ошибка уже показана родительской панелью; диалог остается открытым для повторной проверки.
    } finally {
      setConfirming(false);
    }
  }

  function focusBoxIssues(box: TsdReceiptReviewBoxCheck) {
    setClientId(box.client.id);
    setQuery(box.boxCode);
    setFilter('NOT_RECEIVED');
    setPage(1);
  }

  async function downloadBoxesXlsx() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await onDownloadBoxesXlsx(clientId || undefined);
      const selectedClient = clients.find((client) => client.id === clientId);
      downloadBlob(
        blob,
        `proverka-korobov-tsd${selectedClient?.code ? `-${safeFileName(selectedClient.code)}` : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать Excel для проверки коробов.');
    } finally {
      setDownloading(false);
    }
  }

  if (!dashboard && isLoading) {
    return <p className="panel-message">Загружаю данные приемки ТСД.</p>;
  }

  return (
    <div className="tsd-receipt-review">
      <div className="tsd-receipt-review__head">
        <div>
          <h3>Приемка товаров через ТСД</h3>
          <span>Обновлено {formatDateTime(dashboard?.generatedAt)}</span>
        </div>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={isLoading} title="Обновить приемку">
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="panel-message panel-message--error">{error}</p> : null}
      {downloadError ? <p className="panel-message panel-message--error">{downloadError}</p> : null}
      {isLoading && dashboard ? <p className="inline-status">Обновляю данные.</p> : null}

      <div className="tsd-receipt-review__stats">
        <MetricButton
          icon={CheckCircle2}
          label="Принято штатно"
          tone="success"
          value={dashboard?.stats.acceptedQuantity ?? 0}
          active={filter === 'ACCEPTED'}
          onClick={() => setFilter(filter === 'ACCEPTED' ? 'ALL' : 'ACCEPTED')}
        />
        <MetricButton
          icon={XCircle}
          label="Не принято"
          tone="danger"
          value={dashboard?.stats.notAcceptedQuantity ?? 0}
          active={filter === 'NOT_RECEIVED'}
          onClick={() => setFilter(filter === 'NOT_RECEIVED' ? 'ALL' : 'NOT_RECEIVED')}
        />
        <MetricButton
          icon={ShieldAlert}
          label="Принято с ошибкой"
          tone="warning"
          value={dashboard?.stats.acceptedWithErrorQuantity ?? 0}
          active={filter === 'ACCEPTED_WITH_ERROR'}
          onClick={() => setFilter(filter === 'ACCEPTED_WITH_ERROR' ? 'ALL' : 'ACCEPTED_WITH_ERROR')}
        />
        <MetricButton
          icon={AlertTriangle}
          label="Дубли КИЗ"
          tone="violet"
          value={dashboard?.stats.duplicateKizQuantity ?? 0}
          active={false}
          onClick={() => {
            setFilter('ALL');
            setQuery('ДУБЛЬ КИЗ');
          }}
        />
      </div>

      <section className="tsd-box-checks" aria-label="Короба на проверку">
        <div className="tsd-box-checks__head">
          <div className="tsd-box-checks__title">
            <ClipboardCheck size={19} aria-hidden="true" />
            <div>
              <h4>Короба на проверку</h4>
              <p>Здесь собраны короба, в которых сканы товара не попали в остатки WMS.</p>
            </div>
          </div>
          <div className="tsd-box-checks__head-actions">
            <button
              className="review-action review-action--xlsx"
              type="button"
              onClick={() => void downloadBoxesXlsx()}
              disabled={isDownloading}
            >
              <FileSpreadsheet size={16} aria-hidden="true" />
              <span>{isDownloading ? 'Готовлю Excel…' : 'Скачать Excel'}</span>
            </button>
            <strong className="tsd-box-checks__count">{filteredBoxesToCheck.length}</strong>
          </div>
        </div>

        <div className="tsd-box-checks__table-wrap">
          <table className="tsd-box-checks__table">
            <thead>
              <tr>
                <th>Клиент / короб</th>
                <th>Учтено в WMS</th>
                <th>Не принято</th>
                <th>Диапазон пересчета</th>
                <th>Проблемы</th>
                <th>Последняя ошибка</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleBoxesToCheck.length ? (
                visibleBoxesToCheck.map((box) => {
                  const key = reviewBoxKey(box.client.id, box.boxCode);
                  const issues = boxIssuesByKey.get(key) ?? [];
                  const isExpanded = expandedBoxKey === key;
                  return (
                    <Fragment key={key}>
                      <tr className="tsd-box-checks__row">
                        <td>
                          <strong>{box.client.name}</strong>
                          <code>{box.boxCode}</code>
                          {!box.boxExists ? <span className="tsd-box-checks__missing">Короб не найден в остатках</span> : null}
                        </td>
                        <td><strong>{box.accountedQuantity}</strong> шт.</td>
                        <td><strong className="tsd-box-checks__danger">+{box.notAcceptedQuantity}</strong> шт.</td>
                        <td>
                          <strong className="tsd-box-checks__expected">
                            {box.accountedQuantity}–{box.maximumPhysicalQuantity}
                          </strong>{' '}
                          шт.
                        </td>
                        <td>
                          <strong>{box.issueOperations} {pluralizeIssue(box.issueOperations)}</strong>
                          {box.duplicateKizQuantity ? <span>Дубли КИЗ: {box.duplicateKizQuantity}</span> : null}
                        </td>
                        <td>{formatDateTime(box.lastIssueAt)}</td>
                        <td>
                          <div className="tsd-box-checks__actions">
                            <button className="review-action" type="button" onClick={() => focusBoxIssues(box)}>
                              <Search size={15} aria-hidden="true" />
                              <span>Строки</span>
                            </button>
                            <button
                              className={`icon-button tsd-box-checks__toggle ${isExpanded ? 'is-open' : ''}`}
                              type="button"
                              onClick={() => setExpandedBoxKey(isExpanded ? null : key)}
                              title={isExpanded ? 'Скрыть проблемные товары' : 'Показать проблемные товары'}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown size={17} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="tsd-box-checks__details-row">
                          <td colSpan={7}>
                            <div className="tsd-box-checks__issues">
                              {issues.map((item) => (
                                <div className="tsd-box-checks__issue" key={item.id}>
                                  <div>
                                    <strong>{item.sku?.name || 'Товар без карточки'}</strong>
                                    <span>ШК: {item.barcode || item.sku?.barcode || '-'}</span>
                                  </div>
                                  <div>
                                    <strong>{item.quantity} шт.</strong>
                                    <span>{reasonLabel(item)}</span>
                                  </div>
                                  <div>
                                    <code>{item.kiz || 'КИЗ не указан'}</code>
                                    <strong className={`tsd-kiz-assessment tsd-kiz-assessment--${assessmentTone(item)}`}>
                                      {item.kizAssessment.label}
                                    </strong>
                                    <span>{item.kizAssessment.guidance}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>Коробов с непринятыми товарами нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredBoxesToCheck.length > 20 ? (
          <button className="tsd-box-checks__more" type="button" onClick={() => setShowAllBoxesToCheck((current) => !current)}>
            {showAllBoxesToCheck ? 'Показать первые 20' : `Показать все ${filteredBoxesToCheck.length}`}
          </button>
        ) : null}
        <p className="tsd-box-checks__note">
          Нижняя граница — учет WMS. Верхняя — если каждый проблемный скан относится к отдельной единице. Повторные сканы возможны, поэтому короб нужно пересчитать физически.
        </p>
      </section>

      <div className="tsd-receipt-review__filters">
        <label className="tsd-receipt-review__search">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Короб, ШК, КИЗ, товар, артикул"
          />
        </label>
        <select value={clientId} onChange={(event) => setClientId(event.target.value)} aria-label="Клиент приемки">
          <option value="">Все клиенты</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <select value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} aria-label="Результат приемки">
          <option value="ALL">Все результаты</option>
          <option value="NOT_RECEIVED">Все непринятые</option>
          <option value="NOT_ACCEPTED">Требуют решения</option>
          <option value="ACCEPTED">Приняты штатно</option>
          <option value="ACCEPTED_WITH_ERROR">Приняты с ошибкой</option>
          <option value="REJECTED">Отклонены</option>
        </select>
      </div>

      <div className="tsd-receipt-review__summary">
        Найдено строк: <strong>{filteredItems.length}</strong> из <strong>{dashboard?.stats.totalOperations ?? 0}</strong> · единиц:
        <strong> {sumQuantity(filteredItems)}</strong>
        <div className="tsd-receipt-review__pager">
          <label>
            На странице
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button className="icon-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={visiblePage <= 1} title="Предыдущая страница">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span>{visiblePage} из {pageCount}</span>
          <button className="icon-button" type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={visiblePage >= pageCount} title="Следующая страница">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tsd-receipt-review__table-wrap">
        <table className="tsd-receipt-review__table">
          <thead>
            <tr>
              <th>Результат</th>
              <th>Клиент / короб</th>
              <th>Отсканированный товар</th>
              <th>КИЗ и найденный дубль</th>
              <th>Причина</th>
              <th>Кто / когда</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length ? (
              pageItems.map((item) => (
                <tr className={`tsd-receipt-review__row tsd-receipt-review__row--${resultClass(item.result)}`} key={item.id}>
                  <td>
                    <ResultBadge result={item.result} />
                    <span>{item.quantity} шт.</span>
                  </td>
                  <td>
                    <strong>{item.client.name}</strong>
                    <span className="tsd-receipt-review__box">{item.boxCode || 'Короб не указан'}</span>
                    {item.sourceDocument ? <span>{item.sourceDocument}</span> : null}
                  </td>
                  <td>
                    <strong>{item.sku?.name || 'Карточка товара не найдена'}</strong>
                    <span>{productDetails(item)}</span>
                    <span>ШК: {item.barcode || item.sku?.barcode || '-'}</span>
                  </td>
                  <td>
                    <code>{item.kiz || 'КИЗ не указан'}</code>
                    <div className={`tsd-kiz-assessment tsd-kiz-assessment--${assessmentTone(item)}`}>
                      <strong>{item.kizAssessment.label}</strong>
                      <span>{item.kizAssessment.guidance}</span>
                      {item.kizAssessment.scanOccurrences > 1 ? (
                        <span>Сканов этого КИЗ: {item.kizAssessment.scanOccurrences}</span>
                      ) : null}
                    </div>
                    {item.duplicate ? (
                      <div className="tsd-receipt-review__duplicate">
                        <strong>Уже числится: {item.duplicate.boxCode || 'короб не указан'}</strong>
                        <span>{item.duplicate.name}</span>
                        <span>{duplicateDetails(item)}</span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <strong>{reasonLabel(item)}</strong>
                    <span>{item.message || 'Ошибок нет'}</span>
                  </td>
                  <td>
                    <strong>{item.operatorName || 'Оператор не определен'}</strong>
                    <span>{item.deviceCode}</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </td>
                  <td>
                    {item.result === 'NOT_ACCEPTED' ? (
                      <button className="review-action review-action--accept-error" type="button" onClick={() => setPendingItem(item)}>
                        <PackageCheck size={16} aria-hidden="true" />
                        <span>Принять с ошибкой</span>
                      </button>
                    ) : (
                      <span>{item.result === 'ACCEPTED_WITH_ERROR' ? 'Оставлено в журнале' : 'Действий не требуется'}</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>По выбранным условиям строк приемки нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingItem ? (
        <ConfirmDialog
          title="Принять товар с ошибкой?"
          message="Фактическая единица будет добавлена в указанный короб и останется отмеченной красным. Занятый КИЗ повторно не привязывается."
          details={acceptanceDetails(pendingItem)}
          confirmLabel={`Принять ${pendingItem.quantity} шт. с ошибкой`}
          isBusy={isConfirming}
          onCancel={() => setPendingItem(null)}
          onConfirm={() => void confirmAcceptance()}
        />
      ) : null}
    </div>
  );
}

function MetricButton({
  active,
  icon: Icon,
  label,
  onClick,
  tone,
  value,
}: {
  active: boolean;
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
  tone: 'success' | 'danger' | 'warning' | 'violet';
  value: number;
}) {
  return (
    <button
      className={`tsd-review-metric tsd-review-metric--${tone} ${active ? 'is-active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function ResultBadge({ result }: { result: TsdReceiptReviewResult }) {
  const labels: Record<TsdReceiptReviewResult, string> = {
    ACCEPTED: 'Принято',
    NOT_ACCEPTED: 'Не принято',
    ACCEPTED_WITH_ERROR: 'Принято с ошибкой',
    REJECTED: 'Отклонено',
  };
  return <span className={`tsd-review-result tsd-review-result--${resultClass(result)}`}>{labels[result]}</span>;
}

function resultClass(result: TsdReceiptReviewResult) {
  return result.toLocaleLowerCase('ru-RU').replaceAll('_', '-');
}

function searchableText(item: TsdReceiptReviewItem) {
  return [
    item.client.name,
    item.client.code,
    item.boxCode,
    item.barcode,
    item.kiz,
    item.sku?.name,
    item.sku?.article,
    item.sku?.internalSku,
    item.sku?.color,
    item.sku?.size,
    item.duplicate?.boxCode,
    item.duplicate?.name,
    item.duplicate?.article,
    item.message,
    item.kizAssessment.label,
    item.kizAssessment.guidance,
    ...item.kizAssessment.scannedBoxCodes,
    item.duplicate || (item.kizAssessment.kind !== 'NOT_PROVIDED' && item.kizAssessment.kind !== 'UNCONFIRMED')
      ? 'ДУБЛЬ КИЗ'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru-RU');
}

function assessmentTone(item: TsdReceiptReviewItem) {
  if (item.kizAssessment.likelyAccidental === true) {
    return 'repeat';
  }
  if (item.kizAssessment.likelyAccidental === false) {
    return 'conflict';
  }
  return 'unknown';
}

function productDetails(item: TsdReceiptReviewItem) {
  return [item.sku?.article || item.sku?.internalSku, item.sku?.color, item.sku?.size].filter(Boolean).join(' · ') || '-';
}

function duplicateDetails(item: TsdReceiptReviewItem) {
  if (!item.duplicate) {
    return '';
  }
  return [item.duplicate.article, item.duplicate.color, item.duplicate.size, item.duplicate.barcode]
    .filter(Boolean)
    .join(' · ');
}

function reasonLabel(item: TsdReceiptReviewItem) {
  if (item.duplicate) {
    return 'Дубль КИЗ';
  }
  if (item.result === 'ACCEPTED') {
    return 'Принято без ошибок';
  }
  if (item.result === 'ACCEPTED_WITH_ERROR') {
    return 'Ошибка подтверждена';
  }
  return 'Ошибка приемки';
}

function acceptanceDetails(item: TsdReceiptReviewItem) {
  return [
    `Клиент: ${item.client.name}`,
    `Добавить в короб: ${item.boxCode || 'не указан'}`,
    `Товар: ${item.sku?.name || item.barcode || 'не определен'}`,
    `Количество: ${item.quantity} шт.`,
    `Исходный КИЗ: ${item.kiz || 'не указан'}`,
    item.duplicate
      ? `Этот КИЗ уже числится в коробе ${item.duplicate.boxCode || 'без номера'}, товар «${item.duplicate.name}».`
      : `Ошибка: ${item.message || 'причина не указана'}`,
  ];
}

function sumQuantity(items: TsdReceiptReviewItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function reviewBoxKey(clientId: string, boxCode: string) {
  return `${clientId.trim().toLocaleUpperCase('ru-RU')}|${boxCode.trim().toLocaleUpperCase('ru-RU')}`;
}

function pluralizeIssue(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return 'ошибок';
  }
  if (mod10 === 1) {
    return 'ошибка';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'ошибки';
  }
  return 'ошибок';
}

function formatDateTime(value?: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : '-';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'client';
}
