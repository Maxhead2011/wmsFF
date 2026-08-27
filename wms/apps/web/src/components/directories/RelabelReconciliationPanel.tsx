import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  applyFbsRelabelReconciliation,
  fetchFbsRelabelReconciliation,
  type AuthSession,
  type FbsRelabelReconciliationIssue,
  type FbsRelabelReconciliationReport,
} from '../../lib/api';

type RelabelReconciliationPanelProps = {
  session: AuthSession;
  clientId: string;
  canEdit: boolean;
};

export function RelabelReconciliationPanel({
  session,
  clientId,
  canEdit,
}: RelabelReconciliationPanelProps) {
  const [dateFrom, setDateFrom] = useState(() => dateInputDaysAgo(14));
  const [dateTo, setDateTo] = useState(() => dateInputDaysAgo(0));
  const [barcode, setBarcode] = useState('');
  const [report, setReport] = useState<FbsRelabelReconciliationReport | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [applyingIssueId, setApplyingIssueId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    setMessage('');
    setError('');
  }, [clientId]);

  async function runCheck(event?: FormEvent<HTMLFormElement>, refreshWb = true) {
    event?.preventDefault();
    if (!clientId) return;
    setLoading(true);
    setMessage('');
    setError('');
    try {
      setReport(
        await fetchFbsRelabelReconciliation(session.accessToken, {
          clientId,
          dateFrom,
          dateTo,
          barcode: barcode.trim() || undefined,
          refreshWb,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить сверку.');
    } finally {
      setLoading(false);
    }
  }

  async function applyIssue(issue: FbsRelabelReconciliationIssue) {
    if (
      !canEdit ||
      !issue.correctable ||
      !window.confirm(
        `Применить пропущенную переклейку по заказу WB №${issue.order.id}?\n\n` +
          `${issue.sourceSku?.name ?? 'Исходный товар'}: ${issue.correction.sourceDelta} шт.\n` +
          `${issue.targetSku?.name ?? 'Товар после переклейки'}: +${issue.correction.targetDelta} шт.\n\n` +
          'Операция сохранится в истории и не сможет примениться повторно.',
      )
    ) {
      return;
    }
    setApplyingIssueId(issue.id);
    setMessage('');
    setError('');
    try {
      const result = await applyFbsRelabelReconciliation(session.accessToken, {
        clientId,
        issueId: issue.id,
        dateFrom,
        dateTo,
        barcode: barcode.trim() || undefined,
      });
      setReport(result.report);
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось применить корректировку.');
    } finally {
      setApplyingIssueId('');
    }
  }

  return (
    <section className="relabel-reconciliation">
      <div className="relabel-reconciliation__heading">
        <div>
          <span className="relabel-reconciliation__icon"><ShieldCheck size={21} aria-hidden="true" /></span>
          <div>
            <h3>Сверка остатков и переклейки</h3>
            <p>
              Проверяет отправленные заявки, резервы, фактическую сборку, переклейки и поставки Wildberries.
            </p>
          </div>
        </div>
        {report ? (
          <button type="button" className="icon-text-button" disabled={isLoading} onClick={() => void runCheck(undefined, true)}>
            <RefreshCw size={15} aria-hidden="true" />
            Обновить с WB
          </button>
        ) : null}
      </div>

      <form className="relabel-reconciliation__filters" onSubmit={(event) => void runCheck(event, true)}>
        <label>
          <span>Отправлено с</span>
          <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} required />
        </label>
        <label>
          <span>По</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} required />
        </label>
        <label className="relabel-reconciliation__barcode">
          <span>ШК / артикул для точечной проверки</span>
          <input
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="Например, 2049156013708"
          />
        </label>
        <button className="primary-button" type="submit" disabled={isLoading || !clientId}>
          {isLoading ? <RefreshCw className="is-spinning" size={17} aria-hidden="true" /> : <Search size={17} aria-hidden="true" />}
          {isLoading ? 'Сверяю WMS и WB…' : 'Проверить остатки'}
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {report ? (
        <>
          <div className="relabel-reconciliation__summary">
            <SummaryCard label="Остаток WMS" value={`${report.totals.stockUnits} шт.`} />
            <SummaryCard label="Всего в резерве" value={`${report.totals.reservedUnits} шт.`} />
            <SummaryCard label="Уже вынуто сборщиком" value={`${report.totals.assembledReservedUnits} шт.`} />
            <SummaryCard label="Ещё не собрано" value={`${report.totals.pendingReservedUnits} шт.`} />
            <SummaryCard label="Свободно" value={`${report.totals.freeUnits} шт.`} tone="success" />
            <SummaryCard
              label="Требуют внимания"
              value={String(report.totals.issues)}
              tone={report.totals.issues > 0 ? 'danger' : 'success'}
            />
          </div>

          <div className="relabel-reconciliation__wb-status">
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>
              WB проверен: {report.wb.ordersChecked} заказов, {report.wb.suppliesChecked} поставок.
              Данные на {formatDateTime(report.wb.fetchedAt)}.
            </span>
          </div>

          <div className="relabel-reconciliation__block">
            <div className="relabel-reconciliation__block-title">
              <div>
                <h4>Остаток с учётом резервов</h4>
                <span>«Уже вынуто» — товар собран, но заявка WMS ещё не закрыта.</span>
              </div>
            </div>
            <div className="client-table-scroll">
              <table className="client-directory-table relabel-reconciliation__table">
                <thead>
                  <tr>
                    <th>Исходный товар</th>
                    <th>После переклейки</th>
                    <th>WMS</th>
                    <th>Резерв</th>
                    <th>Где числится</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stockRows.map((row) => (
                    <tr key={`${row.mappingId}-${row.sourceSku.id}-${row.targetSku?.id ?? 'missing'}`}>
                      <td>
                        <strong>{row.sourceSku.name}</strong>
                        <small>{skuLine(row.sourceSku)}</small>
                      </td>
                      <td>
                        <strong>{row.targetSku?.name ?? row.targetArticle}</strong>
                        <small>{row.targetSku ? skuLine(row.targetSku) : 'Карточка целевого SKU не найдена'}</small>
                      </td>
                      <td>
                        <strong>{row.stock.available} шт.</strong>
                        <small>свободно {row.stock.free} · целевого SKU {row.stock.targetAvailable}</small>
                      </td>
                      <td>
                        <strong>{row.stock.reserved} шт.</strong>
                        <small>
                          уже вынуто {row.reservations.assembled} · ещё не собрано {row.reservations.pending}
                        </small>
                        {row.reservations.requestNumbers.length > 0 ? (
                          <small>Заявки: {row.reservations.requestNumbers.map((number) => `№${String(number).padStart(6, '0')}`).join(', ')}</small>
                        ) : null}
                      </td>
                      <td>
                        {row.stock.boxes.length > 0
                          ? row.stock.boxes.map((box) => (
                              <span className="relabel-reconciliation__box" key={box.code}>
                                {box.code} — {box.quantity} шт.
                              </span>
                            ))
                          : 'остатка нет'}
                      </td>
                    </tr>
                  ))}
                  {report.stockRows.length === 0 ? (
                    <tr><td colSpan={5}>По выбранному ШК или артикулу соответствия переклейки не найдены.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="relabel-reconciliation__block">
            <div className="relabel-reconciliation__block-title">
              <div>
                <h4>Отправленные заявки за период</h4>
                <span>Сопоставлены номера заявок WMS, заказы и поставки WB.</span>
              </div>
              <strong>{report.requests.length}</strong>
            </div>
            <div className="client-table-scroll">
              <table className="client-directory-table relabel-reconciliation__table">
                <thead>
                  <tr>
                    <th>Заявка</th>
                    <th>Дата сдачи</th>
                    <th>Поставка WB</th>
                    <th>Заказы</th>
                    <th>Переклейка</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {report.requests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <strong>№{String(request.number).padStart(6, '0')}</strong>
                        <small>{request.title}</small>
                      </td>
                      <td>{formatDateTime(request.shippedAt)}</td>
                      <td>{request.supplies.join(', ') || '—'}</td>
                      <td>{request.wbShippedOrders} из {request.orders} подтверждены WB</td>
                      <td>{request.relabelConfirmed} из {request.relabelExpected}</td>
                      <td>
                        <span className={request.issues > 0 ? 'relabel-reconciliation__result is-warning' : 'relabel-reconciliation__result is-ok'}>
                          {request.issues > 0 ? `${request.issues} замеч.` : 'Проверено'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {report.requests.length === 0 ? (
                    <tr><td colSpan={6}>За выбранный период сданных заявок не найдено.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="relabel-reconciliation__block">
            <div className="relabel-reconciliation__block-title">
              <div>
                <h4>Найденные расхождения</h4>
                <span>Автоматическая корректировка доступна только там, где источник и цель определены однозначно.</span>
              </div>
              <strong>{report.issues.length}</strong>
            </div>
            {report.issues.length > 0 ? (
              <div className="relabel-reconciliation__issues">
                {report.issues.map((issue) => (
                  <article className={issue.severity === 'CRITICAL' ? 'is-critical' : 'is-warning'} key={issue.id}>
                    <AlertTriangle size={20} aria-hidden="true" />
                    <div>
                      <strong>{issue.title}</strong>
                      <span>
                        {issue.request ? `Заявка №${String(issue.request.number).padStart(6, '0')} · ` : ''}
                        заказ WB №{issue.order.id}
                        {issue.supplyId ? ` · ${issue.supplyId}` : ''}
                        {issue.boxCode ? ` · короб ${issue.boxCode}` : ''}
                      </span>
                      <p>{issue.explanation}</p>
                      {issue.sourceSku ? (
                        <small>
                          {issue.sourceSku.name}
                          {issue.targetSku ? ` → ${issue.targetSku.name}` : ''} · {issue.quantity} шт.
                        </small>
                      ) : null}
                    </div>
                    {canEdit && issue.correctable ? (
                      <button
                        type="button"
                        onClick={() => void applyIssue(issue)}
                        disabled={Boolean(applyingIssueId)}
                      >
                        <Wrench size={15} aria-hidden="true" />
                        {applyingIssueId === issue.id ? 'Исправляю…' : 'Применить переклейку'}
                      </button>
                    ) : (
                      <em>Проверить вручную</em>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="relabel-reconciliation__clean">
                <CheckCircle2 size={22} aria-hidden="true" />
                По выбранному периоду расхождений не найдено.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="relabel-reconciliation__empty">
          <ShieldCheck size={27} aria-hidden="true" />
          Выберите период и нажмите «Проверить остатки». Проверка читает актуальные статусы поставок через API WB.
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function dateInputDaysAgo(days: number) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function skuLine(sku: {
  article: string | null;
  internalSku: string;
  size: string | null;
  primaryBarcode: string | null;
}) {
  return [
    sku.article ? `арт. ${sku.article}` : sku.internalSku,
    sku.size ? `размер ${sku.size}` : '',
    sku.primaryBarcode ? `ШК ${sku.primaryBarcode}` : '',
  ].filter(Boolean).join(' · ');
}
