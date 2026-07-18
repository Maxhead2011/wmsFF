import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldAlert,
  UnlockKeyhole,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelInventorySession,
  completeInventorySession,
  decideInventoryLine,
  fetchClients,
  fetchInventoryDashboard,
  fetchInventorySession,
  finishInventoryBox,
  openInventoryBox,
  scanInventoryItem,
  sendInventoryToReview,
  setInventoryCount,
  startInventorySession,
  type AuthSession,
  type ClientSummary,
  type InventoryAuditBox,
  type InventoryDashboard,
  type InventoryLineDecision,
  type InventoryResolutionAction,
  type InventorySession,
  type InventorySessionType,
} from '../../lib/api';
import './inventory.css';

type InventoryMode = InventorySessionType | 'RECONCILIATION';

const modes: Array<{
  id: InventoryMode;
  number: string;
  title: string;
  description: string;
  icon: typeof Boxes;
  danger?: boolean;
}> = [
  {
    id: 'FULL',
    number: '01',
    title: 'Полная инвентаризация',
    description: 'Проверка всех коробов. Все движения товара блокируются до завершения.',
    icon: LockKeyhole,
    danger: true,
  },
  {
    id: 'PARTIAL',
    number: '02',
    title: 'Частичная инвентаризация',
    description: 'Проверка выбранных коробов без остановки складских операций.',
    icon: ListChecks,
  },
  {
    id: 'BOX_CHECK',
    number: '03',
    title: 'Проверка содержимого короба',
    description: 'Быстрая сверка: система сразу показывает, всё ли совпало и что отличается.',
    icon: ScanLine,
  },
  {
    id: 'RECONCILIATION',
    number: '04',
    title: 'Актуализация остатков на базе инвентаризации',
    description: 'Журнал всех проверок и решения менеджера по расхождениям.',
    icon: Settings2,
  },
];

export function InventoryPanel({ session }: { session: AuthSession }) {
  const [mode, setMode] = useState<InventoryMode | null>(null);
  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [nextDashboard, nextClients] = await Promise.all([
        fetchInventoryDashboard(session.accessToken),
        fetchClients(session.accessToken),
      ]);
      setDashboard(nextDashboard);
      setClients(nextClients.filter((client) => client.status !== 'ARCHIVED'));
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session.accessToken]);

  return (
    <div className="inventory">
      <section className="inventory-hero">
        <div>
          <p className="eyebrow">Склад и операции</p>
          <h2>Инвентаризация</h2>
          <p>Сверка фактического содержимого коробов с остатками WMS и управляемая актуализация.</p>
        </div>
        <div className={`inventory-lock ${dashboard?.movementLock.active ? 'inventory-lock--active' : ''}`}>
          {dashboard?.movementLock.active ? <LockKeyhole size={20} /> : <UnlockKeyhole size={20} />}
          <span>
            <small>Движения товара</small>
            <strong>{dashboard?.movementLock.active ? 'Заблокированы' : 'Разрешены'}</strong>
          </span>
        </div>
      </section>

      {dashboard?.movementLock.active ? (
        <div className="inventory-alert inventory-alert--danger">
          <ShieldAlert size={20} />
          <div>
            <strong>Идёт полная инвентаризация: {dashboard.movementLock.title}</strong>
            <span>
              Запустил {dashboard.movementLock.createdByName}. Приёмка, перемещения, сборка, отгрузка и ручные
              корректировки заблокированы до завершения или отмены.
            </span>
          </div>
        </div>
      ) : null}

      <div className="inventory-mode-grid">
        {modes.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`inventory-mode ${mode === item.id ? 'inventory-mode--active' : ''} ${item.danger ? 'inventory-mode--danger' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
            >
              <span className="inventory-mode__number">{item.number}</span>
              <Icon size={24} />
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </button>
          );
        })}
      </div>

      {message ? <p className="form-error">{message}</p> : null}
      {loading ? <p className="muted">Загружаю данные инвентаризации…</p> : null}

      {!loading && mode && dashboard ? (
        <section className="inventory-workbench">
          <div className="inventory-workbench__heading">
            <div>
              <p className="eyebrow">Рабочая зона</p>
              <h3>{modes.find((item) => item.id === mode)?.title}</h3>
            </div>
            <button className="secondary-button" type="button" onClick={() => void load()}>
              <RefreshCw size={16} />
              Обновить
            </button>
          </div>

          {mode === 'RECONCILIATION' ? (
            <Reconciliation
              dashboard={dashboard}
              session={session}
              onChanged={load}
            />
          ) : (
            <InventoryOperation
              type={mode}
              dashboard={dashboard}
              clients={clients}
              session={session}
              onChanged={load}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

function InventoryOperation({
  type,
  dashboard,
  clients,
  session,
  onChanged,
}: {
  type: InventorySessionType;
  dashboard: InventoryDashboard;
  clients: ClientSummary[];
  session: AuthSession;
  onChanged: () => Promise<void>;
}) {
  const candidates = dashboard.activeSessions.filter((item) => item.type === type);
  const [activeId, setActiveId] = useState(candidates[0]?.id ?? '');
  const [current, setCurrent] = useState<InventorySession | null>(candidates[0] ?? null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const next = candidates.find((item) => item.id === activeId) ?? candidates[0] ?? null;
    setCurrent(next);
    setActiveId(next?.id ?? '');
  }, [type, dashboard.activeSessions]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (type !== 'FULL' && !clientId) {
      setMessage('Выберите клиента.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const created = await startInventorySession(session.accessToken, {
        type,
        clientId: type === 'FULL' ? undefined : clientId,
        title,
        comment,
      });
      setCurrent(created);
      setActiveId(created.id);
      setTitle('');
      setComment('');
      await onChanged();
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSession() {
    if (!current) return;
    setCurrent(await fetchInventorySession(session.accessToken, current.id));
  }

  if (current) {
    return (
      <div className="inventory-session">
        {candidates.length > 1 ? (
          <label className="inventory-field">
            <span>Активная проверка</span>
            <select value={activeId} onChange={(event) => setActiveId(event.target.value)}>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
        ) : null}
        <SessionHeader current={current} />
        <BoxCounter session={session} inventory={current} onChanged={refreshSession} />
        <div className="inventory-session__actions">
          <button
            className="primary-button"
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await sendInventoryToReview(session.accessToken, current.id);
                setCurrent(null);
                await onChanged();
              } catch (caught) {
                setMessage(errorMessage(caught));
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <ClipboardCheck size={16} />
            {type === 'BOX_CHECK' ? 'Завершить проверку' : 'Передать менеджеру на актуализацию'}
          </button>
          {dashboard.canManage ? (
            <button
              className="danger-button"
              type="button"
              onClick={async () => {
                if (!window.confirm('Отменить эту инвентаризацию?')) return;
                setBusy(true);
                try {
                  await cancelInventorySession(session.accessToken, current.id);
                  setCurrent(null);
                  await onChanged();
                } catch (caught) {
                  setMessage(errorMessage(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Отменить
            </button>
          ) : null}
        </div>
        {message ? <p className="form-error">{message}</p> : null}
      </div>
    );
  }

  return (
    <form className="inventory-start" onSubmit={create}>
      {type === 'FULL' ? (
        <div className="inventory-alert inventory-alert--danger">
          <AlertTriangle size={20} />
          <div>
            <strong>Полная остановка движений товара</strong>
            <span>
              Сразу после запуска система запретит любые складские движения. Блокировка снимется только после
              завершения или отмены инвентаризации менеджером.
            </span>
          </div>
        </div>
      ) : (
        <label className="inventory-field">
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="inventory-field">
        <span>Название проверки</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Система подставит дату автоматически" />
      </label>
      <label className="inventory-field inventory-field--wide">
        <span>Комментарий</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Зона, причина, ответственный или другие детали" />
      </label>
      <button className={type === 'FULL' ? 'danger-button' : 'primary-button'} type="submit" disabled={busy}>
        {type === 'FULL' ? <LockKeyhole size={16} /> : <ScanLine size={16} />}
        {busy ? 'Запускаю…' : 'Начать инвентаризацию'}
      </button>
      {message ? <p className="form-error">{message}</p> : null}
    </form>
  );
}

function SessionHeader({ current }: { current: InventorySession }) {
  return (
    <div className="inventory-session__summary">
      <div>
        <span className={`inventory-status inventory-status--${current.status.toLowerCase()}`}>{statusLabel(current.status)}</span>
        <h4>{current.title}</h4>
        <p>Запустил {current.createdByName} · {formatDate(current.startedAt)}</p>
      </div>
      <div className="inventory-metrics">
        <span><small>Проверено коробов</small><strong>{current.progress?.checkedBoxes ?? current.boxes.filter((box) => box.status !== 'COUNTING').length}{current.progress?.totalBoxes ? ` / ${current.progress.totalBoxes}` : ''}</strong></span>
        <span><small>С расхождениями</small><strong>{current.progress?.mismatchBoxes ?? current.boxes.filter((box) => box.status === 'MISMATCH').length}</strong></span>
      </div>
    </div>
  );
}

function BoxCounter({
  session,
  inventory,
  onChanged,
}: {
  session: AuthSession;
  inventory: InventorySession;
  onChanged: () => Promise<void>;
}) {
  const [boxCode, setBoxCode] = useState('');
  const [box, setBox] = useState<InventoryAuditBox | null>(null);
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const barcodeRef = useRef<HTMLInputElement | null>(null);

  async function open(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const next = await openInventoryBox(session.accessToken, inventory.id, boxCode);
      setBox(next);
      setBoxCode(next.boxCode);
      setTimeout(() => barcodeRef.current?.focus(), 0);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reloadBox() {
    const refreshed = await fetchInventorySession(session.accessToken, inventory.id);
    setBox(refreshed.boxes.find((item) => item.id === box?.id) ?? null);
    await onChanged();
  }

  async function scan(event: FormEvent) {
    event.preventDefault();
    if (!box || !barcode.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await scanInventoryItem(session.accessToken, box.id, barcode, quantity);
      setBarcode('');
      setQuantity(1);
      await reloadBox();
      setTimeout(() => barcodeRef.current?.focus(), 0);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inventory-counter">
      <form className="inventory-scanbar" onSubmit={open}>
        <label>
          <span>Номер короба</span>
          <input value={boxCode} onChange={(event) => setBoxCode(event.target.value)} placeholder="Пропикайте или введите номер" autoFocus />
        </label>
        <button className="secondary-button" type="submit" disabled={!boxCode.trim() || busy}>
          <Boxes size={16} /> Открыть короб
        </button>
      </form>

      {box ? (
        <>
          <div className="inventory-box-heading">
            <div>
              <p className="eyebrow">{box.clientName}</p>
              <h4>Короб {box.boxCode}</h4>
            </div>
            <span className={`inventory-status inventory-status--${box.status.toLowerCase()}`}>{boxStatusLabel(box.status)}</span>
          </div>

          {box.status === 'COUNTING' ? (
            <form className="inventory-item-scan" onSubmit={scan}>
              <label>
                <span>Штрихкод товара</span>
                <input ref={barcodeRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Сканируйте товары по одному" />
              </label>
              <label className="inventory-item-scan__quantity">
                <span>Количество</span>
                <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
              </label>
              <button className="primary-button" type="submit" disabled={!barcode.trim() || busy}>
                <ScanLine size={16} /> Учесть
              </button>
            </form>
          ) : null}

          <InventoryLinesTable
            box={box}
            editable={box.status === 'COUNTING'}
            onSetCount={async (lineId, counted) => {
              await setInventoryCount(session.accessToken, box.id, lineId, counted);
              await reloadBox();
            }}
          />

          {box.status === 'COUNTING' ? (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMessage('');
                try {
                  const finished = await finishInventoryBox(session.accessToken, box.id);
                  setBox(finished);
                  await onChanged();
                } catch (caught) {
                  setMessage(errorMessage(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <CheckCircle2 size={16} /> Завершить подсчёт короба
            </button>
          ) : (
            <BoxResult box={box} />
          )}
        </>
      ) : (
        <div className="inventory-empty">
          <ScanLine size={28} />
          <strong>Начните с номера короба</strong>
          <span>После сканирования система покажет ожидаемое содержимое и подготовит поле для подсчёта.</span>
        </div>
      )}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}

function InventoryLinesTable({
  box,
  editable,
  onSetCount,
}: {
  box: InventoryAuditBox;
  editable: boolean;
  onSetCount: (lineId: string, count: number) => Promise<void>;
}) {
  if (box.lines.length === 0) {
    return <p className="muted">По данным WMS короб пуст. Отсканированный товар появится в таблице как излишек.</p>;
  }
  return (
    <div className="inventory-table-wrap">
      <table className="inventory-table">
        <thead><tr><th>Товар</th><th>ШК</th><th>В WMS</th><th>Факт</th><th>Разница</th></tr></thead>
        <tbody>
          {box.lines.map((line) => {
            const difference = line.countedQuantity - line.expectedQuantity;
            return (
              <tr key={line.id} className={difference === 0 ? '' : 'inventory-table__mismatch'}>
                <td><strong>{line.skuName}</strong><small>{line.internalSku}</small></td>
                <td>{line.barcode || '—'}</td>
                <td>{line.expectedQuantity}</td>
                <td>
                  {editable ? (
                    <input
                      type="number"
                      min={0}
                      value={line.countedQuantity}
                      onChange={(event) => void onSetCount(line.id, Math.max(0, Number(event.target.value) || 0))}
                    />
                  ) : line.countedQuantity}
                </td>
                <td className={difference === 0 ? 'inventory-diff--ok' : 'inventory-diff--bad'}>
                  {difference > 0 ? `+${difference}` : difference}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BoxResult({ box }: { box: InventoryAuditBox }) {
  const mismatches = box.lines.filter((line) => line.difference !== 0);
  return (
    <div className={`inventory-result ${mismatches.length ? 'inventory-result--bad' : 'inventory-result--ok'}`}>
      {mismatches.length ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
      <div>
        <strong>{mismatches.length ? 'Содержимое отличается' : 'Всё в порядке'}</strong>
        <span>
          {mismatches.length
            ? `Расхождений: ${mismatches.length}. Они выделены в таблице с точной разницей.`
            : 'Фактическое содержимое полностью совпадает с данными WMS.'}
        </span>
      </div>
    </div>
  );
}

function Reconciliation({
  dashboard,
  session,
  onChanged,
}: {
  dashboard: InventoryDashboard;
  session: AuthSession;
  onChanged: () => Promise<void>;
}) {
  const [busyLine, setBusyLine] = useState('');
  const [message, setMessage] = useState('');
  const history = dashboard.historySessions ?? dashboard.reviewSessions;
  const checkedBoxes = history.flatMap((inventory) => inventory.boxes)
    .filter((box) => box.status !== 'COUNTING');
  const matchedBoxes = checkedBoxes.filter((box) => box.status === 'MATCHED').length;

  async function resolveLine(lineId: string, action: InventoryResolutionAction) {
    setBusyLine(lineId);
    setMessage('');
    try {
      await decideInventoryLine(session.accessToken, lineId, action);
      await onChanged();
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusyLine('');
    }
  }

  if (history.length === 0) {
    return <div className="inventory-empty"><ClipboardCheck size={28} /><strong>Проверок пока нет</strong><span>Здесь появятся полные, частичные инвентаризации и проверки содержимого коробов.</span></div>;
  }

  return (
    <div className="inventory-reconciliation">
      {!dashboard.canManage ? (
        <div className="inventory-alert"><ShieldAlert size={20} /><div><strong>Журнал доступен только для просмотра</strong><span>Решения по расхождениям может принимать менеджер или администратор.</span></div></div>
      ) : null}
      <div className="inventory-history-summary">
        <div>
          <p className="eyebrow">Журнал проверок</p>
          <strong>Все инвентаризации и проверки коробов</strong>
          <span>Для каждого короба отображаются ожидаемый состав WMS, фактический подсчёт и точная разница.</span>
        </div>
        <div className="inventory-metrics">
          <span><small>Проверок</small><strong>{history.length}</strong></span>
          <span><small>Коробов проверено</small><strong>{checkedBoxes.length}</strong></span>
          <span><small>Без расхождений</small><strong>{matchedBoxes}</strong></span>
        </div>
      </div>
      {history.map((review) => (
        <article className="inventory-review" key={review.id}>
          <SessionHeader current={review} />
          {review.boxes.length === 0 ? (
            <div className="inventory-empty inventory-empty--compact">
              <ClipboardCheck size={22} />
              <strong>Короба ещё не проверялись</strong>
              <span>Сессия зафиксирована в журнале, но результатов подсчёта пока нет.</span>
            </div>
          ) : review.boxes.map((box) => (
            <div className="inventory-review-box" key={box.id}>
              <div className="inventory-box-heading">
                <div>
                  <p className="eyebrow">{box.clientName}</p>
                  <h4>
                    Короб {box.boxCode}
                    {box.lines.some((line) => line.difference !== 0)
                      ? ` · расхождений ${box.lines.filter((line) => line.difference !== 0).length}`
                      : ' · без расхождений'}
                  </h4>
                  <p className="inventory-audit-meta">
                    {box.countedByName ? `Проверил ${box.countedByName}` : 'Проверка начата'}
                    {' · '}{formatDate(box.completedAt ?? box.startedAt)}
                    {box.resolvedByName && box.resolvedAt ? ` · Решение: ${box.resolvedByName}, ${formatDate(box.resolvedAt)}` : ''}
                  </p>
                </div>
                <span className={`inventory-status inventory-status--${box.status.toLowerCase()}`}>{boxStatusLabel(box.status)}</span>
              </div>
              {box.lines.length > 0 ? <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead><tr><th>Товар</th><th>WMS</th><th>Факт</th><th>Разница</th><th>Результат / решение</th></tr></thead>
                  <tbody>
                    {box.lines.map((line) => (
                      <tr className={line.difference !== 0 ? 'inventory-table__mismatch' : undefined} key={line.id}>
                        <td><strong>{line.skuName}</strong><small>{line.barcode || line.internalSku}</small></td>
                        <td>{line.expectedQuantity}</td><td>{line.countedQuantity}</td>
                        <td className={line.difference === 0 ? 'inventory-diff--ok' : 'inventory-diff--bad'}>{line.difference > 0 ? `+${line.difference}` : line.difference}</td>
                        <td>
                          {line.difference === 0 ? (
                            <span className="inventory-decision-done">
                              <CheckCircle2 size={15} />
                              Совпало
                            </span>
                          ) : line.decision === 'PENDING' && dashboard.canManage && (
                            review.status === 'REVIEW' ||
                            (review.type === 'BOX_CHECK' && (
                              review.status === 'ACTIVE' ||
                              review.status === 'COMPLETED'
                            ))
                          ) ? (
                            <div className="inventory-decision">
                              <button
                                className="primary-button"
                                type="button"
                                disabled={busyLine === line.id}
                                title="Записать в WMS фактическое количество после подсчёта"
                                onClick={() => void resolveLine(line.id, 'APPLY_ACTUAL')}
                              >Актуализировать</button>
                              <button
                                className="secondary-button inventory-delete-action"
                                type="button"
                                disabled={busyLine === line.id}
                                title="Обнулить остаток этой позиции в проверяемом коробе"
                                onClick={() => void resolveLine(line.id, 'DELETE_FROM_BOX')}
                              >Удалить из короба</button>
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={busyLine === line.id}
                                title="Признать расхождение проверенным, но не менять остаток WMS"
                                onClick={() => void resolveLine(line.id, 'ACCEPT_AS_IS')}
                              >Принять как есть</button>
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={busyLine === line.id}
                                title="Не принимать решение сейчас и оставить строку на разборе"
                                onClick={() => void resolveLine(line.id, 'LEAVE_FOR_LATER')}
                              >Оставить как есть</button>
                            </div>
                          ) : line.decision === 'PENDING' ? (
                            <span className="inventory-decision-pending">
                              <AlertTriangle size={15} />
                              {line.resolutionAction === 'LEAVE_FOR_LATER' ? 'Оставлено на разборе' : 'Ожидает решения'}
                            </span>
                          ) : (
                            <span className="inventory-decision-done">
                              <CheckCircle2 size={15} />
                              {resolutionActionLabel(line.resolutionAction, line.decision)}
                              {line.decidedByName ? ` · ${line.decidedByName}` : ''}
                              {line.decidedAt ? ` · ${formatDate(line.decidedAt)}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div> : (
                <p className="inventory-box-empty">В коробе не зафиксировано товарных позиций.</p>
              )}
            </div>
          ))}
          {dashboard.canManage && review.status === 'REVIEW' ? <div className="inventory-session__actions">
            <button
              className="primary-button"
              type="button"
              disabled={(review.progress?.unresolvedLines ?? 0) > 0}
              onClick={async () => {
                try {
                  await completeInventorySession(session.accessToken, review.id);
                  await onChanged();
                } catch (caught) { setMessage(errorMessage(caught)); }
              }}
            >
              <UnlockKeyhole size={16} />
              Завершить инвентаризацию
            </button>
            <span className="muted">Неразобранных позиций: {review.progress?.unresolvedLines ?? 0}</span>
          </div> : null}
        </article>
      ))}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}

function statusLabel(status: InventorySession['status']) {
  return { ACTIVE: 'Идёт подсчёт', REVIEW: 'Актуализация', COMPLETED: 'Завершена', CANCELLED: 'Отменена' }[status];
}

function boxStatusLabel(status: InventoryAuditBox['status']) {
  return { COUNTING: 'Подсчёт', MATCHED: 'Всё совпало', MISMATCH: 'Есть расхождения', RESOLVED: 'Разобран' }[status];
}

function resolutionActionLabel(
  action: InventoryResolutionAction | undefined,
  decision: InventoryLineDecision,
) {
  if (action === 'DELETE_FROM_BOX') return 'Удалено из короба';
  if (action === 'APPLY_ACTUAL') return 'Остаток актуализирован';
  if (action === 'ACCEPT_AS_IS') return 'Принято без изменения WMS';
  return decision === 'APPLY_ACTUAL' ? 'Остаток актуализирован' : 'Оставлен остаток WMS';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
