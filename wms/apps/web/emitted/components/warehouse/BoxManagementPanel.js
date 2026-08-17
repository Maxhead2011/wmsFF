import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive, ArrowRightLeft, Box, CirclePause, CirclePlus, PackageOpen, RefreshCw, Search, Trash2, X, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchBoxes, fetchTurnoverBoxDetails, runTurnoverAction, } from '../../lib/api';
const numberFormatter = new Intl.NumberFormat('ru-RU');
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});
const actionLabels = {
    ADD: 'Добавить',
    WRITE_OFF: 'Списать',
    TRANSFER: 'Перенести',
    UTILIZE: 'Утилизировать',
    HOLD: 'Отложить',
};
export function BoxManagementPanel({ session }) {
    const [showArchive, setShowArchive] = useState(false);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [isSearching, setSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [selectedBox, setSelectedBox] = useState(null);
    const [details, setDetails] = useState({ status: 'idle', data: null });
    const [actionState, setActionState] = useState(null);
    const [actionError, setActionError] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    const [targetSuggestions, setTargetSuggestions] = useState([]);
    const visibleSuggestions = useMemo(() => suggestions.slice(0, 14), [suggestions]);
    useEffect(() => {
        const cleanQuery = query.trim();
        if (!showSuggestions || !cleanQuery) {
            setSuggestions([]);
            setSearching(false);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setSearching(true);
            setSearchError('');
            fetchBoxes(session.accessToken, { code: cleanQuery, archive: showArchive })
                .then((boxes) => {
                if (!cancelled) {
                    setSuggestions(boxes);
                }
            })
                .catch((caught) => {
                if (!cancelled) {
                    setSuggestions([]);
                    setSearchError(errorMessage(caught));
                }
            })
                .finally(() => {
                if (!cancelled) {
                    setSearching(false);
                }
            });
        }, 180);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [query, session.accessToken, showArchive, showSuggestions]);
    useEffect(() => {
        const cleanCode = actionState?.targetBoxCode.trim() ?? '';
        const clientId = details.data?.box.client.id;
        if (!actionState || !clientId || cleanCode.length < 2) {
            setTargetSuggestions([]);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            fetchBoxes(session.accessToken, { clientId, code: cleanCode })
                .then((boxes) => {
                if (!cancelled) {
                    setTargetSuggestions(boxes.slice(0, 20));
                }
            })
                .catch(() => {
                if (!cancelled) {
                    setTargetSuggestions([]);
                }
            });
        }, 180);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [actionState?.targetBoxCode, details.data?.box.client.id, session.accessToken]);
    async function loadBox(box) {
        setSelectedBox(box);
        setQuery(box.code);
        setShowSuggestions(false);
        setSearchError('');
        setActionMessage('');
        setDetails((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const loaded = await fetchTurnoverBoxDetails(session.accessToken, box.code, { clientId: box.clientId });
            setDetails({ status: 'ready', data: loaded });
        }
        catch (caught) {
            setDetails({ status: 'error', data: null, error: errorMessage(caught) });
        }
    }
    async function refreshSelectedBox() {
        if (selectedBox) {
            await loadBox(selectedBox);
        }
    }
    function submitSearch(event) {
        event.preventDefault();
        const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
        const exactMatches = suggestions.filter((box) => box.code.trim().toLocaleLowerCase('ru-RU') === normalizedQuery);
        const candidate = exactMatches.length === 1 ? exactMatches[0] : suggestions.length === 1 ? suggestions[0] : null;
        if (candidate) {
            void loadBox(candidate);
            return;
        }
        setShowSuggestions(true);
        setSearchError(suggestions.length > 1 ? 'Выберите нужный короб из списка.' : 'Короб не найден.');
    }
    function startAction(item, action) {
        const currentBox = details.data?.box.code ?? '';
        setActionState({
            item,
            action,
            quantity: '1',
            targetBoxCode: action === 'ADD' || action === 'HOLD' ? currentBox : '',
            reason: '',
            kiz: '',
            comment: '',
        });
        setActionError('');
        setActionMessage('');
    }
    function switchArchive(nextArchive) {
        setShowArchive(nextArchive);
        setQuery('');
        setSuggestions([]);
        setShowSuggestions(false);
        setSearchError('');
        setSelectedBox(null);
        setDetails({ status: 'idle', data: null });
        setActionState(null);
        setActionError('');
        setActionMessage('');
    }
    function updateAction(key, value) {
        setActionState((current) => (current ? { ...current, [key]: value } : current));
        setActionError('');
    }
    async function submitAction() {
        const box = details.data?.box;
        if (!actionState || !box) {
            return;
        }
        const quantity = Number(actionState.quantity);
        const needsTarget = ['ADD', 'TRANSFER', 'HOLD'].includes(actionState.action);
        const needsReason = ['WRITE_OFF', 'HOLD'].includes(actionState.action);
        const targetBoxCode = actionState.targetBoxCode.trim();
        if (!Number.isInteger(quantity) || quantity <= 0) {
            setActionError('Количество должно быть целым числом больше нуля.');
            return;
        }
        if (actionState.action !== 'ADD' && quantity > actionState.item.quantity) {
            setActionError(`В коробе доступно только ${formatNumber(actionState.item.quantity)} шт.`);
            return;
        }
        if (needsTarget && !targetBoxCode) {
            setActionError('Укажите короб назначения.');
            return;
        }
        if (needsReason && !actionState.reason.trim()) {
            setActionError('Укажите причину операции.');
            return;
        }
        setSubmitting(true);
        setActionError('');
        try {
            await runTurnoverAction(session.accessToken, {
                clientId: box.client.id,
                skuId: actionState.item.skuId,
                action: actionState.action,
                quantity,
                sourceBoxCode: actionState.action === 'ADD' ? undefined : box.code,
                targetBoxCode: needsTarget ? targetBoxCode : undefined,
                reason: actionState.reason.trim() || undefined,
                kiz: actionState.kiz.trim() || undefined,
                comment: actionState.comment.trim() || undefined,
                idempotencyKey: `warehouse-box:${box.id}:${actionState.action}:${actionState.item.skuId}:${Date.now()}`,
            });
            setActionState(null);
            setActionMessage(`${actionLabels[actionState.action]}: операция проведена.`);
            await refreshSelectedBox();
        }
        catch (caught) {
            setActionError(errorMessage(caught));
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "warehouse-box-manager", children: [_jsxs("div", { className: "warehouse-box-view-toggle", role: "group", "aria-label": "\u0420\u0435\u0436\u0438\u043C \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432", children: [_jsxs("button", { className: !showArchive ? 'is-active' : '', type: "button", onClick: () => switchArchive(false), children: [_jsx(Box, { size: 16, "aria-hidden": "true" }), "\u041A\u043E\u0440\u043E\u0431\u0430 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435"] }), _jsxs("button", { className: showArchive ? 'is-active' : '', type: "button", onClick: () => switchArchive(true), children: [_jsx(Archive, { size: 16, "aria-hidden": "true" }), "\u0410\u0440\u0445\u0438\u0432 \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] })] }), _jsx("p", { className: "warehouse-box-view-note", children: showArchive
                    ? 'Найдите удалённый или архивный короб по номеру и откройте сохранённую историю его движений.'
                    : 'Поиск действующих коробов, просмотр содержимого и складские операции.' }), _jsxs("form", { className: "warehouse-box-search", onSubmit: submitSearch, children: [_jsxs("label", { className: "warehouse-box-search__field", children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsxs("div", { className: "warehouse-box-search__input", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: query, onChange: (event) => {
                                            setQuery(event.target.value);
                                            setShowSuggestions(true);
                                            setSearchError('');
                                        }, onFocus: () => setShowSuggestions(Boolean(query.trim())), placeholder: showArchive ? 'Номер короба из архива' : 'Начните вводить номер короба…', autoComplete: "off" }), isSearching ? _jsx(RefreshCw, { className: "is-spinning", size: 16, "aria-hidden": "true" }) : null] }), showSuggestions && query.trim() ? (_jsxs("div", { className: "warehouse-box-suggestions", role: "listbox", "aria-label": "\u041D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430", children: [visibleSuggestions.map((box) => (_jsxs("button", { type: "button", onClick: () => void loadBox(box), children: [_jsx(Box, { size: 17, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: box.code }), _jsxs("small", { children: [box.client.name, " \u00B7 ", boxStatusLabel(box.status), box.storagePlacement
                                                                ? ` · ${box.storagePlacement.pallet.zone?.name ?? 'Без зоны'} / ${box.storagePlacement.pallet.code}`
                                                                : ' · место не задано'] })] }), _jsxs("em", { children: [box._count.balances, " \u043F\u043E\u0437."] })] }, box.id))), !isSearching && visibleSuggestions.length === 0 ? _jsx("p", { children: "\u0421\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0439 \u043D\u0435\u0442." }) : null] })) : null] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !query.trim() || isSearching, children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C" })] }), selectedBox ? (_jsxs("button", { className: "secondary-button", type: "button", onClick: () => void refreshSelectedBox(), disabled: details.status === 'loading', children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })) : null] }), searchError ? _jsx("p", { className: "form-error", children: searchError }) : null, actionMessage ? _jsx("p", { className: "form-success", children: actionMessage }) : null, details.status === 'loading' ? _jsx("p", { className: "warehouse-inline", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043A\u043E\u0440\u043E\u0431." }) : null, details.error ? _jsx("p", { className: "form-error", children: details.error }) : null, details.data ? (_jsx(BoxCard, { details: details.data, readOnly: showArchive, onAction: startAction, onClose: () => {
                    setSelectedBox(null);
                    setDetails({ status: 'idle', data: null });
                    setQuery('');
                } })) : null, !showArchive && actionState && details.data ? (_jsx(BoxActionDialog, { state: actionState, box: details.data.box.code, isSubmitting: isSubmitting, error: actionError, targetSuggestions: targetSuggestions, onChange: updateAction, onCancel: () => setActionState(null), onSubmit: () => void submitAction() })) : null] }));
}
function BoxCard({ details, readOnly, onAction, onClose, }) {
    return (_jsxs("div", { className: "warehouse-box-card", children: [_jsxs("header", { className: "warehouse-box-card__header", children: [_jsxs("div", { children: [_jsx("span", { children: details.box.client.name }), _jsx("h3", { children: details.box.code }), _jsx("small", { children: boxStatusLabel(details.box.status) }), _jsx("small", { children: details.box.storagePlacement
                                    ? `Место: ${details.box.storagePlacement.pallet.zone?.name ?? 'без зоны'} / ${details.box.storagePlacement.pallet.code}`
                                    : 'Место хранения не задано' })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u043A\u043E\u0440\u043E\u0431\u0430", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "warehouse-box-metrics", children: [_jsx(Metric, { label: "\u041F\u043E\u0437\u0438\u0446\u0438\u0439", value: details.totals.rows }), _jsx(Metric, { label: "SKU", value: details.totals.skuCount }), _jsx(Metric, { label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: details.totals.quantity }), _jsx(Metric, { label: "\u041A\u0418\u0417", value: details.totals.kizCount })] }), _jsx("div", { className: "warehouse-box-table-wrap", children: _jsxs("table", { className: "warehouse-box-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u0426\u0432\u0435\u0442 / \u0440\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041A\u0418\u0417" }), !readOnly ? _jsx("th", { children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C" }) : null] }) }), _jsxs("tbody", { children: [details.contents.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: readOnly ? 6 : 7, children: "\u0412 \u043A\u043E\u0440\u043E\u0431\u0435 \u043D\u0435\u0442 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430." }) })) : null, details.contents.map((item) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: [item.internalSku, item.clientSku, item.article].filter(Boolean).join(' · ') })] }), _jsx("td", { children: item.barcode ?? '-' }), _jsx("td", { children: [item.color, item.size].filter(Boolean).join(' / ') || '-' }), _jsx("td", { children: item.statusLabel }), _jsx("td", { children: _jsx("strong", { children: formatNumber(item.quantity) }) }), _jsx("td", { children: item.kiz.length ? (_jsxs("span", { className: "warehouse-box-kiz", title: item.kiz.join('\n'), children: [item.kiz.slice(0, 2).join(', '), item.kizCount > 2 ? ` · еще ${formatNumber(item.kizCount - 2)}` : ''] })) : '-' }), !readOnly ? _jsx("td", { children: _jsxs("div", { className: "warehouse-box-row-actions", children: [_jsxs("button", { type: "button", onClick: () => onAction(item, 'TRANSFER'), title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0442\u043E\u0432\u0430\u0440", children: [_jsx(ArrowRightLeft, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438" })] }), _jsxs("button", { type: "button", onClick: () => onAction(item, 'WRITE_OFF'), title: "\u0421\u043F\u0438\u0441\u0430\u0442\u044C \u0442\u043E\u0432\u0430\u0440", children: [_jsx(Trash2, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043F\u0438\u0441\u0430\u0442\u044C" })] }), _jsxs("button", { type: "button", onClick: () => onAction(item, 'HOLD'), title: "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440", children: [_jsx(CirclePause, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C" })] }), _jsxs("button", { type: "button", onClick: () => onAction(item, 'ADD'), title: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E", children: [_jsx(CirclePlus, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] })] }) }) : null] }, item.balanceId)))] })] }) }), _jsxs("details", { className: "warehouse-box-history", open: readOnly ? true : undefined, children: [_jsxs("summary", { children: ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439 ", _jsx("span", { children: details.movements.length })] }), _jsx("div", { className: "warehouse-box-table-wrap", children: _jsxs("table", { className: "warehouse-box-table warehouse-box-table--history", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" })] }) }), _jsxs("tbody", { children: [details.movements.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) })) : null, details.movements.map((movement) => (_jsxs("tr", { children: [_jsx("td", { children: formatDateTime(movement.date) }), _jsxs("td", { children: [_jsx("strong", { children: movement.typeLabel }), _jsx("span", { children: movement.comment || movement.statusLabel })] }), _jsxs("td", { children: [_jsx("strong", { children: movement.name }), _jsx("span", { children: movement.barcode ?? '-' })] }), _jsx("td", { className: movement.quantity < 0 ? 'is-negative' : 'is-positive', children: formatNumber(movement.quantity) }), _jsx("td", { children: movement.sourceDocument ?? '-' })] }, movement.id)))] })] }) })] })] }));
}
function BoxActionDialog({ state, box, isSubmitting, error, targetSuggestions, onChange, onCancel, onSubmit, }) {
    const needsTarget = ['ADD', 'TRANSFER', 'HOLD'].includes(state.action);
    const needsReason = ['WRITE_OFF', 'HOLD'].includes(state.action);
    return (_jsx("div", { className: "warehouse-box-dialog-backdrop", role: "presentation", children: _jsxs("section", { className: "warehouse-box-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "warehouse-box-dialog-title", children: [_jsxs("header", { children: [_jsx("span", { className: "warehouse-box-dialog__icon", children: state.action === 'WRITE_OFF' ? _jsx(Trash2, { size: 20, "aria-hidden": "true" }) : _jsx(PackageOpen, { size: 20, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { children: actionLabels[state.action] }), _jsx("h3", { id: "warehouse-box-dialog-title", children: state.item.name }), _jsxs("small", { children: [box, " \u00B7 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E ", formatNumber(state.item.quantity), " \u0448\u0442."] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onCancel, disabled: isSubmitting, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "warehouse-box-dialog__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { min: "1", type: "number", value: state.quantity, onChange: (event) => onChange('quantity', event.target.value) })] }), needsTarget ? (_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F" }), _jsx("input", { value: state.targetBoxCode, onChange: (event) => onChange('targetBoxCode', event.target.value), placeholder: "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F", list: "warehouse-box-target-suggestions", autoComplete: "off" }), _jsx("datalist", { id: "warehouse-box-target-suggestions", children: targetSuggestions.map((target) => _jsx("option", { value: target.code, children: target.client.name }, target.id)) })] })) : null, needsReason ? (_jsxs("label", { className: "warehouse-box-dialog__wide", children: [_jsx("span", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430" }), _jsx("input", { value: state.reason, onChange: (event) => onChange('reason', event.target.value), placeholder: "\u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u043F\u043E\u043B\u0435" })] })) : null, _jsxs("label", { className: "warehouse-box-dialog__wide", children: [_jsx("span", { children: "\u041A\u0418\u0417" }), _jsx("textarea", { value: state.kiz, onChange: (event) => onChange('kiz', event.target.value), placeholder: "\u041F\u0440\u0438 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438: \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E \u0438\u043B\u0438 \u0441 \u043D\u043E\u0432\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0438" })] }), _jsxs("label", { className: "warehouse-box-dialog__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { value: state.comment, onChange: (event) => onChange('comment', event.target.value), placeholder: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043A \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", onClick: onCancel, disabled: isSubmitting, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx("button", { className: state.action === 'WRITE_OFF' ? 'danger-button' : 'primary-button', type: "button", onClick: onSubmit, disabled: isSubmitting, children: isSubmitting ? 'Сохраняю' : actionLabels[state.action] })] })] }) }));
}
function Metric({ label, value }) {
    return (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: formatNumber(value) })] }));
}
function formatNumber(value) {
    return numberFormatter.format(value);
}
function formatDateTime(value) {
    return dateTimeFormatter.format(new Date(value));
}
function boxStatusLabel(status) {
    const labels = {
        available: 'На хранении',
        receiving: 'Приемка',
        closed: 'Закрыт',
        packed: 'Упакован',
        shipped: 'Отгружен',
        deleted: 'Удален',
        archived: 'В архиве',
    };
    return labels[status.toLocaleLowerCase('ru-RU')] ?? status;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
