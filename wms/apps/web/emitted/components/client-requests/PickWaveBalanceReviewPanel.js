import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Check, ClipboardCheck, MapPin, Save, Search, Send, Tag, Warehouse, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fetchPickWaveBalanceReview, savePickWaveBalanceReview, submitPickWaveBalanceReview, } from '../../lib/api';
export function PickWaveBalanceReviewPanel({ session, reviews, canWrite, onUpdated }) {
    const [active, setActive] = useState(null);
    const [loadingId, setLoadingId] = useState('');
    const [error, setError] = useState(null);
    if (reviews.length === 0) {
        return null;
    }
    async function openReview(review) {
        setLoadingId(review.id);
        setError(null);
        try {
            setActive(await fetchPickWaveBalanceReview(session.accessToken, review.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoadingId('');
        }
    }
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: "balance-review-panel", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u043E\u0432 \u0432\u043E\u043B\u043D", children: [_jsxs("header", { className: "balance-review-panel__header", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "\u041F\u0435\u0440\u0435\u0434 \u043D\u0430\u0447\u0430\u043B\u043E\u043C \u0441\u0431\u043E\u0440\u043A\u0438" }), _jsx("h3", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0431\u0430\u043B\u0430\u043D\u0441\u044B" }), _jsx("p", { children: "\u0420\u0435\u0448\u0438\u0442\u0435, \u043A\u0430\u043A\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435, \u0430 \u043A\u0430\u043A\u0438\u0435 \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u043E\u0440\u043E\u0434\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0432\u043E\u043B\u043D\u044B." })] }), _jsx("span", { className: "balance-review-panel__counter", children: reviews.length })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsx("div", { className: "balance-review-panel__list", children: reviews.map((review) => (_jsxs("article", { className: "balance-review-card", children: [_jsxs("div", { className: "balance-review-card__main", children: [_jsx("strong", { children: review.waveNumber }), _jsx("span", { children: review.client?.name ?? 'Клиент' }), _jsx("small", { children: review.requests.map((request) => request.destinationCity || request.title).join(' · ') })] }), _jsxs("div", { className: "balance-review-card__stats", children: [_jsxs("span", { children: [_jsx("b", { children: review.summary.pendingLines }), " \u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E"] }), _jsxs("span", { children: [_jsx("b", { children: formatInt(review.summary.totalRemaining) }), " \u0448\u0442. \u0432 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u0445"] }), _jsxs("span", { children: [_jsx("b", { children: review.summary.smallBalanceLines }), " \u043C\u0430\u043B\u044B\u0445 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432"] })] }), _jsxs("button", { className: "button button-primary balance-review-card__button", type: "button", disabled: loadingId === review.id, onClick: () => void openReview(review), children: [_jsx(ClipboardCheck, { size: 17, "aria-hidden": "true" }), loadingId === review.id ? 'Открываю...' : 'Проверить балансы'] })] }, review.id))) })] }), active ? (_jsx(BalanceReviewDialog, { session: session, initialReview: active, canWrite: canWrite, onClose: () => setActive(null), onCompleted: () => {
                    setActive(null);
                    onUpdated();
                } })) : null] }));
}
function BalanceReviewDialog({ session, initialReview, canWrite, onClose, onCompleted, }) {
    const [review, setReview] = useState(initialReview);
    const [drafts, setDrafts] = useState(() => buildDrafts(initialReview));
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('ALL');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const visibleLines = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        return review.lines.filter((line) => {
            const draft = drafts[line.id];
            if (filter === 'PENDING' && draft?.reviewed)
                return false;
            if (filter === 'SMALL' && !line.isSmallBalance)
                return false;
            if (!normalized)
                return true;
            return [line.sourceBoxCode, line.internalSku, line.barcode, line.name, line.color, line.size]
                .filter(Boolean)
                .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(normalized));
        });
    }, [drafts, filter, query, review.lines]);
    const reviewedCount = Object.values(drafts).filter((draft) => draft.reviewed).length;
    const allReviewed = reviewedCount === review.lines.length;
    const disabled = status !== 'idle' || !canWrite;
    function updateAllocation(lineId, requestId, patch) {
        const line = review.lines.find((candidate) => candidate.id === lineId);
        if (!line)
            return;
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
    function sendAllTo(lineId, requestId) {
        const line = review.lines.find((candidate) => candidate.id === lineId);
        if (!line)
            return;
        setDrafts((current) => {
            const allocations = Object.fromEntries(review.requests.map((request) => [
                request.id,
                {
                    ...current[lineId].allocations[request.id],
                    quantity: request.id === requestId ? line.remainingQuantity : 0,
                    needsRelabel: request.id === requestId ? current[lineId].allocations[request.id].needsRelabel : false,
                    targetBarcode: request.id === requestId ? current[lineId].allocations[request.id].targetBarcode : '',
                },
            ]));
            return { ...current, [lineId]: { ...current[lineId], allocations, keepQuantity: 0, reviewed: true } };
        });
    }
    function keepLine(lineId) {
        const line = review.lines.find((candidate) => candidate.id === lineId);
        if (!line)
            return;
        setDrafts((current) => ({
            ...current,
            [lineId]: {
                ...current[lineId],
                reviewed: true,
                keepQuantity: line.remainingQuantity,
                allocations: Object.fromEntries(review.requests.map((request) => [request.id, emptyAllocation()])),
            },
        }));
    }
    function keepAll() {
        setDrafts((current) => Object.fromEntries(review.lines.map((line) => [
            line.id,
            {
                ...current[line.id],
                reviewed: true,
                keepQuantity: line.remainingQuantity,
                allocations: Object.fromEntries(review.requests.map((request) => [request.id, emptyAllocation()])),
            },
        ])));
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
        }
        catch (caught) {
            setError(errorMessage(caught));
            return null;
        }
        finally {
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
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setStatus('idle');
        }
    }
    return (_jsx("div", { className: "online-execution-modal balance-review-modal-shell", role: "dialog", "aria-modal": "true", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u043E\u0432", children: _jsxs("section", { className: "online-execution-modal__panel balance-review-modal", children: [_jsxs("header", { className: "online-execution-modal__header balance-review-modal__header", children: [_jsxs("div", { children: [_jsxs("span", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u043E\u0432 \u00B7 ", review.waveNumber] }), _jsx("h3", { children: review.client?.name }), _jsx("small", { children: review.requests.map((request) => request.destinationCity || request.title).join(' · ') })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "balance-review-modal__toolbar", children: [_jsxs("label", { className: "balance-review-search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u041A\u043E\u0440\u043E\u0431, \u0442\u043E\u0432\u0430\u0440, \u0428\u041A \u0438\u043B\u0438 SKU" })] }), _jsxs("div", { className: "balance-review-filters", role: "group", "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432", children: [_jsx("button", { className: filter === 'ALL' ? 'is-active' : '', type: "button", onClick: () => setFilter('ALL'), children: "\u0412\u0441\u0435" }), _jsx("button", { className: filter === 'PENDING' ? 'is-active' : '', type: "button", onClick: () => setFilter('PENDING'), children: "\u041D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u044B" }), _jsx("button", { className: filter === 'SMALL' ? 'is-active' : '', type: "button", onClick: () => setFilter('SMALL'), children: "\u0414\u043E 5 \u0448\u0442." })] }), canWrite ? (_jsxs("button", { className: "button button-secondary", type: "button", disabled: disabled, onClick: keepAll, children: [_jsx(Warehouse, { size: 16, "aria-hidden": "true" }), " \u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435"] })) : null] }), _jsxs("div", { className: "balance-review-modal__progress", children: [_jsxs("span", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E ", reviewedCount, " \u0438\u0437 ", review.lines.length] }), _jsx("div", { children: _jsx("i", { style: { width: `${review.lines.length ? (reviewedCount / review.lines.length) * 100 : 100}%` } }) })] }), _jsxs("div", { className: "online-execution-modal__body balance-review-modal__body", children: [visibleLines.length === 0 ? _jsx("p", { className: "empty-state", children: "\u041F\u043E \u044D\u0442\u043E\u043C\u0443 \u0444\u0438\u043B\u044C\u0442\u0440\u0443 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0435\u0442." }) : null, visibleLines.map((line) => {
                            const draft = drafts[line.id];
                            return (_jsxs("article", { className: `balance-review-line ${draft.reviewed ? 'is-reviewed' : ''} ${line.isSmallBalance ? 'is-small' : ''}`, children: [_jsxs("div", { className: "balance-review-line__product", children: [_jsxs("div", { className: "balance-review-line__box", children: [_jsx(Warehouse, { size: 17, "aria-hidden": "true" }), _jsx("strong", { children: line.sourceBoxCode }), line.isSmallBalance ? _jsx("span", { children: "\u043C\u0430\u043B\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" }) : null] }), _jsx("h4", { children: line.name }), _jsx("p", { children: [line.internalSku, line.color, line.size].filter(Boolean).join(' · ') }), _jsxs("small", { children: ["\u0428\u041A: ", line.barcode || 'не указан'] }), _jsxs("div", { className: "balance-review-line__numbers", children: [_jsxs("span", { children: ["\u0411\u044B\u043B\u043E ", _jsx("b", { children: line.originalQuantity })] }), _jsxs("span", { children: ["\u0423\u0436\u0435 \u0432 \u0437\u0430\u044F\u0432\u043A\u0430\u0445 ", _jsx("b", { children: line.plannedQuantity })] }), _jsxs("span", { children: ["\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C ", _jsx("b", { children: line.remainingQuantity })] })] })] }), _jsx("div", { className: "balance-review-line__destinations", children: review.requests.map((request) => {
                                            const allocation = draft.allocations[request.id];
                                            return (_jsxs("div", { className: `balance-destination ${allocation.quantity > 0 ? 'has-quantity' : ''}`, children: [_jsxs("div", { className: "balance-destination__title", children: [_jsxs("span", { children: [_jsx(MapPin, { size: 15, "aria-hidden": "true" }), " ", request.destinationCity || request.title] }), _jsx("button", { type: "button", disabled: disabled, onClick: () => sendAllTo(line.id, request.id), children: "\u0412\u0435\u0441\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { type: "number", min: "0", max: line.remainingQuantity, value: allocation.quantity || '', disabled: disabled, onChange: (event) => updateAllocation(line.id, request.id, { quantity: Number(event.target.value) || 0 }), placeholder: "0" })] }), allocation.quantity > 0 ? (_jsxs("div", { className: "balance-destination__relabel", children: [_jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: allocation.needsRelabel, disabled: disabled, onChange: (event) => updateAllocation(line.id, request.id, { needsRelabel: event.target.checked }) }), _jsxs("span", { children: [_jsx(Tag, { size: 14, "aria-hidden": "true" }), " \u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C"] })] }), allocation.needsRelabel ? (_jsx("input", { value: allocation.targetBarcode, disabled: disabled, onChange: (event) => updateAllocation(line.id, request.id, { targetBarcode: event.target.value }), placeholder: "\u041D\u043E\u0432\u044B\u0439 \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434" })) : null] })) : null] }, request.id));
                                        }) }), _jsxs("div", { className: "balance-review-line__decision", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041E\u0441\u0442\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435" }), _jsxs("strong", { children: [draft.keepQuantity, " \u0448\u0442."] })] }), _jsxs("button", { className: "button button-secondary", type: "button", disabled: disabled, onClick: () => keepLine(line.id), children: [_jsx(Warehouse, { size: 15, "aria-hidden": "true" }), " \u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A"] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: draft.comment, disabled: disabled, onChange: (event) => setDrafts((current) => ({
                                                            ...current,
                                                            [line.id]: { ...current[line.id], comment: event.target.value, reviewed: true },
                                                        })), placeholder: "\u0423\u0442\u043E\u0447\u043D\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u0441\u043A\u043B\u0430\u0434\u0430" })] }), _jsx("span", { className: `balance-review-line__state ${draft.reviewed ? 'is-ready' : ''}`, children: draft.reviewed ? _jsxs(_Fragment, { children: [_jsx(Check, { size: 15, "aria-hidden": "true" }), " \u0420\u0435\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0438\u043D\u044F\u0442\u043E"] }) : 'Нужно проверить' })] })] }, line.id));
                        })] }), _jsxs("footer", { className: "balance-review-modal__footer", children: [_jsxs("div", { children: [error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null] }), _jsxs("div", { className: "balance-review-modal__actions", children: [_jsx("button", { className: "button button-secondary", type: "button", onClick: onClose, children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), canWrite ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "button button-secondary", type: "button", disabled: disabled, onClick: () => void save(), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), " ", status === 'saving' ? 'Сохраняю...' : 'Сохранить'] }), _jsxs("button", { className: "button button-primary", type: "button", disabled: disabled || !allReviewed, onClick: () => void submit(), children: [_jsx(Send, { size: 16, "aria-hidden": "true" }), " ", status === 'submitting' ? 'Фиксирую...' : 'Подтвердить распределение'] })] })) : null] })] })] }) }));
}
function buildDrafts(review) {
    return Object.fromEntries(review.lines.map((line) => {
        const existingByRequest = new Map(line.allocations.map((allocation) => [allocation.requestId, allocation]));
        return [
            line.id,
            {
                reviewed: line.isReviewed,
                keepQuantity: line.keepQuantity ?? line.remainingQuantity,
                comment: line.comment ?? '',
                allocations: Object.fromEntries(review.requests.map((request) => {
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
                })),
            },
        ];
    }));
}
function buildDecisionPayload(review, drafts, requireAll) {
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
function emptyAllocation() {
    return { quantity: 0, needsRelabel: false, targetBarcode: '', comment: '' };
}
function formatInt(value) {
    return new Intl.NumberFormat('ru-RU').format(value);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
