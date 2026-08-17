import { Clock3, MessageSquare, Send, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ClientRequestCommentSummary, ClientRequestTimeline } from '../../lib/api';
import { formatCabinetDate, requestStatusLabel, requestTypeLabel } from './clientCabinetFormat';

type TimelineItem =
  | {
      kind: 'event';
      id: string;
      title: string;
      body: string | null;
      createdAt: string;
      actor: string;
      statusFrom?: string | null;
      statusTo?: string | null;
    }
  | {
      kind: 'comment';
      id: string;
      body: string;
      createdAt: string;
      actor: string;
      isInternal: boolean;
    };

type ClientRequestTimelineModalProps = {
  timeline: ClientRequestTimeline;
  onClose: () => void;
  onAddComment: (body: string) => Promise<ClientRequestCommentSummary>;
};

export function ClientRequestTimelineModal({ timeline, onClose, onAddComment }: ClientRequestTimelineModalProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const eventItems: TimelineItem[] = timeline.events.map((event) => ({
      kind: 'event',
      id: event.id,
      title: event.title,
      body: event.body,
      createdAt: event.createdAt,
      actor: event.createdBy?.name ?? event.createdBy?.email ?? 'Система',
      statusFrom: event.statusFrom ? requestStatusLabel(event.statusFrom) : null,
      statusTo: event.statusTo ? requestStatusLabel(event.statusTo) : null,
    }));
    const commentItems: TimelineItem[] = timeline.comments.map((comment) => ({
      kind: 'comment',
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      actor: comment.author?.name ?? comment.author?.email ?? 'Пользователь',
      isInternal: comment.isInternal,
    }));

    return [...eventItems, ...commentItems].sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
  }, [timeline]);

  async function submitComment() {
    const normalized = body.trim();
    if (!normalized) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onAddComment(normalized);
      setBody('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить комментарий.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="client-request-timeline-backdrop" role="presentation">
      <section className="client-request-timeline-modal" aria-label="История заявки">
        <header className="client-request-timeline-modal__header">
          <div>
            <span>{requestTypeLabel(timeline.request.type)}</span>
            <h2>№{String(timeline.request.number).padStart(6, '0')} · {timeline.request.title}</h2>
            <small>
              {timeline.request.client.code} · {requestStatusLabel(timeline.request.status)}
            </small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть историю">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="client-request-timeline-modal__body">
          <div className="client-request-timeline-list">
            {items.length === 0 ? (
              <p className="panel-message">История пока пустая.</p>
            ) : (
              items.map((item) =>
                item.kind === 'event' ? (
                  <article className="client-request-timeline-item" key={`event-${item.id}`}>
                    <Clock3 size={16} aria-hidden="true" />
                    <div>
                      <strong>{item.title}</strong>
                      {item.statusFrom || item.statusTo ? (
                        <span>
                          {item.statusFrom ?? '-'} {'->'} {item.statusTo ?? '-'}
                        </span>
                      ) : null}
                      {item.body ? <span>{item.body}</span> : null}
                      <small>
                        {formatCabinetDate(item.createdAt)} · {item.actor}
                      </small>
                    </div>
                  </article>
                ) : (
                  <article
                    className={`client-request-timeline-item ${
                      item.isInternal ? 'client-request-timeline-item--internal' : ''
                    }`}
                    key={`comment-${item.id}`}
                  >
                    <MessageSquare size={16} aria-hidden="true" />
                    <div>
                      <strong>{item.isInternal ? 'Внутренний комментарий' : item.actor}</strong>
                      <span>{item.body}</span>
                      <small>{formatCabinetDate(item.createdAt)}</small>
                    </div>
                  </article>
                ),
              )
            )}
          </div>

          <footer className="client-request-comment-form">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Комментарий по заявке"
              maxLength={2000}
            />
            {error ? <span className="client-request-file-error">{error}</span> : null}
            <button className="icon-text-button" type="button" disabled={busy || !body.trim()} onClick={() => void submitComment()}>
              <Send size={15} aria-hidden="true" />
              <span>{busy ? 'Отправляю' : 'Добавить'}</span>
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
