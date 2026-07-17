import { Check, ClipboardCheck, MapPin, Save, Search, Send, Tag, Warehouse, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  fetchPickWaveBalanceReview,
  savePickWaveBalanceReview,
  submitPickWaveBalanceReview,
  type AuthSession,
  type PickWaveBalanceDecisionInput,
  type PickWaveBalanceReview,
} from '../../lib/api';

type Props = {
  session: AuthSession;
  reviews: PickWaveBalanceReview[];
  canWrite: boolean;
  onUpdated: () => void;
};

type AllocationDraft = {
  quantity: number;
  needsRelabel: boolean;
  targetBarcode: string;
  comment: string;
};

type LineDraft = {
  reviewed: boolean;
  keepQuantity: number;
  comment: string;
  allocations: Record<string, AllocationDraft>;
};

export function PickWaveBalanceReviewPanel({ session, reviews, canWrite, onUpdated }: Props) {
  const [active, setActive] = useState<PickWaveBalanceReview | null>(null);
  const [loadingId, setLoadingId] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (reviews.length === 0) {
    return null;
  }

  async function openReview(review: PickWaveBalanceReview) {
    setLoadingId(review.id);
    setError(null);
    try {
      setActive(await fetchPickWaveBalanceReview(session.accessToken, review.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingId('');
    }
  }

  return (
    <>
      <section className="balance-review-panel" aria-label="Проверка балансов волн">
        <header className="balance-review-panel__header">
          <div>
            <span className="eyebrow">Перед началом сборки</span>
            <h3>Проверьте балансы</h3>
            <p>Решите, какие остатки оставить на складе, а какие добавить в города текущей волны.</p>
          </div>
          <span className="balance-review-panel__counter">{reviews.length}</span>
        </header>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="balance-review-panel__list">
          {reviews.map((review) => (
            <article className="balance-review-card" key={review.id}>
              <div className="balance-review-card__main">
                <strong>{review.waveNumber}</strong>
                <span>{review.client?.name ?? 'Клиент'}</span>
                <small>
                  {review.requests.map((request) => request.destinationCity || request.title).join(' · ')}
                </small>
              </div>
              <div className="balance-review-card__stats">
                <span><b>{review.summary.pendingLines}</b> не проверено</span>
                <span><b>{formatInt(review.summary.totalRemaining)}</b> шт. в остатках</span>
                <span><b>{review.summary.smallBalanceLines}</b> малых остатков</span>
              </div>
              <button
                className="button button-primary balance-review-card__button"
                type="button"
                disabled={loadingId === review.id}
                onClick={() => void openReview(review)}
              >
                <ClipboardCheck size={17} aria-hidden="true" />
                {loadingId === review.id ? 'Открываю...' : 'Проверить балансы'}
              </button>
            </article>
          ))}
        </div>
      </section>

      {active ? (
        <BalanceReviewDialog
          session={session}
          initialReview={active}
          canWrite={canWrite}
          onClose={() => setActive(null)}
          onCompleted={() => {
            setActive(null);
            onUpdated();
          }}
        />
      ) : null}
    </>
  );
}

function BalanceReviewDialog({
  session,
  initialReview,
  canWrite,
  onClose,
  onCompleted,
}: {
  session: AuthSession;
  initialReview: PickWaveBalanceReview;
  canWrite: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [review, setReview] = useState(initialReview);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() => buildDrafts(initialReview));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'SMALL'>('ALL');
  const [status, setStatus] = useState<'idle' | 'saving' | 'submitting'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleLines = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return review.lines.filter((line) => {
      const draft = drafts[line.id];
      if (filter === 'PENDING' && draft?.reviewed) return false;
      if (filter === 'SMALL' && !line.isSmallBalance) return false;
      if (!normalized) return true;
      return [line.sourceBoxCode, line.internalSku, line.barcode, line.name, line.color, line.size]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(normalized));
    });
  }, [drafts, filter, query, review.lines]);

  const reviewedCount = Object.values(drafts).filter((draft) => draft.reviewed).length;
  const allReviewed = reviewedCount === review.lines.length;
  const disabled = status !== 'idle' || !canWrite;

  function updateAllocation(lineId: string, requestId: string, patch: Partial<AllocationDraft>) {
    const line = review.lines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    setDrafts((current) => {
      const currentLine = current[lineId];
      const currentAllocation = currentLine.allocations[requestId];
      const nextAllocation = { ...currentAllocation, ...patch };
      const otherQuantity = Object.entries(currentLine.allocations)
        .filter(([id]) => id !== requestId)
        .reduce((sum, [, allocation]) => sum + allocation.quantity, 0);
      nextAllocation.quantity = Math.max(0, Math.min(nextAllocation.quantity, line.remainingQuantity - otherQuantity));
      if (nextAllocation.quantity === 0) {
        nextAllocation.needsRelabel = false;
        nextAllocation.targetBarcode = '';
      }
      const allocations = { ...currentLine.allocations, [requestId]: nextAllocation };
      const allocated = Object.values(allocations).reduce((sum, allocation) => sum + allocation.quantity, 0);
      return {
        ...current,
        [lineId]: {
          ...currentLine,
          allocations,
          keepQuantity: line.remainingQuantity - allocated,
          reviewed: true,
        },
      };
    });
  }

  function sendAllTo(lineId: string, requestId: string) {
    const line = review.lines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    setDrafts((current) => {
      const allocations = Object.fromEntries(
        review.requests.map((request) => [
          request.id,
          {
            ...current[lineId].allocations[request.id],
            quantity: request.id === requestId ? line.remainingQuantity : 0,
            needsRelabel: request.id === requestId ? current[lineId].allocations[request.id].needsRelabel : false,
            targetBarcode: request.id === requestId ? current[lineId].allocations[request.id].targetBarcode : '',
          },
        ]),
      );
      return { ...current, [lineId]: { ...current[lineId], allocations, keepQuantity: 0, reviewed: true } };
    });
  }

  function keepLine(lineId: string) {
    const line = review.lines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    setDrafts((current) => ({
      ...current,
      [lineId]: {
        ...current[lineId],
        reviewed: true,
        keepQuantity: line.remainingQuantity,
        allocations: Object.fromEntries(
          review.requests.map((request) => [request.id, emptyAllocation()]),
        ),
      },
    }));
  }

  function keepAll() {
    setDrafts((current) =>
      Object.fromEntries(
        review.lines.map((line) => [
          line.id,
          {
            ...current[line.id],
            reviewed: true,
            keepQuantity: line.remainingQuantity,
            allocations: Object.fromEntries(review.requests.map((request) => [request.id, emptyAllocation()])),
          },
        ]),
      ),
    );
  }

  async function save() {
    const decisions = buildDecisionPayload(review, drafts, false);
    if (decisions.length === 0) {
      setError('Сначала примите решение хотя бы по одной строке.');
      return null;
    }
    setStatus('saving');
    setError(null);
    setMessage(null);
    try {
      const saved = await savePickWaveBalanceReview(session.accessToken, review.id, decisions);
      setReview(saved);
      setDrafts(buildDrafts(saved));
      setMessage(`Сохранено решений: ${saved.summary.reviewedLines} из ${saved.summary.lines}.`);
      return saved;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      setStatus('idle');
    }
  }

  async function submit() {
    if (!allReviewed) {
      setError(`Осталось проверить строк: ${review.lines.length - reviewedCount}.`);
      return;
    }
    setStatus('submitting');
    setError(null);
    setMessage(null);
    try {
      await savePickWaveBalanceReview(session.accessToken, review.id, buildDecisionPayload(review, drafts, true));
      await submitPickWaveBalanceReview(session.accessToken, review.id);
      onCompleted();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setStatus('idle');
    }
  }

  return (
    <div className="online-execution-modal balance-review-modal-shell" role="dialog" aria-modal="true" aria-label="Проверка балансов">
      <section className="online-execution-modal__panel balance-review-modal">
        <header className="online-execution-modal__header balance-review-modal__header">
          <div>
            <span>Проверка балансов · {review.waveNumber}</span>
            <h3>{review.client?.name}</h3>
            <small>{review.requests.map((request) => request.destinationCity || request.title).join(' · ')}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="balance-review-modal__toolbar">
          <label className="balance-review-search">
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Короб, товар, ШК или SKU" />
          </label>
          <div className="balance-review-filters" role="group" aria-label="Фильтр остатков">
            <button className={filter === 'ALL' ? 'is-active' : ''} type="button" onClick={() => setFilter('ALL')}>Все</button>
            <button className={filter === 'PENDING' ? 'is-active' : ''} type="button" onClick={() => setFilter('PENDING')}>Не проверены</button>
            <button className={filter === 'SMALL' ? 'is-active' : ''} type="button" onClick={() => setFilter('SMALL')}>До 5 шт.</button>
          </div>
          {canWrite ? (
            <button className="button button-secondary" type="button" disabled={disabled} onClick={keepAll}>
              <Warehouse size={16} aria-hidden="true" /> Оставить все
            </button>
          ) : null}
        </div>

        <div className="balance-review-modal__progress">
          <span>Проверено {reviewedCount} из {review.lines.length}</span>
          <div><i style={{ width: `${review.lines.length ? (reviewedCount / review.lines.length) * 100 : 100}%` }} /></div>
        </div>

        <div className="online-execution-modal__body balance-review-modal__body">
          {visibleLines.length === 0 ? <p className="empty-state">По этому фильтру остатков нет.</p> : null}
          {visibleLines.map((line) => {
            const draft = drafts[line.id];
            return (
              <article className={`balance-review-line ${draft.reviewed ? 'is-reviewed' : ''} ${line.isSmallBalance ? 'is-small' : ''}`} key={line.id}>
                <div className="balance-review-line__product">
                  <div className="balance-review-line__box">
                    <Warehouse size={17} aria-hidden="true" />
                    <strong>{line.sourceBoxCode}</strong>
                    {line.isSmallBalance ? <span>малый остаток</span> : null}
                  </div>
                  <h4>{line.name}</h4>
                  <p>{[line.internalSku, line.color, line.size].filter(Boolean).join(' · ')}</p>
                  <small>ШК: {line.barcode || 'не указан'}</small>
                  <div className="balance-review-line__numbers">
                    <span>Было <b>{line.originalQuantity}</b></span>
                    <span>Уже в заявках <b>{line.plannedQuantity}</b></span>
                    <span>Распределить <b>{line.remainingQuantity}</b></span>
                  </div>
                </div>

                <div className="balance-review-line__destinations">
                  {review.requests.map((request) => {
                    const allocation = draft.allocations[request.id];
                    return (
                      <div className={`balance-destination ${allocation.quantity > 0 ? 'has-quantity' : ''}`} key={request.id}>
                        <div className="balance-destination__title">
                          <span><MapPin size={15} aria-hidden="true" /> {request.destinationCity || request.title}</span>
                          <button type="button" disabled={disabled} onClick={() => sendAllTo(line.id, request.id)}>Весь остаток</button>
                        </div>
                        <label>
                          <span>Количество</span>
                          <input
                            type="number"
                            min="0"
                            max={line.remainingQuantity}
                            value={allocation.quantity || ''}
                            disabled={disabled}
                            onChange={(event) => updateAllocation(line.id, request.id, { quantity: Number(event.target.value) || 0 })}
                            placeholder="0"
                          />
                        </label>
                        {allocation.quantity > 0 ? (
                          <div className="balance-destination__relabel">
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={allocation.needsRelabel}
                                disabled={disabled}
                                onChange={(event) => updateAllocation(line.id, request.id, { needsRelabel: event.target.checked })}
                              />
                              <span><Tag size={14} aria-hidden="true" /> Перемаркировать</span>
                            </label>
                            {allocation.needsRelabel ? (
                              <input
                                value={allocation.targetBarcode}
                                disabled={disabled}
                                onChange={(event) => updateAllocation(line.id, request.id, { targetBarcode: event.target.value })}
                                placeholder="Новый штрихкод"
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="balance-review-line__decision">
                  <div>
                    <span>Остается на складе</span>
                    <strong>{draft.keepQuantity} шт.</strong>
                  </div>
                  <button className="button button-secondary" type="button" disabled={disabled} onClick={() => keepLine(line.id)}>
                    <Warehouse size={15} aria-hidden="true" /> Оставить остаток
                  </button>
                  <label>
                    <span>Комментарий</span>
                    <input
                      value={draft.comment}
                      disabled={disabled}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [line.id]: { ...current[line.id], comment: event.target.value, reviewed: true },
                      }))}
                      placeholder="Уточнение для склада"
                    />
                  </label>
                  <span className={`balance-review-line__state ${draft.reviewed ? 'is-ready' : ''}`}>
                    {draft.reviewed ? <><Check size={15} aria-hidden="true" /> Решение принято</> : 'Нужно проверить'}
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="balance-review-modal__footer">
          <div>
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}
          </div>
          <div className="balance-review-modal__actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Закрыть</button>
            {canWrite ? (
              <>
                <button className="button button-secondary" type="button" disabled={disabled} onClick={() => void save()}>
                  <Save size={16} aria-hidden="true" /> {status === 'saving' ? 'Сохраняю...' : 'Сохранить'}
                </button>
                <button className="button button-primary" type="button" disabled={disabled || !allReviewed} onClick={() => void submit()}>
                  <Send size={16} aria-hidden="true" /> {status === 'submitting' ? 'Фиксирую...' : 'Подтвердить распределение'}
                </button>
              </>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

function buildDrafts(review: PickWaveBalanceReview): Record<string, LineDraft> {
  return Object.fromEntries(
    review.lines.map((line) => {
      const existingByRequest = new Map(line.allocations.map((allocation) => [allocation.requestId, allocation]));
      return [
        line.id,
        {
          reviewed: line.isReviewed,
          keepQuantity: line.keepQuantity ?? line.remainingQuantity,
          comment: line.comment ?? '',
          allocations: Object.fromEntries(
            review.requests.map((request) => {
              const existing = existingByRequest.get(request.id);
              return [
                request.id,
                existing
                  ? {
                      quantity: existing.quantity,
                      needsRelabel: existing.needsRelabel,
                      targetBarcode: existing.targetBarcode ?? '',
                      comment: existing.comment ?? '',
                    }
                  : emptyAllocation(),
              ];
            }),
          ),
        },
      ];
    }),
  );
}

function buildDecisionPayload(
  review: PickWaveBalanceReview,
  drafts: Record<string, LineDraft>,
  requireAll: boolean,
): PickWaveBalanceDecisionInput[] {
  return review.lines
    .filter((line) => requireAll || drafts[line.id].reviewed)
    .map((line) => ({
      lineId: line.id,
      keepQuantity: drafts[line.id].keepQuantity,
      comment: drafts[line.id].comment.trim() || undefined,
      allocations: Object.entries(drafts[line.id].allocations)
        .filter(([, allocation]) => allocation.quantity > 0)
        .map(([requestId, allocation]) => ({
          requestId,
          quantity: allocation.quantity,
          needsRelabel: allocation.needsRelabel,
          targetBarcode: allocation.needsRelabel ? allocation.targetBarcode.trim() : undefined,
          comment: allocation.comment.trim() || undefined,
        })),
    }));
}

function emptyAllocation(): AllocationDraft {
  return { quantity: 0, needsRelabel: false, targetBarcode: '', comment: '' };
}

function formatInt(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
