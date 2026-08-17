import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Clock3, MessageSquare, Send, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCabinetDate, requestStatusLabel, requestTypeLabel } from './clientCabinetFormat';
export function ClientRequestTimelineModal({ timeline, onClose, onAddComment }) {
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const items = useMemo(() => {
        const eventItems = timeline.events.map((event) => ({
            kind: 'event',
            id: event.id,
            title: event.title,
            body: event.body,
            createdAt: event.createdAt,
            actor: event.createdBy?.name ?? event.createdBy?.email ?? 'Система',
            statusFrom: event.statusFrom ? requestStatusLabel(event.statusFrom) : null,
            statusTo: event.statusTo ? requestStatusLabel(event.statusTo) : null,
        }));
        const commentItems = timeline.comments.map((comment) => ({
            kind: 'comment',
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt,
            actor: comment.author?.name ?? comment.author?.email ?? 'Пользователь',
            isInternal: comment.isInternal,
        }));
        return [...eventItems, ...commentItems].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
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
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось добавить комментарий.');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "client-request-timeline-backdrop", role: "presentation", children: _jsxs("section", { className: "client-request-timeline-modal", "aria-label": "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsxs("header", { className: "client-request-timeline-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: requestTypeLabel(timeline.request.type) }), _jsxs("h2", { children: ["\u2116", String(timeline.request.number).padStart(6, '0'), " \u00B7 ", timeline.request.title] }), _jsxs("small", { children: [timeline.request.client.code, " \u00B7 ", requestStatusLabel(timeline.request.status)] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "client-request-timeline-modal__body", children: [_jsx("div", { className: "client-request-timeline-list", children: items.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u0430\u044F." })) : (items.map((item) => item.kind === 'event' ? (_jsxs("article", { className: "client-request-timeline-item", children: [_jsx(Clock3, { size: 16, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: item.title }), item.statusFrom || item.statusTo ? (_jsxs("span", { children: [item.statusFrom ?? '-', " ", '->', " ", item.statusTo ?? '-'] })) : null, item.body ? _jsx("span", { children: item.body }) : null, _jsxs("small", { children: [formatCabinetDate(item.createdAt), " \u00B7 ", item.actor] })] })] }, `event-${item.id}`)) : (_jsxs("article", { className: `client-request-timeline-item ${item.isInternal ? 'client-request-timeline-item--internal' : ''}`, children: [_jsx(MessageSquare, { size: 16, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: item.isInternal ? 'Внутренний комментарий' : item.actor }), _jsx("span", { children: item.body }), _jsx("small", { children: formatCabinetDate(item.createdAt) })] })] }, `comment-${item.id}`)))) }), _jsxs("footer", { className: "client-request-comment-form", children: [_jsx("textarea", { value: body, onChange: (event) => setBody(event.target.value), placeholder: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435", maxLength: 2000 }), error ? _jsx("span", { className: "client-request-file-error", children: error }) : null, _jsxs("button", { className: "icon-text-button", type: "button", disabled: busy || !body.trim(), onClick: () => void submitComment(), children: [_jsx(Send, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: busy ? 'Отправляю' : 'Добавить' })] })] })] })] }) }));
}
