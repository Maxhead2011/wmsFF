import { Ban, Boxes, FileDown, FileText, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  cancelPickWave,
  createPickWave,
  downloadPickWaveDocumentXlsx,
  fetchClientRequests,
  fetchPickWaveDocument,
  fetchPickWaves,
  fetchUsers,
  runPickWave,
  type AuthSession,
  type ClientRequestSummary,
  type PickWaveDocument,
  type PickWaveSummary,
  type UserSummary,
} from '../../lib/api';
import { requestPriorityLabel, requestStatusLabel } from '../client-requests/clientRequestMeta';
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';

type PickWavePanelProps = {
  session: AuthSession;
};

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

const eligibleStatuses = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'];

export function PickWavePanel({ session }: PickWavePanelProps) {
  const [requests, setRequests] = useState<LoadState<ClientRequestSummary>>({ status: 'idle', data: [] });
  const [waves, setWaves] = useState<LoadState<PickWaveSummary>>({ status: 'idle', data: [] });
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [assignedPickerUserId, setAssignedPickerUserId] = useState(session.user.id);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isLoadingDocumentId, setLoadingDocumentId] = useState('');
  const [isDownloadingXlsxId, setDownloadingXlsxId] = useState('');
  const [isCancellingWaveId, setCancellingWaveId] = useState('');
  const [documentPreview, setDocumentPreview] = useState<PickWaveDocument | null>(null);

  const eligibleRequests = useMemo(
    () => requests.data.filter((request) => request.type === 'OUTBOUND' && eligibleStatuses.includes(request.status)),
    [requests.data],
  );

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setMessage(null);
    setRequests((current) => ({ ...current, status: 'loading', error: undefined }));
    setWaves((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const [nextRequests, nextWaves] = await Promise.all([
        fetchClientRequests(session.accessToken, { type: 'OUTBOUND' }),
        fetchPickWaves(session.accessToken),
      ]);
      const nextUsers = canReadUsers(session)
        ? await fetchUsers(session.accessToken).catch(() => [] as UserSummary[])
        : [];
      setRequests({ status: 'ready', data: nextRequests });
      setWaves({ status: 'ready', data: nextWaves });
      setUsers(nextUsers);
      setSelectedRequestIds((current) => current.filter((id) => nextRequests.some((request) => request.id === id)));
      setAssignedPickerUserId((current) => current || session.user.id);
    } catch (caught) {
      const error = errorMessage(caught);
      setRequests((current) => ({ ...current, status: 'error', error }));
      setWaves((current) => ({ ...current, status: 'error', error }));
    }
  }

  async function submitWave() {
    if (selectedRequestIds.length === 0) {
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const wave = await createPickWave(session.accessToken, {
        requestIds: selectedRequestIds,
        comment: comment.trim() || undefined,
        assignedPickerUserId: assignedPickerUserId || undefined,
      });
      setWaves((current) => ({ status: 'ready', data: [wave, ...current.data] }));
      setSelectedRequestIds([]);
      setAssignedPickerUserId(session.user.id);
      setComment('');
      setMessage(`Волна ${wave.waveNumber} создана${wave.assignedPicker ? `, сборщик ${wave.assignedPicker.name}` : ''}.`);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function startWave(wave: PickWaveSummary) {
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await runPickWave(session.accessToken, wave.id, {
        idempotencyKey: `web-wave:${wave.id}`,
        comment: `Сборка волны ${wave.waveNumber} из web-интерфейса.`,
      });
      setWaves((current) => ({
        status: 'ready',
        data: current.data.map((item) => (item.id === wave.id ? result.wave : item)),
      }));
      await loadData();
      setMessage(`Волна ${result.wave.waveNumber}: обработано ${result.results.length}.`);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function openWaveDocument(wave: PickWaveSummary) {
    setLoadingDocumentId(wave.id);
    setMessage(null);
    try {
      const document = await fetchPickWaveDocument(session.accessToken, wave.id);
      setDocumentPreview(document);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setLoadingDocumentId('');
    }
  }

  async function cancelWave(wave: PickWaveSummary) {
    if (!window.confirm(`Отменить волну ${wave.waveNumber}? Заявки снова станут доступны для новой волны.`)) {
      return;
    }
    setCancellingWaveId(wave.id);
    setMessage(null);
    try {
      const cancelled = await cancelPickWave(session.accessToken, wave.id);
      setWaves((current) => ({
        status: 'ready',
        data: current.data.map((item) => (item.id === wave.id ? cancelled : item)),
      }));
      await loadData();
      setMessage(`Волна ${cancelled.waveNumber} отменена. Заявки освобождены.`);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setCancellingWaveId('');
    }
  }

  async function downloadWaveDocument(wave: PickWaveSummary) {
    setDownloadingXlsxId(wave.id);
    setMessage(null);
    try {
      const blob = await downloadPickWaveDocumentXlsx(session.accessToken, wave.id);
      downloadBlob(blob, `pick-wave-${safeDownloadName(wave.waveNumber)}.xlsx`);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setDownloadingXlsxId('');
    }
  }

  function toggleRequest(requestId: string) {
    setSelectedRequestIds((current) =>
      current.includes(requestId) ? current.filter((id) => id !== requestId) : [...current, requestId],
    );
  }

  return (
    <section className="pick-wave-panel" aria-label="Волны сборки">
      <div className="warehouse-subheading">
        <div>
          <p className="eyebrow">Волны сборки</p>
          <h3>Волны сборки</h3>
        </div>
        <button className="icon-button" type="button" onClick={() => void loadData()} title="Обновить волны" aria-label="Обновить волны">
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      {message ? <p className="warehouse-inline">{message}</p> : null}
      {requests.status === 'error' || waves.status === 'error' ? (
        <p className="form-error">{requests.error ?? waves.error}</p>
      ) : null}

      <div className="pick-wave-layout">
        <div className="pick-wave-candidates">
          <strong>Кандидаты</strong>
          {eligibleRequests.length ? (
            <div className="pick-wave-list">
              {eligibleRequests.slice(0, 12).map((request) => (
                <label key={request.id} className="pick-wave-request">
                  <input
                    type="checkbox"
                    checked={selectedRequestIds.includes(request.id)}
                    onChange={() => toggleRequest(request.id)}
                  />
                  <span>
                    <b>{request.title}</b>
                    <small>
                      {request.client.code} · {requestStatusLabel(request.status)} · {requestPriorityLabel(request.priority)} ·{' '}
                      {requestItemsQuantity(request)} шт.
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="warehouse-inline">Нет исходящих заявок для новой волны.</p>
          )}
          <label className="warehouse-comment">
            <span>Комментарий</span>
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: первая волна WB" />
          </label>
          <label className="warehouse-comment">
            <span>Сборщик</span>
            <select value={assignedPickerUserId} onChange={(event) => setAssignedPickerUserId(event.target.value)}>
              {pickerOptions(session, users).map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
              <option value="">Не назначать</option>
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={() => void submitWave()}
            disabled={selectedRequestIds.length === 0 || isSubmitting}
          >
            <Boxes size={16} aria-hidden="true" />
            <span>Создать волну</span>
          </button>
        </div>

        <div className="pick-wave-history">
          <strong>Последние волны</strong>
          {waves.data.length ? (
            <div className="pick-wave-list">
              {waves.data.slice(0, 8).map((wave) => (
                <article key={wave.id} className="pick-wave-card">
                  <div>
                    <b>{wave.waveNumber}</b>
                    <span className={`status status--${waveStatusTone(wave.status)}`}>{waveStatusLabel(wave.status)}</span>
                  </div>
                  <p>{wave.requests.length} заявок · {wavePickedCount(wave)} собрано · {waveFailedCount(wave)} ошибок</p>
                  <p>Сборщик: {wave.assignedPicker ? userLabel(wave.assignedPicker) : 'не назначен'}</p>
                  <div className="pick-wave-actions">
                    <button
                      className="review-action"
                      type="button"
                      onClick={() => void openWaveDocument(wave)}
                      disabled={isLoadingDocumentId === wave.id}
                    >
                      <FileText size={14} aria-hidden="true" />
                      <span>{isLoadingDocumentId === wave.id ? 'Готовлю' : 'Лист'}</span>
                    </button>
                    <button
                      className="review-action review-action--xlsx"
                      type="button"
                      onClick={() => void downloadWaveDocument(wave)}
                      disabled={isDownloadingXlsxId === wave.id}
                    >
                      <FileDown size={14} aria-hidden="true" />
                      <span>{isDownloadingXlsxId === wave.id ? 'Готовлю' : 'Скачать Excel'}</span>
                    </button>
                    {canRunWave(wave) ? (
                      <button
                        className="review-action review-action--accept"
                        type="button"
                        onClick={() => void startWave(wave)}
                        disabled={isSubmitting}
                      >
                        <Play size={14} aria-hidden="true" />
                        <span>Запустить</span>
                      </button>
                    ) : null}
                    {canCancelWave(wave) ? (
                      <button
                        className="review-action review-action--reject"
                        type="button"
                        onClick={() => void cancelWave(wave)}
                        disabled={isCancellingWaveId === wave.id || isSubmitting}
                      >
                        <Ban size={14} aria-hidden="true" />
                        <span>{isCancellingWaveId === wave.id ? 'Отменяю' : 'Отменить волну'}</span>
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="warehouse-inline">Волн сборки пока нет.</p>
          )}
        </div>
      </div>

      {documentPreview ? (
        <HtmlDocumentPreview
          title={documentPreview.title}
          fileName={documentPreview.fileName}
          html={documentPreview.html}
          onClose={() => setDocumentPreview(null)}
        />
      ) : null}
    </section>
  );
}

function requestItemsQuantity(request: ClientRequestSummary) {
  return request.items.reduce((sum, item) => sum + item.quantity, 0);
}

function wavePickedCount(wave: PickWaveSummary) {
  return wave.requests.filter((request) => request.status === 'PICKED').length;
}

function waveFailedCount(wave: PickWaveSummary) {
  return wave.requests.filter((request) => request.status === 'FAILED').length;
}

function canRunWave(wave: PickWaveSummary) {
  return wave.status === 'FROZEN' || wave.status === 'FAILED' || wave.status === 'PICKING';
}

function canCancelWave(wave: PickWaveSummary) {
  return ['PLANNED', 'BALANCE_REVIEW', 'FROZEN', 'FAILED'].includes(wave.status);
}

function waveStatusLabel(status: PickWaveSummary['status']) {
  const labels: Record<PickWaveSummary['status'], string> = {
    PLANNED: 'план',
    BALANCE_REVIEW: 'проверка балансов',
    FROZEN: 'план зафиксирован',
    PICKING: 'сборка',
    DONE: 'готово',
    FAILED: 'ошибка',
    CANCELLED: 'отмена',
  };
  return labels[status];
}

function waveStatusTone(status: PickWaveSummary['status']) {
  if (status === 'DONE') {
    return 'ready';
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return 'planned';
  }
  return 'in-progress';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeDownloadName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'wave';
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию с волной.';
}

function canReadUsers(session: AuthSession) {
  return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes('users:read');
}

function pickerOptions(session: AuthSession, users: UserSummary[]) {
  const currentUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    status: 'ACTIVE',
  } as UserSummary;
  const activeUsers = users.filter((user) => user.status === 'ACTIVE' && user.id !== session.user.id);

  return [currentUser, ...activeUsers];
}

function userLabel(user: Pick<UserSummary, 'email' | 'name'>) {
  return `${user.name} · ${user.email}`;
}
