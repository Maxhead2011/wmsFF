import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchBoxKizDiscrepancies,
  fetchKizIssues,
  markKizIssueRead,
  resolveKizIssue,
  writeOffAllBoxKizDiscrepancies,
  writeOffBoxKizDiscrepancy,
  type AuthSession,
  type BoxKizDiscrepancy,
  type BoxKizDiscrepancyReport,
  type KizIssue,
  type KizIssuesReport,
} from '../../lib/api';
import './kiz.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';

type KizIssuesPanelProps = {
  session: AuthSession;
  embedded?: boolean;
};

export function KizIssuesPanel({ session, embedded = false }: KizIssuesPanelProps) {
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [report, setReport] = useState<KizIssuesReport | null>(null);
  const [discrepancyReport, setDiscrepancyReport] =
    useState<BoxKizDiscrepancyReport | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<KizIssue | null>(null);
  const [selectedDiscrepancy, setSelectedDiscrepancy] =
    useState<BoxKizDiscrepancy | null>(null);
  const [replacementKiz, setReplacementKiz] = useState('');
  const [comment, setComment] = useState('');
  const [confirmBoxMove, setConfirmBoxMove] = useState(true);
  const [confirmExtraUnit, setConfirmExtraUnit] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [confirmWriteOff, setConfirmWriteOff] = useState(false);
  const [writeOffComment, setWriteOffComment] = useState('');
  const [isBulkWriteOffOpen, setBulkWriteOffOpen] = useState(false);
  const [confirmBulkWriteOff, setConfirmBulkWriteOff] = useState(false);
  const [bulkWriteOffComment, setBulkWriteOffComment] = useState('');

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      try {
        const [issues, discrepancies] = await Promise.all([
          fetchKizIssues(session.accessToken, {
            status,
            search: search.trim() || undefined,
            limit: 300,
          }),
          fetchBoxKizDiscrepancies(session.accessToken, {
            search: search.trim() || undefined,
            limit: 300,
          }),
        ]);
        setReport(issues);
        setDiscrepancyReport(discrepancies);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Не удалось загрузить очередь проблемных КИЗ.',
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [search, session.accessToken, status],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load, session.user.activeWarehouseId]);

  const clients = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; name: string }>();
    report?.issues.forEach((issue) => {
      if (issue.client) byId.set(issue.client.id, issue.client);
    });
    return [...byId.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'ru-RU'),
    );
  }, [report]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  function openIssue(issue: KizIssue) {
    setSelectedIssue(issue);
    setReplacementKiz('');
    setComment('');
    setConfirmBoxMove(true);
    setConfirmExtraUnit(false);
    setMessage('');
    setError('');
    if (issue.isUnread) {
      void markKizIssueRead(session.accessToken, issue.issueKey)
        .then(() => {
          window.dispatchEvent(new Event('kiz-issues-changed'));
          void load(true);
        })
        .catch(() => undefined);
    }
  }

  function closeIssue() {
    if (isSaving) return;
    setSelectedIssue(null);
  }

  function openDiscrepancy(row: BoxKizDiscrepancy) {
    setSelectedIssue(null);
    setSelectedDiscrepancy(row);
    setConfirmWriteOff(false);
    setWriteOffComment('');
    setMessage('');
    setError('');
  }

  function closeDiscrepancy() {
    if (isSaving) return;
    setSelectedDiscrepancy(null);
  }

  async function writeOffDiscrepancy() {
    if (!selectedDiscrepancy || !confirmWriteOff) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await writeOffBoxKizDiscrepancy(
        session.accessToken,
        selectedDiscrepancy.boxId,
        selectedDiscrepancy.skuId,
        {
          confirm: true,
          comment: writeOffComment.trim() || undefined,
        },
      );
      setMessage(result.message);
      setSelectedDiscrepancy(null);
      window.dispatchEvent(new Event('kiz-issues-changed'));
      await load(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось списать расхождение КИЗ.',
      );
    } finally {
      setSaving(false);
    }
  }

  function openBulkWriteOff() {
    setSelectedIssue(null);
    setSelectedDiscrepancy(null);
    setConfirmBulkWriteOff(false);
    setBulkWriteOffComment('');
    setMessage('');
    setError('');
    setBulkWriteOffOpen(true);
  }

  function closeBulkWriteOff() {
    if (isSaving) return;
    setBulkWriteOffOpen(false);
  }

  async function writeOffAllDiscrepancies() {
    if (!confirmBulkWriteOff) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await writeOffAllBoxKizDiscrepancies(
        session.accessToken,
        { search: search.trim() || undefined },
        {
          confirm: true,
          comment: bulkWriteOffComment.trim() || undefined,
        },
      );
      setMessage(result.message);
      setBulkWriteOffOpen(false);
      window.dispatchEvent(new Event('kiz-issues-changed'));
      await load(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось выполнить массовое исправление КИЗ.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function resolve(
    action:
      | 'REPLACE_KIZ'
      | 'REGISTER_EXTRA_UNIT'
      | 'PREPARE_EXTRA_UNIT'
      | 'RELEASE_BOX'
      | 'MARK_RESOLVED',
  ) {
    if (!selectedIssue) return;
    if (
      (action === 'REPLACE_KIZ' || action === 'REGISTER_EXTRA_UNIT') &&
      (replacementKiz.trim().length < 16 ||
        replacementKiz.trim().length > 135)
    ) {
      setError('Отсканируйте корректный КИЗ Data Matrix.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await resolveKizIssue(
        session.accessToken,
        selectedIssue.issueKey,
        {
          action,
          kiz:
            action === 'REPLACE_KIZ' || action === 'REGISTER_EXTRA_UNIT'
              ? replacementKiz.trim()
              : undefined,
          confirmBoxMove:
            action === 'REPLACE_KIZ' ? confirmBoxMove : undefined,
          comment: comment.trim() || undefined,
        },
      );
      setMessage(result.message);
      setSelectedIssue(null);
      window.dispatchEvent(new Event('kiz-issues-changed'));
      await load(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось исправить проблему КИЗ.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkspaceTileGate
      initiallyOpen={embedded}
      embedded={embedded}
      eyebrow="Контроль маркировки"
      title="КИЗ"
      description="Сначала выберите сценарий: разобрать проблему сканирования, сверить короба или выполнить корректировку."
      tiles={[
        { title: 'Проблемные КИЗ', description: 'Очередь ошибок и полная история использования кода.', icon: AlertTriangle, tone: 'red' },
        { title: 'Расхождения в коробах', description: 'Найти лишние и отсутствующие КИЗ по фактическим остаткам.', icon: Search, tone: 'orange' },
        { title: 'Исправления', description: 'Заменить КИЗ, подтвердить единицу или списать расхождение.', icon: Wrench, tone: 'green' },
      ]}
    >
    <div className="kiz-panel">
      <section className="kiz-hero">
        <div className="kiz-hero__icon">
          <ShieldCheck size={26} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">Контроль маркировки</p>
          <h2>Проблемные КИЗ</h2>
          <p>
            Отклонения Wildberries, повторные сканы и расхождения между
            отпиканным товаром, коробом и регистрацией КИЗ в WMS.
          </p>
        </div>
        <button
          className="icon-text-button"
          type="button"
          disabled={isLoading}
          onClick={() => void load()}
        >
          <RefreshCw
            className={isLoading ? 'is-spinning' : ''}
            size={16}
            aria-hidden="true"
          />
          Обновить
        </button>
      </section>

      <section className="kiz-summary" aria-label="Сводка проблем КИЗ">
        <Summary
          label="Непрочитано"
          value={report?.summary.unread ?? 0}
          tone="danger"
        />
        <Summary
          label="Открыто"
          value={report?.summary.open ?? 0}
          tone="danger"
        />
        <Summary
          label="Критические"
          value={report?.summary.critical ?? 0}
          tone="danger"
        />
        <Summary
          label="Предупреждения"
          value={report?.summary.warning ?? 0}
          tone="warning"
        />
        <Summary
          label="Исправлено"
          value={report?.summary.resolved ?? 0}
          tone="success"
        />
        <Summary
          label="Лишних КИЗ"
          value={discrepancyReport?.summary.excessKiz ?? 0}
          tone="warning"
        />
      </section>

      <section className="kiz-toolbar">
        <div className="kiz-tabs" role="tablist" aria-label="Статус проблем">
          {(
            [
              ['open', 'Открытые'],
              ['resolved', 'Исправленные'],
              ['all', 'Все'],
            ] as const
          ).map(([value, label]) => (
            <button
              className={status === value ? 'active' : ''}
              key={value}
              type="button"
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form className="kiz-search" onSubmit={submitSearch}>
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="КИЗ, заявка, заказ, товар, короб или сотрудник"
          />
          <button type="submit">Найти</button>
        </form>
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <section className="kiz-queue kiz-discrepancies">
        <header>
          <div>
            <h3>Расхождения КИЗ по коробам</h3>
            <span>
              КИЗ должно быть ровно столько, сколько единиц товара числится в коробе
            </span>
          </div>
          <div className="kiz-discrepancies__actions">
            <button
              className="kiz-write-off-all-button"
              type="button"
              disabled={
                isLoading ||
                !discrepancyReport ||
                discrepancyReport.summary.rows - discrepancyReport.summary.blockedRows <= 0
              }
              onClick={openBulkWriteOff}
            >
              <Wrench size={16} aria-hidden="true" />
              Исправить все
            </button>
            <strong>{discrepancyReport?.summary.rows ?? 0}</strong>
          </div>
        </header>
        {isLoading && !discrepancyReport ? (
          <div className="kiz-empty">
            <RefreshCw className="is-spinning" size={24} aria-hidden="true" />
            Сверяю остатки и зарегистрированные КИЗ…
          </div>
        ) : discrepancyReport?.discrepancies.length ? (
          <div className="kiz-table-wrap">
            <table className="kiz-table kiz-discrepancy-table">
              <thead>
                <tr>
                  <th>Короб / клиент</th>
                  <th>Костюм / товар</th>
                  <th>В коробе</th>
                  <th>КИЗ</th>
                  <th>Лишних</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {discrepancyReport.discrepancies.map((row) => (
                  <tr key={`${row.boxId}:${row.skuId}`}>
                    <td>
                      <strong>{row.boxCode}</strong>
                      <small>{row.clientCode} · {row.clientName}</small>
                      <small>{row.warehouseCity || 'Филиал не указан'}</small>
                    </td>
                    <td>
                      <strong>{row.internalSku}</strong>
                      <small>{[row.productName, row.size].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td><strong>{row.boxQuantity} шт.</strong></td>
                    <td>
                      <strong>{row.registeredKizCount}</strong>
                      {row.protectedKizCount ? (
                        <small>занято активными заказами: {row.protectedKizCount}</small>
                      ) : null}
                    </td>
                    <td><strong className="kiz-excess-count">+{row.excessKizCount}</strong></td>
                    <td>
                      <button
                        className="kiz-write-off-button"
                        type="button"
                        disabled={!row.canWriteOff}
                        title={row.canWriteOff ? undefined : 'Сначала исправьте активные FBS-заказы, использующие КИЗ из этого короба'}
                        onClick={() => openDiscrepancy(row)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        {row.canWriteOff ? 'Списать расхождение' : 'Занято заказами'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kiz-empty">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>Лишних КИЗ в коробах нет</strong>
            <span>Количество КИЗ совпадает с учтённым количеством товара.</span>
          </div>
        )}
      </section>

      <section className="kiz-queue">
        <header>
          <div>
            <h3>Очередь разбора</h3>
            <span>
              Автоматическое обновление каждые 30 секунд
              {clients.length ? ` · клиентов в выдаче: ${clients.length}` : ''}
            </span>
          </div>
          <strong>{report?.issues.length ?? 0}</strong>
        </header>

        {isLoading && !report ? (
          <div className="kiz-empty">
            <RefreshCw className="is-spinning" size={24} aria-hidden="true" />
            Загружаю проблемы КИЗ…
          </div>
        ) : report?.issues.length ? (
          <div className="kiz-table-wrap">
            <table className="kiz-table">
              <thead>
                <tr>
                  <th>Проблема</th>
                  <th>Заявка / заказ</th>
                  <th>Товар и короб</th>
                  <th>КИЗ</th>
                  <th>Обнаружено</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {report.issues.map((issue) => (
                  <tr
                    className={issue.isUnread ? 'kiz-row--unread' : undefined}
                    key={issue.issueKey}
                  >
                    <td>
                      <span
                        className={`kiz-severity kiz-severity--${issue.severity.toLowerCase()}`}
                      >
                        {issue.severity === 'CRITICAL' ? (
                          <AlertTriangle size={14} aria-hidden="true" />
                        ) : (
                          <Clock3 size={14} aria-hidden="true" />
                        )}
                        {issue.title}
                      </span>
                      {issue.isUnread ? (
                        <span className="kiz-unread-label">Новое</span>
                      ) : null}
                      <small>{issue.explanation}</small>
                      {issue.errorMessage ? (
                        <small className="kiz-error-detail">
                          {issue.errorMessage}
                        </small>
                      ) : null}
                      {issue.stockConflict ? (
                        <small className="kiz-stock-conflict">
                          Остаток: {issue.stockConflict.availableQuantity} ·
                          зарегистрировано КИЗ:{' '}
                          {issue.stockConflict.registeredKizCount} · занято:{' '}
                          {issue.stockConflict.usedKizCount}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <strong>
                        {issue.request
                          ? `№${String(issue.request.number).padStart(6, '0')}`
                          : 'Без заявки'}
                      </strong>
                      <small>Заказ WB: {issue.orderId || '—'}</small>
                      <small>
                        {issue.client
                          ? `${issue.client.code} · ${issue.client.name}`
                          : 'Клиент не найден'}
                      </small>
                      {issue.duplicate ? (
                        <small className="kiz-duplicate">
                          Где использован: заявка{' '}
                          {issue.duplicate.existingRequestNumber
                            ? `№${String(
                                issue.duplicate.existingRequestNumber,
                              ).padStart(6, '0')}`
                            : '—'}
                          , заказ WB {issue.duplicate.existingOrderId || '—'}
                          , короб {issue.duplicate.existingBoxCode || '—'}
                          <br />
                          Костюм / товар:{' '}
                          {formatExistingProduct(
                            issue.duplicate.existingProduct,
                          )}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <strong>{issue.sku?.internalSku || 'SKU не найден'}</strong>
                      <small>
                        {[issue.sku?.name, issue.sku?.size]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </small>
                      <small>
                        Короб: {issue.boxCode || 'без короба'} ·{' '}
                        {issue.branch?.city || 'город не указан'}
                      </small>
                    </td>
                    <td>
                      <code>{issue.kiz || 'не сохранён'}</code>
                      <small>WB: {issue.wbMetaStatus || '—'}</small>
                    </td>
                    <td>
                      <strong>{formatDateTime(issue.detectedAt)}</strong>
                      <small>{issue.workerName || 'сотрудник не указан'}</small>
                      {issue.resolution ? (
                        <small className="kiz-resolution">
                          Решил: {issue.resolution.userName || '—'}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {issue.status === 'OPEN' ? (
                        <button
                          className="kiz-fix-button"
                          type="button"
                          onClick={() => openIssue(issue)}
                        >
                          <Wrench size={15} aria-hidden="true" />
                          Исправить
                        </button>
                      ) : (
                        <span className="kiz-resolved">
                          <CheckCircle2 size={15} aria-hidden="true" />
                          Решено
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kiz-empty">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>
              {status === 'open'
                ? 'Открытых проблем КИЗ нет'
                : 'По выбранному фильтру записей нет'}
            </strong>
            <span>Новые проблемы появятся здесь автоматически.</span>
          </div>
        )}
      </section>

      {selectedIssue ? (
        <div
          className="kiz-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeIssue();
          }}
        >
          <section
            className="kiz-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiz-dialog-title"
          >
            <header>
              <div>
                <p className="eyebrow">Исправление с журналом действий</p>
                <h3 id="kiz-dialog-title">{selectedIssue.title}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closeIssue}
                aria-label="Закрыть"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="kiz-dialog__facts">
              <Fact
                label="Заявка"
                value={
                  selectedIssue.request
                    ? `№${String(selectedIssue.request.number).padStart(6, '0')}`
                    : '—'
                }
              />
              <Fact label="Заказ WB" value={selectedIssue.orderId || '—'} />
              <Fact
                label="Товар"
                value={selectedIssue.sku?.internalSku || '—'}
              />
              <Fact label="Короб" value={selectedIssue.boxCode || '—'} />
            </div>

            <p className="kiz-dialog__explanation">
              {selectedIssue.explanation}
            </p>

            {selectedIssue.duplicate ? (
              <section className="kiz-dialog__diagnostic">
                <strong>Где этот КИЗ уже использован</strong>
                <div>
                  <Fact
                    label="Заявка"
                    value={
                      selectedIssue.duplicate.existingRequestNumber
                        ? `№${String(
                            selectedIssue.duplicate.existingRequestNumber,
                          ).padStart(6, '0')}`
                        : '—'
                    }
                  />
                  <Fact
                    label="Заказ WB"
                    value={selectedIssue.duplicate.existingOrderId || '—'}
                  />
                  <Fact
                    label="Костюм / товар"
                    value={formatExistingProduct(
                      selectedIssue.duplicate.existingProduct,
                    )}
                  />
                  <Fact
                    label="Короб"
                    value={selectedIssue.duplicate.existingBoxCode || '—'}
                  />
                </div>
              </section>
            ) : null}

            {selectedIssue.stockConflict ? (
              <section className="kiz-dialog__diagnostic">
                <strong>Что обнаружила система</strong>
                <div>
                  <Fact
                    label="Остаток в коробе"
                    value={String(selectedIssue.stockConflict.availableQuantity)}
                  />
                  <Fact
                    label="КИЗ зарегистрировано"
                    value={String(
                      selectedIssue.stockConflict.registeredKizCount,
                    )}
                  />
                  <Fact
                    label="КИЗ занято заказами"
                    value={String(selectedIssue.stockConflict.usedKizCount)}
                  />
                </div>
                {selectedIssue.stockConflict.usedAssignments.length ? (
                  <ul>
                    {selectedIssue.stockConflict.usedAssignments.map(
                      (assignment, index) => (
                        <li key={`${assignment.orderId ?? 'order'}-${index}`}>
                          Заявка{' '}
                          {assignment.requestNumber
                            ? `№${String(assignment.requestNumber).padStart(6, '0')}`
                            : '—'}
                          {' · '}заказ WB {assignment.orderId || '—'}
                          {' · '}короб {assignment.boxCode || '—'}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {selectedIssue.allowedActions.includes('REPLACE_KIZ') ||
            selectedIssue.allowedActions.includes('REGISTER_EXTRA_UNIT') ? (
              <label className="kiz-dialog__field">
                <span>
                  {selectedIssue.kind === 'BOX_KIZ_EXHAUSTED'
                    ? 'КИЗ физической дополнительной единицы'
                    : 'Новый корректный КИЗ'}
                </span>
                <textarea
                  autoFocus
                  value={replacementKiz}
                  onChange={(event) => setReplacementKiz(event.target.value)}
                  placeholder="Отсканируйте Data Matrix"
                  rows={3}
                />
                <small>
                  {selectedIssue.kind === 'BOX_KIZ_EXHAUSTED'
                    ? 'Если товар физически есть сверх текущего остатка, система добавит ровно одну единицу, зарегистрирует этот КИЗ и передаст его в Wildberries.'
                    : 'Код будет повторно отправлен в Wildberries. Для уже отпиканного заказа система безопасно вернёт одну единицу в работу и соберёт её снова.'}
                </small>
              </label>
            ) : (
              selectedIssue.allowedActions.includes('PREPARE_EXTRA_UNIT') ? (
                <p className="kiz-dialog__notice">
                  КИЗ здесь вводить не нужно. Подтвердите физическую единицу,
                  после чего сотрудник повторно отсканирует её КИЗ на ТСД.
                  WMS зарегистрирует код и передаст его в Wildberries.
                </p>
              ) : (
                <p className="kiz-dialog__notice">
                  Автоматическое исправление недоступно: заказ уже закрыт,
                  упакован в грузоместо или задание изменилось.
                </p>
              )
            )}

            {selectedIssue.allowedActions.includes('REPLACE_KIZ') ? (
              <label className="kiz-dialog__check">
                <input
                  type="checkbox"
                  checked={confirmBoxMove}
                  onChange={(event) => setConfirmBoxMove(event.target.checked)}
                />
                <span>
                  Разрешить перепривязать КИЗ к фактическому коробу, если в WMS
                  указан другой короб
                </span>
              </label>
            ) : null}

            {selectedIssue.allowedActions.includes('REGISTER_EXTRA_UNIT') ||
            selectedIssue.allowedActions.includes('PREPARE_EXTRA_UNIT') ? (
              <label className="kiz-dialog__check kiz-dialog__check--warning">
                <input
                  type="checkbox"
                  checked={confirmExtraUnit}
                  onChange={(event) => setConfirmExtraUnit(event.target.checked)}
                />
                <span>
                  Подтверждаю, что дополнительная единица товара физически
                  существует. При необходимости остаток будет увеличен ровно
                  на 1 с записью в журнале.
                </span>
              </label>
            ) : null}

            <label className="kiz-dialog__field">
              <span>Комментарий администратора</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Что проверили и почему приняли решение"
                rows={2}
              />
            </label>

            {error ? <p className="form-error">{error}</p> : null}

            <footer>
              <button
                className="secondary-button"
                type="button"
                disabled={isSaving}
                onClick={() => void resolve('MARK_RESOLVED')}
              >
                <CheckCircle2 size={16} aria-hidden="true" />
                Отметить решённой
              </button>
              {selectedIssue.allowedActions.includes('REPLACE_KIZ') ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void resolve('REPLACE_KIZ')}
                >
                  {isSaving ? (
                    <RefreshCw
                      className="is-spinning"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <Wrench size={16} aria-hidden="true" />
                  )}
                  {isSaving ? 'Исправляю…' : 'Исправить КИЗ'}
                </button>
              ) : null}
              {selectedIssue.allowedActions.includes('RELEASE_BOX') ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void resolve('RELEASE_BOX')}
                >
                  Выбрать другой короб
                </button>
              ) : null}
              {selectedIssue.allowedActions.includes(
                'REGISTER_EXTRA_UNIT',
              ) ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSaving || !confirmExtraUnit}
                  onClick={() => void resolve('REGISTER_EXTRA_UNIT')}
                >
                  {isSaving ? (
                    <RefreshCw
                      className="is-spinning"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <Wrench size={16} aria-hidden="true" />
                  )}
                  {isSaving
                    ? 'Исправляю…'
                    : 'Подтвердить +1 и принять КИЗ'}
                </button>
              ) : null}
              {selectedIssue.allowedActions.includes(
                'PREPARE_EXTRA_UNIT',
              ) ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSaving || !confirmExtraUnit}
                  onClick={() => void resolve('PREPARE_EXTRA_UNIT')}
                >
                  {isSaving ? (
                    <RefreshCw
                      className="is-spinning"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <Wrench size={16} aria-hidden="true" />
                  )}
                  {isSaving
                    ? 'Подготавливаю…'
                    : 'Учесть +1 и разрешить повторный скан'}
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}

      {selectedDiscrepancy ? (
        <div
          className="kiz-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeDiscrepancy();
          }}
        >
          <section
            className="kiz-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiz-write-off-title"
          >
            <header>
              <div>
                <p className="eyebrow">Контролируемое списание</p>
                <h3 id="kiz-write-off-title">Списать лишние КИЗ</h3>
              </div>
              <button className="icon-button" type="button" onClick={closeDiscrepancy} aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="kiz-dialog__facts">
              <Fact label="Короб" value={selectedDiscrepancy.boxCode} />
              <Fact label="Товар" value={selectedDiscrepancy.internalSku} />
              <Fact label="Остаток" value={`${selectedDiscrepancy.boxQuantity} шт.`} />
              <Fact label="КИЗ сейчас" value={String(selectedDiscrepancy.registeredKizCount)} />
            </div>
            <p className="kiz-dialog__explanation">
              Будет списано {selectedDiscrepancy.excessKizCount} лишних КИЗ. После операции в коробе останется ровно {selectedDiscrepancy.boxQuantity} КИЗ — по количеству товара.
            </p>
            <p className="kiz-dialog__notice">
              КИЗ, занятые незавершёнными FBS-заказами, защищены и не удаляются. Отгруженные коды сохраняются в истории отгрузок и в журнале этой операции.
            </p>
            <label className="kiz-dialog__field">
              <span>Комментарий администратора</span>
              <textarea
                value={writeOffComment}
                onChange={(event) => setWriteOffComment(event.target.value)}
                placeholder="Например: пересчитан фактический остаток в коробе"
                rows={2}
              />
            </label>
            <label className="kiz-dialog__check kiz-dialog__check--warning">
              <input
                type="checkbox"
                checked={confirmWriteOff}
                onChange={(event) => setConfirmWriteOff(event.target.checked)}
              />
              <span>
                Подтверждаю списание {selectedDiscrepancy.excessKizCount} лишних КИЗ. Количество товара в коробе не изменяется.
              </span>
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <footer>
              <button className="secondary-button" type="button" disabled={isSaving} onClick={closeDiscrepancy}>
                Отмена
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isSaving || !confirmWriteOff}
                onClick={() => void writeOffDiscrepancy()}
              >
                {isSaving ? <RefreshCw className="is-spinning" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                {isSaving ? 'Списываю…' : `Списать ${selectedDiscrepancy.excessKizCount} КИЗ`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {isBulkWriteOffOpen && discrepancyReport ? (
        <div
          className="kiz-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeBulkWriteOff();
          }}
        >
          <section
            className="kiz-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiz-write-off-all-title"
          >
            <header>
              <div>
                <p className="eyebrow">Массовое исправление</p>
                <h3 id="kiz-write-off-all-title">Исправить все расхождения КИЗ</h3>
              </div>
              <button className="icon-button" type="button" onClick={closeBulkWriteOff} aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="kiz-dialog__facts">
              <Fact label="Расхождений" value={String(discrepancyReport.summary.rows)} />
              <Fact label="Лишних КИЗ" value={String(discrepancyReport.summary.excessKiz)} />
              <Fact label="Доступно для исправления" value={String(discrepancyReport.summary.rows - discrepancyReport.summary.blockedRows)} />
              <Fact label="Защищено заказами" value={String(discrepancyReport.summary.blockedRows)} />
            </div>
            <p className="kiz-dialog__explanation">
              Система обработает все доступные расхождения{search.trim() ? ' по текущему поиску' : ' выбранного филиала'} и оставит в каждом коробе ровно столько КИЗ, сколько в нём числится товара.
            </p>
            <p className="kiz-dialog__notice">
              КИЗ активных FBS-заказов не списываются. Заблокированные строки останутся в списке для отдельного разбора. Количество товара не изменяется.
            </p>
            <label className="kiz-dialog__field">
              <span>Комментарий администратора</span>
              <textarea
                value={bulkWriteOffComment}
                onChange={(event) => setBulkWriteOffComment(event.target.value)}
                placeholder="Например: выполнена общая сверка остатков и КИЗ"
                rows={2}
              />
            </label>
            <label className="kiz-dialog__check kiz-dialog__check--warning">
              <input
                type="checkbox"
                checked={confirmBulkWriteOff}
                onChange={(event) => setConfirmBulkWriteOff(event.target.checked)}
              />
              <span>
                Подтверждаю массовое списание лишних КИЗ. Фактическое количество товара в коробах не меняется.
              </span>
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <footer>
              <button className="secondary-button" type="button" disabled={isSaving} onClick={closeBulkWriteOff}>
                Отмена
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isSaving || !confirmBulkWriteOff}
                onClick={() => void writeOffAllDiscrepancies()}
              >
                {isSaving ? <RefreshCw className="is-spinning" size={16} aria-hidden="true" /> : <Wrench size={16} aria-hidden="true" />}
                {isSaving ? 'Исправляю всё…' : 'Исправить все'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
    </WorkspaceTileGate>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'warning' | 'success';
}) {
  return (
    <article className={`kiz-summary__card kiz-summary__card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatExistingProduct(
  product: {
    internalSku: string | null;
    article: string | null;
    name: string | null;
    color: string | null;
    size: string | null;
  } | null,
) {
  if (!product) return '—';
  const primary =
    product.name || product.internalSku || product.article || 'Товар не найден';
  const details = [
    product.internalSku && product.internalSku !== primary
      ? product.internalSku
      : null,
    product.article &&
    product.article !== primary &&
    product.article !== product.internalSku
      ? `арт. ${product.article}`
      : null,
    product.color,
    product.size,
  ].filter((value): value is string => Boolean(value));
  return details.length > 0 ? `${primary} · ${details.join(' · ')}` : primary;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
}
