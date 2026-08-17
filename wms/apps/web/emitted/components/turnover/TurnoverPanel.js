import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Archive, ArrowLeft, ArrowRightLeft, BarChart3, ChevronRight, Download, History, PackagePlus, RefreshCw, Search, Trash2, X, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadTurnoverMovementDocumentXlsx, downloadTurnoverReceiptPeriodXlsx, downloadTurnoverStockXlsx, fetchClients, fetchTurnoverBoxDetails, fetchTurnoverMovementDocument, fetchTurnoverReport, fetchTurnoverStatistics, fetchTurnoverSuggestions, runTurnoverAction, } from '../../lib/api';
import { KnownValueInput } from '../common/KnownValueInput';
import './turnover.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
const emptyActionForm = {
    action: 'TRANSFER',
    skuId: '',
    skuText: '',
    quantity: '1',
    sourceBoxCode: '',
    targetBoxCode: '',
    reason: '',
    kiz: '',
    photoFileName: '',
    comment: '',
};
const actionOptions = [
    { value: 'ADD', label: 'Добавить такой же товар', hint: 'Увеличивает остаток выбранного SKU.' },
    { value: 'WRITE_OFF', label: 'Удалить / списать товар', hint: 'Снимает количество с остатка и оставляет историю.' },
    { value: 'TRANSFER', label: 'Перенести в другую ячейку', hint: 'Перемещает товар между коробами или ячейками.' },
    { value: 'UTILIZE', label: 'Утилизировать', hint: 'Списывает товар с причиной и КИЗ/фото при наличии.' },
    { value: 'HOLD', label: 'Отложить на отдельное хранение', hint: 'Переносит товар в отдельную ячейку со статусом отложено.' },
];
export function TurnoverPanel({ session }) {
    const [activeTile, setActiveTile] = useState('home');
    const [clients, setClients] = useState({ status: 'idle', data: [] });
    const [report, setReport] = useState({ status: 'idle', data: null });
    const [statistics, setStatistics] = useState({ status: 'idle', data: null });
    const [suggestions, setSuggestions] = useState({ status: 'idle', data: null });
    const [suggestionQuery, setSuggestionQuery] = useState('');
    const [suggestionScope, setSuggestionScope] = useState('client');
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [search, setSearch] = useState('');
    const [movementSearch, setMovementSearch] = useState('');
    const [barcode, setBarcode] = useState('');
    const [kiz, setKiz] = useState('');
    const [boxSearch, setBoxSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [groupBy, setGroupBy] = useState('month');
    const [selectedSkuId, setSelectedSkuId] = useState('');
    const [actionForm, setActionForm] = useState(emptyActionForm);
    const [actionMessage, setActionMessage] = useState('');
    const [actionError, setActionError] = useState('');
    const [isSubmittingAction, setSubmittingAction] = useState(false);
    const [movementDocument, setMovementDocument] = useState({ status: 'idle', data: null });
    const [boxDetails, setBoxDetails] = useState({ status: 'idle', data: null });
    const [isDownloadingMovementDocument, setDownloadingMovementDocument] = useState(false);
    const [isDownloadingReceiptPeriod, setDownloadingReceiptPeriod] = useState(false);
    const [receiptPeriodError, setReceiptPeriodError] = useState('');
    const [isDownloadingStockExport, setDownloadingStockExport] = useState(false);
    const [stockExportError, setStockExportError] = useState('');
    const [ignoreActiveStockRequests, setIgnoreActiveStockRequests] = useState(false);
    const canSeeStatistics = useMemo(() => canUseStatistics(session.user.roleCodes, session.user.permissionCodes), [session.user]);
    const canUseActions = useMemo(() => canUseTurnoverActions(session.user.roleCodes, session.user.permissionCodes), [session.user]);
    const selectedReportItem = useMemo(() => {
        const items = report.data?.items ?? [];
        return items.find((item) => item.skuId === selectedSkuId) ?? items[0] ?? null;
    }, [report.data, selectedSkuId]);
    const actionReportItem = useMemo(() => {
        const items = report.data?.items ?? [];
        return items.find((item) => item.skuId === actionForm.skuId) ?? null;
    }, [actionForm.skuId, report.data]);
    const sourceCells = (activeTile === 'actions' && actionForm.skuId ? actionReportItem?.currentCells : selectedReportItem?.currentCells) ?? [];
    const allCells = useMemo(() => uniqueValues((report.data?.items ?? []).flatMap((item) => item.currentCells.map((cell) => cell.boxCode))), [report.data]);
    const productOptions = useMemo(() => buildProductOptions(report.data?.items ?? [], suggestions.data?.products ?? []), [report.data, suggestions.data]);
    const barcodeOptions = useMemo(() => buildBarcodeOptions(report.data?.items ?? [], suggestions.data?.barcodes ?? []), [report.data, suggestions.data]);
    const kizOptions = useMemo(() => buildKizOptions(report.data?.items ?? [], suggestions.data?.kiz ?? []), [report.data, suggestions.data]);
    const sourceCellOptions = useMemo(() => buildCellOptions(sourceCells, suggestions.data?.boxes ?? []), [sourceCells, suggestions.data]);
    const targetCellOptions = useMemo(() => buildCellOptions(allCells.map((boxCode) => ({ boxCode, quantity: 0, status: '' })), suggestions.data?.boxes ?? []), [allCells, suggestions.data]);
    const boxOptions = useMemo(() => buildCellOptions(allCells.map((boxCode) => ({ boxCode, quantity: 0, status: '' })), suggestions.data?.boxes ?? []), [allCells, suggestions.data]);
    useEffect(() => {
        void loadClients();
    }, []);
    useEffect(() => {
        if (!selectedClientId) {
            return;
        }
        setBoxDetails({ status: 'idle', data: null });
        void loadTurnover();
        void loadSuggestions('');
    }, [selectedClientId]);
    useEffect(() => {
        if (!selectedClientId) {
            return;
        }
        const timer = window.setTimeout(() => {
            void loadSuggestions(suggestionQuery, suggestionScope);
        }, 180);
        return () => window.clearTimeout(timer);
    }, [selectedClientId, suggestionQuery, suggestionScope]);
    useEffect(() => {
        if ((activeTile === 'actions' && !canUseActions) ||
            ((activeTile === 'stats' || activeTile === 'stockExport') && !canSeeStatistics)) {
            setActiveTile('movement');
        }
    }, [activeTile, canSeeStatistics, canUseActions]);
    useEffect(() => {
        if (boxDetails.status === 'idle') {
            return;
        }
        const previousOverflow = document.body.style.overflow;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') {
                setBoxDetails({ status: 'idle', data: null });
            }
        };
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [boxDetails.status]);
    useEffect(() => {
        if (!report.data || report.data.items.length === 0) {
            setSelectedSkuId('');
            setActionForm((current) => ({ ...current, skuId: '' }));
            return;
        }
        const items = report.data.items;
        setSelectedSkuId((current) => (items.some((item) => item.skuId === current) ? current : items[0].skuId));
        setActionForm((current) => ({
            ...current,
            skuId: items.some((item) => item.skuId === current.skuId) ? current.skuId : items[0]?.skuId ?? '',
            skuText: items.some((item) => item.skuId === current.skuId) ? current.skuText : productText(items[0]),
        }));
    }, [report.data]);
    async function loadClients() {
        setClients((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const loaded = await fetchClients(session.accessToken);
            setClients({ status: 'ready', data: loaded });
            setSelectedClientId((current) => validRememberedClientId(current, loaded));
            setSelectedClientId((current) => current || loaded[0]?.id || '');
            if (!loaded[0]) {
                setReport({ status: 'ready', data: null });
            }
        }
        catch (caught) {
            setClients({ status: 'error', data: [], error: errorMessage(caught) });
        }
    }
    async function loadTurnover() {
        if (!selectedClientId) {
            return;
        }
        setReport((current) => ({ ...current, status: 'loading', error: undefined }));
        setStatistics((current) => ({ ...current, status: canSeeStatistics ? 'loading' : 'idle', error: undefined }));
        setActionMessage('');
        setActionError('');
        setReceiptPeriodError('');
        setStockExportError('');
        const reportFilter = {
            clientId: selectedClientId,
            search: search.trim() || undefined,
            barcode: barcode.trim() || undefined,
            kiz: kiz.trim() || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
        };
        const statisticsFilter = { ...reportFilter, groupBy };
        try {
            const [nextReport, nextStatistics] = await Promise.all([
                fetchTurnoverReport(session.accessToken, reportFilter),
                canSeeStatistics ? fetchTurnoverStatistics(session.accessToken, statisticsFilter) : Promise.resolve(null),
            ]);
            setReport({ status: 'ready', data: nextReport });
            setStatistics({ status: nextStatistics ? 'ready' : 'idle', data: nextStatistics });
        }
        catch (caught) {
            const message = errorMessage(caught);
            setReport((current) => ({ ...current, status: 'error', error: message }));
            setStatistics((current) => ({ ...current, status: 'error', error: message }));
        }
    }
    async function loadSuggestions(query, scope = 'client') {
        if (!selectedClientId) {
            return;
        }
        setSuggestions((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const loaded = await fetchTurnoverSuggestions(session.accessToken, {
                clientId: selectedClientId,
                search: query.trim() || undefined,
                scope,
            });
            setSuggestions({ status: 'ready', data: loaded });
        }
        catch (caught) {
            setSuggestions((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
        }
    }
    async function loadBoxDetails(nextBoxCode = boxSearch) {
        const cleanBoxCode = nextBoxCode.trim();
        if (!cleanBoxCode) {
            setBoxDetails({ status: 'error', data: null, error: 'Укажите номер короба.' });
            return;
        }
        setBoxSearch(cleanBoxCode);
        setBoxDetails((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const loaded = await fetchTurnoverBoxDetails(session.accessToken, cleanBoxCode);
            setBoxDetails({ status: 'ready', data: loaded });
        }
        catch (caught) {
            setBoxDetails({ status: 'error', data: null, error: errorMessage(caught) });
        }
    }
    function updateActionForm(key, value) {
        setActionForm((current) => ({ ...current, [key]: value }));
        setActionMessage('');
        setActionError('');
    }
    function startBoxAction(item, action) {
        const currentBox = boxDetails.data?.box.code ?? boxSearch.trim();
        setActiveTile('actions');
        setActionForm((current) => ({
            ...current,
            action,
            skuId: item.skuId,
            skuText: boxContentText(item),
            quantity: String(Math.max(1, item.quantity)),
            sourceBoxCode: action === 'ADD' ? '' : currentBox,
            targetBoxCode: action === 'ADD' || action === 'HOLD' ? currentBox : '',
            reason: '',
            kiz: '',
            photoFileName: '',
            comment: '',
        }));
        setActionMessage('');
        setActionError('');
        setBoxDetails({ status: 'idle', data: null });
    }
    function startSkuAction(action) {
        if (!selectedReportItem) {
            return;
        }
        const sourceBoxCode = selectedReportItem.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? '';
        setActiveTile('actions');
        setActionForm({
            action,
            skuId: selectedReportItem.skuId,
            skuText: productText(selectedReportItem),
            quantity: '1',
            sourceBoxCode: action === 'ADD' ? '' : sourceBoxCode,
            targetBoxCode: action === 'ADD' || action === 'HOLD' ? sourceBoxCode : '',
            reason: '',
            kiz: '',
            photoFileName: '',
            comment: '',
        });
        setActionMessage('');
        setActionError('');
    }
    async function submitAction() {
        const actionClientId = actionReportItem?.client.id ?? selectedClientId;
        if (!actionClientId || !actionForm.skuId) {
            return;
        }
        const quantity = Number(actionForm.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            setActionError('Укажите количество целым числом больше нуля.');
            return;
        }
        setSubmittingAction(true);
        setActionMessage('');
        setActionError('');
        try {
            const result = await runTurnoverAction(session.accessToken, {
                clientId: actionClientId,
                skuId: actionForm.skuId,
                action: actionForm.action,
                quantity,
                sourceBoxCode: actionForm.sourceBoxCode.trim() || undefined,
                targetBoxCode: actionForm.targetBoxCode.trim() || undefined,
                reason: actionForm.reason.trim() || undefined,
                kiz: actionForm.kiz.trim() || undefined,
                photoFileName: actionForm.photoFileName.trim() || undefined,
                comment: actionForm.comment.trim() || undefined,
                idempotencyKey: buildActionKey(actionForm.action, actionForm.skuId),
            });
            setActionMessage(result.status === 'ALREADY_APPLIED' ? 'Операция уже была проведена.' : 'Операция проведена и записана в историю.');
            await loadTurnover();
        }
        catch (caught) {
            setActionError(errorMessage(caught));
        }
        finally {
            setSubmittingAction(false);
        }
    }
    async function openMovementDocument(movement) {
        if (!isDocumentMovement(movement)) {
            return;
        }
        setMovementDocument({ status: 'loading', data: null, error: undefined });
        try {
            setMovementDocument({
                status: 'ready',
                data: await fetchTurnoverMovementDocument(session.accessToken, movement.id),
            });
        }
        catch (caught) {
            setMovementDocument({ status: 'error', data: null, error: errorMessage(caught) });
        }
    }
    async function downloadMovementDocument(movementId, fileName) {
        setDownloadingMovementDocument(true);
        try {
            const blob = await downloadTurnoverMovementDocumentXlsx(session.accessToken, movementId);
            downloadBlob(blob, fileName || `movement-${movementId.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setMovementDocument((current) => ({
                ...current,
                status: current.data ? 'ready' : 'error',
                error: errorMessage(caught),
            }));
        }
        finally {
            setDownloadingMovementDocument(false);
        }
    }
    async function downloadReceiptPeriod() {
        if (!selectedClientId) {
            setReceiptPeriodError('Выберите клиента для выгрузки приемки.');
            return;
        }
        setDownloadingReceiptPeriod(true);
        setReceiptPeriodError('');
        try {
            const blob = await downloadTurnoverReceiptPeriodXlsx(session.accessToken, {
                clientId: selectedClientId,
                dateFrom: dateFrom || undefined,
                dateTo: dateTo || undefined,
            });
            const client = clients.data.find((item) => item.id === selectedClientId) ?? null;
            downloadBlob(blob, receiptPeriodFileName(client, dateFrom, dateTo));
        }
        catch (caught) {
            setReceiptPeriodError(errorMessage(caught));
        }
        finally {
            setDownloadingReceiptPeriod(false);
        }
    }
    async function downloadStockExport() {
        if (!selectedClientId) {
            setStockExportError('Выберите клиента для выгрузки остатков.');
            return;
        }
        setDownloadingStockExport(true);
        setStockExportError('');
        try {
            const blob = await downloadTurnoverStockXlsx(session.accessToken, {
                clientId: selectedClientId,
                ignoreActiveRequests: ignoreActiveStockRequests,
            });
            const client = clients.data.find((item) => item.id === selectedClientId) ?? null;
            downloadBlob(blob, stockExportFileName(client, ignoreActiveStockRequests));
        }
        catch (caught) {
            setStockExportError(errorMessage(caught));
        }
        finally {
            setDownloadingStockExport(false);
        }
    }
    function closeMovementDocument() {
        setMovementDocument({ status: 'idle', data: null, error: undefined });
    }
    const totals = report.data?.totals;
    const selectedClient = clients.data.find((client) => client.id === selectedClientId) ?? null;
    return (_jsxs("div", { className: "turnover-workspace", children: [activeTile === 'home' ? (_jsxs("section", { className: "turnover-topic-intro", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0422\u043E\u0432\u0430\u0440\u044B \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0438" }), _jsx("h2", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443" })] }), _jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A, \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F, \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438 \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u0442\u043E\u0432\u0430\u0440\u043E\u043C \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E." })] })) : (_jsxs("button", { className: "turnover-topic-back", type: "button", onClick: () => setActiveTile('home'), children: [_jsx(ArrowLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430" })] })), activeTile !== 'home' ? _jsxs(_Fragment, { children: [_jsxs("section", { className: "turnover-panel turnover-panel--filters", "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430", children: [_jsxs("div", { className: "turnover-filter-grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [clients.data.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.data.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] }), _jsx(KnownValueInput, { label: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0442\u043E\u0432\u0430\u0440\u0443", value: search, options: productOptions, placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, SKU, \u0430\u0440\u0442\u0438\u043A\u0443\u043B", onChange: setSearch, onSearch: (value) => {
                                            setSuggestionScope('client');
                                            setSuggestionQuery(value);
                                        }, onSelect: (option) => {
                                            setSearch(option.label ?? option.value);
                                            setSuggestionQuery(option.value);
                                            setBarcode(optionDataString(option, 'barcode'));
                                            const skuId = optionDataString(option, 'skuId');
                                            if (skuId) {
                                                setSelectedSkuId(skuId);
                                            }
                                        } }), _jsx(KnownValueInput, { label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434", value: barcode, options: barcodeOptions, placeholder: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430", onChange: setBarcode, onSearch: (value) => {
                                            setSuggestionScope('barcode');
                                            setSuggestionQuery(value);
                                        }, onSelect: (option) => {
                                            setBarcode(option.value);
                                            setSearch(optionDataString(option, 'name') || option.label || option.value);
                                            const clientId = optionDataString(option, 'clientId');
                                            if (clientId) {
                                                setSelectedClientId(clientId);
                                            }
                                            const skuId = optionDataString(option, 'skuId');
                                            if (skuId) {
                                                setSelectedSkuId(skuId);
                                            }
                                        } }), _jsx(KnownValueInput, { label: "\u041A\u0418\u0417", value: kiz, options: kizOptions, placeholder: "\u041D\u043E\u043C\u0435\u0440 \u0438\u043B\u0438 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442", onChange: setKiz, onSearch: (value) => {
                                            setSuggestionScope('client');
                                            setSuggestionQuery(value);
                                        }, onSelect: (option) => {
                                            setKiz(option.value);
                                            setSearch(optionDataString(option, 'name') || option.label || option.value);
                                            const skuId = optionDataString(option, 'skuId');
                                            if (skuId) {
                                                setSelectedSkuId(skuId);
                                            }
                                            const barcodeValue = optionDataString(option, 'barcode');
                                            if (barcodeValue) {
                                                setBarcode(barcodeValue);
                                            }
                                        } }), _jsx(KnownValueInput, { label: "\u041A\u043E\u0440\u043E\u0431", value: boxSearch, options: boxOptions, placeholder: "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430 \u0438\u043B\u0438 \u044F\u0447\u0435\u0439\u043A\u0438", onChange: setBoxSearch, onSearch: (value) => {
                                            setSuggestionScope('client');
                                            setSuggestionQuery(value);
                                        }, onSelect: (option) => {
                                            setBoxSearch(option.value);
                                            void loadBoxDetails(option.value);
                                        } }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: dateFrom, onChange: (event) => setDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: dateTo, onChange: (event) => setDateTo(event.target.value) })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void loadTurnover(), disabled: !selectedClientId || report.status === 'loading', children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" })] }), _jsxs("button", { className: "secondary-action", type: "button", onClick: () => void loadBoxDetails(), disabled: !boxSearch.trim() || boxDetails.status === 'loading', children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431" })] })] }), clients.error ? _jsx("p", { className: "form-error", children: clients.error }) : null, report.error ? _jsx("p", { className: "form-error", children: report.error }) : null, barcode.trim() ? _jsx("p", { className: "inline-status", children: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0428\u041A \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u043F\u043E \u0432\u0441\u0435\u043C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u043C \u043A\u043B\u0438\u0435\u043D\u0442\u0430\u043C." }) : null] }), _jsxs("section", { className: "turnover-summary-tiles", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430", children: [_jsx(TurnoverSummaryTile, { label: "SKU \u0432 \u0432\u044B\u0431\u043E\u0440\u043A\u0435", value: formatNumber(totals?.skuCount ?? 0), icon: _jsx(Archive, { size: 18, "aria-hidden": "true" }), tone: "neutral" }), _jsx(TurnoverSummaryTile, { label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0441\u0435\u0439\u0447\u0430\u0441", value: `${formatNumber(totals?.currentQuantity ?? 0)} шт`, icon: _jsx(History, { size: 18, "aria-hidden": "true" }), tone: "stock" }), _jsx(TurnoverSummaryTile, { label: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434", value: `${formatNumber(totals?.receivedQuantity ?? 0)} шт`, icon: _jsx(PackagePlus, { size: 18, "aria-hidden": "true" }), tone: "receipt" }), _jsx(TurnoverSummaryTile, { label: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434", value: `${formatNumber(totals?.shippedQuantity ?? 0)} шт`, icon: _jsx(ArrowRightLeft, { size: 18, "aria-hidden": "true" }), tone: "shipment" }), _jsx(TurnoverSummaryTile, { label: "\u0421\u043F\u0438\u0441\u0430\u043D\u043E \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434", value: `${formatNumber(totals?.writtenOffQuantity ?? 0)} шт`, icon: _jsx(Trash2, { size: 18, "aria-hidden": "true" }), tone: "writeoff" })] }), _jsxs("section", { className: "turnover-quick-tool", "aria-label": "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430 \u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442" }), _jsx("h3", { children: "\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442 \u0442\u043E\u0432\u0430\u0440" }), _jsx("p", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u043D\u0430\u0439\u0434\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E, \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0443, \u0428\u041A \u0438\u043B\u0438 \u041A\u0418\u0417 \u2014 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u043F\u043E\u043A\u0430\u0436\u0435\u043C \u0441\u0440\u0430\u0437\u0443." })] }), _jsx("span", { children: selectedClient?.name ?? 'Клиент не выбран' })] }), selectedReportItem ? (_jsxs("div", { className: "turnover-quick-tool__result", children: [_jsxs("div", { className: "turnover-quick-tool__product", children: [_jsx("span", { children: selectedReportItem.primaryBarcode ?? 'ШК' }), _jsx("strong", { children: selectedReportItem.name }), _jsxs("small", { children: [selectedReportItem.internalSku, " \u00B7 \u043D\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u0435 ", formatNumber(selectedReportItem.currentQuantity), " \u0448\u0442"] })] }), _jsxs("div", { className: "turnover-quick-tool__locations", children: [selectedReportItem.currentCells.length === 0 ? _jsx("span", { className: "turnover-quick-tool__empty", children: "\u041D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430." }) : null, selectedReportItem.currentCells.map((cell) => (_jsxs("button", { type: "button", onClick: () => void loadBoxDetails(cell.boxCode), children: [_jsx("strong", { children: cell.boxCode }), _jsxs("span", { children: [storageZoneLabel(cell), " \u00B7 ", cell.palletSortCode ?? cell.palletCode ?? 'без палет-сорта'] }), _jsxs("small", { children: [formatNumber(cell.quantity), " \u0448\u0442 \u00B7 ", stockStatusLabel(cell.status)] })] }, `${cell.boxId ?? cell.boxCode}-${cell.status}-${cell.palletSortCode ?? ''}`)))] }), canUseActions ? (_jsxs("div", { className: "turnover-quick-tool__actions", children: [_jsxs("button", { className: "secondary-action", type: "button", onClick: () => startSkuAction('ADD'), children: [_jsx(PackagePlus, { size: 16 }), "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C"] }), _jsxs("button", { className: "secondary-action", type: "button", onClick: () => startSkuAction('WRITE_OFF'), children: [_jsx(Trash2, { size: 16 }), "\u0421\u043F\u0438\u0441\u0430\u0442\u044C"] }), _jsxs("button", { className: "secondary-action", type: "button", onClick: () => startSkuAction('TRANSFER'), children: [_jsx(ArrowRightLeft, { size: 16 }), "\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u0442\u044C"] })] })) : null] })) : (_jsx("p", { className: "turnover-quick-tool__empty", children: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u0430, \u0428\u041A \u0438\u043B\u0438 \u041A\u0418\u0417 \u0432 \u043F\u043E\u0438\u0441\u043A\u0435 \u0432\u044B\u0448\u0435." }))] })] }) : null, activeTile === 'home' ? _jsxs("section", { className: "turnover-tiles", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430", children: [_jsx(TurnoverTile, { active: false, index: 1, icon: _jsx(Search, { size: 22, "aria-hidden": "true" }), title: "\u041D\u0430\u0439\u0442\u0438 \u0442\u043E\u0432\u0430\u0440", text: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0428\u041A \u0438\u043B\u0438 \u041A\u0418\u0417 \u2014 \u043F\u043E\u043A\u0430\u0436\u0435\u043C \u043A\u043E\u0440\u043E\u0431, \u0437\u043E\u043D\u0443 \u0438 \u043F\u0430\u043B\u043B\u0435\u0442-\u0441\u043E\u0440\u0442.", value: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A", tone: "lookup", onClick: () => setActiveTile('lookup') }), _jsx(TurnoverTile, { active: false, index: 2, icon: _jsx(History, { size: 22, "aria-hidden": "true" }), title: "\u0422\u043E\u0432\u0430\u0440\u043E-\u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435", text: "\u041F\u0440\u0438\u0435\u043C\u043A\u0430, \u044F\u0447\u0435\u0439\u043A\u0438, \u041A\u0418\u0417, \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F, \u0437\u0430\u044F\u0432\u043A\u0438 \u0438 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435.", value: totals ? `${formatNumber(totals.currentQuantity)} шт` : '0 шт', tone: "stock", onClick: () => setActiveTile('movement') }), _jsx(TurnoverTile, { active: false, index: 3, icon: _jsx(Download, { size: 22, "aria-hidden": "true" }), title: "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438", text: "\u041E\u0434\u0438\u043D Excel \u043F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u0438 \u043F\u0435\u0440\u0438\u043E\u0434\u0443.", value: receiptPeriodLabel(dateFrom, dateTo), tone: "receipt", onClick: () => setActiveTile('receipts') }), canSeeStatistics ? (_jsx(TurnoverTile, { active: false, index: 4, icon: _jsx(Archive, { size: 22, "aria-hidden": "true" }), title: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 Excel", text: "\u041A\u043E\u0440\u043E\u0431\u0430, \u043F\u0430\u043B\u043B\u0435\u0442\u044B, SKU, \u0428\u041A, \u041A\u0418\u0417 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0434\u0430\u0442\u0443.", value: ignoreActiveStockRequests ? 'Полностью' : 'Минус заявки', tone: "export", onClick: () => setActiveTile('stockExport') })) : null, canUseActions ? (_jsx(TurnoverTile, { active: false, index: 5, icon: _jsx(ArrowRightLeft, { size: 22, "aria-hidden": "true" }), title: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u0442\u043E\u0432\u0430\u0440\u0430\u043C\u0438", text: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C, \u0441\u043F\u0438\u0441\u0430\u0442\u044C, \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438, \u0443\u0442\u0438\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438\u043B\u0438 \u043E\u0442\u043B\u043E\u0436\u0438\u0442\u044C.", value: selectedClient?.name ?? 'Клиент', tone: "action", onClick: () => setActiveTile('actions') })) : null, canSeeStatistics ? (_jsx(TurnoverTile, { active: false, index: 6, icon: _jsx(BarChart3, { size: 22, "aria-hidden": "true" }), title: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430", text: "\u041F\u0440\u0438\u0445\u043E\u0434, \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0430 \u0438 \u0442\u0435\u043D\u0434\u0435\u043D\u0446\u0438\u0438 \u043F\u043E \u0434\u043D\u044F\u043C, \u043C\u0435\u0441\u044F\u0446\u0430\u043C, \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0430\u043C.", value: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E", tone: "stats", onClick: () => setActiveTile('stats') })) : null] }) : null, report.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442." }) : null, boxDetails.status !== 'idle' ? (_jsx("div", { className: "turnover-box-dialog", role: "dialog", "aria-modal": "true", "aria-label": "\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043A\u043E\u0440\u043E\u0431\u0430", onMouseDown: (event) => {
                    if (event.currentTarget === event.target) {
                        setBoxDetails({ status: 'idle', data: null });
                    }
                }, children: _jsx("div", { className: "turnover-box-dialog__panel", children: _jsx(BoxDetailsSection, { state: boxDetails, canUseActions: canUseActions, onClose: () => setBoxDetails({ status: 'idle', data: null }), onAction: startBoxAction }) }) })) : null, activeTile === 'receipts' ? (_jsx(ReceiptExportSection, { client: selectedClient, dateFrom: dateFrom, dateTo: dateTo, error: receiptPeriodError, isDownloading: isDownloadingReceiptPeriod, onDownload: () => void downloadReceiptPeriod() })) : null, activeTile === 'stockExport' && canSeeStatistics ? (_jsx(StockExportSection, { client: selectedClient, ignoreActiveRequests: ignoreActiveStockRequests, error: stockExportError, isDownloading: isDownloadingStockExport, onIgnoreActiveRequestsChange: setIgnoreActiveStockRequests, onDownload: () => void downloadStockExport() })) : null, activeTile === 'movement' ? (_jsx(MovementSection, { items: report.data?.items ?? [], search: movementSearch, selectedSkuId: selectedReportItem?.skuId ?? '', onOpenDocument: (movement) => void openMovementDocument(movement), onOpenBox: (boxCode) => void loadBoxDetails(boxCode), onSearch: setMovementSearch, onSelect: setSelectedSkuId })) : null, activeTile === 'actions' && canUseActions ? (_jsx(ActionsSection, { form: actionForm, items: report.data?.items ?? [], sourceCells: sourceCells, allCells: allCells, productOptions: productOptions, sourceCellOptions: sourceCellOptions, targetCellOptions: targetCellOptions, kizOptions: kizOptions, isSubmitting: isSubmittingAction, message: actionMessage, error: actionError, onChange: updateActionForm, onSuggest: setSuggestionQuery, onSubmit: () => void submitAction() })) : null, activeTile === 'stats' && canSeeStatistics ? (_jsx(StatisticsSection, { canSee: canSeeStatistics, statistics: statistics.data, groupBy: groupBy, onGroupBy: (value) => setGroupBy(value), onReload: () => void loadTurnover() })) : null, movementDocument.status !== 'idle' ? (_jsx(TurnoverMovementDocumentModal, { documentState: movementDocument, isDownloading: isDownloadingMovementDocument, onClose: closeMovementDocument, onDownload: (movementId, fileName) => void downloadMovementDocument(movementId, fileName) })) : null] }));
}
function TurnoverTile({ active, index, icon, title, text, value, tone, onClick, }) {
    return (_jsxs("button", { className: `turnover-tile turnover-tile--${tone} ${active ? 'is-active' : ''}`, type: "button", onClick: onClick, children: [_jsx("span", { className: "turnover-tile__index", children: index }), _jsx("span", { className: "turnover-tile__icon", children: icon }), _jsxs("span", { className: "turnover-tile__content", children: [_jsx("small", { children: value }), _jsx("strong", { children: title }), _jsx("span", { children: text })] }), _jsx(ChevronRight, { size: 22, "aria-hidden": "true" })] }));
}
function TurnoverSummaryTile({ label, value, icon, tone, }) {
    return (_jsxs("div", { className: `turnover-summary-tile turnover-summary-tile--${tone}`, children: [_jsx("span", { className: "turnover-summary-tile__icon", children: icon }), _jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function ReceiptExportSection({ client, dateFrom, dateTo, isDownloading, error, onDownload, }) {
    return (_jsxs("section", { className: "turnover-panel turnover-receipt-export", "aria-label": "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438", children: [_jsxs("div", { className: "turnover-details__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsx("h3", { children: "\u0412\u0441\u0435 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0432 \u043E\u0434\u043D\u043E\u043C Excel" })] }), _jsx("span", { children: receiptPeriodLabel(dateFrom, dateTo) })] }), _jsxs("div", { className: "turnover-receipt-export__body", children: [_jsxs("div", { children: [_jsx("strong", { children: client?.name ?? 'Клиент не выбран' }), _jsx("p", { children: "\u0412 \u0444\u0430\u0439\u043B \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0441\u0442\u0440\u043E\u043A\u0438 \u043F\u0440\u0438\u0435\u043C\u043A\u0438 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434: \u043A\u043E\u0440\u043E\u0431, \u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430, SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u041A\u0418\u0417, \u043D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435, \u0446\u0432\u0435\u0442, \u0440\u0430\u0437\u043C\u0435\u0440, \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0438 \u0434\u0430\u0442\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438." }), _jsx("small", { children: "\u0415\u0441\u043B\u0438 \u043F\u0435\u0440\u0438\u043E\u0434 \u0441\u0432\u0435\u0440\u0445\u0443 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D, WMS \u0432\u044B\u0433\u0440\u0443\u0437\u0438\u0442 \u043F\u0440\u0438\u0435\u043C\u043A\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0437\u0430 \u0432\u0435\u0441\u044C \u0441\u0440\u043E\u043A." })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onDownload, disabled: !client || isDownloading, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isDownloading ? 'Формирую файл' : 'Скачать приемку Excel' })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null] }));
}
function StockExportSection({ client, ignoreActiveRequests, isDownloading, error, onIgnoreActiveRequestsChange, onDownload, }) {
    return (_jsxs("section", { className: "turnover-panel turnover-receipt-export turnover-stock-export", "aria-label": "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432", children: [_jsxs("div", { className: "turnover-details__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 Excel" }), _jsx("h3", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0441 \u043A\u043E\u0440\u043E\u0431\u0430\u043C\u0438, SKU \u0438 \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434\u0430\u043C\u0438" })] }), _jsx("span", { children: ignoreActiveRequests ? 'Полный остаток' : 'За вычетом активных заявок' })] }), _jsxs("div", { className: "turnover-receipt-export__body", children: [_jsxs("div", { children: [_jsx("strong", { children: client?.name ?? 'Клиент не выбран' }), _jsx("p", { children: "\u0412 \u0444\u0430\u0439\u043B \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0442\u0435\u043A\u0443\u0449\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u043A\u043E\u0440\u043E\u0431\u0430\u043C: \u043A\u043E\u0440\u043E\u0431, \u043F\u0430\u043B\u043B\u0435\u0442\u0430, SKU WMS, SKU \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0428\u041A, \u0432\u0441\u0435 \u0428\u041A, \u043D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435, \u0446\u0432\u0435\u0442, \u0440\u0430\u0437\u043C\u0435\u0440, \u0441\u0442\u0430\u0442\u0443\u0441, \u041A\u0418\u0417 \u0438 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043A \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0435." }), _jsxs("label", { className: "turnover-stock-export__toggle", children: [_jsx("input", { type: "checkbox", checked: ignoreActiveRequests, onChange: (event) => onIgnoreActiveRequestsChange(event.target.checked) }), _jsx("span", { children: "\u0418\u0433\u043D\u043E\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438 \u0438 \u0441\u043A\u0430\u0447\u0430\u0442\u044C \u043F\u043E\u043B\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" })] }), _jsx("small", { children: "\u0415\u0441\u043B\u0438 \u0433\u0430\u043B\u043E\u0447\u043A\u0430 \u0441\u043D\u044F\u0442\u0430, WMS \u0432\u044B\u0447\u0442\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u044B \u0438\u0437 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u044F\u0432\u043E\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u043D\u0443\u043B\u0435\u0432\u044B\u043C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u043C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u043C \u043D\u0435 \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0432 Excel." })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onDownload, disabled: !client || isDownloading, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isDownloading ? 'Формирую файл' : 'Скачать остатки Excel' })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null] }));
}
function BoxDetailsSection({ state, canUseActions, onClose, onAction, }) {
    const details = state.data;
    return (_jsxs("section", { className: "turnover-panel turnover-box-details", "aria-label": "\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043A\u043E\u0440\u043E\u0431\u0430", children: [_jsxs("div", { className: "turnover-details__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u043E\u0440\u043E\u0431\u0443" }), _jsx("h3", { children: details ? details.box.code : 'Короб' }), details ? _jsxs("span", { children: [details.box.client.name, " \u00B7 \u0441\u0442\u0430\u0442\u0443\u0441 ", details.box.status] }) : null] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u043E\u0440\u043E\u0431", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u0418\u0449\u0443 \u043A\u043E\u0440\u043E\u0431 \u0438 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435." }) : null, state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, details ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "turnover-metrics", children: [_jsx(Metric, { label: "\u041F\u043E\u0437\u0438\u0446\u0438\u0439", value: formatNumber(details.totals.rows) }), _jsx(Metric, { label: "SKU", value: formatNumber(details.totals.skuCount) }), _jsx(Metric, { label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: formatNumber(details.totals.quantity) }), _jsx(Metric, { label: "\u041A\u0418\u0417", value: formatNumber(details.totals.kizCount) })] }), _jsx("div", { className: "turnover-table-wrap", children: _jsxs("table", { className: "turnover-table turnover-box-details__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u0426\u0432\u0435\u0442 / \u0440\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041A\u0418\u0417" }), canUseActions ? _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }) : null] }) }), _jsxs("tbody", { children: [details.contents.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: canUseActions ? 7 : 6, children: "\u0412 \u043A\u043E\u0440\u043E\u0431\u0435 \u043D\u0435\u0442 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430." }) })) : null, details.contents.map((item) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: [item.internalSku, item.clientSku, item.article].filter(Boolean).join(' · ') })] }), _jsx("td", { children: item.barcode ?? '-' }), _jsx("td", { children: [item.color, item.size].filter(Boolean).join(' / ') || '-' }), _jsx("td", { children: item.statusLabel }), _jsx("td", { children: formatNumber(item.quantity) }), _jsx("td", { children: item.kiz.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("span", { children: item.kiz.slice(0, 3).join(', ') }), item.kizCount > item.kiz.length ? _jsxs("small", { children: ["+ ", formatNumber(item.kizCount - item.kiz.length)] }) : null] })) : ('-') }), canUseActions ? (_jsx("td", { children: _jsxs("div", { className: "turnover-box-actions", children: [_jsx("button", { type: "button", onClick: () => onAction(item, 'TRANSFER'), children: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438" }), _jsx("button", { type: "button", onClick: () => onAction(item, 'WRITE_OFF'), children: "\u0421\u043F\u0438\u0441\u0430\u0442\u044C" }), _jsx("button", { type: "button", onClick: () => onAction(item, 'HOLD'), children: "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C" }), _jsx("button", { type: "button", onClick: () => onAction(item, 'ADD'), children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] }) })) : null] }, item.balanceId)))] })] }) }), _jsx("div", { className: "turnover-table-wrap turnover-table-wrap--compact", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" })] }) }), _jsxs("tbody", { children: [details.movements.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "\u041F\u043E \u043A\u043E\u0440\u043E\u0431\u0443 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439." }) })) : null, details.movements.map((movement) => (_jsxs("tr", { children: [_jsx("td", { children: formatDateTime(movement.date) }), _jsxs("td", { children: [_jsx("strong", { children: movement.typeLabel }), _jsx("span", { children: movement.comment || movement.statusLabel })] }), _jsxs("td", { children: [_jsx("strong", { children: movement.name }), _jsx("span", { children: movement.barcode ?? '-' })] }), _jsx("td", { className: movement.quantity < 0 ? 'is-negative' : 'is-positive', children: formatNumber(movement.quantity) }), _jsx("td", { children: movement.sourceDocument ?? '-' })] }, movement.id)))] })] }) })] })) : null] }));
}
function MovementSection({ items, search, selectedSkuId, onOpenDocument, onOpenBox, onSearch, onSelect, }) {
    const filteredItems = items.filter((item) => matchesTurnoverItemSearch(item, search));
    const selected = filteredItems.find((item) => item.skuId === selectedSkuId) ?? filteredItems[0] ?? null;
    if (items.length === 0) {
        return (_jsx("section", { className: "turnover-panel", children: _jsx("p", { className: "turnover-empty", children: "\u041F\u043E \u0444\u0438\u043B\u044C\u0442\u0440\u0443 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F \u0442\u043E\u0432\u0430\u0440\u043E\u0432." }) }));
    }
    return (_jsxs("section", { className: "turnover-panel turnover-movement", "aria-label": "\u0422\u043E\u0432\u0430\u0440\u043E-\u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435", children: [_jsxs("div", { className: "turnover-search-bar", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("input", { value: search, onChange: (event) => onSearch(event.target.value), placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, SKU, \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0438\u043B\u0438 \u0428\u041A" })] }), _jsxs("small", { children: ["\u041D\u0430\u0439\u0434\u0435\u043D\u043E: ", formatNumber(filteredItems.length), " \u0438\u0437 ", formatNumber(items.length)] })] }), _jsxs("div", { className: "turnover-two-columns", children: [_jsx("div", { className: "turnover-table-wrap", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435" }), _jsx("th", { children: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E" }), _jsx("th", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E" })] }) }), _jsxs("tbody", { children: [filteredItems.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "\u041F\u043E \u0442\u0430\u043A\u043E\u043C\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u0442\u043E\u0432\u0430\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D." }) })) : null, filteredItems.map((item) => (_jsxs("tr", { className: item.skuId === selected?.skuId ? 'is-active' : '', onClick: () => onSelect(item.skuId), children: [_jsxs("td", { children: [_jsx("strong", { children: item.client.name }), _jsx("span", { children: item.client.code })] }), _jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: item.internalSku })] }), _jsx("td", { children: item.primaryBarcode ?? 'нет' }), _jsx("td", { children: formatNumber(item.currentQuantity) }), _jsxs("td", { className: "turnover-placement-cell", children: [item.currentCells.length === 0 ? _jsx("span", { children: "\u041D\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u0430" }) : null, item.currentCells.slice(0, 2).map((cell) => (_jsxs("span", { className: "turnover-placement-cell__item", children: [_jsx("strong", { children: cell.boxCode }), _jsx("small", { children: placementSummary(cell) })] }, `${cell.boxId ?? cell.boxCode}-${cell.status}-${cell.palletSortCode ?? ''}`))), item.currentCells.length > 2 ? _jsxs("small", { children: ["\u0415\u0449\u0451 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0439: ", item.currentCells.length - 2] }) : null] }), _jsx("td", { children: formatNumber(item.receivedQuantity) }), _jsx("td", { children: formatNumber(item.shippedQuantity) })] }, item.skuId)))] })] }) }), selected ? _jsx(MovementDetails, { item: selected, onOpenDocument: onOpenDocument, onOpenBox: onOpenBox }) : null] })] }));
}
function MovementDetails({ item, onOpenDocument, onOpenBox, }) {
    return (_jsxs("div", { className: "turnover-details", children: [_jsxs("div", { className: "turnover-details__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F" }), _jsx("h3", { children: item.name }), _jsxs("small", { children: [item.client.name, " \u00B7 ", item.client.code] })] }), _jsx("span", { children: item.primaryBarcode ?? item.internalSku })] }), _jsxs("div", { className: "turnover-current-placement", children: [_jsxs("div", { className: "turnover-current-placement__heading", children: [_jsx("strong", { children: "\u0422\u0435\u043A\u0443\u0449\u0435\u0435 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435" }), _jsxs("span", { children: [item.currentCells.length, " \u043C\u0435\u0441\u0442"] })] }), _jsxs("div", { className: "turnover-cells", children: [item.currentCells.length === 0 ? _jsx("span", { children: "\u041D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u0430." }) : null, item.currentCells.map((cell) => (_jsxs("button", { className: "turnover-cell-card", type: "button", onClick: () => onOpenBox(cell.boxCode), title: `Открыть содержимое короба ${cell.boxCode}`, children: [_jsx("strong", { children: cell.boxCode }), _jsxs("span", { className: "turnover-cell-card__placement", children: [_jsxs("span", { children: ["\u0417\u043E\u043D\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F: ", _jsx("b", { children: storageZoneLabel(cell) })] }), _jsxs("span", { children: ["\u041F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442: ", _jsx("b", { children: cell.palletSortCode ?? cell.palletCode ?? 'не указан' })] })] }), _jsxs("small", { children: [formatNumber(cell.quantity), " \u0448\u0442 \u00B7 ", stockStatusLabel(cell.status)] })] }, `${cell.boxId ?? cell.boxCode}-${cell.status}-${cell.palletSortCode ?? ''}`)))] })] }), _jsxs("div", { className: "turnover-metrics", children: [_jsx(Metric, { label: "\u041F\u0435\u0440\u0432\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434", value: formatDate(item.firstReceiptAt) }), _jsx(Metric, { label: "\u041F\u0435\u0440\u0432\u0430\u044F \u044F\u0447\u0435\u0439\u043A\u0430", value: item.firstCell ?? 'не указана', onClick: item.firstCell ? () => onOpenBox(item.firstCell) : undefined }), _jsx(Metric, { label: "\u0414\u043D\u0435\u0439 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F", value: String(item.storageDays) }), _jsx(Metric, { label: "\u041A\u0418\u0417", value: String(item.kiz.length) })] }), _jsx("div", { className: "turnover-table-wrap turnover-table-wrap--compact", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u042F\u0447\u0435\u0439\u043A\u0430" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" })] }) }), _jsx("tbody", { children: item.movements.map((movement) => (_jsxs("tr", { children: [_jsx("td", { children: formatDateTime(movement.date) }), _jsx("td", { children: isDocumentMovement(movement) ? (_jsxs("button", { className: "turnover-movement-action", type: "button", onClick: () => onOpenDocument(movement), children: [_jsx("strong", { children: movement.typeLabel }), _jsx("span", { children: movement.comment || 'Открыть документ движения' })] })) : (_jsxs(_Fragment, { children: [_jsx("strong", { children: movement.typeLabel }), _jsx("span", { children: movement.comment || movement.statusLabel })] })) }), _jsx("td", { className: movement.quantity < 0 ? 'is-negative' : 'is-positive', children: formatNumber(movement.quantity) }), _jsx("td", { children: movement.boxCode ? (_jsx("button", { className: "turnover-cell-link", type: "button", onClick: () => onOpenBox(movement.boxCode), title: `Открыть содержимое короба ${movement.boxCode}`, children: movement.boxCode })) : ('без ячейки') }), _jsx("td", { children: movement.request ? `${movement.request.title}${movement.request.destinationCity ? `, ${movement.request.destinationCity}` : ''}` : movement.sourceDocument ?? 'нет' })] }, movement.id))) })] }) })] }));
}
function TurnoverMovementDocumentModal({ documentState, isDownloading, onClose, onDownload, }) {
    const document = documentState.data;
    return (_jsx("div", { className: "turnover-document-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F", children: _jsxs("section", { className: "turnover-document-modal__panel", children: [_jsxs("header", { className: "turnover-document-modal__header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F" }), _jsx("h3", { children: document ? document.typeLabel : 'Загрузка документа' }), _jsx("span", { children: document ? `${document.client.name} · ${document.sourceDocument ?? document.movementId}` : 'Получаю данные из WMS' })] }), _jsxs("div", { className: "turnover-document-modal__actions", children: [document ? (_jsxs("button", { className: "primary-button", type: "button", onClick: () => onDownload(document.movementId, document.fileName), disabled: isDownloading, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isDownloading ? 'Скачиваю' : 'Скачать Excel' })] })) : null, _jsx("button", { className: "icon-button", type: "button", onClick: onClose, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] })] }), documentState.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F." }) : null, documentState.error ? _jsx("p", { className: "form-error", children: documentState.error }) : null, document ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "turnover-metrics", children: [_jsx(Metric, { label: "\u041F\u0435\u0440\u0438\u043E\u0434", value: `${formatDateTime(document.periodFrom)} - ${formatDateTime(document.periodTo)}` }), _jsx(Metric, { label: "\u0421\u0442\u0440\u043E\u043A", value: formatNumber(document.rows.length) }), _jsx(Metric, { label: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432, \u0448\u0442", value: formatNumber(document.totalQuantity) }), _jsx(Metric, { label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432", value: formatNumber(document.boxesCount) })] }), _jsx("div", { className: "turnover-table-wrap turnover-document-modal__table", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u2116" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" })] }) }), _jsx("tbody", { children: document.rows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.position }), _jsx("td", { children: formatDateTime(row.date) }), _jsx("td", { children: row.boxCode ?? 'без короба' }), _jsx("td", { children: row.barcode ?? 'нет' }), _jsxs("td", { children: [_jsx("strong", { children: row.name }), _jsx("span", { children: [row.article, row.internalSku].filter(Boolean).join(' · ') })] }), _jsx("td", { children: formatNumber(row.quantity) }), _jsx("td", { children: row.kiz ?? '-' }), _jsx("td", { children: row.comment ?? '-' })] }, row.movementId))) })] }) })] })) : null] }) }));
}
function ActionsSection({ form, items, sourceCells, allCells, productOptions, sourceCellOptions, targetCellOptions, kizOptions, isSubmitting, message, error, onChange, onSuggest, onSubmit, }) {
    const selectedAction = actionOptions.find((item) => item.value === form.action) ?? actionOptions[0];
    const needsSource = form.action !== 'ADD';
    const needsTarget = form.action === 'ADD' || form.action === 'TRANSFER' || form.action === 'HOLD';
    const needsReason = form.action === 'WRITE_OFF' || form.action === 'UTILIZE' || form.action === 'HOLD';
    function selectProduct(option) {
        onChange('skuText', productTextFromOption(option));
        onChange('skuId', optionDataString(option, 'skuId'));
        const boxCode = optionDataString(option, 'boxCode');
        if (boxCode) {
            onChange('sourceBoxCode', boxCode);
        }
    }
    function selectKiz(option) {
        onChange('kiz', option.value);
        const skuId = optionDataString(option, 'skuId');
        if (skuId) {
            onChange('skuId', skuId);
            onChange('skuText', productTextFromOption(option));
        }
        const boxCode = optionDataString(option, 'boxCode');
        if (boxCode) {
            onChange('sourceBoxCode', boxCode);
        }
    }
    return (_jsxs("section", { className: "turnover-panel turnover-actions-panel", "aria-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u0442\u043E\u0432\u0430\u0440\u0430\u043C\u0438", children: [_jsxs("div", { className: "turnover-details__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0420\u0443\u0447\u043D\u0430\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F" }), _jsx("h3", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u0442\u043E\u0432\u0430\u0440\u0430\u043C\u0438" })] }), _jsx(PackagePlus, { size: 22, "aria-hidden": "true" })] }), _jsxs("div", { className: "turnover-action-grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }), _jsx("select", { value: form.action, onChange: (event) => onChange('action', event.target.value), children: actionOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) }), _jsx("small", { children: selectedAction.hint })] }), _jsx(KnownValueInput, { label: "\u0422\u043E\u0432\u0430\u0440", value: form.skuText, options: productOptions, placeholder: items.length === 0 ? 'Нет товаров по фильтру' : 'Начните вводить товар, артикул или ШК', onChange: (value) => {
                            onChange('skuText', value);
                            onChange('skuId', '');
                        }, onSearch: onSuggest, onSelect: selectProduct }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { min: "1", type: "number", value: form.quantity, onChange: (event) => onChange('quantity', event.target.value) })] }), needsSource ? (_jsx(KnownValueInput, { label: "\u041E\u0442\u043A\u0443\u0434\u0430", value: form.sourceBoxCode, options: sourceCellOptions, placeholder: "\u041C\u043E\u0436\u043D\u043E \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C", onChange: (value) => onChange('sourceBoxCode', value), onSearch: onSuggest, onSelect: (option) => onChange('sourceBoxCode', option.value) })) : null, needsTarget ? (_jsx(KnownValueInput, { label: "\u041A\u0443\u0434\u0430", value: form.targetBoxCode, options: targetCellOptions, placeholder: "\u041D\u043E\u0432\u0430\u044F \u0438\u043B\u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0430\u044F \u044F\u0447\u0435\u0439\u043A\u0430", onChange: (value) => onChange('targetBoxCode', value), onSearch: onSuggest, onSelect: (option) => onChange('targetBoxCode', option.value) })) : null, needsReason ? (_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430" }), _jsx("input", { value: form.reason, onChange: (event) => onChange('reason', event.target.value), placeholder: "\u041A\u043E\u0440\u043E\u0442\u043A\u043E, \u0447\u0442\u043E \u0441\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C" })] })) : null] }), _jsxs("div", { className: "turnover-action-grid turnover-action-grid--wide", children: [_jsx(KnownValueInput, { label: "\u041A\u0418\u0417", value: form.kiz, options: kizOptions, placeholder: "\u041C\u043E\u0436\u043D\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E: \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E \u0438\u043B\u0438 \u0441 \u043D\u043E\u0432\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0438", multiline: true, onChange: (value) => onChange('kiz', value), onSearch: onSuggest, onSelect: selectKiz }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u043E\u0442\u043E / \u0444\u0430\u0439\u043B" }), _jsx("input", { type: "file", accept: "image/*", onChange: (event) => onChange('photoFileName', event.target.files?.[0]?.name ?? '') }), _jsx("small", { children: form.photoFileName || 'Файл не выбран. В историю попадет имя файла.' })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { value: form.comment, onChange: (event) => onChange('comment', event.target.value), placeholder: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F" })] })] }), message ? _jsx("p", { className: "form-success", children: message }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsx("div", { className: "turnover-actions", children: _jsxs("button", { className: "primary-button", type: "button", onClick: onSubmit, disabled: isSubmitting || !form.skuId, children: [form.action === 'WRITE_OFF' || form.action === 'UTILIZE' ? _jsx(Trash2, { size: 16, "aria-hidden": "true" }) : _jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Провожу' : 'Провести операцию' })] }) })] }));
}
function StatisticsSection({ canSee, statistics, groupBy, onGroupBy, onReload, }) {
    if (!canSee) {
        return (_jsxs("section", { className: "turnover-panel turnover-empty-panel", children: [_jsx(Archive, { size: 26, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h3", { children: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0441\u043A\u0440\u044B\u0442\u0430" }), _jsx("p", { children: "\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u044D\u0442\u043E\u0442 \u0431\u043B\u043E\u043A \u0432\u0438\u0434\u044F\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446, \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440 \u0438 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440." })] })] }));
    }
    if (!statistics) {
        return (_jsx("section", { className: "turnover-panel", children: _jsx("p", { className: "turnover-empty", children: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u201C\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C\u201D, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443." }) }));
    }
    return (_jsxs("section", { className: "turnover-panel turnover-stats", "aria-label": "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430", children: [_jsxs("div", { className: "turnover-stats__toolbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430" }), _jsx("h3", { children: "\u041F\u0440\u0438\u0445\u043E\u0434 \u0438 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043E \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434\u0430\u043C" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u0440\u0443\u043F\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C" }), _jsxs("select", { value: groupBy, onChange: (event) => {
                                    onGroupBy(event.target.value);
                                    window.setTimeout(onReload, 0);
                                }, children: [_jsx("option", { value: "day", children: "\u041F\u043E \u0434\u043D\u044F\u043C" }), _jsx("option", { value: "month", children: "\u041F\u043E \u043C\u0435\u0441\u044F\u0446\u0430\u043C" }), _jsx("option", { value: "quarter", children: "\u041F\u043E \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0430\u043C" }), _jsx("option", { value: "year", children: "\u041F\u043E \u0433\u043E\u0434\u0430\u043C" })] })] })] }), _jsxs("div", { className: "turnover-metrics", children: [_jsx(Metric, { label: "\u041F\u0440\u0438\u0435\u0445\u0430\u043B\u043E", value: `${formatNumber(statistics.totals.receivedQuantity)} шт` }), _jsx(Metric, { label: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E", value: `${formatNumber(statistics.totals.shippedQuantity)} шт` }), _jsx(Metric, { label: "\u0421\u043F\u0438\u0441\u0430\u043D\u043E", value: `${formatNumber(statistics.totals.writtenOffQuantity)} шт` }), _jsx(Metric, { label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A", value: `${formatNumber(statistics.totals.currentQuantity)} шт` })] }), _jsxs("div", { className: "turnover-two-columns", children: [_jsx("div", { className: "turnover-table-wrap", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041F\u0435\u0440\u0438\u043E\u0434" }), _jsx("th", { children: "\u041F\u0440\u0438\u0445\u043E\u0434" }), _jsx("th", { children: "\u041E\u0442\u0433\u0440\u0443\u0437\u043A\u0430" }), _jsx("th", { children: "\u0421\u043F\u0438\u0441\u0430\u043D\u043E" })] }) }), _jsx("tbody", { children: statistics.trend.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.period }), _jsx("td", { children: formatNumber(row.receivedQuantity) }), _jsx("td", { children: formatNumber(row.shippedQuantity) }), _jsx("td", { children: formatNumber(row.writtenOffQuantity) })] }, row.period))) })] }) }), _jsx("div", { className: "turnover-table-wrap", children: _jsxs("table", { className: "turnover-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u041F\u0440\u0438\u0435\u0445\u0430\u043B\u043E" }), _jsx("th", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E" })] }) }), _jsx("tbody", { children: statistics.rows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.name }), _jsx("span", { children: row.article ?? row.internalSku })] }), _jsx("td", { children: row.primaryBarcode ?? 'нет' }), _jsx("td", { children: formatNumber(row.receivedQuantity) }), _jsx("td", { children: formatNumber(row.shippedQuantity) })] }, row.skuId))) })] }) })] })] }));
}
function Metric({ label, value, onClick }) {
    return (_jsxs("div", { className: "turnover-metric", children: [_jsx("span", { children: label }), onClick ? (_jsx("button", { className: "turnover-metric__link", type: "button", onClick: onClick, title: `Открыть содержимое короба ${value}`, children: value })) : (_jsx("strong", { children: value }))] }));
}
function productText(item) {
    if (!item) {
        return '';
    }
    return [item.name, item.primaryBarcode ? `ШК ${item.primaryBarcode}` : item.internalSku].filter(Boolean).join(' · ');
}
function matchesTurnoverItemSearch(item, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    return [
        item.name,
        item.internalSku,
        item.clientSku,
        item.article,
        item.primaryBarcode,
        ...item.barcodes,
    ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
}
function boxContentText(item) {
    return [item.name, item.barcode ? `ШК ${item.barcode}` : item.internalSku, item.article, item.size].filter(Boolean).join(' · ');
}
function productTextFromOption(option) {
    const name = optionDataString(option, 'name');
    const barcode = optionDataString(option, 'barcode');
    const internalSku = optionDataString(option, 'internalSku');
    return [name || option.label || option.value, barcode ? `ШК ${barcode}` : internalSku].filter(Boolean).join(' · ');
}
function productSearchOptionLabel(item) {
    const article = item.article?.trim() || item.clientSku?.trim() || item.internalSku;
    const articleAndSize = item.size?.trim() ? `${article}-${item.size.trim()}` : article;
    return [articleAndSize, item.barcode?.trim() ? `ШК ${item.barcode.trim()}` : null]
        .filter(Boolean)
        .join(' · ');
}
function optionDataString(option, key) {
    const value = option.data?.[key];
    return value === null || value === undefined ? '' : String(value);
}
function buildProductOptions(items, products) {
    return uniqueOptions([
        ...items.map((item) => ({
            value: productSearchOptionLabel({ ...item, barcode: item.primaryBarcode }),
            label: productSearchOptionLabel({ ...item, barcode: item.primaryBarcode }),
            description: `Остаток ${formatNumber(item.currentQuantity)} шт · ${item.article ?? item.internalSku}`,
            data: {
                skuId: item.skuId,
                name: item.name,
                internalSku: item.internalSku,
                clientSku: item.clientSku,
                article: item.article,
                color: item.color,
                size: item.size,
                barcode: item.primaryBarcode,
                boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
            },
        })),
        ...products.map((product) => ({
            value: productSearchOptionLabel(product),
            label: productSearchOptionLabel(product),
            description: `${product.name} · остаток ${formatNumber(product.quantity)} шт`,
            data: {
                skuId: product.skuId,
                name: product.name,
                internalSku: product.internalSku,
                clientSku: product.clientSku,
                article: product.article,
                color: product.color,
                size: product.size,
                barcode: product.barcode,
                boxCode: product.boxCode,
            },
        })),
    ]);
}
function buildBarcodeOptions(items, barcodes) {
    return uniqueOptions([
        ...items.flatMap((item) => item.barcodes.map((barcode) => ({
            value: barcode,
            label: barcode,
            description: `${item.name} · остаток ${formatNumber(item.currentQuantity)} шт`,
            data: {
                clientId: item.client.id,
                clientName: item.client.name,
                skuId: item.skuId,
                name: item.name,
                internalSku: item.internalSku,
                clientSku: item.clientSku,
                article: item.article,
                barcode,
                boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
            },
        }))),
        ...barcodes.map((barcode) => ({
            value: barcode.value,
            label: barcode.value,
            description: `${barcode.client.name} · ${barcode.name} · ${barcode.internalSku}`,
            data: {
                clientId: barcode.client.id,
                clientName: barcode.client.name,
                skuId: barcode.skuId,
                name: barcode.name,
                internalSku: barcode.internalSku,
                clientSku: barcode.clientSku,
                article: barcode.article,
                barcode: barcode.value,
            },
        })),
    ], (option) => `${option.value}:${optionDataString(option, 'clientId')}:${optionDataString(option, 'skuId')}`);
}
function buildKizOptions(items, kiz) {
    return uniqueOptions([
        ...items.flatMap((item) => item.kiz.map((mark) => ({
            value: mark.value,
            label: mark.value,
            description: `${item.name} · ${mark.status}`,
            data: {
                skuId: item.skuId,
                name: item.name,
                internalSku: item.internalSku,
                clientSku: item.clientSku,
                article: item.article,
                barcode: item.primaryBarcode,
                boxCode: item.currentCells.find((cell) => cell.quantity > 0)?.boxCode ?? item.firstCell,
            },
        }))),
        ...kiz.map((mark) => ({
            value: mark.value,
            label: mark.value,
            description: [mark.name, mark.boxCode ? `ячейка ${mark.boxCode}` : null, mark.status].filter(Boolean).join(' · '),
            data: {
                skuId: mark.skuId,
                name: mark.name,
                internalSku: mark.internalSku,
                article: mark.article,
                barcode: mark.barcode,
                boxCode: mark.boxCode,
            },
        })),
    ]);
}
function buildCellOptions(cells, boxes) {
    return uniqueOptions([
        ...cells.map((cell) => ({
            value: cell.boxCode,
            label: cell.boxCode,
            description: cell.quantity ? `${formatNumber(cell.quantity)} шт · ${cell.status}` : cell.status || 'ячейка клиента',
        })),
        ...boxes.map((box) => ({
            value: box.code,
            label: box.code,
            description: box.status,
        })),
    ]);
}
function uniqueOptions(options, keyOf = (option) => option.value) {
    const seen = new Set();
    const result = [];
    for (const option of options) {
        const key = keyOf(option);
        if (!option.value || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(option);
    }
    return result;
}
function canUseStatistics(roleCodes, permissionCodes) {
    return permissionCodes.includes('system:admin') || roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}
function canUseTurnoverActions(roleCodes, permissionCodes) {
    if (permissionCodes.includes('system:admin')) {
        return true;
    }
    const hasStaffRole = roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'].includes(role));
    if (!hasStaffRole && roleCodes.includes('CLIENT')) {
        return false;
    }
    return permissionCodes.includes('stock:write') || roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}
function isDocumentMovement(movement) {
    if (movement.type === 'SHIP') {
        return movement.quantity < 0;
    }
    return ['INITIAL_IMPORT', 'RECEIPT', 'RETURN'].includes(movement.type) && movement.quantity > 0;
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function receiptPeriodLabel(dateFrom, dateTo) {
    if (!dateFrom && !dateTo) {
        return 'Весь срок';
    }
    if (dateFrom && dateTo) {
        return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
    }
    return dateFrom ? `с ${formatDate(dateFrom)}` : `по ${formatDate(dateTo)}`;
}
function receiptPeriodFileName(client, dateFrom, dateTo) {
    const clientCode = safeFileName(client?.code || client?.name || 'client');
    const period = safeFileName([dateFrom || 'all', dateTo || dateFrom || 'all'].join('_'));
    return `priemka-${clientCode}-${period}.xlsx`;
}
function stockExportFileName(client, ignoreActiveRequests) {
    const clientCode = safeFileName(client?.code || client?.name || 'client');
    const date = new Date().toISOString().slice(0, 10);
    return `ostatki-koroba-${clientCode}-${date}-${ignoreActiveRequests ? 'full' : 'available'}.xlsx`;
}
function safeFileName(value) {
    return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || 'file';
}
function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function formatNumber(value) {
    return new Intl.NumberFormat('ru-RU').format(value);
}
function formatDate(value) {
    if (!value) {
        return 'нет';
    }
    return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}
function formatDateTime(value) {
    if (!value) {
        return 'нет';
    }
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function stockStatusLabel(status) {
    const labels = {
        AVAILABLE: 'Доступно',
        IN_TRANSIT: 'В пути между филиалами',
        RECEIVING: 'Приемка',
        RESERVED: 'Зарезервировано',
        PACKING: 'В сборке',
        SHIPPING: 'К отгрузке',
        HOLD: 'Отложено',
        DAMAGED: 'Повреждено',
        QUARANTINE: 'Карантин',
    };
    return labels[status] ?? status;
}
function storageZoneLabel(cell) {
    if (!cell.storageZone)
        return 'не указана';
    return cell.storageZone.name && cell.storageZone.name !== cell.storageZone.code
        ? `${cell.storageZone.code} · ${cell.storageZone.name}`
        : cell.storageZone.code;
}
function placementSummary(cell) {
    const palletSort = cell.palletSortCode ?? cell.palletCode ?? 'без палет-сорта';
    return `${storageZoneLabel(cell)} · ${palletSort}`;
}
function buildActionKey(action, skuId) {
    const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
    return `web-turnover:${action}:${skuId}:${suffix}`;
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию товарооборота.';
}
