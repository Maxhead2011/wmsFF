import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, Archive, ArrowLeft, ArrowRightLeft, Boxes, CheckCircle2, ClipboardList, FileDown, FileUp, RefreshCw, RotateCcw, Search, ShieldAlert, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cancelClientRequest, checkFbsRequestSupplyConsistency, downloadClientRequestFile, downloadClientRequestItemsXlsx, downloadClientRequestFbsBoxSearchXlsx, downloadClientRequestWbPackagesXlsx, downloadClientRequestWbProductsXlsx, downloadFbsRequestPickListPdf, downloadPickInstructionXlsx, downloadTsdMovementsXlsx, downloadTsdOutgoingBoxesXlsx, downloadTsdOutgoingContentsXlsx, emergencyCloseClientRequestFromXlsx, enableFbsEmergencyAssembly, fetchClientRequestManualBoxSelection, fetchClientRequestFbsBoxSearch, fetchClientRequestDocument, fetchClientRequestBoxOverlaps, fetchClientRequests, fetchClients, fetchFbsOrders, fetchFbsMoveTargets, fetchPickInstruction, fetchPendingPickWaveBalanceReviews, fetchTsdAssemblyPlan, mergeFbsRequestTails, markTsdFbsAssemblyPackedWithoutSource, moveFbsOrdersToNewSupply, previewFbsRequestTails, packageClientRequest, pickClientRequest, refreshPickInstruction as refreshPickInstructionDocument, repairFbsRequestSelection as repairFbsRequestSelectionRequest, repairFbsRequestSupplyConsistency, resolveTsdFbsKizConflict, resolveTsdFbsSyncConflict, resetTsdFbsAssemblyOrder, resolveFbsSynchronization, restoreTsdFbsRescanFromWildberries, rollbackEmergencyCloseClientRequest, saveClientRequestManualBoxSelection, shipClientRequest, syncClientRequestToTsd, updateClientRequestStatus, uploadManualPickInstruction, } from '../../lib/api';
import { ClientRequestCreateForm } from './ClientRequestCreateForm';
import { ClientRequestDocumentPreview } from './ClientRequestDocumentPreview';
import { ClientRequestEditModal } from './ClientRequestEditModal';
import { ClientRequestXlsxImportForm } from './ClientRequestXlsxImportForm';
import './client-requests.css';
import { ClientRequestsTable } from './ClientRequestsTable';
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';
import { requestStatusLabel } from './clientRequestMeta';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PickWaveBalanceReviewPanel } from './PickWaveBalanceReviewPanel';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ClientRequestsPanel({ session, onOpenFbsOrders }) {
    const canRead = canUse(session.user, 'client-requests:read');
    const canWrite = canUse(session.user, 'client-requests:write');
    const canChangeStatus = canUse(session.user, 'client-requests:status');
    const canPickOutbound = canUse(session.user, 'stock:write');
    const canEditAnyRequest = canEditRequestAnyStatus(session.user);
    const canUploadManualInstruction = canUploadOwnInstruction(session.user);
    const canDownloadOriginalRequest = canAdministerRequestFiles(session.user);
    const canViewBoxOverlaps = canAdministerRequestFiles(session.user);
    const [requests, setRequests] = useState({ status: 'idle', data: [] });
    const [clients, setClients] = useState({ status: 'idle', data: [] });
    const [balanceReviews, setBalanceReviews] = useState({ status: 'idle', data: [] });
    const [boxOverlaps, setBoxOverlaps] = useState({ status: 'idle', data: null });
    const [error, setError] = useState(null);
    const [actionMessage, setActionMessage] = useState(null);
    const [documentPreview, setDocumentPreview] = useState(null);
    const [pickInstructionPreview, setPickInstructionPreview] = useState(null);
    const [refreshingInstructionId, setRefreshingInstructionId] = useState(null);
    const [syncingTsdRequestId, setSyncingTsdRequestId] = useState(null);
    const [checkingSupplyRequestId, setCheckingSupplyRequestId] = useState(null);
    const [fbsSupplyConsistency, setFbsSupplyConsistency] = useState(null);
    const [editingRequest, setEditingRequest] = useState(null);
    const [onlinePreview, setOnlinePreview] = useState(null);
    const [onlineFbsMove, setOnlineFbsMove] = useState({ orderId: null });
    const [onlineFbsMoveChoice, setOnlineFbsMoveChoice] = useState(null);
    const [onlineKizResolution, setOnlineKizResolution] = useState({ assemblyId: null });
    const [onlineFbsSyncResolution, setOnlineFbsSyncResolution] = useState({ assemblyId: null });
    const [emergencyUpload, setEmergencyUpload] = useState(null);
    const [emergencyRollback, setEmergencyRollback] = useState(null);
    const [isRollingBackEmergency, setRollingBackEmergency] = useState(false);
    const [manualInstructionUpload, setManualInstructionUpload] = useState(null);
    const [manualClose, setManualClose] = useState(null);
    const [manualBoxSelection, setManualBoxSelection] = useState(null);
    const [closeStockRecovery, setCloseStockRecovery] = useState(null);
    const [fbsBoxSearch, setFbsBoxSearch] = useState(null);
    const [showArchive, setShowArchive] = useState(false);
    const [archiveBoxSearch, setArchiveBoxSearch] = useState('');
    const [appliedArchiveBoxSearch, setAppliedArchiveBoxSearch] = useState('');
    const [fbsTailClientId, setFbsTailClientId] = useRememberedClientId(session.user.id);
    const [selectedFbsTailRequestIds, setSelectedFbsTailRequestIds] = useState(() => new Set());
    const [isPreviewingFbsTails, setPreviewingFbsTails] = useState(false);
    const [fbsTailMergePreview, setFbsTailMergePreview] = useState(null);
    const [isMergingFbsTails, setMergingFbsTails] = useState(false);
    const [fbsSynchronizationAudit, setFbsSynchronizationAudit] = useState(null);
    const [isRunningFbsSynchronizationAudit, setRunningFbsSynchronizationAudit] = useState(false);
    const [resolvingFbsSynchronizationRequestId, setResolvingFbsSynchronizationRequestId] = useState(null);
    const visibleClients = useMemo(() => clients.data, [clients.data]);
    const displayedRequests = useMemo(() => ({
        ...requests,
        data: requests.data.filter((request) => {
            const isArchived = request.status === 'DONE' || request.status === 'CANCELLED';
            return showArchive ? isArchived : !isArchived;
        }),
    }), [requests, showArchive]);
    const fbsTailEligibleRequests = useMemo(() => displayedRequests.data.filter((request) => canMergeFbsRequestTail(request)), [displayedRequests.data]);
    const fbsTailClients = useMemo(() => [
        ...new Map(fbsTailEligibleRequests.map((request) => [
            request.clientId,
            request.client,
        ])).values(),
    ], [fbsTailEligibleRequests]);
    const selectableFbsTailRequestIds = useMemo(() => new Set(fbsTailEligibleRequests
        .filter((request) => request.clientId === fbsTailClientId)
        .map((request) => request.id)), [fbsTailClientId, fbsTailEligibleRequests]);
    const selectedFbsTailRequests = useMemo(() => fbsTailEligibleRequests.filter((request) => selectedFbsTailRequestIds.has(request.id)), [fbsTailEligibleRequests, selectedFbsTailRequestIds]);
    const fbsAuditClientIds = useMemo(() => [...new Set(requests.data
            .filter((request) => (request._count?.fbsOrderLinks ?? 0) > 0)
            .map((request) => request.clientId))], [requests.data]);
    useEffect(() => {
        setFbsTailClientId((current) => {
            if (fbsTailClients.some((client) => client.id === current)) {
                return current;
            }
            return fbsTailClients.length === 1 ? fbsTailClients[0].id : '';
        });
    }, [fbsTailClients]);
    useEffect(() => {
        setSelectedFbsTailRequestIds((current) => {
            const next = new Set([...current].filter((requestId) => selectableFbsTailRequestIds.has(requestId)));
            return next.size === current.size ? current : next;
        });
    }, [selectableFbsTailRequestIds]);
    useEffect(() => {
        if (canRead) {
            void loadData();
        }
    }, [canRead, showArchive, appliedArchiveBoxSearch]);
    useEffect(() => {
        const requestId = onlinePreview?.request.id;
        if (!requestId) {
            return;
        }
        let cancelled = false;
        let refreshInProgress = false;
        const refresh = async () => {
            if (cancelled ||
                refreshInProgress ||
                document.visibilityState !== 'visible') {
                return;
            }
            refreshInProgress = true;
            try {
                const plan = await fetchTsdAssemblyPlan(session.accessToken, requestId);
                if (!cancelled) {
                    setOnlinePreview((current) => current?.request.id === requestId ? { ...current, plan, status: 'ready', error: undefined } : current);
                }
            }
            catch (caught) {
                if (!cancelled) {
                    setOnlinePreview((current) => current?.request.id === requestId ? { ...current, status: 'error', error: errorMessage(caught) } : current);
                }
            }
            finally {
                refreshInProgress = false;
            }
        };
        const timer = window.setInterval(() => {
            void refresh();
        }, 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [onlinePreview?.request.id, session.accessToken]);
    if (!canRead) {
        return null;
    }
    async function loadData() {
        setError(null);
        setRequests((current) => ({ ...current, status: 'loading', error: undefined }));
        setClients((current) => ({ ...current, status: 'loading', error: undefined }));
        setBalanceReviews((current) => ({ ...current, status: 'loading', error: undefined }));
        if (canViewBoxOverlaps) {
            setBoxOverlaps((current) => ({ ...current, status: 'loading', error: undefined }));
            void fetchClientRequestBoxOverlaps(session.accessToken)
                .then((data) => setBoxOverlaps({ status: 'ready', data }))
                .catch((caught) => setBoxOverlaps((current) => ({
                ...current,
                status: 'error',
                error: errorMessage(caught),
            })));
        }
        try {
            const [nextRequests, nextClients, nextBalanceReviews] = await Promise.all([
                fetchClientRequests(session.accessToken, {
                    archive: showArchive || undefined,
                    boxCode: showArchive ? appliedArchiveBoxSearch || undefined : undefined,
                }),
                fetchClients(session.accessToken),
                fetchPendingPickWaveBalanceReviews(session.accessToken),
            ]);
            setRequests({ status: 'ready', data: nextRequests });
            setClients({ status: 'ready', data: nextClients });
            setBalanceReviews({ status: 'ready', data: nextBalanceReviews });
        }
        catch (caught) {
            const message = errorMessage(caught);
            setRequests((current) => ({ ...current, status: 'error', error: message }));
            setClients((current) => ({ ...current, status: 'error', error: message }));
            setBalanceReviews((current) => ({ ...current, status: 'error', error: message }));
        }
    }
    async function runFbsSynchronizationAudit() {
        if (isRunningFbsSynchronizationAudit)
            return;
        setRunningFbsSynchronizationAudit(true);
        setError(null);
        setActionMessage(null);
        try {
            const results = await Promise.allSettled(fbsAuditClientIds.map((clientId) => fetchFbsOrders(session.accessToken, clientId, true)));
            const responses = [];
            const failures = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    responses.push(result.value);
                }
                else {
                    const client = visibleClients.find((item) => item.id === fbsAuditClientIds[index]);
                    failures.push(`${client?.name ?? 'Клиент'}: ${errorMessage(result.reason)}`);
                }
            });
            setFbsSynchronizationAudit(buildFbsSynchronizationAudit(responses, failures));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setRunningFbsSynchronizationAudit(false);
        }
    }
    async function resolveFbsSynchronizationIssue(issue, action) {
        if (resolvingFbsSynchronizationRequestId)
            return;
        const actionLabel = action === 'CONFIRM_DELIVERED' ? 'подтвердить сдачу' : 'вернуть в работу';
        const confirmation = window.prompt(`Для действия «${actionLabel}» введите номер заявки ${issue.requestNumber}. Остатки повторно не изменятся.`, '');
        if (confirmation?.trim() !== String(issue.requestNumber)) {
            setActionMessage('Действие отменено: номер заявки не подтверждён.');
            return;
        }
        setResolvingFbsSynchronizationRequestId(issue.requestId);
        setError(null);
        try {
            const result = await resolveFbsSynchronization(session.accessToken, issue.requestId, action, issue.requestNumber);
            setRequests((current) => ({
                ...current,
                data: current.data.map((request) => request.id === result.request.id ? result.request : request),
            }));
            setActionMessage(result.message);
            await runFbsSynchronizationAudit();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setResolvingFbsSynchronizationRequestId(null);
        }
    }
    async function changeStatus(requestId, status) {
        setError(null);
        const request = requests.data.find((item) => item.id === requestId);
        if (request && isManualStockClosingRequest(request) && status === 'DONE' && request.status !== 'DONE') {
            openManualClose(request);
            return;
        }
        try {
            const updated = await updateClientRequestStatus(session.accessToken, requestId, { status });
            setRequests((current) => ({
                ...current,
                data: current.data.map((request) => (request.id === updated.id ? updated : request)),
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function cancelRequest(request) {
        if (!window.confirm(`Отменить заявку "${request.title}"?`)) {
            return;
        }
        setError(null);
        try {
            const updated = await cancelClientRequest(session.accessToken, request.id);
            setRequests((current) => ({
                ...current,
                data: current.data.map((item) => (item.id === updated.id ? updated : item)),
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function pickOutboundRequest(request) {
        setError(null);
        try {
            await pickClientRequest(session.accessToken, {
                requestId: request.id,
                idempotencyKey: `web-pick:${request.id}`,
                comment: 'Сборка запущена из web-интерфейса.',
            });
            setRequests((current) => ({
                ...current,
                data: current.data.map((item) => (item.id === request.id ? { ...item, status: 'IN_WORK' } : item)),
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function openRequestDocument(request) {
        setError(null);
        try {
            setDocumentPreview(await fetchClientRequestDocument(session.accessToken, request.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function openPickInstruction(request) {
        setError(null);
        try {
            setPickInstructionPreview(await fetchPickInstruction(session.accessToken, request.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function openManualBoxSelection(request) {
        setManualBoxSelection({ request, status: 'loading', data: null });
        setError(null);
        try {
            const data = await fetchClientRequestManualBoxSelection(session.accessToken, request.id);
            setManualBoxSelection({ request, status: 'ready', data });
        }
        catch (caught) {
            setManualBoxSelection({ request, status: 'ready', data: null, error: errorMessage(caught) });
        }
    }
    async function openFbsBoxSearch(request) {
        setFbsBoxSearch({ request, status: 'loading', data: null });
        setError(null);
        try {
            const data = await fetchClientRequestFbsBoxSearch(session.accessToken, request.id);
            setFbsBoxSearch({ request, status: 'ready', data });
        }
        catch (caught) {
            setFbsBoxSearch({ request, status: 'ready', data: null, error: errorMessage(caught) });
        }
    }
    function changeManualBoxQuantity(requestItemId, boxId, rawValue) {
        const parsed = Number.parseInt(rawValue, 10);
        const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        setManualBoxSelection((current) => {
            if (!current?.data || current.status === 'saving')
                return current;
            const items = current.data.items.map((item) => {
                if (item.requestItemId !== requestItemId)
                    return item;
                const boxes = item.boxes.map((box) => box.boxId === boxId
                    ? { ...box, selectedQuantity: Math.min(quantity, box.availableQuantity) }
                    : box);
                return {
                    ...item,
                    boxes,
                    selectedQuantity: boxes.reduce((sum, box) => sum + box.selectedQuantity, 0),
                };
            });
            return {
                ...current,
                error: undefined,
                data: {
                    ...current.data,
                    items,
                    summary: {
                        ...current.data.summary,
                        selectedQuantity: items.reduce((sum, item) => sum + item.selectedQuantity, 0),
                    },
                },
            };
        });
    }
    async function saveManualBoxSelection(clear = false) {
        if (!manualBoxSelection?.data)
            return;
        const data = manualBoxSelection.data;
        const invalidItem = !clear
            ? data.items.find((item) => item.selectedQuantity !== item.requestedQuantity)
            : undefined;
        if (invalidItem) {
            const label = invalidItem.sku?.internalSku ?? invalidItem.requestedBarcode ?? invalidItem.requestedName ?? 'позиции';
            setManualBoxSelection((current) => current
                ? {
                    ...current,
                    error: `Для ${label} нужно выбрать ${invalidItem.requestedQuantity} шт., сейчас выбрано ${invalidItem.selectedQuantity} шт.`,
                }
                : current);
            return;
        }
        const selections = clear
            ? []
            : data.items.flatMap((item) => item.boxes
                .filter((box) => box.selectedQuantity > 0)
                .map((box) => ({
                requestItemId: item.requestItemId,
                boxId: box.boxId,
                quantity: box.selectedQuantity,
            })));
        setManualBoxSelection((current) => (current ? { ...current, status: 'saving', error: undefined } : current));
        try {
            const saved = await saveClientRequestManualBoxSelection(session.accessToken, manualBoxSelection.request.id, selections);
            setManualBoxSelection((current) => current ? { ...current, status: 'ready', data: saved, error: undefined } : current);
            setActionMessage(clear ? 'Выбор коробов очищен.' : 'Короба для списания сохранены. Остатки пока не изменены.');
        }
        catch (caught) {
            setManualBoxSelection((current) => current ? { ...current, status: 'ready', error: errorMessage(caught) } : current);
        }
    }
    async function downloadOriginalRequestFile(request, file) {
        setError(null);
        try {
            const blob = await downloadClientRequestFile(session.accessToken, request.id, file.id);
            downloadBlob(blob, file.fileName);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    function openManualClose(request) {
        const recordedPackages = request.status === 'PACKED' && request.packages.length > 0;
        const boxes = request.packages.filter((item) => !isPalletPackage(item.packageType)).length;
        const pallets = request.packages.filter((item) => isPalletPackage(item.packageType)).length;
        const packageUnits = request.packages.reduce((total, item) => total + item.items.reduce((itemTotal, row) => itemTotal + row.quantity, 0), 0);
        const requestedUnits = request.items.reduce((total, item) => total + item.quantity, 0);
        setManualClose({
            request,
            boxes: recordedPackages ? String(boxes) : '',
            pallets: recordedPackages ? String(pallets) : '0',
            packedUnits: String(packageUnits || requestedUnits),
            comment: request.managerComment?.trim() || 'Заявка сдана вручную; остатки списаны автоматически.',
            usesRecordedPackages: recordedPackages,
            status: 'idle',
        });
    }
    async function submitManualClose(allowOverweightPackages = false) {
        if (!manualClose)
            return;
        const boxes = parseNonNegativeInteger(manualClose.boxes);
        const pallets = parseNonNegativeInteger(manualClose.pallets);
        const packedUnits = parseNonNegativeInteger(manualClose.packedUnits);
        const requestedUnits = manualClose.request.items.reduce((total, item) => total + item.quantity, 0);
        let validationError;
        if (boxes == null || pallets == null || packedUnits == null) {
            validationError = 'Заполните короба, паллеты и количество товара целыми числами.';
        }
        else if (boxes + pallets < 1) {
            validationError = 'Укажите хотя бы один короб или одну паллету.';
        }
        else if (!manualClose.usesRecordedPackages && packedUnits !== requestedUnits) {
            validationError = `В составе заявки ${requestedUnits} шт. Исправьте количество или сначала отредактируйте заявку.`;
        }
        else if (!manualClose.comment.trim()) {
            validationError = 'Укажите комментарий к ручному закрытию.';
        }
        if (validationError) {
            setManualClose((current) => (current ? { ...current, error: validationError } : current));
            return;
        }
        setManualClose((current) => (current ? { ...current, status: 'submitting', error: undefined } : current));
        setError(null);
        try {
            await updateClientRequestStatus(session.accessToken, manualClose.request.id, {
                status: 'DONE',
                managerComment: manualClose.comment.trim() +
                    (allowOverweightPackages
                        ? ' Превышение расчётного веса 25 кг подтверждено менеджером.'
                        : ''),
                boxes: boxes,
                pallets: pallets,
                packedUnits: packedUnits,
                allowOverweightPackages,
            });
            setManualClose(null);
            setActionMessage('Отгрузка закрыта. Остатки списаны, начисления за обработку и черновик счета сформированы.');
            await loadData();
        }
        catch (caught) {
            const message = errorMessage(caught);
            const failedClose = {
                ...manualClose,
                status: 'idle',
                error: message,
            };
            setManualClose(failedClose);
            if (isStockSourceResolutionError(message) && !isOverweightPackageError(message)) {
                await openCloseStockRecovery(failedClose, message);
            }
        }
    }
    async function openCloseStockRecovery(closeOverride, errorOverride) {
        const close = closeOverride ?? manualClose;
        if (!close)
            return;
        const originalError = errorOverride ??
            close.error ??
            'Штатное закрытие заявки не выполнено.';
        setCloseStockRecovery({
            close,
            status: 'loading',
            data: null,
            values: {},
            selectedItemIds: [],
            touchedItemIds: [],
            originalError,
        });
        try {
            const data = await fetchClientRequestManualBoxSelection(session.accessToken, close.request.id);
            const values = Object.fromEntries(data.items.map((item) => [
                item.requestItemId,
                {
                    boxQuantities: Object.fromEntries(item.boxes.map((box) => [
                        box.boxCode,
                        box.selectedQuantity > 0 ? String(box.selectedQuantity) : '',
                    ])),
                    noBoxQuantity: '',
                    manualBoxCode: '',
                    manualBoxQuantity: '',
                },
            ]));
            setCloseStockRecovery({
                close,
                status: 'ready',
                data,
                values,
                selectedItemIds: [],
                touchedItemIds: [],
                originalError,
            });
        }
        catch (caught) {
            setCloseStockRecovery((current) => current
                ? { ...current, status: 'ready', error: errorMessage(caught) }
                : current);
        }
    }
    function changeCloseStockSource(requestItemId, patch) {
        setCloseStockRecovery((current) => {
            if (!current || current.status !== 'ready')
                return current;
            const value = current.values[requestItemId];
            if (!value)
                return current;
            return {
                ...current,
                error: undefined,
                selectedItemIds: current.selectedItemIds.includes(requestItemId)
                    ? current.selectedItemIds
                    : [...current.selectedItemIds, requestItemId],
                touchedItemIds: current.touchedItemIds.includes(requestItemId)
                    ? current.touchedItemIds
                    : [...current.touchedItemIds, requestItemId],
                values: {
                    ...current.values,
                    [requestItemId]: patch(value),
                },
            };
        });
    }
    function chooseCloseStockWithoutBox(requestItemId, requestedQuantity) {
        changeCloseStockSource(requestItemId, (value) => ({
            ...value,
            boxQuantities: Object.fromEntries(Object.keys(value.boxQuantities).map((boxCode) => [boxCode, ''])),
            manualBoxCode: '',
            manualBoxQuantity: '',
            noBoxQuantity: String(requestedQuantity),
        }));
    }
    function selectCloseStockItems(requestItemIds) {
        setCloseStockRecovery((current) => {
            if (!current || current.status !== 'ready')
                return current;
            return {
                ...current,
                error: undefined,
                selectedItemIds: [...new Set(requestItemIds)],
            };
        });
    }
    function toggleCloseStockItem(requestItemId, selected) {
        setCloseStockRecovery((current) => {
            if (!current || current.status !== 'ready')
                return current;
            return {
                ...current,
                error: undefined,
                selectedItemIds: selected
                    ? [...new Set([...current.selectedItemIds, requestItemId])]
                    : current.selectedItemIds.filter((itemId) => itemId !== requestItemId),
            };
        });
    }
    function chooseSelectedCloseStockWithoutBox() {
        setCloseStockRecovery((current) => {
            if (!current || current.status !== 'ready' || !current.data)
                return current;
            if (current.selectedItemIds.length === 0) {
                return { ...current, error: 'Сначала выберите проблемные товары.' };
            }
            const selectedIds = new Set(current.selectedItemIds);
            const nextValues = { ...current.values };
            const touchedItemIds = new Set(current.touchedItemIds);
            for (const item of current.data.items) {
                if (!selectedIds.has(item.requestItemId))
                    continue;
                const value = current.values[item.requestItemId];
                if (!value)
                    continue;
                nextValues[item.requestItemId] = {
                    ...value,
                    boxQuantities: Object.fromEntries(Object.keys(value.boxQuantities).map((boxCode) => [boxCode, ''])),
                    manualBoxCode: '',
                    manualBoxQuantity: '',
                    noBoxQuantity: String(item.requestedQuantity),
                };
                touchedItemIds.add(item.requestItemId);
            }
            return {
                ...current,
                error: undefined,
                values: nextValues,
                touchedItemIds: [...touchedItemIds],
            };
        });
    }
    async function submitCloseStockRecovery() {
        if (!closeStockRecovery?.data || closeStockRecovery.status !== 'ready')
            return;
        if (closeStockRecovery.touchedItemIds.length === 0) {
            setCloseStockRecovery((current) => current
                ? { ...current, error: 'Выберите проблемный товар и укажите его фактический источник.' }
                : current);
            return;
        }
        const unresolvedFbsItems = closeStockRecovery.data.items.filter((item) => item.fbsOrders.some((order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending) &&
            !closeStockRecovery.touchedItemIds.includes(item.requestItemId));
        if (unresolvedFbsItems.length > 0) {
            const orderIds = unresolvedFbsItems.flatMap((item) => item.fbsOrders
                .filter((order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending)
                .map((order) => order.orderId));
            setCloseStockRecovery((current) => current
                ? {
                    ...current,
                    error: `Подтвердите фактический источник для незавершённых FBS-заказов: ` +
                        `№${orderIds.join(', №')}.`,
                }
                : current);
            return;
        }
        const stockSources = [];
        for (const requestItemId of closeStockRecovery.touchedItemIds) {
            const item = closeStockRecovery.data.items.find((candidate) => candidate.requestItemId === requestItemId);
            const value = closeStockRecovery.values[requestItemId];
            if (!item || !value)
                continue;
            const sources = new Map();
            for (const [boxCode, rawQuantity] of Object.entries(value.boxQuantities)) {
                const quantity = parseNonNegativeInteger(rawQuantity || '0') ?? 0;
                if (quantity <= 0)
                    continue;
                sources.set(`BOX:${boxCode.toLocaleUpperCase('ru-RU')}`, { boxCode, quantity });
            }
            const manualBoxCode = value.manualBoxCode.trim();
            const manualQuantity = parseNonNegativeInteger(value.manualBoxQuantity || '0') ?? 0;
            if (manualQuantity > 0) {
                if (!manualBoxCode) {
                    setCloseStockRecovery((current) => current ? { ...current, error: 'Введите номер фактического короба.' } : current);
                    return;
                }
                const key = `BOX:${manualBoxCode.toLocaleUpperCase('ru-RU')}`;
                const existing = sources.get(key);
                sources.set(key, {
                    boxCode: existing?.boxCode ?? manualBoxCode,
                    quantity: (existing?.quantity ?? 0) + manualQuantity,
                });
            }
            const noBoxQuantity = parseNonNegativeInteger(value.noBoxQuantity || '0') ?? 0;
            if (noBoxQuantity > 0) {
                sources.set('NO_BOX', { noBox: true, quantity: noBoxQuantity });
            }
            const confirmedQuantity = [...sources.values()].reduce((sum, source) => sum + source.quantity, 0);
            if (confirmedQuantity !== item.requestedQuantity) {
                const label = item.sku?.name ??
                    item.sku?.internalSku ??
                    item.requestedName ??
                    item.requestedBarcode ??
                    'товара';
                setCloseStockRecovery((current) => current
                    ? {
                        ...current,
                        error: `Для «${label}» укажите источник всех ${item.requestedQuantity} шт. ` +
                            `Сейчас указано ${confirmedQuantity} шт.`,
                    }
                    : current);
                return;
            }
            for (const source of sources.values()) {
                stockSources.push({ requestItemId, ...source });
            }
        }
        const close = closeStockRecovery.close;
        const boxes = parseNonNegativeInteger(close.boxes);
        const pallets = parseNonNegativeInteger(close.pallets);
        const packedUnits = parseNonNegativeInteger(close.packedUnits);
        if (boxes == null || pallets == null || packedUnits == null) {
            setCloseStockRecovery((current) => current ? { ...current, error: 'Параметры закрытия заявки изменились. Откройте закрытие повторно.' } : current);
            return;
        }
        setCloseStockRecovery((current) => current ? { ...current, status: 'submitting', error: undefined } : current);
        try {
            await updateClientRequestStatus(session.accessToken, close.request.id, {
                status: 'DONE',
                managerComment: `${close.comment.trim()} Фактический источник проблемного товара подтверждён менеджером.` +
                    (isOverweightPackageError(closeStockRecovery.originalError)
                        ? ' Превышение расчётного веса 25 кг подтверждено менеджером.'
                        : ''),
                boxes,
                pallets,
                packedUnits,
                stockSources,
                allowOverweightPackages: isOverweightPackageError(closeStockRecovery.originalError),
            });
            setCloseStockRecovery(null);
            setManualClose(null);
            setActionMessage('Заявка закрыта по подтверждённому факту. Источник товара и корректировка остатков записаны в движениях.');
            await loadData();
        }
        catch (caught) {
            setCloseStockRecovery((current) => current
                ? { ...current, status: 'ready', error: errorMessage(caught) }
                : current);
        }
    }
    async function openOnlineExecution(request) {
        setOnlinePreview({ request, plan: null, status: 'loading' });
        setOnlineFbsMove({ orderId: null });
        setOnlineKizResolution({ assemblyId: null });
        setOnlineFbsSyncResolution({ assemblyId: null });
        setError(null);
        try {
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview({ request, plan, status: 'ready' });
        }
        catch (caught) {
            setOnlinePreview({ request, plan: null, status: 'error', error: errorMessage(caught) });
        }
    }
    async function resolveOnlineFbsKiz(request, assemblyId) {
        setOnlineKizResolution({ assemblyId });
        try {
            const result = await resolveTsdFbsKizConflict(session.accessToken, request.id, assemblyId);
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview((current) => current?.request.id === request.id
                ? { ...current, plan, status: 'ready', error: undefined }
                : current);
            setOnlineKizResolution({
                assemblyId: null,
                ...(result.resolved
                    ? { message: result.message }
                    : { error: result.message }),
            });
        }
        catch (caught) {
            setOnlineKizResolution({
                assemblyId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function restoreOnlineFbsRescanFromWb(request, assemblyId) {
        setOnlineKizResolution({ assemblyId });
        try {
            const result = await restoreTsdFbsRescanFromWildberries(session.accessToken, request.id, assemblyId);
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview((current) => current?.request.id === request.id
                ? { ...current, plan, status: 'ready', error: undefined }
                : current);
            setOnlineKizResolution({ assemblyId: null, message: result.message });
            await loadData();
        }
        catch (caught) {
            setOnlineKizResolution({ assemblyId: null, error: errorMessage(caught) });
        }
    }
    async function resolveOnlineFbsSyncConflict(request, assemblyId, action) {
        let comment;
        if (action === 'RETURN_TO_STOCK') {
            const confirmed = window.confirm('Подтвердите, что товар физически возвращён в указанный короб или в хранение без коробов. Резерв FBS и отсканированные данные будут сняты.');
            if (!confirmed)
                return;
        }
        else {
            const managerComment = window.prompt('Опишите решение менеджера. После подтверждения конфликт будет закрыт, а прежний резерв FBS снят:', '');
            if (managerComment === null)
                return;
            comment = managerComment.trim();
            if (!comment) {
                setOnlineFbsSyncResolution({
                    assemblyId: null,
                    error: 'Для подтверждения решения менеджера нужен комментарий.',
                });
                return;
            }
        }
        setOnlineFbsSyncResolution({ assemblyId });
        try {
            const result = await resolveTsdFbsSyncConflict(session.accessToken, request.id, assemblyId, { action, comment });
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview((current) => current?.request.id === request.id
                ? { ...current, plan, status: 'ready', error: undefined }
                : current);
            setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
            await loadData();
        }
        catch (caught) {
            setOnlineFbsSyncResolution({
                assemblyId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function resetOnlineFbsAssemblyOrder(request, assemblyId, orderId) {
        const confirmed = window.confirm(`Сбросить сборку заказа №${orderId}?\n\nWMS снимет резерв и очистит только ШК товара, КИЗ, короб и наклейку этого заказа. Сам заказ на Wildberries не отменяется. Перед сбросом верните товар в исходный короб.`);
        if (!confirmed)
            return;
        setOnlineFbsSyncResolution({ assemblyId });
        try {
            const result = await resetTsdFbsAssemblyOrder(session.accessToken, request.id, assemblyId);
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview((current) => current?.request.id === request.id
                ? { ...current, plan, status: 'ready', error: undefined }
                : current);
            setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
            await loadData();
        }
        catch (caught) {
            setOnlineFbsSyncResolution({
                assemblyId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function markOnlineFbsOrderPackedWithoutSource(request, assemblyId, orderId) {
        const confirmed = window.confirm(`Отметить заказ №${orderId} как «Вложен без короба»?\n\nЗаказ будет засчитан в сборке. При закрытии заявки WMS обязательно попросит указать фактический короб, откуда был взят товар. Для маркируемого товара КИЗ должен быть уже подтверждён Wildberries.`);
        if (!confirmed)
            return;
        setOnlineFbsSyncResolution({ assemblyId });
        try {
            const result = await markTsdFbsAssemblyPackedWithoutSource(session.accessToken, request.id, assemblyId);
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview((current) => current?.request.id === request.id
                ? { ...current, plan, status: 'ready', error: undefined }
                : current);
            setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
            await loadData();
        }
        catch (caught) {
            setOnlineFbsSyncResolution({
                assemblyId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function refreshOnlineExecution() {
        if (!onlinePreview) {
            return;
        }
        const request = onlinePreview.request;
        setOnlinePreview((current) => (current ? { ...current, status: 'loading', error: undefined } : current));
        setActionMessage(null);
        try {
            // A manual refresh must reconcile the marketplace snapshot first. Merely
            // re-reading the TSD plan leaves cancelled, moved and newly added orders
            // invisible until the background cache eventually catches up.
            const marketplaceOrders = await fetchFbsOrders(session.accessToken, request.clientId, true);
            const requestOrders = marketplaceOrders.orders.filter((order) => order.request?.id === request.id);
            const activeOrders = requestOrders.filter((order) => order.category === 'active').length;
            const cancelledOrders = requestOrders.filter((order) => order.category === 'cancelled').length;
            let consistencyMessage = '';
            try {
                const consistency = await checkFbsRequestSupplyConsistency(session.accessToken, request.id);
                consistencyMessage = consistency.consistent
                    ? `Состав поставки совпадает: WB ${consistency.wbOrders}, WMS ${consistency.wmsOrders}.`
                    : `Расхождение поставки: WB ${consistency.wbOrders}, WMS ${consistency.wmsOrders}; не хватает ${consistency.missingInWms}, лишних ${consistency.extraInWms}.`;
            }
            catch (caught) {
                consistencyMessage = `Сверка поставки недоступна: ${errorMessage(caught)}`;
            }
            const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
            setOnlinePreview({ request, plan, status: 'ready' });
            setActionMessage(`Онлайн-заявка №${String(request.number).padStart(6, '0')} полностью обновлена. ` +
                `В заявке: ${requestOrders.length}, активных: ${activeOrders}, отменённых: ${cancelledOrders}. ` +
                consistencyMessage);
            await loadData();
        }
        catch (caught) {
            setOnlinePreview({ request, plan: onlinePreview.plan, status: 'error', error: errorMessage(caught) });
        }
    }
    async function downloadPickInstruction(request) {
        setError(null);
        try {
            if (isFbsRequest(request)) {
                const blob = await downloadFbsRequestPickListPdf(session.accessToken, request.id);
                downloadBlob(blob, `Лист_подбора_FBS_${String(request.number).padStart(6, '0')}.pdf`);
            }
            else {
                const blob = await downloadPickInstructionXlsx(session.accessToken, request.id);
                downloadBlob(blob, `pick-instruction-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function moveOnlineFbsOrders(request, selectedOrders) {
        const orders = [...new Map(selectedOrders.map((order) => [`${order.connectionId}:${order.id}`, order])).values()];
        if (orders.length === 0)
            return;
        setOnlineFbsMove({ orderId: orders.length === 1 ? orders[0].id : '__bulk__' });
        try {
            const targets = await fetchFbsMoveTargets(session.accessToken, {
                clientId: request.clientId,
                orders,
            });
            setOnlineFbsMove({ orderId: null });
            setOnlineFbsMoveChoice({
                request,
                orders,
                sourceCity: targets.sourceCity,
                candidates: targets.candidates,
                targetSupplyId: '__new__',
            });
        }
        catch (caught) {
            setOnlineFbsMove({
                orderId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function confirmOnlineFbsOrdersMove() {
        if (!onlineFbsMoveChoice)
            return;
        const { request, orders, targetSupplyId } = onlineFbsMoveChoice;
        setOnlineFbsMoveChoice(null);
        setOnlineFbsMove({ orderId: orders.length === 1 ? orders[0].id : '__bulk__' });
        try {
            const result = await moveFbsOrdersToNewSupply(session.accessToken, {
                clientId: request.clientId,
                orders,
                ...(targetSupplyId === '__new__' ? {} : { targetSupplyId }),
            });
            const destinationLabel = targetSupplyId === '__new__'
                ? 'в новую поставку'
                : 'в доступную поставку того же города';
            const message = `${orders.length === 1 ? `Заказ №${orders[0].id} перенесён` : `${orders.length} заказов перенесены`} ${destinationLabel} ${result.targetSupply.id} ` +
                `и заявку №${String(result.targetRequest.number).padStart(6, '0')}.`;
            setOnlineFbsMove({ orderId: null, message });
            setActionMessage(message);
            try {
                const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
                setOnlinePreview((current) => current?.request.id === request.id
                    ? { ...current, plan, status: 'ready', error: undefined }
                    : current);
            }
            catch {
                setOnlinePreview(null);
            }
            void loadData();
        }
        catch (caught) {
            setOnlineFbsMove({
                orderId: null,
                error: errorMessage(caught),
            });
        }
    }
    async function moveOnlineFbsOrder(request, order) {
        return moveOnlineFbsOrders(request, [order]);
    }
    async function openFbsRequestTailsPreview() {
        if (selectedFbsTailRequests.length === 0 ||
            isPreviewingFbsTails ||
            isMergingFbsTails) {
            return;
        }
        const requestIds = selectedFbsTailRequests.map((request) => request.id);
        setPreviewingFbsTails(true);
        setError(null);
        setActionMessage(null);
        try {
            const data = await previewFbsRequestTails(session.accessToken, requestIds);
            setFbsTailMergePreview({ requestIds, data });
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setPreviewingFbsTails(false);
        }
    }
    async function confirmFbsRequestTailsMerge() {
        if (!fbsTailMergePreview || isMergingFbsTails) {
            return;
        }
        setMergingFbsTails(true);
        setError(null);
        setActionMessage(null);
        setFbsTailMergePreview((current) => current ? { ...current, error: undefined } : current);
        try {
            const result = await mergeFbsRequestTails(session.accessToken, fbsTailMergePreview.requestIds, fbsTailMergePreview.data.orders.map((order) => ({
                connectionId: order.connectionId,
                id: order.id,
            })));
            setFbsTailMergePreview(null);
            setSelectedFbsTailRequestIds(new Set());
            setActionMessage(`Создана заявка №${String(result.targetRequest.number).padStart(6, '0')}: ` +
                `${result.moved} необработанных заказов из ${result.selectedRequestCount} заявок. ` +
                `Новая поставка WB: ${result.targetSupply.id}.` +
                (result.skipped > 0
                    ? ` Пропущено заказов: ${result.skipped} (${result.skippedOrders
                        .map((order) => `№${order.id}`)
                        .join(', ')}).`
                    : ''));
            await loadData();
        }
        catch (caught) {
            setFbsTailMergePreview((current) => current ? { ...current, error: errorMessage(caught) } : current);
        }
        finally {
            setMergingFbsTails(false);
        }
    }
    async function downloadRequestItems(request) {
        setError(null);
        try {
            const blob = await downloadClientRequestItemsXlsx(session.accessToken, request.id);
            downloadBlob(blob, `sostav-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function downloadWbProductsTemplate(request) {
        setError(null);
        try {
            const blob = await downloadClientRequestWbProductsXlsx(session.accessToken, request.id);
            downloadBlob(blob, `wb-products-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function downloadWbPackagesTemplate(request) {
        setError(null);
        try {
            const blob = await downloadClientRequestWbPackagesXlsx(session.accessToken, request.id);
            downloadBlob(blob, `wb-packages-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function refreshPickInstruction(request) {
        setError(null);
        setActionMessage(null);
        setRefreshingInstructionId(request.id);
        try {
            const repair = isFbsRequest(request)
                ? await repairFbsRequestSelectionRequest(session.accessToken, request.id)
                : null;
            const document = await refreshPickInstructionDocument(session.accessToken, request.id);
            setPickInstructionPreview(document);
            setActionMessage(repair?.message
                ?? `Заявка №${String(request.number).padStart(6, '0')} принудительно пересчитана по текущим остаткам. Архивные короба исключены, история сборки сохранена.`);
            if (onlinePreview?.request.id === request.id) {
                const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
                setOnlinePreview({ request: onlinePreview.request, plan, status: 'ready' });
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setRefreshingInstructionId((current) => (current === request.id ? null : current));
        }
    }
    async function openFbsSupplyConsistency(request) {
        setError(null);
        setCheckingSupplyRequestId(request.id);
        setFbsSupplyConsistency({ request, status: 'loading', data: null });
        try {
            const data = await checkFbsRequestSupplyConsistency(session.accessToken, request.id);
            setFbsSupplyConsistency((current) => current?.request.id === request.id
                ? { request, status: 'ready', data }
                : current);
        }
        catch (caught) {
            setFbsSupplyConsistency((current) => current?.request.id === request.id
                ? { request, status: 'ready', data: null, error: errorMessage(caught) }
                : current);
        }
        finally {
            setCheckingSupplyRequestId((current) => (current === request.id ? null : current));
        }
    }
    async function repairFbsSupplyConsistency() {
        const current = fbsSupplyConsistency;
        if (!current || current.status === 'repairing')
            return;
        setFbsSupplyConsistency({ ...current, status: 'repairing', error: undefined });
        try {
            const data = await repairFbsRequestSupplyConsistency(session.accessToken, current.request.id);
            setFbsSupplyConsistency({
                request: current.request,
                status: 'ready',
                data,
            });
            setActionMessage(data.message);
            await loadData();
        }
        catch (caught) {
            setFbsSupplyConsistency({
                ...current,
                status: 'ready',
                error: errorMessage(caught),
            });
        }
    }
    async function syncRequestToTsd(request) {
        setError(null);
        setActionMessage(null);
        setSyncingTsdRequestId(request.id);
        try {
            const result = await syncClientRequestToTsd(session.accessToken, request.id);
            if (result.mode === 'FBS' &&
                (result.requiresEmergencyAssembly === true || ((result.totalOrders ?? 0) > 0 &&
                    (result.activeOrders ?? 0) === 0))) {
                const confirmed = window.confirm(`Заявка №${String(request.number).padStart(6, '0')} не видна на ТСД, потому что Wildberries уже считает все ее заказы переданными/завершенными.\n\n` +
                    'Вернуть ее в локальную очередь ТСД для полной физической сборки? Статусы и поставка в Wildberries изменены не будут.');
                if (!confirmed) {
                    setActionMessage(`Проверка завершена: заявка №${String(request.number).padStart(6, '0')} скрыта из ТСД статусами Wildberries. Восстановление отменено пользователем.`);
                    return;
                }
                const emergency = await enableFbsEmergencyAssembly(session.accessToken, request.id);
                const repair = await repairFbsRequestSelectionRequest(session.accessToken, request.id);
                setActionMessage(`Заявка №${String(request.number).padStart(6, '0')} возвращена в очередь ТСД: ${emergency.shippedOrders} заказ(а/ов). ` +
                    `${repair.reservedTasks} заказ(а/ов) сразу привязаны к живым остаткам, ${repair.waitingStockTasks} ожидают товар. Wildberries не изменялся.`);
                await loadData();
                return;
            }
            const repair = result.mode === 'FBS'
                ? await repairFbsRequestSelectionRequest(session.accessToken, request.id)
                : null;
            setActionMessage(repair?.message ?? result.message
                ?? `Заявка №${String(request.number).padStart(6, '0')} синхронизирована с ТСД. Обновите очередь на устройстве.`);
            await loadData();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSyncingTsdRequestId((current) => (current === request.id ? null : current));
        }
    }
    async function downloadOnlineOutgoingBoxes(request) {
        setError(null);
        try {
            const blob = await downloadTsdOutgoingBoxesXlsx(session.accessToken, request.id);
            downloadBlob(blob, `outgoing-boxes-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function downloadOnlineOutgoingContents(request) {
        setError(null);
        try {
            const blob = await downloadTsdOutgoingContentsXlsx(session.accessToken, request.id);
            downloadBlob(blob, `outgoing-contents-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function downloadOnlineMovements(request) {
        setError(null);
        try {
            const blob = await downloadTsdMovementsXlsx(session.accessToken, request.id);
            downloadBlob(blob, `movements-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function packageOutboundRequest(request) {
        setError(null);
        try {
            const result = await packageClientRequest(session.accessToken, {
                requestId: request.id,
                idempotencyKey: `web-pack:${request.id}`,
                comment: 'Упаковка выполнена из web-интерфейса.',
            });
            setRequests((current) => ({
                ...current,
                data: current.data.map((item) => item.id === request.id ? { ...item, status: 'PACKED', packages: result.packages ?? item.packages } : item),
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function shipOutboundRequest(request) {
        setError(null);
        try {
            await shipClientRequest(session.accessToken, {
                requestId: request.id,
                idempotencyKey: `web-ship:${request.id}`,
                comment: 'Отгрузка закрыта из web-интерфейса.',
            });
            setRequests((current) => ({
                ...current,
                data: current.data.map((item) => (item.id === request.id ? { ...item, status: 'DONE' } : item)),
            }));
        }
        catch (caught) {
            const message = errorMessage(caught);
            if (isOverweightPackageError(message)) {
                openManualClose(request);
                setManualClose((current) => (current ? { ...current, error: message, status: 'idle' } : current));
                return;
            }
            setError(message);
        }
    }
    async function submitEmergencyPackedXlsx() {
        if (!emergencyUpload?.file) {
            setEmergencyUpload((current) => (current ? { ...current, error: 'Выберите Excel-файл с фактическими коробами.' } : current));
            return;
        }
        const { request, file } = emergencyUpload;
        setError(null);
        setEmergencyUpload((current) => (current ? { ...current, status: 'submitting', error: undefined } : current));
        try {
            const result = await emergencyCloseClientRequestFromXlsx(session.accessToken, request.id, file);
            setEmergencyUpload({ request, file, status: 'done', result });
            setRequests((current) => ({
                ...current,
                data: current.data.map((item) => (item.id === request.id ? { ...item, status: 'PACKED' } : item)),
            }));
            void loadData();
        }
        catch (caught) {
            setEmergencyUpload((current) => (current ? { ...current, status: 'idle', error: errorMessage(caught) } : current));
        }
    }
    async function rollbackEmergencyClose() {
        if (!emergencyRollback) {
            return;
        }
        setError(null);
        setActionMessage(null);
        setRollingBackEmergency(true);
        try {
            const result = await rollbackEmergencyCloseClientRequest(session.accessToken, emergencyRollback.id);
            setEmergencyRollback(null);
            setActionMessage(`Аварийное закрытие отменено. Восстановлено ${result.restoredUnits} шт. в ${result.restoredBoxes} коробах.`);
            await loadData();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setRollingBackEmergency(false);
        }
    }
    async function submitManualInstruction() {
        if (!manualInstructionUpload?.file) {
            setManualInstructionUpload((current) => (current ? { ...current, error: 'Выберите Excel-файл инструкции.' } : current));
            return;
        }
        const { request, file } = manualInstructionUpload;
        setError(null);
        setManualInstructionUpload((current) => (current ? { ...current, status: 'submitting', error: undefined } : current));
        try {
            const result = await uploadManualPickInstruction(session.accessToken, request.id, file);
            setManualInstructionUpload({ request, file, status: 'done', result });
            setPickInstructionPreview(result);
            if (onlinePreview?.request.id === request.id) {
                const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
                setOnlinePreview({ request: onlinePreview.request, plan, status: 'ready' });
            }
        }
        catch (caught) {
            setManualInstructionUpload((current) => current ? { ...current, status: 'idle', error: errorMessage(caught) } : current);
        }
    }
    function acceptCreated(request) {
        setRequests((current) => ({
            status: 'ready',
            data: [request, ...current.data],
        }));
    }
    function acceptUpdated(request) {
        setRequests((current) => ({
            ...current,
            status: 'ready',
            data: current.data.map((item) => (item.id === request.id ? request : item)),
        }));
        setEditingRequest(null);
    }
    return (_jsxs("section", { className: "client-requests-panel", "aria-label": "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsxs("div", { className: "section-heading client-requests-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsx("h2", { children: showArchive ? 'Архив заявок' : 'Клиентские заявки' })] }), _jsxs("div", { className: "client-requests-panel__heading-actions", children: [!showArchive ? (_jsxs("button", { className: "client-request-fbs-audit-trigger", type: "button", onClick: () => void runFbsSynchronizationAudit(), disabled: isRunningFbsSynchronizationAudit || fbsAuditClientIds.length === 0, title: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u0441\u0442\u0430\u0442\u0443\u0441\u044B FBS \u0438\u0437 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u043E\u0432 \u0438 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u0441 \u0437\u0430\u044F\u0432\u043A\u0430\u043C\u0438 WMS", children: [_jsx(ShieldAlert, { className: isRunningFbsSynchronizationAudit ? 'is-spinning' : undefined, size: 17, "aria-hidden": "true" }), _jsx("span", { children: isRunningFbsSynchronizationAudit ? 'Проверяю…' : 'Проверить рассинхронизацию FBS' })] })) : null, _jsxs("button", { className: `client-request-archive-toggle ${showArchive ? 'is-active' : ''}`, type: "button", onClick: () => setShowArchive((current) => !current), children: [showArchive ? _jsx(ArrowLeft, { size: 17, "aria-hidden": "true" }) : _jsx(Archive, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: showArchive ? 'К активным заявкам' : 'Архив заявок' })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadData(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0438", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] })] }), !showArchive && fbsSynchronizationAudit ? (_jsx(FbsSynchronizationAuditPanel, { audit: fbsSynchronizationAudit, canResolve: canChangeStatus, resolvingRequestId: resolvingFbsSynchronizationRequestId, onResolve: resolveFbsSynchronizationIssue, onClose: () => setFbsSynchronizationAudit(null) })) : null, !showArchive && canViewBoxOverlaps ? _jsx(BoxOverlapStatistics, { state: boxOverlaps }) : null, !showArchive && balanceReviews.status === 'ready' ? (_jsx(PickWaveBalanceReviewPanel, { session: session, reviews: balanceReviews.data, canWrite: canWrite, onUpdated: () => void loadData() })) : null, !showArchive && canWrite && clients.status === 'ready' ? (_jsxs(_Fragment, { children: [_jsx(ClientRequestXlsxImportForm, { clients: visibleClients, session: session, onCreated: acceptCreated }), _jsx(ClientRequestCreateForm, { clients: visibleClients, session: session, onCreated: acceptCreated })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, actionMessage ? _jsx("p", { className: "form-success", children: actionMessage }) : null, showArchive ? (_jsxs("form", { className: "client-request-archive-search", onSubmit: (event) => {
                    event.preventDefault();
                    const nextSearch = archiveBoxSearch.trim();
                    if (nextSearch === appliedArchiveBoxSearch) {
                        void loadData();
                    }
                    else {
                        setAppliedArchiveBoxSearch(nextSearch);
                    }
                }, children: [_jsxs("label", { children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: archiveBoxSearch, onChange: (event) => setArchiveBoxSearch(event.target.value), placeholder: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431 \u0432 \u0430\u0440\u0445\u0438\u0432\u0435 \u0437\u0430\u044F\u0432\u043E\u043A", "aria-label": "\u041D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430 \u0432 \u0430\u0440\u0445\u0438\u0432\u0435" }), archiveBoxSearch ? (_jsx("button", { className: "client-request-archive-search__clear", type: "button", title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A \u043F\u043E \u0430\u0440\u0445\u0438\u0432\u0443", onClick: () => {
                                    setArchiveBoxSearch('');
                                    setAppliedArchiveBoxSearch('');
                                }, children: _jsx(X, { size: 15, "aria-hidden": "true" }) })) : null] }), _jsxs("button", { className: "primary-button", type: "submit", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431" })] }), appliedArchiveBoxSearch ? (_jsxs("span", { className: "client-request-archive-search__result", children: ["\u041F\u043E\u0438\u0441\u043A: ", appliedArchiveBoxSearch, " \u00B7 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0437\u0430\u044F\u0432\u043E\u043A: ", displayedRequests.data.length] })) : null] })) : null, !showArchive && canWrite && fbsTailEligibleRequests.length > 0 ? (_jsxs("section", { className: "client-request-fbs-tails", "aria-label": "\u041E\u0431\u044A\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u044B\u0445 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432", children: [_jsxs("div", { className: "client-request-fbs-tails__copy", children: [_jsx(ArrowRightLeft, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041D\u043E\u0432\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u0438\u0437 \u0445\u0432\u043E\u0441\u0442\u043E\u0432 FBS" }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u043E\u0442\u043C\u0435\u0442\u044C\u0442\u0435 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438 \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435 \u0438 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0438\u0442\u0435 \u0438\u0445 \u043D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0432 \u043E\u0434\u043D\u0443 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443." })] })] }), _jsxs("div", { className: "client-request-fbs-tails__actions", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: fbsTailClientId, onChange: (event) => {
                                            setFbsTailClientId(event.target.value);
                                            setSelectedFbsTailRequestIds(new Set());
                                            setFbsTailMergePreview(null);
                                        }, disabled: isPreviewingFbsTails || isMergingFbsTails, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), fbsTailClients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)))] })] }), _jsxs("span", { className: "client-request-fbs-tails__selected", children: ["\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0437\u0430\u044F\u0432\u043E\u043A: ", _jsx("strong", { children: selectedFbsTailRequests.length })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void openFbsRequestTailsPreview(), disabled: selectedFbsTailRequests.length === 0 ||
                                    isPreviewingFbsTails ||
                                    isMergingFbsTails, children: [_jsx(ClipboardList, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isPreviewingFbsTails
                                            ? 'Проверяю состав…'
                                            : 'Показать, что будет перенесено' })] })] })] })) : null, _jsx("div", { className: "client-requests-panel__list", children: renderRequests(displayedRequests, selectableFbsTailRequestIds, selectedFbsTailRequestIds, setSelectedFbsTailRequestIds, canChangeStatus, canPickOutbound, canWrite, canEditAnyRequest, canPickOutbound && canEditAnyRequest, canUploadManualInstruction, refreshingInstructionId, syncingTsdRequestId, checkingSupplyRequestId, (requestId, status) => void changeStatus(requestId, status), (request) => void cancelRequest(request), (request) => setEditingRequest(request), (request) => void openRequestDocument(request), (request) => void downloadRequestItems(request), canDownloadOriginalRequest
                    ? (request, file) => void downloadOriginalRequestFile(request, file)
                    : undefined, canPickOutbound ? (request) => void openOnlineExecution(request) : undefined, canPickOutbound ? (request) => void openManualBoxSelection(request) : undefined, canPickOutbound ? (request) => void openFbsBoxSearch(request) : undefined, (request) => void openPickInstruction(request), (request) => void refreshPickInstruction(request), canPickOutbound ? (request) => void syncRequestToTsd(request) : undefined, canPickOutbound ? (request) => void openFbsSupplyConsistency(request) : undefined, onOpenFbsOrders, (request) => void downloadPickInstruction(request), canPickOutbound ? (request) => void downloadWbProductsTemplate(request) : undefined, canPickOutbound ? (request) => void downloadWbPackagesTemplate(request) : undefined, canUploadManualInstruction
                    ? (request) => setManualInstructionUpload({ request, file: null, status: 'idle' })
                    : undefined, canUploadManualInstruction ? (request) => setEmergencyUpload({ request, file: null, status: 'idle' }) : undefined, canUploadManualInstruction ? (request) => setEmergencyRollback(request) : undefined, (request) => void pickOutboundRequest(request), (request) => void packageOutboundRequest(request), (request) => void shipOutboundRequest(request)) }), fbsTailMergePreview ? (_jsx(FbsTailMergePreviewModal, { state: fbsTailMergePreview, isSubmitting: isMergingFbsTails, onConfirm: () => void confirmFbsRequestTailsMerge(), onClose: () => {
                    if (!isMergingFbsTails) {
                        setFbsTailMergePreview(null);
                    }
                } })) : null, fbsSupplyConsistency ? (_jsx(FbsSupplyConsistencyModal, { state: fbsSupplyConsistency, onRepair: () => void repairFbsSupplyConsistency(), onClose: () => {
                    if (fbsSupplyConsistency.status !== 'repairing') {
                        setFbsSupplyConsistency(null);
                    }
                } })) : null, documentPreview ? (_jsx(ClientRequestDocumentPreview, { document: documentPreview, onClose: () => setDocumentPreview(null) })) : null, editingRequest ? (_jsx(ClientRequestEditModal, { request: editingRequest, session: session, canBypassAvailability: canEditAnyRequest, onClose: () => setEditingRequest(null), onSaved: acceptUpdated })) : null, pickInstructionPreview ? (_jsx(HtmlDocumentPreview, { title: pickInstructionPreview.title, fileName: pickInstructionPreview.fileName, html: pickInstructionPreview.html, onClose: () => setPickInstructionPreview(null) })) : null, onlinePreview ? (_jsx(OnlineExecutionModal, { request: onlinePreview.request, plan: onlinePreview.plan, status: onlinePreview.status, error: onlinePreview.error, movingOrderId: onlineFbsMove.orderId, moveMessage: onlineFbsMove.message, moveError: onlineFbsMove.error, resolvingKizId: onlineKizResolution.assemblyId, kizResolutionMessage: onlineKizResolution.message, kizResolutionError: onlineKizResolution.error, resolvingSyncConflictId: onlineFbsSyncResolution.assemblyId, syncConflictResolutionMessage: onlineFbsSyncResolution.message, syncConflictResolutionError: onlineFbsSyncResolution.error, onResolveKiz: canWrite
                    ? (assemblyId) => void resolveOnlineFbsKiz(onlinePreview.request, assemblyId)
                    : undefined, onRestoreRescanKiz: canWrite
                    ? (assemblyId) => void restoreOnlineFbsRescanFromWb(onlinePreview.request, assemblyId)
                    : undefined, onResolveSyncConflict: canWrite
                    ? (assemblyId, action) => void resolveOnlineFbsSyncConflict(onlinePreview.request, assemblyId, action)
                    : undefined, onResetFbsAssembly: canWrite
                    ? (assemblyId, orderId) => void resetOnlineFbsAssemblyOrder(onlinePreview.request, assemblyId, orderId)
                    : undefined, onMarkPackedWithoutSource: canWrite
                    ? (assemblyId, orderId) => void markOnlineFbsOrderPackedWithoutSource(onlinePreview.request, assemblyId, orderId)
                    : undefined, onMoveOrder: canWrite
                    ? (order) => void moveOnlineFbsOrder(onlinePreview.request, order)
                    : undefined, onMoveOrders: canWrite
                    ? (orders) => void moveOnlineFbsOrders(onlinePreview.request, orders)
                    : undefined, onClose: () => {
                    setOnlinePreview(null);
                    setOnlineFbsMove({ orderId: null });
                    setOnlineFbsMoveChoice(null);
                    setOnlineKizResolution({ assemblyId: null });
                    setOnlineFbsSyncResolution({ assemblyId: null });
                }, onRefresh: () => void refreshOnlineExecution(), onDownloadBoxes: () => void downloadOnlineOutgoingBoxes(onlinePreview.request), onDownloadContents: () => void downloadOnlineOutgoingContents(onlinePreview.request), onDownloadMovements: () => void downloadOnlineMovements(onlinePreview.request) })) : null, onlineFbsMoveChoice ? (_jsx(OnlineFbsMoveTargetDialog, { state: onlineFbsMoveChoice, onChange: (targetSupplyId) => setOnlineFbsMoveChoice((current) => current ? { ...current, targetSupplyId } : current), onConfirm: () => void confirmOnlineFbsOrdersMove(), onClose: () => setOnlineFbsMoveChoice(null) })) : null, emergencyUpload ? (_jsx(EmergencyPackedXlsxModal, { state: emergencyUpload, onFileChange: (file) => setEmergencyUpload((current) => (current ? { ...current, file, error: undefined } : current)), onSubmit: () => void submitEmergencyPackedXlsx(), onClose: () => setEmergencyUpload(null) })) : null, emergencyRollback ? (_jsx(ConfirmDialog, { title: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0430\u0432\u0430\u0440\u0438\u0439\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435?", message: `Заявка «${emergencyRollback.title}» вернется в состояние до загрузки аварийного файла.`, details: [
                    'Списанные остатки и КИЗ будут восстановлены в исходных коробах.',
                    'Аварийные упаковочные места, файл и автоматически созданные финансовые черновики будут удалены.',
                    'Если счет уже выставлен или оплачен, WMS остановит откат без изменения склада.',
                ], confirmLabel: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435", isBusy: isRollingBackEmergency, onCancel: () => setEmergencyRollback(null), onConfirm: () => void rollbackEmergencyClose() })) : null, manualInstructionUpload ? (_jsx(ManualInstructionUploadModal, { state: manualInstructionUpload, onFileChange: (file) => setManualInstructionUpload((current) => (current ? { ...current, file, error: undefined, status: 'idle' } : current)), onSubmit: () => void submitManualInstruction(), onClose: () => setManualInstructionUpload(null) })) : null, manualClose ? (_jsx(ManualCloseModal, { state: manualClose, onChange: (patch) => setManualClose((current) => (current ? { ...current, ...patch, error: undefined } : current)), onSubmit: () => void submitManualClose(), onForceOverweight: () => void submitManualClose(true), onResolveStock: () => void openCloseStockRecovery(), onClose: () => setManualClose(null) })) : null, closeStockRecovery ? (_jsx(CloseStockRecoveryModal, { state: closeStockRecovery, onBoxQuantityChange: (requestItemId, boxCode, quantity) => changeCloseStockSource(requestItemId, (value) => ({
                    ...value,
                    boxQuantities: { ...value.boxQuantities, [boxCode]: quantity },
                    noBoxQuantity: '',
                })), onUseSuggestedBox: (requestItemId, boxCode, quantity) => changeCloseStockSource(requestItemId, (value) => ({
                    ...value,
                    boxQuantities: {
                        ...Object.fromEntries(Object.keys(value.boxQuantities).map((knownBoxCode) => [knownBoxCode, ''])),
                        [boxCode]: String(quantity),
                    },
                    noBoxQuantity: '',
                    manualBoxCode: '',
                    manualBoxQuantity: '',
                })), onManualBoxChange: (requestItemId, patch) => changeCloseStockSource(requestItemId, (value) => ({
                    ...value,
                    ...patch,
                    noBoxQuantity: '',
                })), onNoBoxQuantityChange: (requestItemId, quantity) => changeCloseStockSource(requestItemId, (value) => ({
                    ...value,
                    noBoxQuantity: quantity,
                })), onChooseNoBox: chooseCloseStockWithoutBox, onSelectItems: selectCloseStockItems, onToggleItem: toggleCloseStockItem, onChooseSelectedNoBox: chooseSelectedCloseStockWithoutBox, onSubmit: () => void submitCloseStockRecovery(), onClose: () => setCloseStockRecovery(null) })) : null, manualBoxSelection ? (_jsx(ManualBoxSelectionModal, { state: manualBoxSelection, onQuantityChange: changeManualBoxQuantity, onSave: () => void saveManualBoxSelection(false), onClear: () => void saveManualBoxSelection(true), onClose: () => setManualBoxSelection(null) })) : null, fbsBoxSearch ? (_jsx(FbsBoxSearchModal, { state: fbsBoxSearch, onDownload: async () => {
                    const blob = await downloadClientRequestFbsBoxSearchXlsx(session.accessToken, fbsBoxSearch.request.id);
                    downloadBlob(blob, `${fbsBoxSearch.data?.stockMode === 'WITHOUT_BOXES' ? 'Остатки_склада_FBS' : 'Совпадающие_короба_FBS'}_${String(fbsBoxSearch.request.number).padStart(6, '0')}.xlsx`);
                }, onClose: () => setFbsBoxSearch(null) })) : null] }));
}
function isFbsRequest(request) {
    return ((request._count?.fbsOrderLinks ?? 0) > 0 ||
        request.title.trim().toLocaleUpperCase('ru-RU').startsWith('FBS') ||
        request.comment
            ?.toLocaleLowerCase('ru-RU')
            .includes('создано из fbs-заказов:') === true);
}
function canMergeFbsRequestTail(request) {
    return (request.type === 'OUTBOUND' &&
        isFbsRequest(request) &&
        ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(request.status));
}
function FbsTailMergePreviewModal({ state, isSubmitting, onConfirm, onClose, }) {
    const sourceRequestNumbers = state.data.sourceRequests
        .map((request) => `№${String(request.number).padStart(6, '0')}`)
        .join(', ');
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0430 \u0445\u0432\u043E\u0441\u0442\u043E\u0432 FBS", children: _jsxs("section", { className: "online-execution-modal__panel fbs-tail-preview-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041F\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u043E\u0441\u0442\u0430\u0432 \u043D\u043E\u0432\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsxs("h3", { children: ["\u0425\u0432\u043E\u0441\u0442\u044B \u0438\u0437 \u0437\u0430\u044F\u0432\u043E\u043A ", sourceRequestNumbers] }), _jsx("small", { children: "\u0414\u043E \u043D\u0430\u0436\u0430\u0442\u0438\u044F \u043A\u043D\u043E\u043F\u043A\u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0437\u0430\u043A\u0430\u0437\u044B \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u044F\u0442\u0441\u044F" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, disabled: isSubmitting, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body fbs-tail-preview-modal__body", children: [_jsxs("div", { className: "fbs-tail-preview-modal__summary", children: [_jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("strong", { children: state.data.orderCount })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0415\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("strong", { children: state.data.itemCount })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0420\u0430\u0437\u043D\u044B\u0445 SKU" }), _jsx("strong", { children: state.data.skuCount })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0445 \u0437\u0430\u044F\u0432\u043E\u043A" }), _jsx("strong", { children: state.data.sourceRequests.length })] })] }), _jsxs("div", { className: "fbs-tail-preview-modal__notice", children: [_jsx(ClipboardList, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0438\u0436\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u043D \u0442\u043E\u0447\u043D\u044B\u0439 \u0441\u043E\u0441\u0442\u0430\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u0443\u0434\u0435\u0442 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u0432 \u043D\u043E\u0432\u0443\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 WB \u0438 \u0437\u0430\u043F\u0438\u0441\u0430\u043D \u0432 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443 WMS." })] }), _jsx("div", { className: "fbs-tail-preview-modal__table-wrap", children: _jsxs("table", { className: "fbs-tail-preview-modal__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0418\u0437 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437 WB" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("th", { children: "\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442" })] }) }), _jsx("tbody", { children: state.data.orders.map((order) => (_jsxs("tr", { children: [_jsx("td", { children: order.sourceRequest
                                                        ? `№${String(order.sourceRequest.number).padStart(6, '0')}`
                                                        : '—' }), _jsxs("td", { children: [_jsxs("strong", { children: ["\u2116", order.id] }), _jsxs("small", { children: ["\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 ", order.sourceSupplyId] })] }), _jsxs("td", { children: [_jsx("strong", { children: order.product.name }), _jsxs("small", { children: ["\u0410\u0440\u0442. ", order.product.article || order.article || '—', " \u00B7 SKU ", order.product.clientSku || order.product.internalSku] }), _jsxs("small", { children: ["\u0428\u041A ", order.barcodes.join(', ') || '—'] })] }), _jsx("td", { children: order.product.size || '—' }), _jsx("td", { children: _jsxs("strong", { children: [order.itemCount, " \u0448\u0442."] }) }), _jsx("td", { children: order.storageBoxes.length > 0
                                                        ? order.storageBoxes
                                                            .map((box) => `${box.code} (${box.quantity})`)
                                                            .join(', ')
                                                        : 'Короб не найден' })] }, `${order.connectionId}-${order.id}`))) })] }) }), state.data.skippedOrders.length > 0 ? (_jsxs("details", { className: "fbs-tail-preview-modal__skipped", children: [_jsxs("summary", { children: ["\u041D\u0435 \u0431\u0443\u0434\u0443\u0442 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u044B: ", state.data.skippedOrders.length] }), _jsx("ul", { children: state.data.skippedOrders.map((order, index) => (_jsxs("li", { children: [_jsxs("strong", { children: ["\u2116", order.id] }), " \u2014 ", order.reason] }, `${order.id}-${index}`))) })] })) : null, state.error ? (_jsx("p", { className: "form-error fbs-tail-preview-modal__error", children: state.error })) : null, _jsxs("div", { className: "fbs-tail-preview-modal__actions", children: [_jsx("button", { className: "client-request-action-button", type: "button", onClick: onClose, disabled: isSubmitting, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirm, disabled: isSubmitting || state.data.orders.length === 0, children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting
                                                ? 'Создаю новую заявку…'
                                                : `Подтвердить перенос ${state.data.orderCount} заказов` })] })] })] })] }) }));
}
function FbsBoxSearchModal({ state, onDownload, onClose, }) {
    const [search, setSearch] = useState('');
    const [downloadStatus, setDownloadStatus] = useState('idle');
    const [downloadError, setDownloadError] = useState('');
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    const withoutBoxes = state.data?.stockMode === 'WITHOUT_BOXES';
    const boxes = (state.data?.boxes ?? []).filter((box) => {
        if (!normalizedSearch)
            return true;
        return [
            box.boxCode,
            ...box.orderIds,
            ...box.items.flatMap((item) => [item.productName, item.article ?? '', ...item.barcodes]),
        ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
    });
    const warehouseStock = (state.data?.warehouseStock ?? []).filter((item) => {
        if (!normalizedSearch)
            return true;
        return [
            ...item.orderIds,
            item.productName,
            item.article ?? '',
            ...item.barcodes,
        ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
    });
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u0434\u043B\u044F FBS-\u0437\u0430\u044F\u0432\u043A\u0438", children: _jsxs("section", { className: "online-execution-modal__panel fbs-box-search-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: withoutBoxes ? 'Остатки склада FBS' : 'Совпадающие короба FBS' }), _jsxs("h3", { children: ["\u2116", String(state.request.number).padStart(6, '0'), " \u00B7 ", state.request.title] }), _jsxs("small", { children: [state.request.client.name, " \u00B7 ", withoutBoxes
                                            ? 'поштучный учет без привязки к коробам и палет-сортам'
                                            : 'показаны только короба, общие для нескольких заказов'] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body fbs-box-search-modal__body", children: [state.status === 'loading' ? (_jsxs("p", { className: "panel-message", children: [_jsx(RefreshCw, { size: 18, "aria-hidden": "true" }), " \u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435."] })) : state.data ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "fbs-box-search-modal__summary", children: [_jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432 \u0432 \u0437\u0430\u044F\u0432\u043A\u0435" }), _jsx("strong", { children: state.data.summary.orders })] }), _jsxs("span", { children: [_jsx("small", { children: withoutBoxes ? 'Позиций на складе' : 'Совпадающих коробов' }), _jsx("strong", { children: withoutBoxes ? state.data.warehouseStock.length : state.data.summary.boxes })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("strong", { children: state.data.summary.confirmedOrders })] })] }), _jsxs("label", { className: "fbs-box-search-modal__search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: withoutBoxes ? 'Номер заказа, ШК, артикул или товар' : 'Номер короба, заказа, ШК или товар', autoFocus: true }), search ? (_jsx("button", { type: "button", onClick: () => setSearch(''), title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", children: _jsx(X, { size: 15, "aria-hidden": "true" }) })) : null] }), withoutBoxes && warehouseStock.length ? (_jsx("div", { className: "fbs-box-search-results", children: warehouseStock.map((item) => (_jsxs("article", { className: "fbs-box-search-card", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx(Boxes, { size: 19, "aria-hidden": "true" }), _jsx("strong", { children: item.productName })] }), _jsxs("span", { children: [item.availableQuantity, " \u0448\u0442. \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435"] })] }), _jsxs("div", { className: "fbs-box-search-card__orders", children: [_jsx("strong", { children: item.orderIds.length
                                                            ? `Заказы №${item.orderIds.join(', №')}`
                                                            : 'Заказы по позиции не определены' }), _jsx("span", { children: "\u0411\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0438 \u043F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442\u043E\u0432" })] }), _jsx("div", { className: "fbs-box-search-card__items", children: _jsxs("div", { children: [_jsxs("span", { children: [_jsxs("strong", { children: ["\u0410\u0440\u0442. ", item.article || '—'] }), _jsxs("small", { children: ["\u0428\u041A ", item.barcodes.join(', ') || '—', " \u00B7 \u043D\u0443\u0436\u043D\u043E ", item.requestedQuantity, " \u0448\u0442."] })] }), _jsxs("span", { children: [_jsxs("strong", { children: [item.freeQuantity, " \u0448\u0442. \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E"] }), _jsxs("small", { children: ["\u0437\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u043E ", item.reservedQuantity, " \u0448\u0442."] })] })] }) })] }, item.requestItemId))) })) : !withoutBoxes && boxes.length ? (_jsx("div", { className: "fbs-box-search-results", children: boxes.map((box) => (_jsxs("article", { className: `fbs-box-search-card ${box.confirmedOrderIds.length ? 'is-confirmed' : ''}`, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx(Boxes, { size: 19, "aria-hidden": "true" }), _jsx("strong", { children: box.boxCode })] }), _jsxs("span", { children: [box.items.reduce((sum, item) => sum + item.availableQuantity, 0), " \u0448\u0442. \u0441\u043E\u0432\u043F\u0430\u0432\u0448\u0435\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430"] })] }), _jsxs("div", { className: "fbs-box-search-card__orders", children: [_jsxs("strong", { children: ["\u0417\u0430\u043A\u0430\u0437\u044B \u2116", box.orderIds.join(', №')] }), box.confirmedOrderIds.length ? (_jsxs("span", { className: "is-confirmed", children: ["\u0422\u043E\u0447\u043D\u043E \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E \u0422\u0421\u0414: \u2116", box.confirmedOrderIds.join(', №')] })) : (_jsx("span", { children: "\u0412 \u044D\u0442\u043E\u043C \u043A\u043E\u0440\u043E\u0431\u0435 \u0441\u043E\u0432\u043F\u0430\u043B\u0438 \u0442\u043E\u0432\u0430\u0440\u044B \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u0438\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432" }))] }), _jsx("div", { className: "fbs-box-search-card__items", children: box.items.map((item) => (_jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: item.productName }), _jsxs("small", { children: ["\u0410\u0440\u0442. ", item.article || '—', " \u00B7 \u0428\u041A ", item.barcodes.join(', ') || '—'] })] }), _jsxs("span", { children: [_jsxs("strong", { children: [item.availableQuantity, " \u0448\u0442."] }), _jsx("small", { children: item.freeQuantity > 0 ? `свободно ${item.freeQuantity}` : 'зарезервировано' })] })] }, `${box.boxId}-${item.requestItemId}`))) })] }, box.boxId))) })) : (_jsx("p", { className: "panel-message", children: withoutBoxes
                                        ? state.data.warehouseStock.length
                                            ? 'По этому запросу товар не найден.'
                                            : 'Поштучного остатка по товарам этой заявки на складе нет.'
                                        : state.data.boxes.length
                                            ? 'По этому запросу короб не найден.'
                                            : 'Общих коробов для нескольких заказов этой заявки нет.' })), state.data.unmatchedOrderIds.length ? (_jsx("p", { className: "form-error fbs-box-search-modal__unmatched", children: withoutBoxes
                                        ? `Нет доступного складского остатка для заказов №${state.data.unmatchedOrderIds.join(', №')}.`
                                        : `Не найдены в активных коробах заказы №${state.data.unmatchedOrderIds.join(', №')}.` })) : null] })) : null, state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, downloadError ? _jsx("p", { className: "form-error", children: downloadError }) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), state.data && (state.data.boxes.length > 0 || state.data.warehouseStock.length > 0) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", disabled: downloadStatus === 'downloading', onClick: async () => {
                                        setDownloadStatus('downloading');
                                        setDownloadError('');
                                        try {
                                            await onDownload();
                                        }
                                        catch (caught) {
                                            setDownloadError(errorMessage(caught));
                                        }
                                        finally {
                                            setDownloadStatus('idle');
                                        }
                                    }, children: [_jsx(FileDown, { size: 16, "aria-hidden": "true" }), downloadStatus === 'downloading' ? 'Формирую Excel' : 'Скачать Excel'] })) : null] })] })] }) }));
}
function ManualBoxSelectionModal({ state, onQuantityChange, onSave, onClear, onClose, }) {
    const isBusy = state.status === 'loading' || state.status === 'saving';
    const isComplete = Boolean(state.data?.items.length &&
        state.data.items.every((item) => item.selectedQuantity === item.requestedQuantity));
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0412\u044B\u0431\u043E\u0440 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0434\u043B\u044F \u0437\u0430\u044F\u0432\u043A\u0438", children: _jsxs("section", { className: "online-execution-modal__panel manual-box-selection-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0420\u0443\u0447\u043D\u043E\u0439 \u0432\u044B\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432" }), _jsxs("h3", { children: ["\u2116", String(state.request.number).padStart(6, '0'), " \u00B7 ", state.request.title] }), _jsxs("small", { children: [state.request.client.name, " \u00B7 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u0435 \u00AB\u0421\u0434\u0430\u043D\u043E\u00BB"] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body manual-box-selection-modal__body", children: [state.status === 'loading' ? (_jsxs("p", { className: "panel-message", children: [_jsx(RefreshCw, { size: 18, "aria-hidden": "true" }), " \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u043A\u043E\u0440\u043E\u0431\u0430\u043C."] })) : state.data ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "manual-box-selection-modal__notice", children: [_jsx(Boxes, { size: 21, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0447\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430 \u0438 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E." }), _jsx("span", { children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0444\u0438\u043A\u0441\u0438\u0440\u0443\u0435\u0442 \u0432\u044B\u0431\u043E\u0440. \u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043F\u0440\u043E\u0438\u0437\u043E\u0439\u0434\u0435\u0442 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430 \u0437\u0430\u044F\u0432\u043A\u0438 \u0432 \u00AB\u0421\u0434\u0430\u043D\u043E\u00BB." })] })] }), _jsxs("div", { className: `manual-box-selection-modal__summary ${isComplete ? 'is-complete' : 'is-incomplete'}`, children: [_jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435" }), _jsxs("strong", { children: [state.data.summary.selectedQuantity, " / ", state.data.summary.requestedQuantity, " \u0448\u0442."] })] }), _jsx("div", { className: "manual-box-selection-items", children: state.data.items.map((item) => {
                                        const itemLabel = item.sku?.name ?? item.requestedName ?? 'Товар не сопоставлен';
                                        const itemCode = item.sku?.article ?? item.sku?.internalSku ?? item.requestedBarcode ?? 'без артикула';
                                        const remaining = Math.max(0, item.requestedQuantity - item.selectedQuantity);
                                        const complete = item.selectedQuantity === item.requestedQuantity;
                                        return (_jsxs("article", { className: `manual-box-selection-item ${complete ? 'is-complete' : 'is-incomplete'}`, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("h4", { children: itemLabel }), _jsxs("span", { children: ["\u0410\u0440\u0442\u0438\u043A\u0443\u043B: ", itemCode] }), _jsxs("span", { children: ["\u0428\u041A: ", item.sku?.barcodes.join(', ') || item.requestedBarcode || 'не указан'] })] }), _jsxs("strong", { children: [item.selectedQuantity, " / ", item.requestedQuantity, " \u0448\u0442."] })] }), item.boxes.length ? (_jsx("div", { className: "manual-box-selection-boxes", children: item.boxes.map((box) => {
                                                        const checked = box.selectedQuantity > 0;
                                                        const suggestedQuantity = Math.min(box.availableQuantity, remaining || box.availableQuantity);
                                                        return (_jsxs("label", { className: `manual-box-selection-box ${checked ? 'is-selected' : ''}`, children: [_jsx("input", { type: "checkbox", checked: checked, disabled: isBusy || !state.data?.editable, onChange: (event) => onQuantityChange(item.requestItemId, box.boxId, event.target.checked ? String(suggestedQuantity) : '0') }), _jsxs("div", { children: [_jsx("strong", { children: box.boxCode }), _jsxs("span", { children: ["\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E ", box.availableQuantity, " \u0448\u0442. \u00B7", ' ', box.statuses.map((row) => `${stockStatusLabel(row.status)} ${row.quantity}`).join(', ') || 'остаток изменился'] })] }), _jsx("input", { className: "manual-box-selection-box__quantity", type: "number", min: "0", max: box.availableQuantity, step: "1", inputMode: "numeric", value: box.selectedQuantity || '', placeholder: "0", disabled: isBusy || !state.data?.editable, "aria-label": `Количество из короба ${box.boxCode}`, onChange: (event) => onQuantityChange(item.requestItemId, box.boxId, event.target.value) })] }, box.boxId));
                                                    }) })) : (_jsx("p", { className: "manual-box-selection-item__empty", children: "\u0412 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u0430\u0445 \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430 \u044D\u0442\u043E\u0439 \u043F\u043E\u0437\u0438\u0446\u0438\u0438." }))] }, item.requestItemId));
                                    }) }), !state.data.editable ? (_jsx("p", { className: "form-error", children: "\u0414\u043B\u044F \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u0432\u044B\u0431\u043E\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430." })) : null] })) : null, state.error ? _jsx("p", { className: "form-error manual-box-selection-modal__error", children: state.error }) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, disabled: state.status === 'saving', children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), state.data?.editable && state.data.summary.selectedQuantity > 0 ? (_jsx("button", { className: "client-request-action-button client-request-action-button--cancel", type: "button", onClick: onClear, disabled: isBusy, children: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0432\u044B\u0431\u043E\u0440" })) : null, state.data?.editable ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--box-selection", type: "button", onClick: onSave, disabled: isBusy || !isComplete, children: [_jsx(Boxes, { size: 16, "aria-hidden": "true" }), state.status === 'saving' ? 'Сохраняю' : 'Сохранить короба'] })) : null] })] })] }) }));
}
function stockStatusLabel(status) {
    if (status === 'AVAILABLE')
        return 'доступно';
    if (status === 'PACKING')
        return 'в сборке';
    if (status === 'SHIPPING')
        return 'к отгрузке';
    return status;
}
function ManualCloseModal({ state, onChange, onSubmit, onForceOverweight, onResolveStock, onClose, }) {
    const isSubmitting = state.status === 'submitting';
    const requestedUnits = state.request.items.reduce((total, item) => total + item.quantity, 0);
    const isOverweightError = Boolean(state.error && isOverweightPackageError(state.error));
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0420\u0443\u0447\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438", children: _jsxs("section", { className: "online-execution-modal__panel manual-close-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0420\u0443\u0447\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438" }), _jsx("h3", { children: state.request.title }), _jsxs("small", { children: [state.request.client.name, " \u00B7 ", state.request.destinationCity || 'город не указан'] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body", children: [_jsxs("div", { className: "manual-close-modal__notice", children: [_jsx(Boxes, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: state.usesRecordedPackages ? 'Упаковочные места уже зафиксированы.' : 'Укажите фактический результат упаковки.' }), _jsx("span", { children: state.usesRecordedPackages
                                                ? 'Проверьте сводку и подтвердите сдачу. Данные ТСД и состав коробов будут сохранены.'
                                                : 'После подтверждения WMS спишет товар, создаст упаковочные места и сформирует черновики счетов.' })] })] }), _jsxs("div", { className: "manual-close-modal__summary", children: [_jsx("span", { children: "\u041F\u043E \u0437\u0430\u044F\u0432\u043A\u0435" }), _jsxs("strong", { children: [requestedUnits, " \u0448\u0442."] })] }), _jsxs("div", { className: "manual-close-modal__fields", children: [_jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: state.boxes, disabled: isSubmitting || state.usesRecordedPackages, onChange: (event) => onChange({ boxes: event.target.value }) })] }), _jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0430\u043B\u043B\u0435\u0442" }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: state.pallets, disabled: isSubmitting || state.usesRecordedPackages, onChange: (event) => onChange({ pallets: event.target.value }) })] }), _jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043E, \u0448\u0442." }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: state.packedUnits, disabled: isSubmitting || state.usesRecordedPackages, onChange: (event) => onChange({ packedUnits: event.target.value }) })] })] }), _jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { rows: 3, value: state.comment, disabled: isSubmitting, onChange: (event) => onChange({ comment: event.target.value }) })] }), state.error ? _jsx("p", { className: "form-error manual-close-modal__error", children: state.error }) : null, isOverweightError ? (_jsxs("div", { className: "manual-close-modal__overweight-action", role: "alert", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041A\u043E\u0440\u043E\u0431 \u0442\u044F\u0436\u0435\u043B\u0435\u0435 25 \u043A\u0433" }), _jsx("span", { children: "\u0415\u0441\u043B\u0438 \u0437\u0430\u044F\u0432\u043A\u0443 \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u0433\u0440\u0443\u0437\u0438\u0442\u044C, \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435. \u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u0432\u0435\u0441\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F." })] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--ship", type: "button", onClick: onForceOverweight, disabled: isSubmitting, children: [_jsx(ShieldAlert, { size: 18, "aria-hidden": "true" }), isSubmitting ? 'Закрываю заявку' : 'Закрыть заявку несмотря на перегруз'] })] })) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, disabled: isSubmitting, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), state.error && !isOverweightError ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--box-selection", type: "button", onClick: onResolveStock, disabled: isSubmitting, children: [_jsx(ShieldAlert, { size: 16, "aria-hidden": "true" }), "\u0423\u043A\u0430\u0437\u0430\u0442\u044C \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043A\u043E\u0440\u043E\u0431 / \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u0430"] })) : null, !isOverweightError ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--ship", type: "button", onClick: onSubmit, disabled: isSubmitting, children: [_jsx(Truck, { size: 16, "aria-hidden": "true" }), isSubmitting ? 'Закрываю отгрузку' : 'Подтвердить и сдать'] })) : null, _jsxs("button", { className: "client-request-action-button client-request-action-button--ship", type: "button", onClick: onForceOverweight, disabled: isSubmitting, title: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u0434\u0430\u0436\u0435 \u043F\u0440\u0438 \u0440\u0430\u0441\u0447\u0451\u0442\u043D\u043E\u043C \u0432\u0435\u0441\u0435 \u043A\u043E\u0440\u043E\u0431\u0430 \u0431\u043E\u043B\u0435\u0435 25 \u043A\u0433", children: [_jsx(ShieldAlert, { size: 16, "aria-hidden": "true" }), isSubmitting
                                            ? 'Закрываю заявку'
                                            : isOverweightError
                                                ? 'Пропустить 25 кг и закрыть заявку'
                                                : 'Закрыть с разрешением веса более 25 кг'] })] })] })] }) }));
}
function CloseStockRecoveryModal({ state, onBoxQuantityChange, onUseSuggestedBox, onManualBoxChange, onNoBoxQuantityChange, onChooseNoBox, onSelectItems, onToggleItem, onChooseSelectedNoBox, onSubmit, onClose, }) {
    const isBusy = state.status === 'loading' || state.status === 'submitting';
    const normalizedError = state.originalError.toLocaleLowerCase('ru-RU');
    const isGlobalProblem = isOverweightPackageError(state.originalError);
    const problemItemIds = state.data?.items
        .filter((item) => isGlobalProblem || isCloseStockRecoveryProblem(item, normalizedError))
        .map((item) => item.requestItemId) ?? [];
    const selectedCount = state.selectedItemIds.length;
    const allProblemsSelected = problemItemIds.length > 0 && problemItemIds.every((itemId) => state.selectedItemIds.includes(itemId));
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0442\u043E\u0432\u0430\u0440\u0430", children: _jsxs("section", { className: "online-execution-modal__panel manual-box-selection-modal close-stock-recovery-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0417\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u043F\u043E \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u043E\u043C\u0443 \u0444\u0430\u043A\u0442\u0443" }), _jsxs("h3", { children: ["\u2116", String(state.close.request.number).padStart(6, '0'), " \u00B7 ", state.close.request.title] }), _jsx("small", { children: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043F\u043E\u0437\u0438\u0446\u0438\u0438, \u0438\u0437-\u0437\u0430 \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", disabled: isBusy, children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body manual-box-selection-modal__body", children: [_jsxs("div", { className: "close-stock-recovery-modal__warning", children: [_jsx(ShieldAlert, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0428\u0442\u0430\u0442\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E" }), _jsx("span", { children: state.originalError })] })] }), state.data ? (_jsxs("div", { className: "close-stock-recovery-bulk", "aria-label": "\u041C\u0430\u0441\u0441\u043E\u0432\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u043C\u0438 \u0442\u043E\u0432\u0430\u0440\u0430\u043C\u0438", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0445 \u043F\u043E\u0437\u0438\u0446\u0438\u0439: ", problemItemIds.length] }), _jsxs("span", { children: ["\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ", selectedCount, ". \u041C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E, \u043D\u043E \u043D\u0435 \u0437\u0430\u043A\u0440\u043E\u0435\u0442 \u0437\u0430\u044F\u0432\u043A\u0443 \u0431\u0435\u0437 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F."] })] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", disabled: isBusy || problemItemIds.length === 0 || allProblemsSelected, onClick: () => onSelectItems(problemItemIds), children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), allProblemsSelected ? 'Все проблемные выбраны' : 'Выбрать все проблемные'] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--box-selection", type: "button", disabled: isBusy || selectedCount === 0, onClick: onChooseSelectedNoBox, children: [_jsx(Boxes, { size: 16, "aria-hidden": "true" }), "\u0412\u0441\u0435 \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] })] })) : null, isGlobalProblem ? (_jsxs("div", { className: "close-stock-recovery-weight-override", children: [_jsx(AlertTriangle, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435 25 \u043A\u0433 \u0431\u0443\u0434\u0435\u0442 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E \u0438 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043A\u0430\u043A \u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430." })] })) : null, state.status === 'loading' ? (_jsxs("p", { className: "panel-message", children: [_jsx(RefreshCw, { size: 18, "aria-hidden": "true" }), " \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0442\u043E\u0432\u0430\u0440\u044B \u0438 \u043A\u043E\u0440\u043E\u0431\u0430 \u0437\u0430\u044F\u0432\u043A\u0438."] })) : state.data ? (_jsx("div", { className: "close-stock-recovery-items", children: state.data.items.map((item) => {
                                const value = state.values[item.requestItemId];
                                if (!value)
                                    return null;
                                const itemLabel = item.sku?.name ?? item.requestedName ?? 'Товар не сопоставлен';
                                const itemCode = item.sku?.article ?? item.sku?.internalSku ?? item.requestedBarcode ?? 'без артикула';
                                const touched = state.touchedItemIds.includes(item.requestItemId);
                                const selected = state.selectedItemIds.includes(item.requestItemId);
                                const matchesError = [
                                    item.sku?.internalSku,
                                    item.sku?.article,
                                    item.sku?.name,
                                    item.requestedBarcode,
                                    item.requestedName,
                                ].some((candidate) => candidate
                                    ? normalizedError.includes(candidate.toLocaleLowerCase('ru-RU'))
                                    : false);
                                const confirmedQuantity = Object.values(value.boxQuantities).reduce((sum, quantity) => sum + (parseNonNegativeInteger(quantity || '0') ?? 0), 0) +
                                    (parseNonNegativeInteger(value.manualBoxQuantity || '0') ?? 0) +
                                    (parseNonNegativeInteger(value.noBoxQuantity || '0') ?? 0);
                                const availableBoxes = item.boxes.filter((box) => box.availableQuantity > 0);
                                const unavailableSelectedBoxes = item.boxes.filter((box) => box.availableQuantity === 0 && box.selectedQuantity > 0);
                                const incompleteFbsOrders = item.fbsOrders.filter((order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending);
                                const isProblem = isGlobalProblem || matchesError || incompleteFbsOrders.length > 0;
                                return (_jsxs("details", { className: `close-stock-recovery-item ${touched ? 'is-touched' : ''} ${selected ? 'is-selected' : ''} ${isProblem ? 'is-problem' : ''}`, open: touched || selected || isProblem, children: [_jsxs("summary", { children: [_jsx("input", { className: "close-stock-recovery-item__selector", type: "checkbox", checked: selected, disabled: isBusy, "aria-label": `Выбрать ${itemLabel}`, onClick: (event) => event.stopPropagation(), onChange: (event) => onToggleItem(item.requestItemId, event.target.checked) }), _jsxs("div", { children: [_jsx("strong", { children: itemLabel }), _jsxs("span", { children: ["\u0410\u0440\u0442\u0438\u043A\u0443\u043B: ", itemCode, " \u00B7 \u0428\u041A: ", item.sku?.barcodes.join(', ') || item.requestedBarcode || 'не указан'] }), item.itemComment ? _jsx("span", { children: item.itemComment }) : null] }), _jsxs("b", { children: [confirmedQuantity, " / ", item.requestedQuantity, " \u0448\u0442."] })] }), _jsxs("div", { className: "close-stock-recovery-item__body", children: [incompleteFbsOrders.length > 0 ? (_jsxs("div", { className: "close-stock-recovery-fbs-warning", children: [_jsx(ShieldAlert, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041D\u0443\u0436\u043D\u043E \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0442\u043E\u0432\u0430\u0440\u0430 FBS" }), _jsxs("span", { children: [incompleteFbsOrders.map((order) => (`№${order.orderId} — ${order.sourceBoxPending ? 'исходный короб не указан' : fbsAssemblyStatusLabel(order.assemblyStatus)}`)).join('; '), ". \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435, \u043E\u0442\u043A\u0443\u0434\u0430 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0432\u0437\u044F\u0442 \u0442\u043E\u0432\u0430\u0440."] })] })] })) : null, _jsxs("p", { children: ["\u0423\u043A\u0430\u0436\u0438\u0442\u0435, \u0433\u0434\u0435 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438 \u043D\u0430\u0445\u043E\u0434\u0438\u043B\u0438\u0441\u044C \u0432\u0441\u0435 ", item.requestedQuantity, " \u0448\u0442. \u044D\u0442\u043E\u0439 \u043F\u043E\u0437\u0438\u0446\u0438\u0438. \u0414\u0430\u043D\u043D\u044B\u0435 WMS \u0440\u044F\u0434\u043E\u043C \u043F\u0440\u0438\u0432\u0435\u0434\u0435\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0441\u0432\u0435\u0440\u043A\u0438 \u0438 \u043D\u0435 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0438\u0432\u0430\u044E\u0442 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430."] }), _jsxs("div", { className: "close-stock-recovery-available-heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0413\u0434\u0435 \u0442\u043E\u0432\u0430\u0440 \u0435\u0441\u0442\u044C \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438" }), _jsxs("span", { children: ["WMS \u043D\u0430\u0448\u043B\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432: ", availableBoxes.length, ". \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u043A\u043E\u0440\u043E\u0431\u0430 \u0441 \u043D\u0430\u0438\u0431\u043E\u043B\u044C\u0448\u0438\u043C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u043C."] })] }), _jsxs("b", { children: [availableBoxes.reduce((sum, box) => sum + box.availableQuantity, 0), " \u0448\u0442. \u0432\u0441\u0435\u0433\u043E"] })] }), availableBoxes.length > 0 ? (_jsx("div", { className: "close-stock-recovery-boxes", children: availableBoxes.map((box) => (_jsxs("label", { children: [_jsxs("span", { children: [_jsx("strong", { children: box.boxCode }), _jsxs("small", { children: ["\u0421\u0435\u0439\u0447\u0430\u0441 \u0432 WMS: ", box.availableQuantity, " \u0448\u0442. \u00B7", ' ', box.statuses.map((row) => `${stockStatusLabel(row.status)} ${row.quantity}`).join(', ') || 'остаток не найден'] })] }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: value.boxQuantities[box.boxCode] ?? '', placeholder: "0", disabled: isBusy, "aria-label": `Фактически взято из короба ${box.boxCode}`, onChange: (event) => onBoxQuantityChange(item.requestItemId, box.boxCode, event.target.value) }), _jsx("button", { type: "button", disabled: isBusy, onClick: () => onUseSuggestedBox(item.requestItemId, box.boxCode, Math.min(item.requestedQuantity, box.availableQuantity)), children: box.availableQuantity >= item.requestedQuantity
                                                                    ? 'Взять всё отсюда'
                                                                    : `Начать с ${box.availableQuantity} шт.` })] }, box.boxId))) })) : (_jsx("p", { className: "manual-box-selection-item__empty", children: "WMS \u043D\u0435 \u043D\u0430\u0448\u043B\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u044D\u0442\u0438\u043C \u0442\u043E\u0432\u0430\u0440\u043E\u043C." })), unavailableSelectedBoxes.length > 0 ? (_jsxs("div", { className: "close-stock-recovery-stale-boxes", children: [_jsx("strong", { children: "\u0420\u0430\u043D\u0435\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430, \u0433\u0434\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u0430" }), unavailableSelectedBoxes.map((box) => (_jsxs("label", { children: [_jsx("span", { children: box.boxCode }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: value.boxQuantities[box.boxCode] ?? '', placeholder: "0", disabled: isBusy, onChange: (event) => onBoxQuantityChange(item.requestItemId, box.boxCode, event.target.value) })] }, box.boxId)))] })) : null, _jsxs("div", { className: "close-stock-recovery-manual-box", children: [_jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u0414\u0440\u0443\u0433\u043E\u0439 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043A\u043E\u0440\u043E\u0431" }), _jsx("input", { type: "text", value: value.manualBoxCode, placeholder: "\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u0438\u043B\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u043E\u043C\u0435\u0440 \u043A\u043E\u0440\u043E\u0431\u0430", disabled: isBusy, onChange: (event) => onManualBoxChange(item.requestItemId, { manualBoxCode: event.target.value }) })] }), _jsxs("label", { className: "form-field close-stock-recovery-manual-box__quantity", children: [_jsx("span", { children: "\u0412\u0437\u044F\u0442\u043E, \u0448\u0442." }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: value.manualBoxQuantity, placeholder: "0", disabled: isBusy, onChange: (event) => onManualBoxChange(item.requestItemId, { manualBoxQuantity: event.target.value }) })] })] }), _jsxs("div", { className: `close-stock-recovery-no-box ${value.noBoxQuantity ? 'is-selected' : ''}`, children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0422\u043E\u0432\u0430\u0440 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438 \u0431\u044B\u043B \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u044D\u0442\u043E\u0442 \u0432\u0430\u0440\u0438\u0430\u043D\u0442, \u0435\u0441\u043B\u0438 \u043D\u043E\u043C\u0435\u0440\u0430 \u043A\u043E\u0440\u043E\u0431\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u043D\u0435\u0442." })] }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: value.noBoxQuantity, placeholder: "0", disabled: isBusy, "aria-label": "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u0430", onChange: (event) => onNoBoxQuantityChange(item.requestItemId, event.target.value) }), _jsx("button", { type: "button", disabled: isBusy, onClick: () => onChooseNoBox(item.requestItemId, item.requestedQuantity), children: "\u0412\u0435\u0441\u044C \u0442\u043E\u0432\u0430\u0440 \u0431\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u0430" })] })] })] }, item.requestItemId));
                            }) })) : null, state.error ? _jsx("p", { className: "form-error manual-box-selection-modal__error", children: state.error }) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, disabled: isBusy, children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("button", { className: "client-request-action-button client-request-action-button--ship", type: "button", onClick: onSubmit, disabled: isBusy || !state.data, children: [_jsx(Truck, { size: 16, "aria-hidden": "true" }), state.status === 'submitting' ? 'Закрываю заявку' : 'Подтвердить источник и сдать'] })] })] })] }) }));
}
function BoxOverlapStatistics({ state, }) {
    if (state.status === 'idle')
        return null;
    if (state.status === 'loading' && !state.data) {
        return _jsx("section", { className: "box-overlap-panel is-loading", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u043F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0432 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u044F\u0432\u043A\u0430\u0445..." });
    }
    if (state.status === 'error' && !state.data) {
        return _jsxs("section", { className: "box-overlap-panel is-error", children: ["\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F: ", state.error] });
    }
    const statistics = state.data;
    if (!statistics)
        return null;
    const hasOverlaps = statistics.overlappingBoxesCount > 0;
    return (_jsxs("details", { className: `box-overlap-panel ${hasOverlaps ? 'has-conflicts' : 'is-clear'}`, children: [_jsxs("summary", { children: [_jsx("span", { className: "box-overlap-panel__icon", children: hasOverlaps ? _jsx(ShieldAlert, { size: 20, "aria-hidden": "true" }) : _jsx(Boxes, { size: 20, "aria-hidden": "true" }) }), _jsxs("span", { children: [_jsx("strong", { children: hasOverlaps ? 'Обнаружены пересечения коробов' : 'Пересечений коробов нет' }), _jsxs("small", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u0437\u0430\u044F\u0432\u043E\u043A: ", statistics.checkedRequestsCount, " \u0438\u0437 ", statistics.activeRequestsCount, ". \u041E\u0431\u0449\u0438\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432:", ' ', statistics.overlappingBoxesCount, "."] })] }), _jsx("span", { className: "box-overlap-panel__count", children: statistics.overlappingBoxesCount })] }), _jsxs("div", { className: "box-overlap-panel__body", children: [_jsxs("div", { className: "box-overlap-metrics", children: [_jsxs("article", { children: [_jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsx("strong", { children: statistics.activeRequestsCount })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0438 \u0441 \u043A\u043E\u043D\u0444\u043B\u0438\u043A\u0442\u043E\u043C" }), _jsx("strong", { children: statistics.requestsWithOverlapsCount })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0435\u0441\u0435\u043A\u0430\u044E\u0449\u0438\u0435\u0441\u044F \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("strong", { children: statistics.overlappingBoxesCount })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041E\u0448\u0438\u0431\u043A\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438" }), _jsx("strong", { children: statistics.errors.length })] })] }), statistics.overlaps.length > 0 ? (_jsx("div", { className: "box-overlap-list", children: statistics.overlaps.map((overlap) => (_jsxs("article", { className: "box-overlap-card", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("strong", { children: overlap.boxCode })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("strong", { children: overlap.client.name })] }), _jsxs("b", { children: [overlap.requests.length, " \u0437\u0430\u044F\u0432\u043A\u0438"] })] }), _jsx("div", { className: "box-overlap-card__requests", children: overlap.requests.map((request) => (_jsxs("div", { children: [_jsxs("strong", { children: ["\u2116", String(request.number).padStart(6, '0'), " \u00B7 ", request.title] }), _jsx("span", { children: requestStatusLabel(request.status) }), _jsx("small", { children: request.destinationCity || 'Город не указан' })] }, request.id))) })] }, `${overlap.clientId}-${overlap.boxCode}`))) })) : (_jsx("p", { className: "box-overlap-panel__empty", children: "\u041A\u0430\u0436\u0434\u044B\u0439 \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u043E\u0439 \u043A\u043E\u0440\u043E\u0431 \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u043E\u0434\u043D\u043E\u0439 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u043E\u0439." })), statistics.errors.length > 0 ? (_jsxs("div", { className: "box-overlap-errors", children: [_jsx("strong", { children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" }), statistics.errors.map((error) => _jsxs("span", { children: [error.title, ": ", error.message] }, error.requestId))] })) : null] })] }));
}
function ManualInstructionUploadModal({ state, onFileChange, onSubmit, onClose, }) {
    const isSubmitting = state.status === 'submitting';
    const movements = state.result?.warehouseBalanceMoves?.length ?? 0;
    const relabels = state.result?.warehouseMarkRows?.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
    return (_jsx("div", { className: "online-execution-modal manual-instruction-modal-shell", role: "dialog", "aria-modal": "true", "aria-label": "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u0432\u043E\u0435\u0439 \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u043E\u0439 \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u0438", children: _jsxs("section", { className: "online-execution-modal__panel manual-instruction-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0421\u0432\u043E\u044F \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0430\u044F \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F" }), _jsx("h3", { children: state.request.title }), _jsx("small", { children: state.request.client.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body", children: [_jsxs("div", { className: "manual-instruction-modal__warning", children: [_jsx(AlertTriangle, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u043D \u0437\u0430\u044F\u0432\u043A\u0438 \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0435\u043D \u0441\u0440\u0430\u0437\u0443." }), _jsx("span", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442 \u043B\u0438\u0441\u0442\u044B \u00AB\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F\u00BB, \u00AB\u0426\u0435\u043B\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430\u00BB \u0438 \u00AB\u041C\u0410\u0420\u041A\u00BB, \u0437\u0430\u0442\u0435\u043C \u0437\u0430\u043C\u0435\u043D\u0438\u0442 \u043F\u043E\u0438\u0441\u043A \u043A\u043E\u0440\u043E\u0431\u043E\u0432, \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0443 \u0438 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0432 \u0422\u0421\u0414. \u0423\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u0441\u043E\u0432\u043C\u0435\u0441\u0442\u0438\u043C\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F." })] })] }), _jsxs("label", { className: "form-field", children: [_jsx("span", { children: "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F XLSX" }), _jsx("input", { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disabled: isSubmitting || state.status === 'done', onChange: (event) => onFileChange(event.target.files?.[0] ?? null) })] }), state.file ? _jsxs("p", { className: "manual-instruction-modal__file", children: ["\u0412\u044B\u0431\u0440\u0430\u043D \u0444\u0430\u0439\u043B: ", state.file.name] }) : null, state.error ? _jsx("p", { className: "form-error manual-instruction-modal__error", children: state.error }) : null, state.result ? (_jsxs("div", { className: "manual-instruction-modal__result", children: [_jsx("strong", { children: "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430, \u043F\u043B\u0430\u043D \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0435\u043D." }), _jsxs("span", { children: ["\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u0432 \u043F\u043E\u0438\u0441\u043A\u0435: ", state.result.boxesCount] }), _jsxs("span", { children: ["\u041A \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0435: ", state.result.totalAllocated, " \u0448\u0442."] }), _jsxs("span", { children: ["\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439: ", movements, " \u0441\u0442\u0440\u043E\u043A"] }), _jsxs("span", { children: ["\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430: ", relabels, " \u0448\u0442."] }), _jsxs("span", { children: ["\u0414\u0435\u0444\u0438\u0446\u0438\u0442: ", state.result.totalShortage, " \u0448\u0442."] })] })) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, children: state.status === 'done' ? 'Закрыть' : 'Отмена' }), _jsxs("button", { className: "client-request-action-button client-request-action-button--manual-instruction", type: "button", onClick: onSubmit, disabled: isSubmitting || state.status === 'done' || !state.file, children: [_jsx(FileUp, { size: 16, "aria-hidden": "true" }), isSubmitting ? 'Проверяю и перестраиваю' : state.status === 'done' ? 'План перестроен' : 'Загрузить и перестроить'] })] })] })] }) }));
}
function EmergencyPackedXlsxModal({ state, onFileChange, onSubmit, onClose, }) {
    const isSubmitting = state.status === 'submitting';
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u0430\u044F \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0430 \u0437\u0430\u044F\u0432\u043A\u0438", children: _jsxs("section", { className: "online-execution-modal__panel emergency-xlsx-modal", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u0430\u044F \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0430 \u043F\u043E Excel" }), _jsx("h3", { children: state.request.title }), _jsx("small", { children: state.request.client.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-execution-modal__body", children: [_jsxs("div", { className: "emergency-xlsx-modal__warning", children: [_jsx("strong", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 Excel \u0441\u043E \u0441\u043F\u0438\u0441\u043A\u043E\u043C \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432." }), _jsx("span", { children: "\u0412 \u043F\u0435\u0440\u0432\u043E\u043C \u0441\u0442\u043E\u043B\u0431\u0446\u0435 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u043D\u043E\u043C\u0435\u0440\u0443 FFL \u043D\u0430 \u0441\u0442\u0440\u043E\u043A\u0443. WMS \u0441\u0432\u0435\u0440\u0438\u0442 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u0437\u0430\u044F\u0432\u043A\u043E\u0439, \u0441\u043F\u0438\u0448\u0435\u0442 \u0435\u0433\u043E \u0438 \u043F\u0435\u0440\u0435\u0432\u0435\u0434\u0435\u0442 \u0437\u0430\u044F\u0432\u043A\u0443 \u0432 \u0441\u0442\u0430\u0442\u0443\u0441 \u00AB\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u0430\u00BB." })] }), _jsxs("label", { className: "form-field", children: [_jsx("span", { children: "Excel-\u0444\u0430\u0439\u043B" }), _jsx("input", { type: "file", accept: ".xlsx,.xls", disabled: isSubmitting || state.status === 'done', onChange: (event) => onFileChange(event.target.files?.[0] ?? null) })] }), state.file ? _jsxs("p", { className: "emergency-xlsx-modal__file", children: ["\u0412\u044B\u0431\u0440\u0430\u043D \u0444\u0430\u0439\u043B: ", state.file.name] }) : null, state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, state.result ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "inline-status", children: ["\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043E: \u043A\u043E\u0440\u043E\u0431\u043E\u0432 ", state.result.boxes, ", \u0435\u0434\u0438\u043D\u0438\u0446 ", state.result.packedUnits, ", \u043F\u0430\u043B\u043B\u0435\u0442 ", state.result.pallets, ". \u0424\u0430\u0439\u043B\u044B WB \u0433\u043E\u0442\u043E\u0432\u044B."] }), state.result.warnings.length > 0 ? (_jsxs("div", { className: "emergency-xlsx-modal__warning emergency-xlsx-modal__warning--result", children: [_jsx("strong", { children: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043E \u0441 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F\u043C\u0438" }), _jsxs("span", { children: ["\u041D\u0435 \u0441\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E (\u0432\u043A\u043B\u044E\u0447\u0430\u044F \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u0443\u044E \u043F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0443): ", state.result.shortageQuantity, " \u0448\u0442. \u0418\u0437\u043B\u0438\u0448\u0435\u043A \u043F\u043E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u043C \u043A\u043E\u0440\u043E\u0431\u0430\u043C: ", state.result.excessQuantity, " \u0448\u0442."] }), _jsx("ul", { children: state.result.warnings.map((warning, index) => (_jsx("li", { children: warning.message }, `${warning.code}-${warning.boxCode ?? warning.skuId ?? index}-${index}`))) })] })) : null] })) : null, _jsxs("div", { className: "emergency-xlsx-modal__actions", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx("button", { className: "client-request-action-button client-request-action-button--emergency", type: "button", onClick: onSubmit, disabled: isSubmitting || state.status === 'done' || !state.file, "aria-busy": isSubmitting, children: isSubmitting
                                        ? 'Списываю короба и упаковываю'
                                        : state.status === 'done'
                                            ? 'Заявка упакована'
                                            : 'Упаковать по списку коробов' })] })] })] }) }));
}
function OnlineFbsMoveTargetDialog({ state, onChange, onConfirm, onClose, }) {
    const selectedCandidate = state.candidates.find((candidate) => candidate.supplyId === state.targetSupplyId);
    return (_jsx("div", { className: "online-fbs-move-target-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041A\u0443\u0434\u0430 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 FBS-\u0437\u0430\u043A\u0430\u0437\u044B", children: _jsxs("section", { className: "online-fbs-move-target-modal__panel", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0435\u043D\u043E\u0441 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("h3", { children: "\u041A\u0443\u0434\u0430 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438" }), _jsxs("small", { children: [state.orders.length, " \u0437\u0430\u043A\u0430\u0437(\u0430/\u043E\u0432) \u00B7 \u0433\u043E\u0440\u043E\u0434 ", state.sourceCity] })] }), _jsx("button", { type: "button", className: "icon-button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "online-fbs-move-target-modal__body", children: [_jsxs("label", { className: `online-fbs-move-target-card${state.targetSupplyId === '__new__' ? ' is-selected' : ''}`, children: [_jsx("input", { type: "radio", name: "online-fbs-move-target", checked: state.targetSupplyId === '__new__', onChange: () => onChange('__new__') }), _jsx("span", { className: "online-fbs-move-target-card__icon", children: _jsx(ArrowRightLeft, { size: 20, "aria-hidden": "true" }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u0412 \u043D\u043E\u0432\u0443\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 WB" }), _jsx("small", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u0441\u043E\u0437\u0434\u0430\u0441\u0442 \u043D\u043E\u0432\u0443\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0438 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443 WMS." })] })] }), _jsxs("div", { className: "online-fbs-move-target-modal__available", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0442\u043E\u0433\u043E \u0436\u0435 \u0433\u043E\u0440\u043E\u0434\u0430" }), _jsx("span", { children: state.candidates.length })] }), state.candidates.length > 0 ? (state.candidates.map((candidate) => (_jsxs("label", { className: `online-fbs-move-target-card${state.targetSupplyId === candidate.supplyId ? ' is-selected' : ''}`, children: [_jsx("input", { type: "radio", name: "online-fbs-move-target", checked: state.targetSupplyId === candidate.supplyId, onChange: () => onChange(candidate.supplyId) }), _jsx("span", { className: "online-fbs-move-target-card__icon", children: _jsx(Truck, { size: 20, "aria-hidden": "true" }) }), _jsxs("span", { children: [_jsx("strong", { children: candidate.supplyId }), _jsxs("small", { children: [candidate.city, " \u00B7 \u0437\u0430\u044F\u0432\u043A\u0430 \u2116", String(candidate.requestNumber).padStart(6, '0'), " \u00B7 ", candidate.orderCount, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u00B7 ", candidate.itemCount, " \u0435\u0434."] })] })] }, candidate.supplyId)))) : (_jsxs("p", { children: ["\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0445 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u0433\u043E\u0440\u043E\u0434\u0430 ", state.sourceCity, ", \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u044E\u0442 \u043D\u043E\u0432\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B."] }))] })] }), _jsxs("footer", { children: [_jsx("button", { type: "button", onClick: onClose, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { type: "button", className: "primary", onClick: onConfirm, children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), selectedCandidate
                                    ? `Перенести в ${selectedCandidate.supplyId}`
                                    : 'Создать и перенести'] })] })] }) }));
}
function OnlineExecutionModal({ request, plan, status, error, movingOrderId, moveMessage, moveError, resolvingKizId, kizResolutionMessage, kizResolutionError, resolvingSyncConflictId, syncConflictResolutionMessage, syncConflictResolutionError, onResolveKiz, onRestoreRescanKiz, onResolveSyncConflict, onResetFbsAssembly, onMarkPackedWithoutSource, onMoveOrder, onMoveOrders, onClose, onRefresh, onDownloadBoxes, onDownloadContents, onDownloadMovements, }) {
    const [movementSearch, setMovementSearch] = useState('');
    const [actualMovementSearch, setActualMovementSearch] = useState('');
    const [fbsAssemblySearch, setFbsAssemblySearch] = useState('');
    const [notCollectedSearch, setNotCollectedSearch] = useState('');
    const [selectedNotCollectedOrders, setSelectedNotCollectedOrders] = useState([]);
    const [wmsBoxesOpen, setWmsBoxesOpen] = useState(false);
    const wmsBoxesRef = useRef(null);
    const searchBoxes = normalizeOnlineBoxes(plan?.searchBoxes ?? plan?.boxesToSearch ?? []);
    const palletSortByBoxCode = new Map(searchBoxes
        .filter((box) => box.storageLocation?.palletCode)
        .map((box) => [
        normalizeCode(box.boxCode),
        box.storageLocation.palletCode,
    ]));
    const foundCodes = new Set([...(plan?.boxSearchProgress?.foundBoxCodes ?? []), ...(plan?.foundBoxCodes ?? []), ...(plan?.foundBoxesCodes ?? [])].map(normalizeCode));
    const searchTotal = plan?.boxSearchProgress?.total ?? searchBoxes.length;
    const foundCount = plan?.boxSearchProgress?.found ??
        searchBoxes.filter((box) => box.found || box.isFound || foundCodes.has(normalizeCode(box.boxCode))).length;
    const remainingCount = Math.max(0, searchTotal - foundCount);
    const relabelTotal = plan?.relabelTotal ?? plan?.relabelTasks?.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
    const movementTotal = plan?.movementProgress?.totalRequired ?? plan?.movementRequiredTotal ?? plan?.movementTotal ?? 0;
    const movementDone = plan?.movementProgress?.totalMoved ?? 0;
    const movementRemaining = plan?.movementProgress?.totalRemaining ?? Math.max(0, movementTotal - movementDone);
    const isClosedForOnline = plan ? ['PACKED', 'DONE'].includes(plan.status) : false;
    const progressPercent = Math.round(averageProgress([
        progressRatio(foundCount, searchTotal),
        relabelTotal > 0 ? (isClosedForOnline ? 1 : 0) : 1,
        progressRatio(movementDone, movementTotal),
    ]) * 100);
    const movementRows = plan?.movementProgress?.rows ?? [];
    const movementSourceBoxes = plan?.movementProgress?.sourceBoxes ?? [];
    const actualMovements = plan?.movementProgress?.actualRows ?? [];
    const fbsAssembly = plan?.fbsAssembly ?? null;
    const wmsBoxes = fbsAssembly?.wmsBoxes ?? null;
    const notCollected = fbsAssembly?.notCollected ?? null;
    const returnRequired = fbsAssembly?.returnRequired ?? null;
    const rescanRequiredRows = (fbsAssembly?.rows ?? []).filter((row) => row.status === 'RESCAN_REQUIRED');
    const normalizedFbsAssemblySearch = fbsAssemblySearch.trim().toLocaleLowerCase('ru-RU');
    const filteredFbsAssemblyRows = (fbsAssembly?.rows ?? []).filter((row) => !normalizedFbsAssemblySearch ||
        [
            row.sourceBoxCode,
            row.orderId,
            row.productBarcode,
            row.size,
            row.wbStickerPartB,
            row.wbStickerBarcode,
            row.productName,
            row.article,
        ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(normalizedFbsAssemblySearch)));
    const normalizedNotCollectedSearch = notCollectedSearch.trim().toLocaleLowerCase('ru-RU');
    const filteredNotCollectedRows = (notCollected?.rows ?? []).filter((row) => !normalizedNotCollectedSearch ||
        [
            row.name,
            row.article,
            row.color,
            row.size,
            row.barcode,
            ...row.orderIds,
            ...row.availableBoxes.map((box) => box.boxCode),
        ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(normalizedNotCollectedSearch)));
    const notCollectedOrders = [...new Map((notCollected?.rows ?? [])
            .flatMap((row) => row.orders)
            .map((order) => [onlineFbsOrderKey(order), order])).values()];
    const notCollectedOrderKeys = notCollectedOrders.map(onlineFbsOrderKey);
    const selectedNotCollectedOrderRows = notCollectedOrders.filter((order) => selectedNotCollectedOrders.includes(onlineFbsOrderKey(order)));
    const allNotCollectedOrdersSelected = notCollectedOrderKeys.length > 0 &&
        notCollectedOrderKeys.every((key) => selectedNotCollectedOrders.includes(key));
    useEffect(() => {
        setSelectedNotCollectedOrders((current) => current.filter((key) => notCollectedOrderKeys.includes(key)));
    }, [notCollectedOrderKeys.join('|')]);
    const outgoingBoxes = normalizeOutgoingBoxes(plan);
    const filteredMovementRows = movementRows.filter((row) => movementRowMatchesSearch(row, movementSearch));
    const filteredActualMovements = actualMovements.filter((row) => movementRowMatchesSearch(row, actualMovementSearch));
    return (_jsx("div", { className: "online-execution-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041E\u043D\u043B\u0430\u0439\u043D-\u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", children: _jsxs("section", { className: "online-execution-modal__panel", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041E\u043D\u043B\u0430\u0439\u043D \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435" }), _jsx("h3", { children: request.title }), _jsxs("small", { children: [request.client.name, " \u00B7 ", request.destinationCity ?? 'город не указан'] })] }), _jsxs("div", { className: "online-execution-modal__actions", children: [_jsxs("button", { className: "client-request-action-button client-request-action-button--wms-boxes", type: "button", onClick: () => {
                                        setWmsBoxesOpen(true);
                                        requestAnimationFrame(() => {
                                            wmsBoxesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                        });
                                    }, disabled: status === 'loading' || !fbsAssembly, title: "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D\u043D\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 WMS", children: [_jsx(Boxes, { size: 16, "aria-hidden": "true" }), "\u041A\u043E\u0440\u043E\u0431\u0430 WMS", wmsBoxes ? _jsx("strong", { children: wmsBoxes.packedUnits }) : null] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", onClick: onDownloadBoxes, disabled: status === 'loading' || !plan, children: [_jsx(FileDown, { size: 16, "aria-hidden": "true" }), "\u041A\u043E\u0440\u043E\u0431\u0430 Excel"] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", onClick: onDownloadContents, disabled: status === 'loading' || !plan, children: [_jsx(FileDown, { size: 16, "aria-hidden": "true" }), "\u0421\u043E\u0441\u0442\u0430\u0432 Excel"] }), _jsx("button", { className: "icon-button", type: "button", onClick: onRefresh, title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043E\u043D\u043B\u0430\u0439\u043D-\u0434\u0430\u043D\u043D\u044B\u0435", disabled: status === 'loading', children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] })] }), status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041F\u043E\u043B\u0443\u0447\u0430\u044E \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F." }) : null, status === 'error' ? _jsx("p", { className: "form-error", children: error ?? 'Не удалось получить онлайн-выполнение.' }) : null, moveMessage ? _jsx("p", { className: "online-execution-action-message", children: moveMessage }) : null, moveError ? _jsx("p", { className: "form-error online-execution-action-error", children: moveError }) : null, kizResolutionMessage ? _jsx("p", { className: "online-execution-action-message", children: kizResolutionMessage }) : null, kizResolutionError ? _jsx("p", { className: "form-error online-execution-action-error", children: kizResolutionError }) : null, syncConflictResolutionMessage ? _jsx("p", { className: "online-execution-action-message", children: syncConflictResolutionMessage }) : null, syncConflictResolutionError ? _jsx("p", { className: "form-error online-execution-action-error", children: syncConflictResolutionError }) : null, plan ? (_jsxs("div", { className: "online-execution-modal__body", children: [_jsxs("section", { className: "online-execution-progress", children: [_jsxs("div", { children: [_jsxs("strong", { children: [progressPercent, "%"] }), _jsxs("span", { children: ["\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432 ", foundCount, " \u0438\u0437 ", searchTotal, " \u00B7 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ", remainingCount, " \u00B7 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u043E ", movementDone, " \u0438\u0437 ", movementTotal] })] }), _jsx("meter", { min: 0, max: 100, value: progressPercent })] }), _jsxs("div", { className: "online-execution-metrics", children: [_jsxs("article", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 WMS" }), _jsx("strong", { children: plan.statusLabel ?? plan.status })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsxs("strong", { children: [foundCount, " / ", searchTotal] })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430" }), _jsxs("strong", { children: [relabelTotal, " \u0448\u0442."] })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F" }), _jsxs("strong", { children: [movementDone, " / ", movementTotal] })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041D\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443" }), _jsx("strong", { children: outgoingBoxes.length })] }), notCollected ? (_jsxs("article", { className: notCollected.remainingUnits > 0 ? 'is-warning' : 'is-done', children: [_jsx("span", { children: "\u041D\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u043E" }), _jsxs("strong", { children: [notCollected.remainingUnits, " \u0448\u0442."] })] })) : null, returnRequired && returnRequired.orders > 0 ? (_jsxs("article", { className: "is-danger", children: [_jsx("span", { children: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F" }), _jsx("strong", { children: returnRequired.orders })] })) : null] }), fbsAssembly ? (_jsxs(_Fragment, { children: [_jsxs("details", { className: "online-execution-section online-execution-section--wms-boxes", open: wmsBoxesOpen, onToggle: (event) => setWmsBoxesOpen(event.currentTarget.open), ref: wmsBoxesRef, children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsx(Boxes, { size: 18, "aria-hidden": "true" }), _jsx("strong", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 WMS" }), _jsx("small", { children: "\u043D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0443" })] }), _jsxs("b", { children: [wmsBoxes?.packedUnits ?? 0, " \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D\u043E \u00B7 ", wmsBoxes?.remainingUnits ?? fbsAssembly.totalOrders, " \u0435\u0449\u0451 \u043D\u0435\u0442"] })] }), _jsxs("div", { className: "online-execution-wms-boxes", children: [wmsBoxes && wmsBoxes.boxes.length > 0 ? (_jsx("div", { className: "online-execution-wms-box-list", children: wmsBoxes.boxes.map((box) => (_jsxs("details", { className: "online-execution-wms-box", children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsx("strong", { children: box.code }), _jsxs("small", { children: [box.status === 'CLOSED' ? 'закрыт' : 'открыт', " \u00B7 ", box.items.reduce((sum, item) => sum + item.quantity, 0), " \u0435\u0434."] })] }), _jsx("span", { children: box.closedByName || box.openedByName || box.deviceCode || 'ТСД' })] }), _jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--wms-box", children: _jsxs("table", { className: "online-execution-table online-execution-table--wms-box", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437 WB" }), _jsx("th", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D \u0442\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041D\u0430\u043A\u043B\u0435\u0439\u043A\u0430 WB" }), _jsx("th", { children: "\u041A\u043E\u0433\u0434\u0430" })] }) }), _jsx("tbody", { children: box.items.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\u2116", item.orderId] }) }), _jsxs("td", { children: [_jsx("strong", { children: item.productName }), _jsx("span", { children: item.article ? `арт. ${item.article}` : 'артикул не указан' })] }), _jsx("td", { children: item.productBarcode ?? '—' }), _jsx("td", { children: _jsx("strong", { children: item.size ?? '—' }) }), _jsx("td", { children: item.kiz ?? 'без КИЗ' }), _jsx("td", { children: _jsx("strong", { className: "online-execution-wb-digits", children: item.wbStickerPartB ?? '—' }) }), _jsxs("td", { children: [_jsx("strong", { children: item.packedByName ?? box.closedByName ?? box.openedByName ?? 'ТСД' }), _jsx("span", { children: formatOnlineDateTime(item.packedAt ?? box.openedAt) })] })] }, item.id))) })] }) })] }, box.id))) })) : (_jsx("p", { className: "online-execution-empty", children: "\u0412 \u044D\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D \u043D\u0438 \u043E\u0434\u0438\u043D \u043A\u043E\u0440\u043E\u0431 WMS." })), _jsxs("section", { className: "online-execution-wms-boxes__remaining", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: "\u0427\u0442\u043E \u0435\u0449\u0451 \u043D\u0435 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D\u043E \u0432 \u043A\u043E\u0440\u043E\u0431\u0430 WMS" }), _jsxs("span", { children: [wmsBoxes?.notPacked.length ?? fbsAssembly.totalOrders, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] })] }), wmsBoxes && wmsBoxes.notPacked.length > 0 ? (_jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--wms-remaining", children: _jsxs("table", { className: "online-execution-table online-execution-table--wms-remaining", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437 WB" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0428\u041A WB" }), _jsx("th", { children: "\u041F\u043E\u0447\u0435\u043C\u0443 \u0435\u0449\u0451 \u043D\u0435 \u0432 \u043A\u043E\u0440\u043E\u0431\u0435" })] }) }), _jsx("tbody", { children: wmsBoxes.notPacked.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\u2116", item.orderId] }) }), _jsxs("td", { children: [_jsx("strong", { children: item.productName }), _jsx("span", { children: item.article ? `арт. ${item.article}` : 'артикул не указан' })] }), _jsx("td", { children: item.productBarcode ?? '—' }), _jsx("td", { children: _jsx("strong", { children: item.size ?? '—' }) }), _jsx("td", { children: _jsx("strong", { children: item.wbStickerPartB ?? '—' }) }), _jsx("td", { children: _jsx("span", { className: `online-execution-pill ${item.readyForPacking ? 'is-open' : 'is-danger'}`, children: item.readyForPacking ? 'Собран — нужно упаковать' : item.assemblyStatusLabel }) })] }, item.orderId))) })] }) })) : (_jsx("p", { className: "online-execution-empty online-execution-empty--done", children: "\u0412\u0441\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u044D\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D\u044B \u0432 \u043A\u043E\u0440\u043E\u0431\u0430 WMS." }))] })] })] }), fbsAssembly.kizConflicts?.length ? (_jsxs("section", { className: "online-execution-section online-execution-section--kiz-conflict", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsxs("div", { children: [_jsxs("h4", { children: [_jsx(ShieldAlert, { size: 18, "aria-hidden": "true" }), "\u041A\u0418\u0417 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438"] }), _jsx("span", { children: "WMS \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u043B\u0430 \u043D\u0435\u0443\u0434\u0430\u0447\u043D\u044B\u0439 \u0441\u043A\u0430\u043D. \u041A\u043D\u043E\u043F\u043A\u0430 \u0441\u0432\u0435\u0440\u0438\u0442 \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0443 \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438 WB, \u0441\u043D\u0438\u043C\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0443\u044E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0443." })] }), _jsx("strong", { children: fbsAssembly.kizConflicts.length })] }), _jsx("div", { className: "online-execution-kiz-conflict-list", children: fbsAssembly.kizConflicts.map((conflict) => (_jsxs("article", { children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0417\u0430\u043A\u0430\u0437 WB \u2116", conflict.orderId] }), _jsxs("span", { children: [conflict.productName, conflict.article ? ` · арт. ${conflict.article}` : '', conflict.sourceBoxCode ? ` · короб ${conflict.sourceBoxCode}` : ''] }), _jsx("code", { children: conflict.kiz }), _jsx("small", { children: conflict.message })] }), onResolveKiz ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--kiz-fix", type: "button", disabled: Boolean(resolvingKizId), onClick: () => onResolveKiz(conflict.id), children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true", className: resolvingKizId === conflict.id ? 'is-spinning' : undefined }), resolvingKizId === conflict.id
                                                                ? 'Проверяю в WB…'
                                                                : 'Проверить и исправить КИЗ'] })) : null] }, conflict.id))) })] })) : null, rescanRequiredRows.length > 0 ? (_jsxs("section", { className: "online-execution-section online-execution-section--sync-conflict", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsxs("div", { children: [_jsxs("h4", { children: [_jsx(ShieldAlert, { size: 18, "aria-hidden": "true" }), "\u041A\u0418\u0417 \u0432\u0432\u0435\u0434\u0451\u043D \u0432\u0440\u0443\u0447\u043D\u0443\u044E \u0432 Wildberries"] }), _jsx("span", { children: "\u0415\u0441\u043B\u0438 \u041A\u0418\u0417 \u0443\u0436\u0435 \u043F\u0440\u043E\u043F\u0438\u043A\u0430\u043D \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435 WB, \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443: WMS \u043F\u043E\u043B\u0443\u0447\u0438\u0442 \u0435\u0433\u043E \u0438\u0437 Wildberries \u0438 \u0432\u0435\u0440\u043D\u0451\u0442 \u0437\u0430\u043A\u0430\u0437 \u0432 \u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0431\u0435\u0437 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0433\u043E \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0442\u043E\u0432\u0430\u0440\u0430." })] }), _jsx("strong", { children: rescanRequiredRows.length })] }), _jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--sync-conflict", children: _jsxs("table", { className: "online-execution-table online-execution-table--sync-conflict", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437 WB" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: rescanRequiredRows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\u2116", row.orderId] }) }), _jsxs("td", { children: [_jsx("strong", { children: row.productName }), _jsx("span", { children: [row.article, row.size].filter(Boolean).join(' · ') })] }), _jsx("td", { children: _jsx("strong", { children: row.sourceBoxCode ?? 'без короба' }) }), _jsx("td", { children: row.statusLabel }), _jsx("td", { children: onRestoreRescanKiz ? (_jsxs("button", { type: "button", className: "online-execution-sync-conflict-button is-manager", onClick: () => onRestoreRescanKiz(row.id), disabled: resolvingKizId !== null, children: [_jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }), resolvingKizId === row.id
                                                                                ? 'Проверяю WB…'
                                                                                : 'КИЗ уже введён в WB'] })) : (_jsx("span", { children: "\u041D\u0443\u0436\u043D\u044B \u043F\u0440\u0430\u0432\u0430 \u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043E\u043A" })) })] }, row.id))) })] }) })] })) : null, fbsAssembly.duplicateKizScans?.length ? (_jsxs("details", { className: "online-execution-section online-execution-section--duplicate-kiz", open: true, children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsx(AlertTriangle, { size: 18, "aria-hidden": "true" }), _jsx("strong", { children: "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043F\u0440\u043E\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u041A\u0418\u0417" })] }), _jsx("b", { children: fbsAssembly.duplicateKizScans.length })] }), _jsx("div", { className: "online-execution-duplicate-kiz-list", children: fbsAssembly.duplicateKizScans.map((event) => (_jsxs("article", { children: [_jsx("code", { children: event.kiz }), _jsxs("div", { className: "online-execution-duplicate-kiz-occurrences", children: [_jsxs("div", { className: "is-attempt", children: [_jsx("span", { children: "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 \u0441\u043A\u0430\u043D" }), _jsx("strong", { children: formatOnlineDateTime(event.attempt.scannedAt) }), _jsxs("small", { children: [onlineRequestNumber(event.attempt.requestNumber), " \u00B7 \u0437\u0430\u043A\u0430\u0437 \u2116", event.attempt.orderId] }), _jsxs("small", { children: ["\u043A\u043E\u0440\u043E\u0431 ", event.attempt.boxCode, " \u00B7 ", event.attempt.workerName || event.attempt.deviceCode || 'сотрудник не указан'] }), event.attempt.deviceCode ? _jsxs("small", { children: ["\u0422\u0421\u0414: ", event.attempt.deviceCode] }) : null] }), _jsxs("div", { className: "is-existing", children: [_jsx("span", { children: "\u0413\u0434\u0435 \u041A\u0418\u0417 \u0443\u0436\u0435 \u0431\u044B\u043B \u043F\u0440\u0438\u043D\u044F\u0442" }), _jsx("strong", { children: formatOnlineDateTime(event.existing.scannedAt) }), _jsxs("small", { children: [onlineRequestNumber(event.existing.requestNumber), " \u00B7 \u0437\u0430\u043A\u0430\u0437 \u2116", event.existing.orderId] }), _jsxs("small", { children: ["\u043A\u043E\u0440\u043E\u0431 ", event.existing.boxCode, " \u00B7 ", event.existing.workerName || event.existing.deviceCode || 'сотрудник не указан'] }), event.existing.deviceCode ? _jsxs("small", { children: ["\u0422\u0421\u0414: ", event.existing.deviceCode] }) : null] })] })] }, event.eventKey || event.id))) })] })) : null, returnRequired && returnRequired.rows.length > 0 ? (_jsxs("section", { className: "online-execution-section online-execution-section--sync-conflict", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsxs("div", { children: [_jsxs("h4", { children: [_jsx(AlertTriangle, { size: 17, "aria-hidden": "true" }), "\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F FBS \u043F\u043E\u0441\u043B\u0435 \u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u0431\u043E\u0440\u043A\u0438"] }), _jsx("span", { children: "\u042D\u0442\u0438 \u0442\u043E\u0432\u0430\u0440\u044B \u043D\u0435\u043B\u044C\u0437\u044F \u043C\u043E\u043B\u0447\u0430 \u0443\u0431\u0440\u0430\u0442\u044C \u0438\u0437 \u0437\u0430\u044F\u0432\u043A\u0438: \u0432\u0435\u0440\u043D\u0438\u0442\u0435 \u0438\u0445 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434 \u0438\u043B\u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430." })] }), _jsxs("strong", { children: [returnRequired.units, " \u0448\u0442."] })] }), syncConflictResolutionMessage ? (_jsx("p", { className: "online-execution-action-message is-success", children: syncConflictResolutionMessage })) : null, syncConflictResolutionError ? (_jsx("p", { className: "online-execution-action-message is-error", children: syncConflictResolutionError })) : null, _jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--sync-conflict", children: _jsxs("table", { className: "online-execution-table online-execution-table--sync-conflict", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u0427\u0442\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsx("tbody", { children: returnRequired.rows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\u2116", row.orderId] }) }), _jsxs("td", { children: [_jsx("strong", { children: row.productName }), _jsx("span", { children: [row.article ? `арт. ${row.article}` : '', row.size ? `размер ${row.size}` : '', row.productBarcode ? `ШК ${row.productBarcode}` : '']
                                                                                .filter(Boolean)
                                                                                .join(' · ') })] }), _jsx("td", { children: _jsx("strong", { children: row.sourceBoxCode ?? 'не выбран' }) }), _jsx("td", { children: row.kiz ?? 'не пропикан' }), _jsx("td", { children: _jsx("strong", { children: row.syncIssue ?? 'Требуется решение менеджера.' }) }), _jsx("td", { children: onResolveSyncConflict ? (_jsxs("div", { className: "online-execution-sync-conflict-actions", children: [_jsxs("button", { type: "button", className: "online-execution-sync-conflict-button is-return", onClick: () => onResolveSyncConflict(row.id, 'RETURN_TO_STOCK'), disabled: resolvingSyncConflictId !== null, children: [_jsx(RotateCcw, { size: 14, "aria-hidden": "true" }), resolvingSyncConflictId === row.id
                                                                                        ? 'Возвращаю…'
                                                                                        : 'Вернуть на склад'] }), _jsxs("button", { type: "button", className: "online-execution-sync-conflict-button is-manager", onClick: () => onResolveSyncConflict(row.id, 'MANAGER_CONFIRMED'), disabled: resolvingSyncConflictId !== null, children: [_jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }), resolvingSyncConflictId === row.id
                                                                                        ? 'Подтверждаю…'
                                                                                        : 'Решение менеджера'] })] })) : (_jsx("span", { children: "\u041D\u0443\u0436\u043D\u044B \u043F\u0440\u0430\u0432\u0430 \u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043E\u043A" })) })] }, row.id))) })] }) })] })) : null, _jsxs("section", { className: "online-execution-section online-execution-section--not-collected", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: "\u0427\u0442\u043E \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u043E" }), _jsxs("span", { children: [notCollected?.remainingUnits ?? 0, " \u0448\u0442. \u00B7 ", notCollected?.remainingPositions ?? 0, " \u043F\u043E\u0437\u0438\u0446\u0438\u0439 \u00B7 ", notCollected?.remainingOrders ?? 0, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] })] }), notCollected && notCollected.rows.length > 0 ? (_jsxs(_Fragment, { children: [_jsx(OnlineSectionSearch, { value: notCollectedSearch, onChange: setNotCollectedSearch, placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0442\u043E\u0432\u0430\u0440, \u0437\u0430\u043A\u0430\u0437, \u0428\u041A \u0438\u043B\u0438 \u043A\u043E\u0440\u043E\u0431" }), onMoveOrders && notCollectedOrders.length > 0 ? (_jsxs("div", { className: "online-execution-bulk-move", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: allNotCollectedOrdersSelected, onChange: (event) => setSelectedNotCollectedOrders(event.target.checked ? notCollectedOrderKeys : []), disabled: Boolean(movingOrderId) }), _jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u043D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B" }), _jsx("strong", { children: notCollectedOrders.length })] }), _jsxs("button", { type: "button", onClick: () => onMoveOrders(selectedNotCollectedOrderRows), disabled: selectedNotCollectedOrderRows.length === 0 || Boolean(movingOrderId), children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), movingOrderId
                                                                    ? 'Проверяю поставки…'
                                                                    : `Перенести выбранные (${selectedNotCollectedOrderRows.length})`] })] })) : null, filteredNotCollectedRows.length > 0 ? (_jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--not-collected", children: _jsxs("table", { className: "online-execution-table online-execution-table--not-collected", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437\u044B WB / \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }), _jsx("th", { children: "\u0413\u0434\u0435 \u043B\u0435\u0436\u0438\u0442" }), _jsx("th", { children: "\u041D\u0443\u0436\u043D\u043E" }), _jsx("th", { children: "\u0421\u043E\u0431\u0440\u0430\u043D\u043E" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C" })] }) }), _jsx("tbody", { children: filteredNotCollectedRows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.name ?? 'Товар без названия' }), _jsx("span", { children: [row.article ? `арт. ${row.article}` : '', row.color, row.size ? `размер ${row.size}` : '', row.barcode ? `ШК ${row.barcode}` : '']
                                                                                        .filter(Boolean)
                                                                                        .join(' · ') })] }), _jsx("td", { children: row.orders.length > 0 ? (_jsx("div", { className: "online-execution-order-actions", children: row.orders.map((order) => (_jsxs("div", { children: [_jsxs("label", { className: "online-execution-order-select", children: [_jsx("input", { type: "checkbox", checked: selectedNotCollectedOrders.includes(onlineFbsOrderKey(order)), onChange: (event) => {
                                                                                                        const key = onlineFbsOrderKey(order);
                                                                                                        setSelectedNotCollectedOrders((current) => event.target.checked
                                                                                                            ? [...new Set([...current, key])]
                                                                                                            : current.filter((item) => item !== key));
                                                                                                    }, disabled: Boolean(movingOrderId), "aria-label": `Выбрать заказ №${order.id}` }), _jsxs("strong", { children: ["\u2116", order.id] })] }), onMoveOrder ? (_jsxs("button", { type: "button", onClick: () => onMoveOrder(order), disabled: Boolean(movingOrderId), title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0437\u0430\u043A\u0430\u0437 \u0432 \u043D\u043E\u0432\u0443\u044E \u0438\u043B\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0443\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 WB \u0442\u043E\u0433\u043E \u0436\u0435 \u0433\u043E\u0440\u043E\u0434\u0430", children: [_jsx(ArrowRightLeft, { size: 14, "aria-hidden": "true" }), movingOrderId === order.id
                                                                                                    ? 'Проверяю…'
                                                                                                    : 'Перенести'] })) : null, onMarkPackedWithoutSource ? (_jsxs("button", { type: "button", className: "online-execution-pack-without-source", onClick: () => {
                                                                                                if (order.assemblyId) {
                                                                                                    onMarkPackedWithoutSource(order.assemblyId, order.id);
                                                                                                }
                                                                                            }, disabled: !order.assemblyId || resolvingSyncConflictId !== null, title: order.requiresKiz && !order.kizAccepted
                                                                                                ? 'Сначала КИЗ должен быть подтверждён Wildberries'
                                                                                                : 'Засчитать заказ сейчас, а исходный короб указать при закрытии заявки', children: [_jsx(CheckCircle2, { size: 14, "aria-hidden": "true" }), resolvingSyncConflictId === order.assemblyId
                                                                                                    ? 'Засчитываю…'
                                                                                                    : 'Вложен без короба'] })) : null] }, `${order.connectionId}:${order.id}`))) })) : row.orderIds.length > 0 ? (row.orderIds.map((orderId) => `№${orderId}`).join(', ')) : ('номер уточняется') }), _jsx("td", { children: row.availableBoxes.length > 0
                                                                                ? (_jsx("div", { className: "online-execution-storage-list", children: row.availableBoxes.map((box) => {
                                                                                        const palletCode = box.palletCode ?? palletSortByBoxCode.get(normalizeCode(box.boxCode));
                                                                                        return (_jsxs("span", { children: [_jsxs("strong", { children: [box.boxCode, " \u2014 ", box.quantity, " \u0448\u0442."] }), _jsxs("small", { children: ["\u041F\u0430\u043B\u043B\u0435\u0442-\u0441\u043E\u0440\u0442: ", palletCode ?? 'не назначен'] })] }, normalizeCode(box.boxCode)));
                                                                                    }) }))
                                                                                : 'доступный короб не найден' }), _jsx("td", { children: row.requiredQuantity }), _jsx("td", { children: row.collectedQuantity }), _jsx("td", { children: _jsx("strong", { className: "online-execution-remaining-quantity", children: row.remainingQuantity }) })] }, row.requestItemId))) })] }) })) : (_jsx("p", { className: "online-execution-empty", children: "\u041F\u043E \u044D\u0442\u043E\u043C\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u043D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." }))] })) : (_jsx("p", { className: "online-execution-empty online-execution-empty--done", children: "\u0412\u0441\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u044D\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438 \u0441\u043E\u0431\u0440\u0430\u043D\u044B." }))] }), _jsxs("section", { className: "online-execution-section online-execution-section--fbs-fact", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0431\u043E\u0440\u043A\u0430 FBS" }), _jsxs("span", { children: ["\u0441\u043E\u0431\u0440\u0430\u043D\u043E ", fbsAssembly.completedOrders, " \u0438\u0437 ", fbsAssembly.totalOrders, " \u00B7 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435 ", Math.max(0, fbsAssembly.startedOrders - fbsAssembly.completedOrders)] })] }), _jsx(OnlineSectionSearch, { value: fbsAssemblySearch, onChange: setFbsAssemblySearch, placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0437\u0430\u043A\u0430\u0437, \u043A\u043E\u0440\u043E\u0431, \u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430 \u0438\u043B\u0438 \u0428\u041A WB" }), filteredFbsAssemblyRows.length ? (_jsx("div", { className: "online-execution-table-wrap online-execution-table-wrap--fbs-fact", children: _jsxs("table", { className: "online-execution-table online-execution-table--fbs-fact", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431, \u043E\u0442\u043A\u0443\u0434\u0430 \u0432\u0437\u044F\u0442" }), _jsx("th", { children: "\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430" }), _jsx("th", { children: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0428\u041A WB \u2014 \u0431\u043E\u043B\u044C\u0448\u0438\u0435 4 \u0446\u0438\u0444\u0440\u044B" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: filteredFbsAssemblyRows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("strong", { children: row.sourceBoxPending
                                                                            ? 'Указать при закрытии'
                                                                            : row.sourceBoxCode ?? 'ещё не выбран' }) }), _jsxs("td", { children: [_jsxs("strong", { children: ["\u2116", row.orderId] }), _jsxs("span", { children: [row.productName, row.article ? ` · арт. ${row.article}` : ''] })] }), _jsx("td", { children: row.productBarcode ?? 'ещё не пропикан' }), _jsx("td", { children: _jsx("strong", { children: row.size ?? 'не указан' }) }), _jsxs("td", { children: [_jsx("strong", { className: "online-execution-wb-digits", children: row.wbStickerPartB ?? '—' }), _jsx("span", { children: row.wbStickerBarcode ? `полный ШК: ${row.wbStickerBarcode}` : 'появится после получения наклейки WB' })] }), _jsx("td", { children: _jsx("span", { className: `online-execution-pill ${row.status === 'COMPLETED'
                                                                            ? 'is-done'
                                                                            : row.status === 'RETURN_REQUIRED'
                                                                                ? 'is-danger'
                                                                                : 'is-open'}`, children: row.sourceBoxPending ? 'Вложен без короба' : row.statusLabel }) }), _jsx("td", { children: onResetFbsAssembly && ['IN_PROGRESS', 'RESCAN_REQUIRED'].includes(row.status) ? (_jsxs("button", { type: "button", className: "online-execution-sync-conflict-button is-reset", disabled: resolvingSyncConflictId !== null, onClick: () => onResetFbsAssembly(row.id, row.orderId), title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0441\u043A\u0430\u043D\u044B \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u044D\u0442\u043E\u0442 \u0437\u0430\u043A\u0430\u0437 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0422\u0421\u0414", children: [_jsx(RotateCcw, { size: 14, "aria-hidden": "true" }), resolvingSyncConflictId === row.id
                                                                                ? 'Сбрасываю…'
                                                                                : 'Сбросить сборку'] })) : (_jsx("span", { children: "\u2014" })) })] }, row.id))) })] }) })) : (_jsx("p", { className: "online-execution-empty", children: fbsAssembly.rows.length
                                                ? 'По этому запросу строки фактической сборки не найдены.'
                                                : 'Фактические данные появятся после начала сборки заказов на ТСД.' }))] })] })) : null, _jsx(OnlineBoxChips, { title: "\u041A\u043E\u0440\u043E\u0431\u0430 \u0434\u043B\u044F \u043F\u043E\u0438\u0441\u043A\u0430", subtitle: `Найдено: ${foundCount} из ${searchTotal} · осталось: ${remainingCount}`, boxes: searchBoxes.map((box) => ({
                                code: box.boxCode,
                                done: box.found || box.isFound || foundCodes.has(normalizeCode(box.boxCode)),
                                doneText: ['найден', box.multiCityLabel].filter(Boolean).join(' · '),
                                todoText: ['не найден', box.multiCityLabel].filter(Boolean).join(' · '),
                            })) }), _jsx(OnlineBoxChips, { title: "\u041A\u043E\u0440\u043E\u0431\u0430, \u0433\u0434\u0435 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0443\u0436\u0435 \u0441\u0434\u0435\u043B\u0430\u043D\u044B", subtitle: movementSourceBoxes.length ? `Готово: ${movementSourceBoxes.filter((box) => box.done).length} из ${movementSourceBoxes.length}` : 'Перемещений нет', boxes: movementSourceBoxes.map((box) => ({
                                code: box.sourceBox,
                                done: box.done,
                                doneText: `готов · ${box.movedQuantity} шт.`,
                                todoText: `осталось ${box.remainingQuantity} шт.`,
                            })), emptyText: "\u041F\u043E \u044D\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0435 \u043D\u0435\u0442 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u043C\u0438." }), _jsxs("section", { className: "online-execution-section", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F" }), _jsx("span", { children: movementRows.length ? `${movementRows.length} строк` : 'нет строк' }), _jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx client-request-action-button--compact", type: "button", onClick: onDownloadMovements, disabled: status === 'loading' || !plan, title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C Excel \u0441 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u043C\u0438", children: [_jsx(FileDown, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "Excel" })] })] }), _jsx(OnlineSectionSearch, { value: movementSearch, onChange: setMovementSearch, placeholder: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431 \u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u0445" }), filteredMovementRows.length ? (_jsx("div", { className: "online-execution-table-wrap", children: _jsxs("table", { className: "online-execution-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0418\u0437 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("th", { children: "\u0412 \u043A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" })] }) }), _jsx("tbody", { children: filteredMovementRows.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { children: row.sourceBox }), _jsx("td", { children: targetBoxesText(row) }), _jsxs("td", { children: [_jsx("strong", { children: row.name ?? row.barcode ?? '-' }), _jsxs("span", { children: [row.barcode ?? '-', row.size ? ` · ${row.size}` : ''] })] }), _jsxs("td", { children: [row.movedQuantity ?? 0, " / ", row.requiredQuantity ?? row.quantity] }), _jsx("td", { children: _jsx("span", { className: `online-execution-pill ${row.done ? 'is-done' : 'is-open'}`, children: row.done ? 'готово' : `осталось ${row.remainingQuantity ?? row.quantity}` }) })] }, `${row.sourceBox}-${row.barcode}-${row.targetBox}-${index}`))) })] }) })) : (_jsx("p", { className: "online-execution-empty", children: movementRows.length ? 'По этому номеру короба перемещений не найдено.' : 'Перемещения по заявке не требуются.' }))] }), _jsxs("section", { className: "online-execution-section", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: "\u0424\u0430\u043A\u0442 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439" }), _jsx("span", { children: actualMovements.length ? `${actualMovements.length} строк` : 'пока нет факта' })] }), _jsx(OnlineSectionSearch, { value: actualMovementSearch, onChange: setActualMovementSearch, placeholder: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431 \u0432 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0445 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F\u0445" }), filteredActualMovements.length ? (_jsx("div", { className: "online-execution-table-wrap", children: _jsxs("table", { className: "online-execution-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0418\u0437" }), _jsx("th", { children: "\u0412" }), _jsx("th", { children: "\u0427\u0442\u043E \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" })] }) }), _jsx("tbody", { children: filteredActualMovements.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { children: row.sourceBox }), _jsx("td", { children: row.targetBox }), _jsxs("td", { children: [_jsx("strong", { children: row.name ?? row.barcode ?? '-' }), _jsxs("span", { children: [row.barcode ?? '-', row.size ? ` · ${row.size}` : ''] })] }), _jsx("td", { children: row.quantity })] }, `${row.sourceBox}-${row.targetBox}-${row.barcode}-${index}`))) })] }) })) : (_jsx("p", { className: "online-execution-empty", children: actualMovements.length ? 'По этому номеру короба выполненных перемещений не найдено.' : 'Фактические переносы появятся после синхронизации ТСД.' }))] }), _jsx(OnlineBoxChips, { title: "\u041D\u0410 \u041E\u0422\u041F\u0420\u0410\u0412\u041A\u0423", subtitle: outgoingBoxes.length ? `Актуально коробов: ${outgoingBoxes.length}` : 'короба пока не определены', boxes: outgoingBoxes.map((box) => ({
                                code: box.boxCode,
                                done: true,
                                doneText: [box.typeLabel, box.quantity ? `${box.quantity} шт.` : '', box.sourceBox ? `из ${box.sourceBox}` : '']
                                    .filter(Boolean)
                                    .join(' · '),
                                todoText: '',
                            })), emptyText: "\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0438\u0441\u043A\u0430 \u0438 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439 \u0437\u0434\u0435\u0441\u044C \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u0440\u043E\u0431\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0443\u0435\u0437\u0436\u0430\u044E\u0442." })] })) : null] }) }));
}
function OnlineBoxChips({ title, subtitle, boxes, emptyText = 'Список пуст.', }) {
    const [search, setSearch] = useState('');
    const filteredBoxes = boxes.filter((box) => box.code.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
    return (_jsxs("section", { className: "online-execution-section", children: [_jsxs("div", { className: "online-execution-section__heading", children: [_jsx("h4", { children: title }), _jsx("span", { children: subtitle })] }), _jsx(OnlineSectionSearch, { value: search, onChange: setSearch, placeholder: "\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u0440\u043E\u0431 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0437\u0434\u0435\u043B\u0435" }), filteredBoxes.length ? (_jsx("div", { className: "online-execution-chips", children: filteredBoxes.map((box) => (_jsxs("span", { className: `online-execution-chip ${box.done ? 'is-done' : 'is-open'}`, children: [_jsx("strong", { children: box.code }), _jsx("small", { children: box.done ? box.doneText : box.todoText })] }, `${title}-${box.code}`))) })) : (_jsx("p", { className: "online-execution-empty", children: boxes.length ? 'Короб с таким номером не найден.' : emptyText }))] }));
}
function OnlineSectionSearch({ value, onChange, placeholder }) {
    return (_jsxs("label", { className: "online-execution-search", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: value, onChange: (event) => onChange(event.target.value), placeholder: placeholder }), value ? (_jsx("button", { type: "button", onClick: () => onChange(''), title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", children: _jsx(X, { size: 15, "aria-hidden": "true" }) })) : null] }));
}
function FbsSynchronizationAuditPanel({ audit, canResolve, resolvingRequestId, onResolve, onClose, }) {
    return (_jsxs("section", { className: `client-request-fbs-audit${audit.issues.length ? ' is-warning' : ' is-ok'}`, "aria-live": "polite", children: [_jsxs("header", { className: "client-request-fbs-audit__header", children: [_jsxs("div", { children: [_jsxs("div", { className: "client-request-fbs-audit__title", children: [audit.issues.length ? _jsx(AlertTriangle, { size: 19, "aria-hidden": "true" }) : _jsx(CheckCircle2, { size: 19, "aria-hidden": "true" }), _jsx("strong", { children: audit.issues.length ? `Найдено расхождений: ${audit.issues.length}` : 'Рассинхронизаций не найдено' })] }), _jsxs("span", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432: ", audit.clients, " \u00B7 \u0437\u0430\u043A\u0430\u0437\u043E\u0432: ", audit.orders] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0421\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442", "aria-label": "\u0421\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438", children: _jsx(X, { size: 17, "aria-hidden": "true" }) })] }), audit.issues.length ? (_jsx("div", { className: "client-request-fbs-audit__issues", children: audit.issues.map((issue) => {
                    const isResolving = resolvingRequestId === issue.requestId;
                    const canConfirmDelivery = issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED';
                    return (_jsxs("article", { className: "client-request-fbs-audit__issue", children: [_jsxs("div", { className: "client-request-fbs-audit__issue-copy", children: [_jsxs("strong", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", String(issue.requestNumber).padStart(6, '0'), " \u00B7 ", issue.requestTitle] }), _jsxs("span", { children: [issue.clientName, " \u00B7 ", issue.marketplaceNames.join(', ')] }), _jsxs("p", { children: ["\u0412 WMS: ", _jsx("b", { children: fbsSynchronizationStatusLabel(issue.wmsStatus) }), " \u00B7 \u043D\u0430 \u0441\u0434\u0430\u0447\u0435/\u0432 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0435: ", issue.shippedOrders, " \u00B7 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E: ", issue.deliveredOrders, " \u00B7 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: ", issue.cancelledOrders, "."] }), _jsx("small", { children: issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED'
                                            ? 'Все заказы маркетплейса доставлены либо отменены. Выберите, оставить заявку в работе или подтвердить её сдачу без повторного списания остатков.'
                                            : 'В WMS заявка закрыта, но в маркетплейсе ещё есть активные заказы. Верните её в работу для проверки.' })] }), canResolve ? (_jsxs("div", { className: "client-request-fbs-audit__actions", children: [_jsx("button", { className: "secondary-button", type: "button", disabled: isResolving, onClick: () => void onResolve(issue, 'RETURN_TO_WORK'), children: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0432 \u0440\u0430\u0431\u043E\u0442\u0443" }), canConfirmDelivery ? (_jsx("button", { className: "primary-button", type: "button", disabled: isResolving, onClick: () => void onResolve(issue, 'CONFIRM_DELIVERED'), children: isResolving ? 'Сохраняю…' : 'Подтвердить сдачу' })) : null] })) : null] }, issue.requestId));
                }) })) : null, audit.failures.length ? (_jsxs("p", { className: "client-request-fbs-audit__failures", children: ["\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C: ", audit.failures.join(' · ')] })) : null] }));
}
function FbsSupplyConsistencyModal({ state, onRepair, onClose, }) {
    const { data } = state;
    const isBusy = state.status === 'loading' || state.status === 'repairing';
    return (_jsx("div", { className: "online-execution-modal fbs-supply-consistency-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u043E\u0441\u0442\u0430\u0432\u0430 FBS-\u0437\u0430\u044F\u0432\u043A\u0438 \u0441 Wildberries", children: _jsxs("section", { className: "online-execution-modal__panel fbs-supply-consistency-modal__panel", children: [_jsxs("header", { className: "online-execution-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u0441\u043E\u0441\u0442\u0430\u0432\u0430 WB" }), _jsxs("h3", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", String(state.request.number).padStart(6, '0')] }), _jsx("small", { children: state.request.client.name })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, disabled: isBusy, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "fbs-supply-consistency-modal__body", children: [state.status === 'loading' ? (_jsx("p", { className: "inline-status", children: "\u0417\u0430\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u044E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0441\u043E\u0441\u0442\u0430\u0432 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0443 Wildberries\u2026" })) : null, state.status === 'repairing' ? (_jsx("p", { className: "inline-status", children: "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u044E\u0449\u0438\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u044E \u0441\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438\u2026" })) : null, state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, data ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: `fbs-supply-consistency-summary ${data.consistent ? 'is-ok' : 'is-error'}`, children: [data.consistent ? _jsx(CheckCircle2, { size: 22, "aria-hidden": "true" }) : _jsx(AlertTriangle, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: data.consistent ? 'Состав совпадает' : 'Есть расхождение состава' }), _jsx("span", { children: data.message })] })] }), _jsxs("div", { className: "fbs-supply-consistency-metrics", children: [_jsxs("article", { children: [_jsx("span", { children: "\u0412 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0435 WB" }), _jsx("strong", { children: data.wbOrders })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0412 \u0437\u0430\u044F\u0432\u043A\u0435 WMS" }), _jsx("strong", { children: data.wmsOrders })] }), _jsxs("article", { className: data.missingInWms > 0 ? 'is-error' : '', children: [_jsx("span", { children: "\u041D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u0432 WMS" }), _jsx("strong", { children: data.missingInWms })] }), _jsxs("article", { className: data.extraInWms > 0 ? 'is-error' : '', children: [_jsx("span", { children: "\u041B\u0438\u0448\u043D\u0438\u0445 \u0432 WMS" }), _jsx("strong", { children: data.extraInWms })] })] }), _jsx("div", { className: "fbs-supply-consistency-table-wrap", children: _jsxs("table", { className: "data-table fbs-supply-consistency-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 WB" }), _jsx("th", { children: "\u0421\u043A\u043B\u0430\u0434" }), _jsx("th", { children: "WB" }), _jsx("th", { children: "WMS" }), _jsx("th", { children: "\u041D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442" }), _jsx("th", { children: "\u041B\u0438\u0448\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: data.supplies.map((supply) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: supply.supplyId }), _jsx("small", { children: supply.accountName })] }), _jsx("td", { children: supply.warehouseName ?? 'Не указан' }), _jsx("td", { children: supply.wbOrders }), _jsx("td", { children: supply.wmsOrders }), _jsx("td", { className: supply.missingInWms > 0 ? 'is-error' : '', children: supply.missingInWms }), _jsx("td", { className: supply.extraInWms > 0 ? 'is-error' : '', children: supply.extraInWms })] }, `${supply.connectionId}:${supply.supplyId}`))) })] }) }), data.supplies.some((supply) => supply.missingOrderIds.length || supply.extraOrderIds.length) ? (_jsxs("details", { className: "fbs-supply-consistency-details", children: [_jsx("summary", { children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0441 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F\u043C\u0438" }), data.supplies.map((supply) => (supply.missingOrderIds.length || supply.extraOrderIds.length ? (_jsxs("div", { children: [_jsx("strong", { children: supply.supplyId }), supply.missingOrderIds.length ? _jsxs("p", { children: ["\u041D\u0435\u0442 \u0432 WMS: ", supply.missingOrderIds.join(', ')] }) : null, supply.extraOrderIds.length ? _jsxs("p", { children: ["\u041B\u0438\u0448\u043D\u0438\u0435 \u0432 WMS: ", supply.extraOrderIds.join(', ')] }) : null] }, supply.supplyId)) : null))] })) : null] })) : null] }), _jsxs("footer", { className: "fbs-supply-consistency-modal__footer", children: [_jsx("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: onClose, disabled: isBusy, children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), data && !data.consistent ? (_jsxs("button", { className: "primary-button", type: "button", onClick: onRepair, disabled: isBusy, children: [_jsx(RefreshCw, { className: state.status === 'repairing' ? 'is-spinning' : undefined, size: 16, "aria-hidden": "true" }), _jsx("span", { children: state.status === 'repairing' ? 'Исправляю…' : 'Исправить состав заявки' })] })) : null] })] }) }));
}
function renderRequests(state, selectableRequestIds, selectedRequestIds, onRequestSelectionChange, canChangeStatus, canPickOutbound, canCancelRequests, canEditAnyRequest, canRefreshPickInstruction, canUploadManualInstruction, refreshingInstructionId, syncingTsdRequestId, checkingSupplyRequestId, onStatusChange, onCancelRequest, onEditRequest, onOpenDocument, onDownloadRequestItems, onDownloadOriginalFile, onOpenOnlineExecution, onSelectManualBoxes, onOpenFbsBoxSearch, onOpenPickInstruction, onRefreshPickInstruction, onSyncTsd, onCheckSupplyConsistency, onOpenFbsOrders, onDownloadPickInstruction, onDownloadWbProducts, onDownloadWbPackages, onUploadManualInstruction, onEmergencyPackedXlsx, onRollbackEmergencyClose, onPickOutbound, onPackageOutbound, onShipOutbound) {
    if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
        return (_jsxs("p", { className: "panel-message", children: [_jsx(ClipboardList, { size: 22, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0437\u0430\u044F\u0432\u043A\u0438." })] }));
    }
    if (state.status === 'error') {
        return _jsx("p", { className: "panel-message panel-message--error", children: state.error ?? 'Не удалось загрузить заявки.' });
    }
    if (state.data.length === 0) {
        return _jsx("p", { className: "panel-message", children: "\u0417\u0430\u044F\u0432\u043E\u043A \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." });
    }
    return (_jsxs(_Fragment, { children: [state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0437\u0430\u044F\u0432\u043A\u0438." }) : null, _jsx(ClientRequestsTable, { items: state.data, selectableRequestIds: selectableRequestIds, selectedRequestIds: selectedRequestIds, onRequestSelectionChange: onRequestSelectionChange, canChangeStatus: canChangeStatus, canPickOutbound: canPickOutbound, canCancelRequests: canCancelRequests, canEditAnyRequest: canEditAnyRequest, canRefreshPickInstruction: canRefreshPickInstruction, refreshingInstructionId: refreshingInstructionId, syncingTsdRequestId: syncingTsdRequestId, checkingSupplyRequestId: checkingSupplyRequestId, onStatusChange: onStatusChange, onCancelRequest: onCancelRequest, onEditRequest: onEditRequest, onOpenDocument: onOpenDocument, onDownloadRequestItems: onDownloadRequestItems, onDownloadOriginalFile: onDownloadOriginalFile, onOpenOnlineExecution: onOpenOnlineExecution, onSelectManualBoxes: onSelectManualBoxes, onOpenFbsBoxSearch: onOpenFbsBoxSearch, onOpenPickInstruction: onOpenPickInstruction, onRefreshPickInstruction: onRefreshPickInstruction, onSyncTsd: onSyncTsd, onCheckSupplyConsistency: onCheckSupplyConsistency, onOpenFbsOrders: onOpenFbsOrders, onDownloadPickInstruction: onDownloadPickInstruction, onDownloadWbProducts: onDownloadWbProducts, onDownloadWbPackages: onDownloadWbPackages, onUploadManualInstruction: canUploadManualInstruction ? onUploadManualInstruction : undefined, onEmergencyPackedXlsx: onEmergencyPackedXlsx, onRollbackEmergencyClose: onRollbackEmergencyClose, onPickOutbound: onPickOutbound, onPackageOutbound: onPackageOutbound, onShipOutbound: onShipOutbound })] }));
}
function isManualStockClosingRequest(request) {
    return ((request.type === 'OUTBOUND' || request.type === 'DELIVERY') &&
        request.items.length > 0 &&
        !request.comment?.toLocaleLowerCase('ru-RU').includes('создано из excel:'));
}
function normalizeOnlineBoxes(values) {
    return values
        .map((box) => ({
        boxCode: (box.boxCode ?? box.code ?? '').trim(),
        found: Boolean(box.found),
        isFound: Boolean(box.isFound),
        servesMultipleCities: Boolean(box.servesMultipleCities),
        multiCityLabel: box.multiCityLabel?.trim() ?? '',
        storageLocation: box.storageLocation ?? null,
    }))
        .filter((box) => box.boxCode);
}
function normalizeOutgoingBoxes(plan) {
    if (!plan) {
        return [];
    }
    const boxes = new Map();
    const addBox = (boxCode, typeLabel, sourceBox = '', quantity = 0) => {
        const normalized = normalizeCode(boxCode);
        if (!normalized) {
            return;
        }
        const current = boxes.get(normalized) ?? {
            boxCode: boxCode?.trim() || normalized,
            typeLabel,
            sourceBox: '',
            quantity: 0,
        };
        current.typeLabel = current.typeLabel || typeLabel;
        current.quantity += quantity;
        if (sourceBox && !current.sourceBox.split(', ').some((value) => normalizeCode(value) === normalizeCode(sourceBox))) {
            current.sourceBox = current.sourceBox ? `${current.sourceBox}, ${sourceBox}` : sourceBox;
        }
        boxes.set(normalized, current);
    };
    for (const box of plan.outgoingBoxes ?? []) {
        addBox(box.boxCode ?? box.code, box.typeLabel ?? 'К отправке', box.sourceBox ?? '', box.quantity ?? 0);
    }
    for (const boxCode of plan.outgoingBoxCodes ?? []) {
        addBox(boxCode, 'К отправке');
    }
    for (const box of plan.shipmentBoxes ?? []) {
        addBox(box.boxCode ?? box.code, 'Целый короб');
    }
    for (const boxCode of plan.shipmentBoxCodes ?? []) {
        addBox(boxCode, 'Целый короб');
    }
    return [...boxes.values()].sort((left, right) => left.boxCode.localeCompare(right.boxCode, 'ru', { numeric: true }));
}
function targetBoxesText(row) {
    if (row.actualTargetBoxes?.length) {
        return row.actualTargetBoxes.join(', ');
    }
    if (row.targetBox) {
        return row.targetBox;
    }
    return row.purpose === 'SHIPMENT' || row.targetRole === 'SHIPMENT' ? 'новый короб поставки' : 'короб баланса';
}
function progressRatio(done, total) {
    if (total <= 0) {
        return 1;
    }
    return Math.max(0, Math.min(1, done / total));
}
function averageProgress(values) {
    const safeValues = values.length ? values : [0];
    return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}
function normalizeCode(value) {
    return value?.trim().toLocaleLowerCase('ru-RU') ?? '';
}
function onlineFbsOrderKey(order) {
    return `${order.connectionId}:${order.id}`;
}
function onlineRequestNumber(value) {
    return value == null ? 'заявка без номера' : `заявка №${String(value).padStart(6, '0')}`;
}
function formatOnlineDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value || 'время не записано';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date);
}
function movementRowMatchesSearch(row, query) {
    const normalizedQuery = normalizeCode(query);
    if (!normalizedQuery)
        return true;
    return [row.sourceBox, row.targetBox, ...(row.actualTargetBoxes ?? []), row.barcode, row.name]
        .filter((value) => Boolean(value))
        .some((value) => normalizeCode(value).includes(normalizedQuery));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function canEditRequestAnyStatus(user) {
    return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}
function canUploadOwnInstruction(user) {
    return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER'].includes(role));
}
function canAdministerRequestFiles(user) {
    return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER'].includes(role));
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function safeDownloadName(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'request';
}
function parseNonNegativeInteger(value) {
    if (!/^\d+$/.test(value.trim()))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function isPalletPackage(packageType) {
    return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}
function isStockSourceResolutionError(message) {
    const normalized = message.toLocaleLowerCase('ru-RU');
    return (normalized.includes('остат') ||
        normalized.includes('списан') ||
        normalized.includes('фактическ') ||
        normalized.includes('короб'));
}
function isOverweightPackageError(message) {
    const normalized = message.toLocaleLowerCase('ru-RU');
    return (normalized.includes('превышает 25 кг') &&
        (normalized.includes('вес короба') || normalized.includes('расчетный вес короба')));
}
function isCloseStockRecoveryProblem(item, normalizedError) {
    const matchesError = [
        item.sku?.internalSku,
        item.sku?.article,
        item.sku?.name,
        item.requestedBarcode,
        item.requestedName,
    ].some((candidate) => candidate
        ? normalizedError.includes(candidate.toLocaleLowerCase('ru-RU'))
        : false);
    const hasPendingFbsSource = item.fbsOrders.some((order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending);
    return matchesError || hasPendingFbsSource;
}
function buildFbsSynchronizationAudit(responses, failures) {
    const byRequest = new Map();
    let orders = 0;
    for (const response of responses) {
        for (const order of response.orders) {
            if (!order.request)
                continue;
            orders += 1;
            const current = byRequest.get(order.request.id) ?? {
                requestId: order.request.id,
                requestNumber: order.request.number,
                requestTitle: order.request.title,
                clientName: response.client.name,
                marketplaceNames: [],
                wmsStatus: order.request.status,
                activeOrders: 0,
                shippedOrders: 0,
                deliveredOrders: 0,
                cancelledOrders: 0,
            };
            const marketplaceName = order.marketplace === 'WILDBERRIES'
                ? 'WB'
                : order.marketplace === 'OZON'
                    ? 'Ozon'
                    : 'Яндекс Маркет';
            if (!current.marketplaceNames.includes(marketplaceName)) {
                current.marketplaceNames.push(marketplaceName);
            }
            if (order.category === 'active')
                current.activeOrders += 1;
            else if (order.category === 'cancelled')
                current.cancelledOrders += 1;
            else if (order.category === 'shipped')
                current.shippedOrders += 1;
            else if (order.category === 'archive')
                current.deliveredOrders += 1;
            byRequest.set(order.request.id, current);
        }
    }
    const closed = new Set(['DONE', 'CANCELLED', 'REJECTED']);
    const issues = [];
    byRequest.forEach((request) => {
        // `shipped` in WB means handover to delivery, not delivery to the buyer.
        // Such a request must remain in work; #161 is exactly this case.
        if (!closed.has(request.wmsStatus) &&
            request.activeOrders === 0 &&
            request.shippedOrders === 0 &&
            (request.deliveredOrders > 0 || request.cancelledOrders > 0)) {
            issues.push({ ...request, kind: 'WMS_OPEN_MARKETPLACE_FINISHED' });
        }
        if (closed.has(request.wmsStatus) && request.activeOrders > 0) {
            issues.push({ ...request, kind: 'WMS_CLOSED_MARKETPLACE_ACTIVE' });
        }
    });
    return {
        checkedAt: new Date().toISOString(),
        clients: responses.length,
        orders,
        failures,
        issues: issues.sort((left, right) => left.requestNumber - right.requestNumber),
    };
}
function fbsSynchronizationStatusLabel(status) {
    const labels = {
        SUBMITTED: 'Новая',
        IN_REVIEW: 'На проверке',
        APPROVED: 'Подтверждена',
        IN_WORK: 'В работе',
        PACKED: 'Упакована',
        DONE: 'Сдана',
        CANCELLED: 'Отменена',
        REJECTED: 'Отклонена',
    };
    return labels[status] ?? status;
}
function fbsAssemblyStatusLabel(status) {
    if (status === 'COMPLETED')
        return 'собран';
    if (status === 'IN_PROGRESS')
        return 'сборка не завершена';
    if (status === 'RELEASED')
        return 'отложен на ТСД';
    if (status === 'CANCELLED')
        return 'сборка отменена';
    return 'не начинался на ТСД';
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
