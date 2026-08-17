import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, FileSpreadsheet, RefreshCw, Search, SendHorizontal, Trash2, X, XCircle, } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { commitBoxTransfersXlsx, downloadBoxTransferBatchFile, fetchBoxTransferBatches, fetchBoxes, fetchClients, fetchStockBalances, previewBoxTransfersXlsx, reverseBoxTransferBatch, transferBetweenBoxes, } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
import { TransferPreview, TransferResult } from './TransferStatusBlocks';
export function BoxTransferForm({ session }) {
    const fileInputRef = useRef(null);
    const [clients, setClients] = useState([]);
    const [balances, setBalances] = useState([]);
    const [boxes, setBoxes] = useState([]);
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [selectedBalanceId, setSelectedBalanceId] = useState('');
    const [toBoxCode, setToBoxCode] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [comment, setComment] = useState('');
    const [loadState, setLoadState] = useState('idle');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    const [importFile, setImportFile] = useState(null);
    const [importPreview, setImportPreview] = useState(null);
    const [isPreviewing, setPreviewing] = useState(false);
    const [isCommitting, setCommitting] = useState(false);
    const [importMessage, setImportMessage] = useState('');
    const [batches, setBatches] = useState([]);
    const [isLoadingBatches, setLoadingBatches] = useState(false);
    const [expandedBatchIds, setExpandedBatchIds] = useState([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeletingBatches, setDeletingBatches] = useState(false);
    const [transferBoxSearch, setTransferBoxSearch] = useState('');
    const selectedBalance = useMemo(() => balances.find((balance) => balance.id === selectedBalanceId) ?? null, [balances, selectedBalanceId]);
    const sourceBalances = balances.filter((balance) => balance.box?.code && balance.quantity > 0);
    const canDeleteBatches = session.user.permissionCodes.includes('system:admin') ||
        session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
    useEffect(() => {
        void loadClients();
    }, [session.accessToken]);
    useEffect(() => {
        if (selectedClientId) {
            void loadOperationalData(selectedClientId);
            void loadTransferBatches(selectedClientId);
        }
    }, [selectedClientId]);
    async function loadClients() {
        setLoadState('loading');
        setError('');
        try {
            const list = await fetchClients(session.accessToken);
            setClients(list);
            setSelectedClientId((current) => validRememberedClientId(current, list));
            if (list.length === 0) {
                setLoadState('ready');
            }
        }
        catch (caught) {
            setLoadState('error');
            setError(errorMessage(caught));
        }
    }
    async function loadOperationalData(clientId = selectedClientId) {
        if (!clientId) {
            return;
        }
        setLoadState('loading');
        setError('');
        setResult(null);
        try {
            const [nextBalances, nextBoxes] = await Promise.all([
                fetchStockBalances(session.accessToken, { clientId }),
                fetchBoxes(session.accessToken, { clientId }),
            ]);
            setBalances(nextBalances);
            setBoxes(nextBoxes);
            setSelectedBalanceId((current) => keepSelectedBalance(current, nextBalances));
            setLoadState('ready');
        }
        catch (caught) {
            setLoadState('error');
            setError(errorMessage(caught));
        }
    }
    async function loadTransferBatches(clientId = selectedClientId) {
        if (!clientId) {
            setBatches([]);
            return;
        }
        setLoadingBatches(true);
        try {
            const nextBatches = await fetchBoxTransferBatches(session.accessToken, clientId);
            setBatches(nextBatches);
            setSelectedBatchIds((current) => current.filter((id) => nextBatches.some((batch) => batch.id === id && batch.status !== 'REVERSED')));
            setExpandedBatchIds((current) => current.filter((id) => nextBatches.some((batch) => batch.id === id)));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoadingBatches(false);
        }
    }
    function changeClient(clientId) {
        setSelectedClientId(clientId);
        setSelectedBalanceId('');
        setToBoxCode('');
        setQuantity('1');
        setComment('');
        setResult(null);
        setImportFile(null);
        setImportPreview(null);
        setImportMessage('');
        setBatches([]);
        setSelectedBatchIds([]);
        setExpandedBatchIds([]);
        setTransferBoxSearch('');
    }
    function changeBalance(balanceId) {
        const balance = balances.find((item) => item.id === balanceId);
        setSelectedBalanceId(balanceId);
        setQuantity(balance ? String(Math.min(balance.quantity, Number(quantity) || 1)) : '1');
        setResult(null);
    }
    async function submitTransfer() {
        if (!selectedBalance?.box?.code || !selectedClientId) {
            return;
        }
        setSubmitting(true);
        setError('');
        setResult(null);
        try {
            const parsedQuantity = Number(quantity);
            const transfer = await transferBetweenBoxes(session.accessToken, {
                clientId: selectedClientId,
                skuId: selectedBalance.skuId,
                fromBoxCode: selectedBalance.box.code,
                toBoxCode: toBoxCode.trim(),
                quantity: parsedQuantity,
                status: selectedBalance.status,
                idempotencyKey: buildIdempotencyKey(selectedBalance.id),
                comment: comment.trim() || undefined,
            });
            setResult(transfer);
            await loadOperationalData(selectedClientId);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSubmitting(false);
        }
    }
    async function previewTransfers(file) {
        if (!file || !selectedClientId) {
            return;
        }
        setPreviewing(true);
        setImportFile(file);
        setImportPreview(null);
        setImportMessage('');
        setError('');
        setResult(null);
        try {
            const preview = await previewBoxTransfersXlsx(session.accessToken, selectedClientId, file);
            setImportPreview(preview);
            setImportMessage(`Проверено ${preview.summary.rows} строк: можно выполнить ${preview.summary.readyRows}, с ошибками ${preview.summary.errorRows}.`);
        }
        catch (caught) {
            setImportFile(null);
            setError(errorMessage(caught));
        }
        finally {
            setPreviewing(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }
    async function commitTransfers() {
        if (!importFile || !selectedClientId || !importPreview?.summary.readyRows) {
            return;
        }
        setCommitting(true);
        setError('');
        try {
            const response = await commitBoxTransfersXlsx(session.accessToken, selectedClientId, importFile);
            setImportPreview(response.preview);
            setImportFile(null);
            setImportMessage(`Файл применен: строк ${response.rows}, перемещено ${response.quantity} шт.` +
                (response.preview.summary.errorRows ? ` Не выполнено строк: ${response.preview.summary.errorRows}.` : ''));
            await Promise.all([loadOperationalData(selectedClientId), loadTransferBatches(selectedClientId)]);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setCommitting(false);
        }
    }
    async function downloadBatch(batch) {
        setError('');
        try {
            const blob = await downloadBoxTransferBatchFile(session.accessToken, batch.id);
            downloadBlob(blob, batch.fileName);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function deleteSelectedBatches() {
        if (!selectedBatchIds.length) {
            return;
        }
        setDeletingBatches(true);
        setError('');
        const errors = [];
        for (const batchId of selectedBatchIds) {
            try {
                await reverseBoxTransferBatch(session.accessToken, batchId);
            }
            catch (caught) {
                const batch = batches.find((item) => item.id === batchId);
                errors.push(`${batch?.fileName ?? batchId}: ${errorMessage(caught)}`);
            }
        }
        setShowDeleteConfirm(false);
        setSelectedBatchIds([]);
        await Promise.all([loadOperationalData(selectedClientId), loadTransferBatches(selectedClientId)]);
        setDeletingBatches(false);
        setImportMessage(errors.length
            ? `Удалены не все файлы: ${errors.slice(0, 3).join('; ')}`
            : 'Выбранные перемещения отменены, остатки возвращены в исходные короба.');
    }
    const parsedQuantity = Number(quantity);
    const hasValidQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0 && (!selectedBalance || parsedQuantity <= selectedBalance.quantity);
    const canSubmit = Boolean(selectedBalance?.box?.code && toBoxCode.trim()) && hasValidQuantity && loadState !== 'loading' && !isSubmitting;
    return (_jsxs("div", { className: "box-transfer", children: [_jsxs("div", { className: "warehouse-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => changeClient(event.target.value), children: [clients.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsxs("select", { value: selectedBalanceId, onChange: (event) => changeBalance(event.target.value), children: [sourceBalances.length === 0 ? _jsx("option", { value: "", children: "\u041E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u0432 \u043A\u043E\u0440\u043E\u0431\u0430\u0445 \u043D\u0435\u0442" }) : null, sourceBalances.map((balance) => (_jsxs("option", { value: balance.id, children: [balance.box?.code, " - ", balance.sku.internalSku, " - ", balance.quantity, " \u0448\u0442."] }, balance.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043B\u0435\u0432\u043E\u0439 \u043A\u043E\u0440\u043E\u0431" }), _jsx("input", { list: "warehouse-boxes", placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 FFL_BOX_002", value: toBoxCode, onChange: (event) => setToBoxCode(event.target.value) }), _jsx("datalist", { id: "warehouse-boxes", children: boxes.map((box) => (_jsx("option", { value: box.code }, box.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { min: "1", max: selectedBalance?.quantity ?? undefined, type: "number", value: quantity, onChange: (event) => setQuantity(event.target.value) })] })] }), _jsxs("label", { className: "warehouse-comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value) })] }), selectedBalance ? _jsx(TransferPreview, { balance: selectedBalance, toBoxCode: toBoxCode }) : null, _jsxs("div", { className: "warehouse-import-strip", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0438\u0437 Excel" }), _jsx("span", { children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0444\u0430\u0439\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442\u0441\u044F. \u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0445 \u0441\u0442\u0440\u043E\u043A." })] }), _jsx("input", { ref: fileInputRef, accept: ".xlsx,.xls", hidden: true, type: "file", onChange: (event) => void previewTransfers(event.target.files?.[0] ?? null) }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => fileInputRef.current?.click(), disabled: !selectedClientId || isPreviewing || isCommitting, children: [_jsx(FileSpreadsheet, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isPreviewing ? 'Проверяю Excel' : 'Выбрать и проверить' })] })] }), importPreview ? (_jsx(TransferImportPreviewPanel, { preview: importPreview, canCommit: Boolean(importFile && importPreview.summary.readyRows > 0), isCommitting: isCommitting, onCommit: () => void commitTransfers() })) : null, importMessage ? _jsx("p", { className: "warehouse-inline", children: importMessage }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, loadState === 'loading' ? _jsx("p", { className: "warehouse-inline", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435." }) : null, _jsxs("div", { className: "warehouse-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: () => void submitTransfer(), disabled: !canSubmit, children: [_jsx(SendHorizontal, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Перенос' : 'Перенести вручную' })] }), _jsxs("button", { className: "primary-button warehouse-secondary", type: "button", onClick: () => void Promise.all([loadOperationalData(), loadTransferBatches()]), disabled: !selectedClientId || loadState === 'loading' || isLoadingBatches, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), result ? _jsx(TransferResult, { result: result }) : null, _jsx(TransferBatchHistory, { batches: batches, boxSearch: transferBoxSearch, canDelete: canDeleteBatches, expandedIds: expandedBatchIds, isLoading: isLoadingBatches, selectedIds: selectedBatchIds, onDelete: () => setShowDeleteConfirm(true), onDownload: (batch) => void downloadBatch(batch), onRefresh: () => void loadTransferBatches(), onToggleExpanded: (id) => setExpandedBatchIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]), onToggleSelected: (id) => setSelectedBatchIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]), onToggleAll: (ids) => setSelectedBatchIds(ids), onBoxSearchChange: setTransferBoxSearch }), showDeleteConfirm ? (_jsx(ConfirmDialog, { title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F?", message: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442 \u043E\u0431\u0440\u0430\u0442\u043D\u044B\u0435 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0438 \u0432\u0435\u0440\u043D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440 \u0432 \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430. \u0415\u0441\u043B\u0438 \u0442\u043E\u0432\u0430\u0440 \u0443\u0436\u0435 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D \u0434\u0430\u043B\u044C\u0448\u0435 \u0438\u043B\u0438 \u0441\u043F\u0438\u0441\u0430\u043D, \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E.", details: selectedBatchIds.map((id) => batches.find((batch) => batch.id === id)?.fileName ?? id), confirmLabel: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438", isBusy: isDeletingBatches, onCancel: () => setShowDeleteConfirm(false), onConfirm: () => void deleteSelectedBatches() })) : null] }));
}
function TransferImportPreviewPanel({ canCommit, isCommitting, onCommit, preview, }) {
    return (_jsxs("section", { className: "transfer-file-preview", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0444\u0430\u0439\u043B\u0430 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439", children: [_jsxs("header", { className: "transfer-file-preview__header", children: [_jsxs("div", { children: [_jsx("strong", { children: preview.fileName }), _jsxs("span", { children: ["\u0421\u0442\u0440\u043E\u043A: ", preview.summary.rows, " \u00B7 \u043C\u043E\u0436\u043D\u043E: ", preview.summary.readyRows, " \u00B7 \u043E\u0448\u0438\u0431\u043A\u0438: ", preview.summary.errorRows, " \u00B7 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E:", ' ', preview.summary.quantity] })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onCommit, disabled: !canCommit || isCommitting, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isCommitting ? 'Выполняю' : `Выполнить ${preview.summary.readyRows} строк` })] })] }), _jsx(TransferRowsTable, { rows: preview.rows })] }));
}
function TransferBatchHistory({ batches, boxSearch, canDelete, expandedIds, isLoading, onDelete, onDownload, onRefresh, onBoxSearchChange, onToggleAll, onToggleExpanded, onToggleSelected, selectedIds, }) {
    const normalizedBoxSearch = normalizeBoxSearch(boxSearch);
    const visibleBatches = normalizedBoxSearch
        ? batches.filter((batch) => batch.rows.some((row) => transferRowMatchesBox(row, normalizedBoxSearch)))
        : batches;
    const deletableIds = visibleBatches.filter((batch) => batch.status !== 'REVERSED').map((batch) => batch.id);
    const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selectedIds.includes(id));
    return (_jsxs("section", { className: "transfer-history", "aria-label": "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0444\u0430\u0439\u043B\u043E\u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439", children: [_jsxs("header", { className: "transfer-history__header", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0424\u0430\u0439\u043B\u044B \u0438 \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439" }), _jsx("span", { children: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0435 Excel, \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438, \u043E\u0448\u0438\u0431\u043A\u0438 \u0438 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043D\u044B\u0435 \u043F\u0430\u043A\u0435\u0442\u044B \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] }), _jsxs("div", { className: "transfer-history__actions", children: [_jsxs("button", { className: "secondary-button", type: "button", onClick: onRefresh, disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить историю' })] }), canDelete ? (_jsxs("button", { className: "danger-button", type: "button", onClick: onDelete, disabled: !selectedIds.length, children: [_jsx(Trash2, { size: 16, "aria-hidden": "true" }), _jsxs("span", { children: ["\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 (", selectedIds.length, ")"] })] })) : null] })] }), _jsxs("label", { className: "transfer-history__search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: boxSearch, onChange: (event) => onBoxSearchChange(event.target.value), placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0438\u043B\u0438 \u0446\u0435\u043B\u0435\u0432\u043E\u0439 \u043A\u043E\u0440\u043E\u0431 \u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u0445", "aria-label": "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430 \u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u0445" }), boxSearch ? (_jsx("button", { type: "button", onClick: () => onBoxSearchChange(''), title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439", children: _jsx(X, { size: 15, "aria-hidden": "true" }) })) : null, normalizedBoxSearch ? _jsxs("span", { children: ["\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432: ", visibleBatches.length] }) : null] }), batches.length === 0 ? (_jsx("p", { className: "warehouse-inline", children: "\u0414\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0435\u0449\u0435 \u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439." })) : visibleBatches.length === 0 ? (_jsx("p", { className: "warehouse-inline", children: "\u041F\u043E \u044D\u0442\u043E\u043C\u0443 \u043D\u043E\u043C\u0435\u0440\u0443 \u043A\u043E\u0440\u043E\u0431\u0430 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." })) : (_jsx("div", { className: "transfer-history__table-wrap", children: _jsxs("table", { className: "transfer-history__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: canDelete ? (_jsx("input", { "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439", type: "checkbox", checked: allSelected, onChange: () => onToggleAll(allSelected ? [] : deletableIds) })) : null }), _jsx("th", { children: "\u0424\u0430\u0439\u043B" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u041E\u043F\u0435\u0440\u0430\u0442\u043E\u0440" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0421\u0442\u0440\u043E\u043A\u0438" }), _jsx("th", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("th", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" })] }) }), _jsx("tbody", { children: visibleBatches.map((batch) => {
                                const expanded = normalizedBoxSearch ? true : expandedIds.includes(batch.id);
                                const visibleRows = normalizedBoxSearch
                                    ? batch.rows.filter((row) => transferRowMatchesBox(row, normalizedBoxSearch))
                                    : batch.rows;
                                return (_jsxs(Fragment, { children: [_jsxs("tr", { className: batch.status === 'REVERSED' ? 'transfer-history__row--reversed' : undefined, children: [_jsx("td", { children: canDelete ? (_jsx("input", { "aria-label": `Выбрать ${batch.fileName}`, type: "checkbox", checked: selectedIds.includes(batch.id), disabled: batch.status === 'REVERSED', onChange: () => onToggleSelected(batch.id) })) : null }), _jsxs("td", { children: [_jsxs("button", { className: "transfer-history__file", type: "button", onClick: () => onToggleExpanded(batch.id), children: [_jsx(FileSpreadsheet, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: batch.fileName })] }), _jsx("small", { children: formatFileSize(batch.sizeBytes) })] }), _jsx("td", { children: formatDateTime(batch.createdAt) }), _jsx("td", { children: batch.uploadedByName || '-' }), _jsx("td", { children: _jsx("span", { className: `transfer-batch-status transfer-batch-status--${batch.status.toLowerCase()}`, children: batchStatusLabel(batch.status) }) }), _jsxs("td", { children: [batch.appliedRowCount, " / ", batch.rowCount, batch.rejectedRowCount ? ` · ошибок ${batch.rejectedRowCount}` : ''] }), _jsxs("td", { children: [batch.quantity, " \u0448\u0442."] }), _jsx("td", { children: _jsxs("div", { className: "transfer-history__row-actions", children: [_jsx("button", { className: "icon-button", type: "button", onClick: () => onDownload(batch), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 Excel", children: _jsx(Download, { size: 16, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button", type: "button", onClick: () => onToggleExpanded(batch.id), title: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438", children: expanded ? _jsx(ChevronUp, { size: 16, "aria-hidden": "true" }) : _jsx(ChevronDown, { size: 16, "aria-hidden": "true" }) })] }) })] }), expanded ? (_jsx("tr", { className: "transfer-history__details-row", children: _jsxs("td", { colSpan: 8, children: [batch.status === 'REVERSED' ? (_jsxs("p", { className: "transfer-history__reversed-note", children: ["\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u044B ", batch.reversedAt ? formatDateTime(batch.reversedAt) : '', batch.reversedByName ? `, оператор: ${batch.reversedByName}` : '', "."] })) : null, _jsx(TransferRowsTable, { rows: visibleRows })] }) })) : null] }, batch.id));
                            }) })] }) }))] }));
}
function normalizeBoxSearch(value) {
    return value.trim().toLocaleUpperCase('ru-RU');
}
function transferRowMatchesBox(row, normalizedSearch) {
    return [row.fromBoxCode, row.toBoxCode].some((code) => code.trim().toLocaleUpperCase('ru-RU').includes(normalizedSearch));
}
function TransferRowsTable({ rows }) {
    return (_jsx("div", { className: "transfer-rows-table-wrap", children: _jsxs("table", { className: "transfer-rows-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0421\u0442\u0440\u043E\u043A\u0430" }), _jsx("th", { children: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442" }), _jsx("th", { children: "\u041E\u0442\u043A\u0443\u0434\u0430" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u0443\u0434\u0430" }), _jsx("th", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("th", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E" }), _jsx("th", { children: "\u041F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: rows.map((row) => {
                        const successful = row.status === 'READY' || row.status === 'APPLIED';
                        return (_jsxs("tr", { className: successful ? 'transfer-row--ready' : 'transfer-row--error', children: [_jsx("td", { children: row.rowNumber }), _jsx("td", { children: _jsxs("span", { className: `transfer-row-status ${successful ? 'transfer-row-status--ready' : 'transfer-row-status--error'}`, children: [successful ? _jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }) : _jsx(XCircle, { size: 14, "aria-hidden": "true" }), transferRowStatusLabel(row.status)] }) }), _jsx("td", { children: row.fromBoxCode || '-' }), _jsxs("td", { children: [_jsx("strong", { children: row.skuName || row.internalSku || row.barcode || '-' }), _jsx("span", { children: row.barcode || '-' })] }), _jsx("td", { children: row.toBoxCode || '-' }), _jsx("td", { children: row.quantity || '-' }), _jsx("td", { children: row.availableQuantity }), _jsx("td", { children: _jsxs("span", { className: "transfer-row-message", children: [!successful ? _jsx(AlertTriangle, { size: 14, "aria-hidden": "true" }) : null, row.message] }) })] }, `${row.rowNumber}:${row.fromBoxCode}:${row.barcode}`));
                    }) })] }) }));
}
function keepSelectedBalance(current, balances) {
    if (balances.some((balance) => balance.id === current && balance.quantity > 0)) {
        return current;
    }
    return balances.find((balance) => balance.box?.code && balance.quantity > 0)?.id ?? '';
}
function buildIdempotencyKey(balanceId) {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
    return `web-transfer:${balanceId}:${random}`;
}
function transferRowStatusLabel(status) {
    if (status === 'READY')
        return 'Можно';
    if (status === 'APPLIED')
        return 'Выполнено';
    if (status === 'REJECTED')
        return 'Не выполнено';
    return 'Ошибка';
}
function batchStatusLabel(status) {
    if (status === 'APPLIED')
        return 'Выполнен';
    if (status === 'APPLIED_WITH_ERRORS')
        return 'Выполнен частично';
    if (status === 'REVERSED')
        return 'Отменен';
    return status;
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}
function formatFileSize(sizeBytes) {
    if (sizeBytes < 1024)
        return `${sizeBytes} Б`;
    if (sizeBytes < 1024 * 1024)
        return `${Math.round(sizeBytes / 1024)} КБ`;
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} МБ`;
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить складскую операцию.';
}
