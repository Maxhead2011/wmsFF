import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Container,
  ListChecks,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Send,
  ServerCog,
  Tablet,
  Tags,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyAdministrationPalletSortScan,
  applyAdministrationTechnicalWork,
  applyAdministrationTechnicalWorkBulk,
  diagnoseAdministrationTechnicalWork,
  fetchAdministrationTechnicalWork,
  previewAdministrationPalletSortScan,
  type AdministrationPalletSortScanPreview,
  type AdministrationTechnicalWorkCategory,
  type AdministrationTechnicalWorkBulkResult,
  type AdministrationTechnicalWorkDiagnosis,
  type AdministrationTechnicalWorkIssue,
  type AdministrationTechnicalWorkOverview,
  type AuthSession,
} from '../../lib/api';
import { KizIssuesPanel } from '../kiz/KizIssuesPanel';
import { AdministrationPhantomStockPanel } from './AdministrationPhantomStock';
import { AdministrationInternalApis } from './AdministrationInternalApis';
import { AdministrationTsdWorkloadsPanel } from './AdministrationTsdWorkloads';
import { AdministrationUnpalletedWriteoff, canUseUnpalletedWriteoff } from './AdministrationUnpalletedWriteoff';

type Props = { session: AuthSession };
type SectionId = AdministrationTechnicalWorkCategory | 'KIZ' | 'TSD' | 'PHANTOM_STOCK' | 'INTERNAL_APIS' | 'UNPALLETED_WRITEOFF';
type TechnicalAction = AdministrationTechnicalWorkIssue['actions'][number];

type SectionDefinition = {
  id: SectionId;
  title: string;
  description: string;
  icon: LucideIcon;
};

const sections: SectionDefinition[] = [
  { id: 'REQUESTS', title: 'Заявки', description: 'Очереди ТСД и ошибки маршрута сборки', icon: ClipboardList },
  { id: 'PALLET_SORTS', title: 'Паллет-сорты', description: 'Короба без паллет-сорта и неверные источники', icon: Container },
  { id: 'BOXES', title: 'Короба', description: 'Пустые, архивные, отсутствующие и занятые короба', icon: Boxes },
  // FIX: this destructive entry point is additionally filtered by system:admin below.
  { id: 'UNPALLETED_WRITEOFF', title: 'Списание коробов без паллет-сорта', description: 'Только ИП Лукин Илья Ильич: анализ, списание остатков и архив', icon: Boxes },
  { id: 'KIZ', title: 'КИЗы', description: 'Конфликты кодов, расхождения и подтверждённые исправления', icon: Tags },
  { id: 'MARKETPLACE_STATUS', title: 'Статусы WB', description: 'Не передан статус, возврат товара или решение менеджера', icon: Send },
  { id: 'TSD', title: 'Занятые ТСД', description: 'Зависшие задания и безопасное освобождение устройств', icon: Tablet },
  { id: 'PHANTOM_STOCK', title: 'Фантомные остатки', description: 'Остаток есть в системе, но отсутствует в коробе', icon: PackageSearch },
  // ADDED: Internal routes are documented separately from external WB/Ozon connections.
  { id: 'INTERNAL_APIS', title: 'Внутренние API', description: 'Состояние, назначение, логика и защищённый перезапуск', icon: ServerCog },
];

// FIX: keep the real tile source testable so a client cannot regain the destructive entry point.
export function visibleTechnicalWorkSections(session: AuthSession) {
  return sections.filter(
    (section) => section.id !== 'UNPALLETED_WRITEOFF' || canUseUnpalletedWriteoff(session),
  );
}

export function AdministrationTechnicalWork({ session }: Props) {
  const [selected, setSelected] = useState<SectionId | null>(null);
  const [overview, setOverview] = useState<AdministrationTechnicalWorkOverview | null>(null);
  const [diagnoses, setDiagnoses] = useState<Partial<Record<AdministrationTechnicalWorkCategory, AdministrationTechnicalWorkDiagnosis>>>({});
  const [loading, setLoading] = useState<SectionId | 'OVERVIEW' | ''>('OVERVIEW');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ issue: AdministrationTechnicalWorkIssue; action: AdministrationTechnicalWorkIssue['actions'][number] } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [comment, setComment] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await fetchAdministrationTechnicalWork(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading((current) => current === 'OVERVIEW' ? '' : current);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const diagnose = useCallback(async (category: AdministrationTechnicalWorkCategory) => {
    setLoading(category);
    setError('');
    setMessage('');
    setPending(null);
    try {
      const result = await diagnoseAdministrationTechnicalWork(session.accessToken, category);
      setDiagnoses((current) => ({ ...current, [category]: result }));
      await loadOverview();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading('');
    }
  }, [loadOverview, session.accessToken]);

  useEffect(() => {
    if (selected && isDiagnosticSection(selected) && !diagnoses[selected]) void diagnose(selected);
  }, [selected, diagnoses, diagnose]);

  const currentDefinition = useMemo(() => sections.find((section) => section.id === selected) ?? null, [selected]);

  async function applyFix() {
    if (!pending) return;
    const { issue, action } = pending;
    setLoading(issue.category);
    setError('');
    setMessage('');
    try {
      const result = await applyAdministrationTechnicalWork(session.accessToken, {
        issueId: issue.id,
        category: issue.category,
        action: action.id,
        confirmation,
        comment: comment.trim() || undefined,
      });
      setMessage(result.verified ? result.message : `${result.message} Автоматическая проверка подтверждает, что проблема ещё осталась.`);
      setPending(null);
      setConfirmation('');
      setComment('');
      const refreshed = await diagnoseAdministrationTechnicalWork(session.accessToken, issue.category);
      setDiagnoses((current) => ({ ...current, [issue.category]: refreshed }));
      await loadOverview();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading('');
    }
  }

  async function applyBulkFix(payload: {
    category: AdministrationTechnicalWorkCategory;
    issueIds: string[];
    action: TechnicalAction['id'];
    confirmation: string;
    comment?: string;
  }) {
    setLoading(payload.category);
    setError('');
    setMessage('');
    try {
      const result = await applyAdministrationTechnicalWorkBulk(session.accessToken, payload);
      setMessage(
        `Массовое исправление завершено: проверено проблем ${result.verified} из ${result.requestedIssues}, ` +
        `выполнено операций ${result.applied}, не исправлено ${result.failed}.` +
        (result.verificationWarning ? ` ${result.verificationWarning}` : ''),
      );
      if (result.diagnosis) {
        setDiagnoses((current) => ({ ...current, [payload.category]: result.diagnosis! }));
      } else {
        const refreshed = await diagnoseAdministrationTechnicalWork(session.accessToken, payload.category);
        setDiagnoses((current) => ({ ...current, [payload.category]: refreshed }));
      }
      await loadOverview();
      return result;
    } catch (caught) {
      setError(errorText(caught));
      throw caught;
    } finally {
      setLoading('');
    }
  }

  function openSection(id: SectionId) {
    setSelected(id);
    setError('');
    setMessage('');
    setPending(null);
  }

  if (selected && currentDefinition) {
    return (
      <section className="admin-tech-shell">
        <header className="admin-tech-detail-head">
          <button type="button" className="admin-tech-back" onClick={() => setSelected(null)}>
            <ArrowLeft size={17} /> Все технические работы
          </button>
          <div>
            <h3>{currentDefinition.title}</h3>
            <p>{currentDefinition.description}</p>
          </div>
          {isDiagnosticSection(selected) ? (
            <button type="button" className="admin-button admin-button--ghost" disabled={loading === selected} onClick={() => void diagnose(selected)}>
              <RefreshCw size={16} className={loading === selected ? 'admin-spin' : ''} /> Проанализировать сейчас
            </button>
          ) : null}
        </header>

        {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
        {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}

        {selected === 'KIZ' ? <KizIssuesPanel session={session} embedded /> : null}
        {selected === 'TSD' ? <AdministrationTsdWorkloadsPanel session={session} /> : null}
        {selected === 'PHANTOM_STOCK' ? <AdministrationPhantomStockPanel session={session} /> : null}
        {selected === 'INTERNAL_APIS' ? <AdministrationInternalApis session={session} /> : null}
        {selected === 'UNPALLETED_WRITEOFF' && canUseUnpalletedWriteoff(session) ? <AdministrationUnpalletedWriteoff session={session} /> : null}
        {selected === 'PALLET_SORTS' ? (
          <PalletSortScanRecovery
            session={session}
            onApplied={async () => {
              await diagnose('PALLET_SORTS');
            }}
          />
        ) : null}
        {isDiagnosticSection(selected) ? (
          <DiagnosisPanel
            diagnosis={diagnoses[selected] ?? null}
            loading={loading === selected}
            pending={pending}
            confirmation={confirmation}
            comment={comment}
            onChoose={(issue, action) => {
              setPending({ issue, action });
              setConfirmation('');
              setComment('');
              setMessage('');
            }}
            onCancel={() => setPending(null)}
            onConfirmation={setConfirmation}
            onComment={setComment}
            onApply={() => void applyFix()}
            onBulkApply={applyBulkFix}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="admin-tech-shell">
      <header className="admin-tech-intro">
        <div>
          <h3>Технические работы</h3>
          <p>Проверка проблем заявок и только подтверждённые действия, которые действительно меняют состояние WMS.</p>
        </div>
        <button type="button" className="admin-button admin-button--ghost" disabled={loading === 'OVERVIEW'} onClick={() => void loadOverview()}>
          <RefreshCw size={16} className={loading === 'OVERVIEW' ? 'admin-spin' : ''} /> Обновить счётчики
        </button>
      </header>
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}
      <div className="admin-tech-grid">
        {visibleTechnicalWorkSections(session).map((section) => {
          const Icon = section.icon;
          const diagnosis = isDiagnosticSection(section.id) ? diagnoses[section.id] : null;
          const count = diagnosis?.summary.issues ?? (section.id === 'MARKETPLACE_STATUS' ? overview?.statusProblems : undefined);
          return (
            <button type="button" className="admin-tech-tile" key={section.id} onClick={() => openSection(section.id)}>
              <span className="admin-tech-tile__icon"><Icon size={22} /></span>
              <span className="admin-tech-tile__body">
                <strong>{section.title}</strong>
                <small>{section.description}</small>
              </span>
              <span className={count ? 'admin-tech-tile__count is-alert' : 'admin-tech-tile__count'}>
                {count === undefined ? 'Проверить' : count === 0 ? 'Чисто' : count}
              </span>
            </button>
          );
        })}
      </div>
      <footer className="admin-tech-footnote">
        <Wrench size={16} /> Активных FBS-заявок для проверки: {overview?.activeRequests ?? '—'}. Анализ коробов и паллет-сортов запускается только по нажатию, чтобы не нагружать сборку.
      </footer>
    </section>
  );
}

function PalletSortScanRecovery({ session, onApplied }: { session: AuthSession; onApplied: () => Promise<void> }) {
  const [palletCode, setPalletCode] = useState('');
  const [boxText, setBoxText] = useState('');
  const [preview, setPreview] = useState<AdministrationPalletSortScanPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const boxCodes = useMemo(() => uniqueScannedCodes(boxText), [boxText]);

  function changePallet(value: string) {
    setPalletCode(value);
    setPreview(null);
    setConfirmation('');
  }

  function changeBoxes(value: string) {
    setBoxText(value);
    setPreview(null);
    setConfirmation('');
  }

  async function runPreview() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setPreview(await previewAdministrationPalletSortScan(session.accessToken, { palletCode, boxCodes }));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function applyScan() {
    if (!preview) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await applyAdministrationPalletSortScan(session.accessToken, {
        palletCode: preview.pallet.code,
        boxCodes: preview.boxes.map((box) => box.code),
        confirmation,
      });
      setMessage(result.message);
      setPreview(null);
      setConfirmation('');
      setBoxText('');
      await onApplied();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-tech-bulk" aria-label="Восстановление палет-сорта фактическим сканированием">
      <div className="admin-tech-bulk__head">
        <Container size={20} />
        <div>
          <strong>Восстановить по фактическому размещению</strong>
          <span>Сначала отсканируйте палет-сорт, затем все короба, которые сейчас физически находятся на нём.</span>
        </div>
      </div>
      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}
      <div className="admin-tech-bulk__controls">
        <label>Палет-сорт
          <input value={palletCode} onChange={(event) => changePallet(event.target.value)} placeholder="Отсканируйте палет-сорт" />
        </label>
        <label>Короба, по одному в строке
          <textarea value={boxText} onChange={(event) => changeBoxes(event.target.value)} rows={6} placeholder="Отсканируйте короб и нажмите Enter" />
        </label>
        <div className="admin-tech-bulk__selection">
          <strong>Уникальных коробов: {boxCodes.length}</strong>
          <span>Старая история размещений не применяется автоматически.</span>
        </div>
        <button type="button" className="admin-button admin-button--primary" disabled={busy || !palletCode.trim() || boxCodes.length === 0} onClick={() => void runPreview()}>
          {busy ? <><LoaderCircle size={16} className="admin-spin" /> Проверяем…</> : 'Проверить перед размещением'}
        </button>
      </div>
      {preview ? (
        <div className="admin-tech-bulk__confirm">
          <strong>{preview.pallet.code}: коробов {preview.summary.requested}</strong>
          <p>
            Новых привязок: {preview.summary.place}; переносов с другой палеты: {preview.summary.move};
            уже на месте: {preview.summary.unchanged}; связанных заявок: {preview.summary.affectedRequests}.
          </p>
          {preview.pallet.willCreate ? <p>Карточка палет-сорта будет создана для склада {preview.pallet.warehouse?.name}.</p> : null}
          {preview.boxes.some((box) => box.action === 'MOVE') ? (
            <ul>{preview.boxes.filter((box) => box.action === 'MOVE').map((box) => <li key={box.code}>{box.code}: перенос с {box.currentPalletCode}</li>)}</ul>
          ) : null}
          {preview.errors.length > 0 ? <ul>{preview.errors.map((row) => <li key={`${row.code}:${row.message}`}>{row.code}: {row.message}</li>)}</ul> : null}
          {preview.affectedRequests.length > 0 ? <p>Будут пересчитаны заявки: {preview.affectedRequests.map((request) => request.number).join(', ')}.</p> : null}
          <label>Подтверждение
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={preview.confirmation} />
          </label>
          <div>
            <button type="button" className="admin-button admin-button--ghost" onClick={() => setPreview(null)}>Отмена</button>
            <button type="button" className="admin-button admin-button--primary" disabled={busy || !preview.canApply || confirmation.trim().toLocaleUpperCase('ru-RU') !== preview.confirmation} onClick={() => void applyScan()}>
              {busy ? 'Сохраняю…' : 'Разместить и пересчитать заявки'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DiagnosisPanel({
  diagnosis,
  loading,
  pending,
  confirmation,
  comment,
  onChoose,
  onCancel,
  onConfirmation,
  onComment,
  onApply,
  onBulkApply,
}: {
  diagnosis: AdministrationTechnicalWorkDiagnosis | null;
  loading: boolean;
  pending: { issue: AdministrationTechnicalWorkIssue; action: AdministrationTechnicalWorkIssue['actions'][number] } | null;
  confirmation: string;
  comment: string;
  onChoose: (issue: AdministrationTechnicalWorkIssue, action: AdministrationTechnicalWorkIssue['actions'][number]) => void;
  onCancel: () => void;
  onConfirmation: (value: string) => void;
  onComment: (value: string) => void;
  onApply: () => void;
  onBulkApply: (payload: {
    category: AdministrationTechnicalWorkCategory;
    issueIds: string[];
    action: TechnicalAction['id'];
    confirmation: string;
    comment?: string;
  }) => Promise<AdministrationTechnicalWorkBulkResult>;
}) {
  const actionOptions = useMemo(() => {
    const values = new Map<TechnicalAction['id'], TechnicalAction>();
    diagnosis?.issues.forEach((issue) => issue.actions.forEach((action) => values.set(action.id, action)));
    return [...values.values()];
  }, [diagnosis]);
  const [bulkActionId, setBulkActionId] = useState<TechnicalAction['id'] | ''>('');
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [bulkPrepared, setBulkPrepared] = useState(false);
  const [bulkConfirmation, setBulkConfirmation] = useState('');
  const [bulkComment, setBulkComment] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<AdministrationTechnicalWorkBulkResult | null>(null);

  useEffect(() => {
    const nextAction = actionOptions.some((action) => action.id === bulkActionId)
      ? bulkActionId
      : actionOptions[0]?.id ?? '';
    setBulkActionId(nextAction);
    setSelectedIssueIds(new Set());
    setBulkPrepared(false);
    setBulkConfirmation('');
    setBulkComment('');
  }, [diagnosis?.checkedAt, actionOptions]);

  if (loading && !diagnosis) return <div className="admin-tech-loading"><LoaderCircle className="admin-spin" size={22} /> Проверяем заявки и фактические источники…</div>;
  if (!diagnosis) return null;
  if (diagnosis.issues.length === 0) {
    return <div className="admin-tech-empty"><CheckCircle2 size={24} /><strong>Проблем не найдено</strong><span>Проверка выполнена {formatCheckedAt(diagnosis.checkedAt)}.</span></div>;
  }

  const selectedAction = actionOptions.find((action) => action.id === bulkActionId) ?? null;
  const eligibleIssues = bulkActionId
    ? diagnosis.issues.filter((issue) => issue.actions.some((action) => action.id === bulkActionId))
    : [];
  const selectableIssues = eligibleIssues.slice(0, 200);

  function changeBulkAction(value: TechnicalAction['id']) {
    setBulkActionId(value);
    setSelectedIssueIds(new Set());
    setBulkPrepared(false);
    setBulkResult(null);
  }

  function toggleIssue(issueId: string) {
    setSelectedIssueIds((current) => {
      const next = new Set(current);
      if (next.has(issueId)) next.delete(issueId);
      else if (next.size < 200) next.add(issueId);
      return next;
    });
    setBulkPrepared(false);
  }

  async function runBulk() {
    if (!selectedAction || selectedIssueIds.size === 0) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const result = await onBulkApply({
        category: diagnosis!.category,
        issueIds: [...selectedIssueIds],
        action: selectedAction.id,
        confirmation: bulkConfirmation,
        comment: bulkComment.trim() || undefined,
      });
      setBulkResult(result);
      setSelectedIssueIds(new Set());
      setBulkPrepared(false);
      setBulkConfirmation('');
      setBulkComment('');
    } catch {
      // The parent renders the exact server error and preserves this selection for retry.
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="admin-tech-results">
      <div className="admin-tech-summary">
        <strong>Найдено: {diagnosis.summary.issues}</strong>
        {diagnosis.category === 'PALLET_SORTS' ? <span>Уникальных коробов: {diagnosis.summary.uniqueObjects}</span> : null}
        <span>Критичных: {diagnosis.summary.critical}</span>
        <span>Можно исправить из раздела: {diagnosis.summary.actionable}</span>
        <small>Проверено {formatCheckedAt(diagnosis.checkedAt)}</small>
      </div>
      {actionOptions.length > 0 ? (
        <section className="admin-tech-bulk" aria-label="Массовое исправление">
          <div className="admin-tech-bulk__head">
            <ListChecks size={20} />
            <div><strong>Массовое исправление</strong><span>Одна категория и одно действие за запуск. Одинаковые проблемы одной заявки объединяются.</span></div>
          </div>
          <div className="admin-tech-bulk__controls">
            <label>Действие
              <select value={bulkActionId} onChange={(event) => changeBulkAction(event.target.value as TechnicalAction['id'])}>
                {actionOptions.map((action) => <option value={action.id} key={action.id}>{action.label}</option>)}
              </select>
            </label>
            <div className="admin-tech-bulk__selection">
              <strong>Выбрано: {selectedIssueIds.size}</strong>
              <span>Подходит: {eligibleIssues.length}{eligibleIssues.length > 200 ? ' · за запуск максимум 200' : ''}</span>
            </div>
            <button type="button" className="admin-button admin-button--ghost" onClick={() => {
              setSelectedIssueIds(new Set(selectableIssues.map((issue) => issue.id)));
              setBulkPrepared(false);
            }}>Выбрать все подходящие</button>
            <button type="button" className="admin-button admin-button--ghost" disabled={selectedIssueIds.size === 0} onClick={() => {
              setSelectedIssueIds(new Set());
              setBulkPrepared(false);
            }}>Снять выбор</button>
            <button type="button" className="admin-button admin-button--primary" disabled={selectedIssueIds.size === 0 || bulkBusy} onClick={() => setBulkPrepared(true)}>
              Подготовить исправление
            </button>
          </div>
          {bulkPrepared && selectedAction ? (
            <div className="admin-tech-bulk__confirm">
              <strong>{selectedAction.label}: {selectedIssueIds.size} проблем</strong>
              <p>Перед каждым изменением сервер повторно проверит проблему. Введите <code>{selectedAction.confirmation}</code>.</p>
              <label>Подтверждение<input value={bulkConfirmation} onChange={(event) => setBulkConfirmation(event.target.value)} placeholder={selectedAction.confirmation} /></label>
              {selectedAction.requiresComment ? <label>Общий комментарий менеджера<textarea value={bulkComment} onChange={(event) => setBulkComment(event.target.value)} rows={3} /></label> : null}
              <div><button type="button" className="admin-button admin-button--ghost" onClick={() => setBulkPrepared(false)}>Отмена</button><button type="button" className="admin-button admin-button--primary" disabled={bulkBusy || bulkConfirmation.trim().toLocaleUpperCase('ru-RU') !== selectedAction.confirmation || selectedAction.requiresComment && !bulkComment.trim()} onClick={() => void runBulk()}>{bulkBusy ? <><LoaderCircle size={16} className="admin-spin" /> Выполняется…</> : 'Исправить выбранные и проверить'}</button></div>
            </div>
          ) : null}
          {bulkResult ? <p className={bulkResult.failed > 0 ? 'admin-tech-bulk__result is-warning' : 'admin-tech-bulk__result'}>Проверено {bulkResult.verified} из {bulkResult.requestedIssues}; выполнено операций {bulkResult.applied}; не исправлено {bulkResult.failed}.</p> : null}
        </section>
      ) : null}
      {diagnosis.issues.map((issue) => (
        <article className={`admin-tech-issue admin-tech-issue--${issue.severity.toLowerCase()}`} key={issue.id}>
          <header>
            <AlertTriangle size={19} />
            <div><h4>{issue.title}</h4><p>{issue.explanation}</p></div>
            <span>{issue.severity === 'CRITICAL' ? 'Критично' : 'Нужна проверка'}</span>
          </header>
          <div className="admin-tech-issue__meta">
            {bulkActionId && issue.actions.some((action) => action.id === bulkActionId) ? (
              <label className="admin-tech-issue__select"><input type="checkbox" checked={selectedIssueIds.has(issue.id)} onChange={() => toggleIssue(issue.id)} /> В массовое исправление</label>
            ) : null}
            {issue.request ? <b>Заявка №{String(issue.request.number).padStart(6, '0')} · {issue.request.client.name}</b> : null}
            {issue.orderId ? <b>Заказ WB №{issue.orderId}</b> : null}
            {issue.objectCode ? <code>{issue.objectCode}</code> : null}
          </div>
          <ul>{issue.evidence.map((row) => <li key={row}>{row}</li>)}</ul>
          <p className="admin-tech-issue__recommendation"><strong>Что делать:</strong> {issue.recommendation}</p>
          {issue.actions.length > 0 ? (
            <div className="admin-tech-actions">
              {issue.actions.map((action) => (
                <button type="button" className={action.tone === 'DANGER' ? 'admin-button admin-button--danger' : 'admin-button admin-button--primary'} key={action.id} onClick={() => onChoose(issue, action)}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : <p className="admin-tech-no-action">Безопасного автоматического исправления нет — система не будет менять данные вслепую.</p>}

          {pending?.issue.id === issue.id ? (
            <div className="admin-tech-confirm">
              <strong>{pending.action.label}</strong>
              <p>Перед выполнением проблема будет проверена повторно. Введите <code>{pending.action.confirmation}</code>.</p>
              <label>Подтверждение<input value={confirmation} onChange={(event) => onConfirmation(event.target.value)} placeholder={pending.action.confirmation} /></label>
              {pending.action.requiresComment ? <label>Комментарий менеджера<textarea value={comment} onChange={(event) => onComment(event.target.value)} rows={3} /></label> : null}
              <div><button type="button" className="admin-button admin-button--ghost" onClick={onCancel}>Отмена</button><button type="button" className="admin-button admin-button--primary" disabled={confirmation.trim().toLocaleUpperCase('ru-RU') !== pending.action.confirmation || pending.action.requiresComment && !comment.trim()} onClick={onApply}>Выполнить и проверить</button></div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function isDiagnosticSection(value: SectionId): value is AdministrationTechnicalWorkCategory {
  return ['REQUESTS', 'PALLET_SORTS', 'BOXES', 'MARKETPLACE_STATUS'].includes(value);
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить техническую проверку.';
}

function uniqueScannedCodes(value: string) {
  return [...new Set(value.split(/[\r\n,;]+/).map((code) => code.trim().toLocaleUpperCase('ru-RU')).filter(Boolean))];
}
