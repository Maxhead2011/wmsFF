import { AlertTriangle, Archive, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  applyAdministrationUnpalletedWriteoff,
  previewAdministrationUnpalletedWriteoff,
  recheckAdministrationUnpalletedBlockers,
  type AdministrationUnpalletedBlockerRecheckResult,
  type AdministrationUnpalletedWriteoffBlocker,
  type AdministrationUnpalletedWriteoffPreview,
  type AdministrationUnpalletedWriteoffWarning,
  type AuthSession,
} from '../../lib/api';

const CONFIRMATION = 'СПИСАТЬ И АРХИВИРОВАТЬ';
// FIX: Keep the UI batch aligned with the server-side safety boundary.
export const UNPALLETED_WRITEOFF_BATCH_SIZE = 25;

const blockerLabels: Record<AdministrationUnpalletedWriteoffBlocker, string> = {
  // FIX: orphan PACKING is supported; shipment history and unknown statuses stay protected.
  NON_AVAILABLE_BALANCE: 'есть остаток в защищённом статусе (например SHIPPING)',
  ACTIVE_CLIENT_REQUEST: 'короб участвует в незавершённой заявке',
  ACTIVE_FBS_ASSEMBLY: 'короб зарезервирован активной сборкой FBS',
  OPEN_INVENTORY: 'короб участвует в открытой инвентаризации',
  FOREIGN_CLIENT_DATA: 'обнаружены связи с остатками или КИЗами другого клиента',
  ACTIVE_PICK_WAVE: 'остаток используется незавершённой волной сборки',
  PENDING_BOX_CHECK: 'по коробу не принято решение в проверке целостности',
};

const warningLabels: Record<AdministrationUnpalletedWriteoffWarning, string> = {
  KIZ_COUNT_MISMATCH: 'число доступных КИЗов не совпадает с остатком; SHIPPING не изменится',
};

export function AdministrationUnpalletedWriteoff({ session }: { session: AuthSession }) {
  const [preview, setPreview] = useState<AdministrationUnpalletedWriteoffPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // FIX: demo administrators and clients do not get a fallback UI even if this component is mounted directly.
  if (!canUseUnpalletedWriteoff(session)) return null;

  const safeBoxIds = preview?.rows
    .filter((row) => row.safe)
    .slice(0, UNPALLETED_WRITEOFF_BATCH_SIZE)
    .map((row) => row.boxId) ?? [];
  const blockedRows = preview?.rows.filter((row) => !row.safe) ?? [];
  const warningRows = preview?.rows.filter((row) => row.warnings.length > 0) ?? [];

  async function runPreview(keepMessage = false) {
    setBusy(true);
    setError('');
    if (!keepMessage) setMessage('');
    try {
      setPreview(await previewAdministrationUnpalletedWriteoff(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function applyNextBatch() {
    if (safeBoxIds.length === 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await applyAdministrationUnpalletedWriteoff(session.accessToken, {
        boxIds: safeBoxIds,
        confirmation,
      });
      const resultText =
        `Обработано коробов: ${result.processed}. Архивировано: ${result.archived}. ` +
        `Пропущено после повторной проверки: ${result.skipped}. Ошибок: ${result.failed}. ` +
        `Списано единиц: ${result.unitsWrittenOff}.`;
      if (result.failed > 0) setError(`${resultText} Неуспешные короба не изменены; повторите анализ.`);
      else setMessage(resultText);
      setConfirmation('');
      try {
        setPreview(await previewAdministrationUnpalletedWriteoff(session.accessToken));
      } catch (refreshError) {
        // FIX: a refresh error must not make a successful destructive operation look rolled back.
        setError(`${resultText} Не удалось обновить список: ${errorText(refreshError)}`);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function recheckBlockers() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await recheckAdministrationUnpalletedBlockers(session.accessToken);
      setPreview(result.preview);
      const resultText = unpalletedRecheckMessage(result);
      if (result.fbs.error) setError(resultText);
      else setMessage(resultText);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-tech-bulk" aria-label="Списание коробов без паллет-сорта">
      <div className="admin-tech-bulk__head">
        <Archive size={20} />
        <div>
          <strong>ИП Лукин Илья Ильич: короба без паллет-сорта</strong>
          <span>
            Анализ ничего не меняет. Списание доступно только для безопасных коробов без активных заявок,
            сборок и инвентаризаций. Исторические КИЗы SHIPPING не изменяются.
          </span>
        </div>
      </div>

      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}

      <div className="admin-tech-bulk__controls">
        <div className="admin-tech-bulk__selection">
          <strong>Сначала получите свежий снимок</strong>
          <span>Перед применением сервер повторит все проверки внутри транзакции.</span>
        </div>
        <button type="button" className="admin-button admin-button--ghost" disabled={busy} onClick={() => void runPreview()}>
          {busy ? <><LoaderCircle size={16} className="admin-spin" /> Проверяем…</> : <><RefreshCw size={16} /> Проанализировать</>}
        </button>
        <button type="button" className="admin-button admin-button--primary" disabled={busy} onClick={() => void recheckBlockers()}>
          {busy ? <><LoaderCircle size={16} className="admin-spin" /> Перепроверяем…</> : <><RefreshCw size={16} /> Перепроверить и снять устаревшие блокировки</>}
        </button>
      </div>

      {preview ? (
        <div className="admin-tech-results">
          <div className="admin-tech-summary">
            <strong>Без паллет-сорта: {preview.summary.candidates}</strong>
            <span>Можно списать: {preview.summary.safe} коробов / {preview.summary.safeUnits} ед.</span>
            <span>Заблокировано: {preview.summary.blocked}</span>
            <span>С предупреждением по КИЗам: {preview.summary.warnings}</span>
            <small>Проверено: {new Date(preview.checkedAt).toLocaleString('ru-RU')}</small>
          </div>

          {blockedRows.length > 0 ? (
            <details className="admin-tech-issue admin-tech-issue--critical">
              <summary>Почему заблокированы {blockedRows.length} коробов</summary>
              <ul>
                {preview.blockerSummary.map((item) => (
                  <li key={item.blocker}>
                    <strong>{blockerLabels[item.blocker]}</strong> — {item.boxes} коробов / {item.units} ед.
                  </li>
                ))}
              </ul>
              <details>
                <summary>Показать конкретные короба</summary>
                <ul>
                  {blockedRows.map((row) => (
                    <li key={row.boxId}>
                      <strong>{row.boxCode}</strong> — {row.quantity} ед.: {row.blockers.map((item) => blockerLabels[item]).join('; ')}
                    </li>
                  ))}
                </ul>
              </details>
            </details>
          ) : null}

          {warningRows.length > 0 ? (
            <details className="admin-tech-issue">
              <summary>Предупреждения по КИЗам: {warningRows.length} коробов</summary>
              <ul>
                {preview.warningSummary.map((item) => (
                  <li key={item.warning}>
                    <strong>{warningLabels[item.warning]}</strong> — {item.boxes} коробов / {item.units} ед.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {preview.summary.safe > 0 ? (
            <div className="admin-tech-bulk__confirm">
              <p>
                Следующая партия: {safeBoxIds.length} из {preview.summary.safe} безопасных коробов.
                После выполнения список автоматически проверится заново.
              </p>
              <label>
                Для подтверждения введите «{CONFIRMATION}»
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  placeholder={CONFIRMATION}
                />
              </label>
              <div>
                <button
                  type="button"
                  className="admin-button admin-button--primary"
                  disabled={busy || confirmation.trim() !== CONFIRMATION}
                  onClick={() => void applyNextBatch()}
                >
                  {busy ? 'Выполняется…' : `Списать и архивировать следующую партию (${safeBoxIds.length})`}
                </button>
              </div>
            </div>
          ) : (
            <p className="admin-tech-bulk__result">Безопасных коробов для списания сейчас нет.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

// TEST: access is kept as a pure predicate so the client/demo regression is covered without a browser session.
export function canUseUnpalletedWriteoff(session: AuthSession) {
  return (
    !session.user.isDemo &&
    session.user.roleCodes.includes('ADMIN') &&
    session.user.permissionCodes.includes('system:admin')
  );
}

// TEST: partial success is not hidden when WB refresh fails after inventory cleanup.
export function unpalletedRecheckMessage(result: AdministrationUnpalletedBlockerRecheckResult) {
  const inventoryText =
    `Инвентаризации: проверено ${result.inventory.checked}, завершено ${result.inventory.completed}. `;
  const queueText = `После перепроверки заблокировано коробов: ${result.preview.summary.blocked}.`;
  return result.fbs.error
    ? `${inventoryText}WB не обновлён: ${result.fbs.error}. ${queueText}`
    : `${inventoryText}Статусы WB обновлены. ${queueText}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
