import { AlertTriangle, CheckCircle2, History, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  decideWarehouseBoxCheckRow,
  fetchClients,
  fetchWarehouseBoxChecks,
  runWarehouseBoxCheck,
  type AuthSession,
  type ClientSummary,
  type WarehouseBoxCheck,
  type WarehouseBoxCheckRow,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';

export function BoxIntegrityPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [periodFrom, setPeriodFrom] = useState(dateInput(daysAgo(30)));
  const [periodTo, setPeriodTo] = useState(dateInput(new Date()));
  const [checks, setChecks] = useState<WarehouseBoxCheck[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState('');
  const [message, setMessage] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const selected = checks.find((check) => check.id === selectedId) ?? checks[0] ?? null;
  const groupedRows = useMemo(() => groupRows(selected?.rows ?? []), [selected]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchClients(session.accessToken),
      fetchWarehouseBoxChecks(session.accessToken),
    ])
      .then(([nextClients, nextChecks]) => {
        if (!active) return;
        setClients(nextClients);
        setChecks(nextChecks);
        setSelectedId(nextChecks[0]?.id ?? '');
      })
      .catch((caught: unknown) => {
        if (active) setMessage(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  async function loadChecks(nextClientId = clientId) {
    const nextChecks = await fetchWarehouseBoxChecks(
      session.accessToken,
      nextClientId || undefined,
    );
    setChecks(nextChecks);
    setSelectedId((current) =>
      nextChecks.some((check) => check.id === current) ? current : nextChecks[0]?.id ?? '',
    );
  }

  async function runCheck() {
    setBusy(true);
    setMessage('');
    try {
      const check = await runWarehouseBoxCheck(session.accessToken, {
        periodFrom,
        periodTo,
        clientId: clientId || undefined,
      });
      setChecks((current) => [check, ...current.filter((item) => item.id !== check.id)]);
      setSelectedId(check.id);
      setMessage(
        check.findingsCount
          ? `Проверка завершена: найдено ${check.findingsCount} подозрительных позиций. Ничего не списано автоматически.`
          : 'Проверка завершена: подозрительных остатков за выбранный период не найдено.',
      );
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    row: WarehouseBoxCheckRow,
    action: 'WRITE_OFF' | 'KEEP_AS_IS' | 'SET_QUANTITY',
  ) {
    const quantityValue = quantities[row.id];
    const quantity = action === 'SET_QUANTITY' ? Number(quantityValue) : undefined;
    if (action === 'SET_QUANTITY' && (!Number.isInteger(quantity) || quantity! < 0)) {
      setMessage('Введите целое новое количество от 0.');
      return;
    }
    if (
      action === 'WRITE_OFF' &&
      !window.confirm(
        `Списать весь доступный остаток ${row.internalSku} (${row.currentQuantity} шт.) из короба ${row.boxCode}?`,
      )
    ) {
      return;
    }
    setBusyRowId(row.id);
    setMessage('');
    try {
      const updated = await decideWarehouseBoxCheckRow(
        session.accessToken,
        row.id,
        { action, quantity },
      );
      setChecks((current) =>
        current.map((check) => (check.id === updated.id ? updated : check)),
      );
      setMessage('Решение применено и сохранено в истории проверки.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusyRowId('');
    }
  }

  return (
    <div className="box-integrity">
      <div className="box-integrity__intro">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>Проверка фантомных остатков</strong>
          <p>
            Система проверяет все активные короба за период и показывает доказательства.
            Остатки меняются только после вашего решения.
          </p>
        </div>
      </div>

      <div className="box-integrity__filters">
        <label>
          <span>Клиент</span>
          <select
            value={clientId}
            onChange={(event) => {
              const value = event.target.value;
              setClientId(value);
              void loadChecks(value).catch((caught) => setMessage(errorMessage(caught)));
            }}
          >
            <option value="">Все доступные клиенты</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Период с</span>
          <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
        </label>
        <label>
          <span>Период по</span>
          <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={() => void runCheck()}
          disabled={busy || !periodFrom || !periodTo}
        >
          <Play size={16} aria-hidden="true" />
          {busy ? 'Проверяю…' : 'Запустить проверку'}
        </button>
      </div>

      {message ? <p className="warehouse-inline">{message}</p> : null}

      {checks.length > 0 ? (
        <div className="box-integrity__history">
          <label>
            <span><History size={15} aria-hidden="true" /> История проверок</span>
            <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
              {checks.map((check) => (
                <option key={check.id} value={check.id}>
                  {formatDateTime(check.createdAt)} · {formatDate(check.periodFrom)}—{formatDate(check.periodTo)} · найдено {check.findingsCount}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {selected ? (
        <>
          <div className="box-integrity__summary">
            <SummaryCard label="Проверено коробов" value={selected.boxesChecked} />
            <SummaryCard label="Коробов с риском" value={groupedRows.length} tone="warning" />
            <SummaryCard label="Подозрительных единиц" value={selected.probableUnits} tone="danger" />
            <SummaryCard label="Точных совпадений" value={selected.highConfidenceRows} tone="danger" />
          </div>

          {groupedRows.length === 0 ? (
            <div className="box-integrity__empty">
              <CheckCircle2 size={22} aria-hidden="true" />
              За выбранный период подозрительных коробов не найдено.
            </div>
          ) : (
            <div className="box-integrity__boxes">
              {groupedRows.map((group) => (
                <details key={group.boxCode} className="box-integrity__box">
                  <summary>
                    <span>
                      <AlertTriangle size={17} aria-hidden="true" />
                      <strong>{group.boxCode}</strong>
                      <small>{group.clientName}</small>
                    </span>
                    <span>
                      {group.rows.length} поз. · риск {group.rows.reduce((sum, row) => sum + row.suspectQuantity, 0)} шт.
                    </span>
                  </summary>
                  <div className="box-integrity__rows">
                    {group.rows.map((row) => (
                      <article key={row.id} className={`box-integrity__row box-integrity__row--${row.severity.toLowerCase()}`}>
                        <div className="box-integrity__row-head">
                          <div>
                            <strong>{row.skuName}</strong>
                            <span>{row.internalSku}{row.barcode ? ` · ШК ${row.barcode}` : ''}</span>
                          </div>
                          <span className={`box-integrity__badge box-integrity__badge--${row.severity.toLowerCase()}`}>
                            {severityLabel(row.severity)}
                          </span>
                        </div>
                        <p>{row.reasonLabel}</p>
                        <div className="box-integrity__metrics">
                          <span>В WMS <strong>{row.currentQuantity}</strong></span>
                          <span>Под вопросом <strong>{row.suspectQuantity}</strong></span>
                          <span>Взято на переклейку <strong>{row.relabelQuantity}</strong></span>
                          <span>Взято в FBS <strong>{row.fbsPickedQuantity}</strong></span>
                          <span>Восстановлено <strong>{row.restoredQuantity}</strong></span>
                          <span>КИЗ / лишних <strong>{row.markCount} / {row.excessMarkCount}</strong></span>
                        </div>
                        {row.evidence?.relabelOrders?.length ? (
                          <small className="box-integrity__evidence">
                            События: {row.evidence.relabelOrders.join('; ')}
                          </small>
                        ) : null}
                        {row.decision === 'PENDING' ? (
                          <div className="box-integrity__actions">
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={busyRowId === row.id}
                              onClick={() => void decide(row, 'KEEP_AS_IS')}
                            >
                              Оставить как есть
                            </button>
                            <button
                              className="danger-button"
                              type="button"
                              disabled={busyRowId === row.id}
                              onClick={() => void decide(row, 'WRITE_OFF')}
                            >
                              Списать
                            </button>
                            <label>
                              <span>Новое количество</span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={quantities[row.id] ?? String(row.currentQuantity)}
                                onChange={(event) =>
                                  setQuantities((current) => ({ ...current, [row.id]: event.target.value }))
                                }
                              />
                            </label>
                            <button
                              className="primary-button"
                              type="button"
                              disabled={busyRowId === row.id}
                              onClick={() => void decide(row, 'SET_QUANTITY')}
                            >
                              Изменить количество
                            </button>
                          </div>
                        ) : (
                          <div className="box-integrity__decision">
                            <CheckCircle2 size={16} aria-hidden="true" />
                            {decisionLabel(row)} · {row.decidedByName ?? 'менеджер'} · {formatDateTime(row.decidedAt)}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="warehouse-inline">Проверок ещё нет. Выберите период и запустите первую.</p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'normal' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`box-integrity__summary-card box-integrity__summary-card--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function groupRows(rows: WarehouseBoxCheckRow[]) {
  const map = new Map<string, { boxCode: string; clientName: string; rows: WarehouseBoxCheckRow[] }>();
  rows.forEach((row) => {
    const group = map.get(row.boxCode) ?? { boxCode: row.boxCode, clientName: row.clientName, rows: [] };
    group.rows.push(row);
    map.set(row.boxCode, group);
  });
  return [...map.values()].sort((left, right) => {
    const leftPending = left.rows.filter((row) => row.decision === 'PENDING').length;
    const rightPending = right.rows.filter((row) => row.decision === 'PENDING').length;
    return rightPending - leftPending || left.boxCode.localeCompare(right.boxCode);
  });
}

function severityLabel(value: WarehouseBoxCheckRow['severity']) {
  if (value === 'HIGH') return 'Точный риск';
  if (value === 'MEDIUM') return 'Нужна проверка';
  return 'Расхождение КИЗ';
}

function decisionLabel(row: WarehouseBoxCheckRow) {
  if (row.decision === 'KEEP_AS_IS') return `Оставлено как есть: ${row.afterQuantity ?? row.currentQuantity} шт.`;
  if (row.decision === 'WRITE_OFF') return `Списано: ${row.beforeQuantity ?? row.currentQuantity} → 0`;
  return `Количество изменено: ${row.beforeQuantity ?? row.currentQuantity} → ${row.afterQuantity ?? row.decidedQuantity ?? 0}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '—';
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
