import { AlertTriangle, Archive, ArrowLeft, ArrowRightLeft, Boxes, CheckCircle2, ClipboardList, FileDown, FileUp, MapPinned, PackageX, RefreshCw, RotateCcw, Search, ShieldAlert, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelClientRequest,
  checkFbsRequestSupplyConsistency,
  downloadClientRequestFile,
  downloadClientRequestItemsXlsx,
  downloadClientRequestFbsBoxSearchXlsx,
  downloadClientRequestWbPackagesXlsx,
  downloadClientRequestWbProductsXlsx,
  downloadFbsRequestPickListPdf,
  downloadPickInstructionXlsx,
  downloadTsdMovementsXlsx,
  downloadTsdOutgoingBoxesXlsx,
  downloadTsdOutgoingContentsXlsx,
  emergencyCloseClientRequestFromXlsx,
  fetchClientRequestManualBoxSelection,
  fetchClientRequestFbsBoxSearch,
  fetchClientRequestDocument,
  fetchClientRequestBoxOverlaps,
  fetchClientRequests,
  fetchClients,
  fetchFbsOrders,
  fetchFbsRequestRoute,
  fetchPickInstruction,
  fetchPendingPickWaveBalanceReviews,
  fetchTsdAssemblyPlan,
  mergeFbsRequestTails,
  markTsdFbsAssemblyPackedWithoutSource,
  moveFbsOrdersToNewSupply,
  previewFbsRequestTails,
  packageClientRequest,
  pickClientRequest,
  refreshPickInstruction as refreshPickInstructionDocument,
  repairFbsOrdersMove,
  repairFbsRequestSelection as repairFbsRequestSelectionRequest,
  rebuildFbsRequestRoute,
  repairFbsRequestSupplyConsistency,
  resolveTsdFbsKizConflict,
  resolveTsdFbsSyncConflict,
  resetTsdFbsAssemblyOrder,
  resolveFbsSynchronization,
  restoreTsdFbsRescanFromWildberries,
  rollbackEmergencyCloseClientRequest,
  saveClientRequestManualBoxSelection,
  shipClientRequest,
  syncClientRequestToTsd,
  updateClientRequestStatus,
  uploadManualPickInstruction,
  type AuthSession,
  type AuthUser,
  type ClientRequestDocument,
  type ClientRequestBoxOverlapStatistics,
  type ClientRequestManualBoxSelection,
  type ClientRequestFbsBoxSearch,
  type ClientRequestFileSummary,
  type ClientRequestStatus,
  type ClientRequestSummary,
  type ClientFbsOrders,
  type ClientSummary,
  type EmergencyPackedXlsxResult,
  type FbsSyncConflictResolutionAction,
  type FbsRequestSupplyConsistency,
  type FbsRequestRoute,
  type MergeFbsRequestTailsPreview,
  type PickInstructionDocument,
  type PickWaveBalanceReview,
  type TsdAssemblyPlan,
} from '../../lib/api';
import { ClientRequestCreateForm } from './ClientRequestCreateForm';
import { ClientRequestDocumentPreview } from './ClientRequestDocumentPreview';
import { ClientRequestEditModal } from './ClientRequestEditModal';
import { ClientRequestXlsxImportForm } from './ClientRequestXlsxImportForm';
import './client-requests.css';
import { ClientRequestsTable } from './ClientRequestsTable';
import {
  buildUnknownSourceNoBoxStockSources,
  isProblemCloseStockSourceItem,
  selectAllUnknownSourcesWithoutBox,
  type CloseStockSourceValue,
} from './closeStockRecovery';
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';
import { requestStatusLabel } from './clientRequestMeta';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PickWaveBalanceReviewPanel } from './PickWaveBalanceReviewPanel';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { resolveFbsSyncConflictBatch } from './fbsSyncConflictBatch';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type ClientRequestsPanelProps = {
  session: AuthSession;
  onOpenFbsOrders?: (request: ClientRequestSummary) => void;
};

type RequestSortField = 'number' | 'createdAt' | 'quantity';
type RequestSortDirection = 'asc' | 'desc';

type ManualCloseState = {
  request: ClientRequestSummary;
  boxes: string;
  pallets: string;
  packedUnits: string;
  comment: string;
  usesRecordedPackages: boolean;
  status: 'idle' | 'submitting';
  error?: string;
};

type ManualBoxSelectionState = {
  request: ClientRequestSummary;
  status: 'loading' | 'ready' | 'saving';
  data: ClientRequestManualBoxSelection | null;
  error?: string;
};

type CloseStockRecoveryState = {
  close: ManualCloseState;
  status: 'loading' | 'ready' | 'submitting';
  data: ClientRequestManualBoxSelection | null;
  values: Record<string, CloseStockSourceValue>;
  touchedItemIds: string[];
  originalError: string;
  error?: string;
};

type FbsBoxSearchState = {
  request: ClientRequestSummary;
  status: 'loading' | 'ready';
  data: ClientRequestFbsBoxSearch | null;
  error?: string;
};

type FbsTailMergePreviewState = {
  requestIds: string[];
  data: MergeFbsRequestTailsPreview;
  error?: string;
};

type FbsSupplyConsistencyState = {
  request: ClientRequestSummary;
  status: 'loading' | 'ready' | 'repairing';
  data: FbsRequestSupplyConsistency | null;
  error?: string;
};

type FbsSynchronizationAuditIssue = {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  clientName: string;
  marketplaceNames: string[];
  wmsStatus: ClientRequestStatus;
  activeOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  kind: 'WMS_OPEN_MARKETPLACE_FINISHED' | 'WMS_CLOSED_MARKETPLACE_ACTIVE';
};

type FbsSynchronizationAudit = {
  checkedAt: string;
  clients: number;
  orders: number;
  issues: FbsSynchronizationAuditIssue[];
  failures: string[];
};

export function ClientRequestsPanel({ session, onOpenFbsOrders }: ClientRequestsPanelProps) {
  const canRead = canUse(session.user, 'client-requests:read');
  const canWrite = canUse(session.user, 'client-requests:write');
  const canChangeStatus = canUse(session.user, 'client-requests:status');
  const canPickOutbound = canUse(session.user, 'stock:write');
  const canEditAnyRequest = canEditRequestAnyStatus(session.user);
  const canUploadManualInstruction = canUploadOwnInstruction(session.user);
  const canDownloadOriginalRequest = canAdministerRequestFiles(session.user);
  const canViewBoxOverlaps = canAdministerRequestFiles(session.user);
  const [requests, setRequests] = useState<LoadState<ClientRequestSummary>>({ status: 'idle', data: [] });
  const [clients, setClients] = useState<LoadState<ClientSummary>>({ status: 'idle', data: [] });
  const [balanceReviews, setBalanceReviews] = useState<LoadState<PickWaveBalanceReview>>({ status: 'idle', data: [] });
  const [boxOverlaps, setBoxOverlaps] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ClientRequestBoxOverlapStatistics | null;
    error?: string;
  }>({ status: 'idle', data: null });
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] = useState<ClientRequestDocument | null>(null);
  const [pickInstructionPreview, setPickInstructionPreview] = useState<PickInstructionDocument | null>(null);
  const [refreshingInstructionId, setRefreshingInstructionId] = useState<string | null>(null);
  const [syncingTsdRequestId, setSyncingTsdRequestId] = useState<string | null>(null);
  const [checkingSupplyRequestId, setCheckingSupplyRequestId] = useState<string | null>(null);
  const [routeLoadingRequestId, setRouteLoadingRequestId] = useState<string | null>(null);
  const [fbsRoutePanel, setFbsRoutePanel] = useState<{
    request: ClientRequestSummary;
    status: 'loading' | 'ready' | 'rebuilding' | 'error';
    data: FbsRequestRoute | null;
    error?: string;
    diff?: { addedBoxes: string[]; removedBoxes: string[] };
  } | null>(null);
  const [fbsSupplyConsistency, setFbsSupplyConsistency] = useState<FbsSupplyConsistencyState | null>(null);
  const [editingRequest, setEditingRequest] = useState<ClientRequestSummary | null>(null);
  const [onlinePreview, setOnlinePreview] = useState<{ request: ClientRequestSummary; plan: TsdAssemblyPlan | null; status: 'loading' | 'ready' | 'error'; error?: string } | null>(null);
  const [onlineFbsMove, setOnlineFbsMove] = useState<{
    orderId: string | null;
    message?: string;
    error?: string;
  }>({ orderId: null });
  const [onlineKizResolution, setOnlineKizResolution] = useState<{
    assemblyId: string | null;
    message?: string;
    error?: string;
  }>({ assemblyId: null });
  const [onlineFbsSyncResolution, setOnlineFbsSyncResolution] = useState<{
    assemblyId: string | null;
    message?: string;
    error?: string;
  }>({ assemblyId: null });
  const [emergencyUpload, setEmergencyUpload] = useState<{
    request: ClientRequestSummary;
    file: File | null;
    status: 'idle' | 'submitting' | 'done';
    error?: string;
    result?: EmergencyPackedXlsxResult;
  } | null>(null);
  const [emergencyRollback, setEmergencyRollback] = useState<ClientRequestSummary | null>(null);
  const [isRollingBackEmergency, setRollingBackEmergency] = useState(false);
  const [manualInstructionUpload, setManualInstructionUpload] = useState<{
    request: ClientRequestSummary;
    file: File | null;
    status: 'idle' | 'submitting' | 'done';
    error?: string;
    result?: PickInstructionDocument;
  } | null>(null);
  const [manualClose, setManualClose] = useState<ManualCloseState | null>(null);
  const [manualBoxSelection, setManualBoxSelection] = useState<ManualBoxSelectionState | null>(null);
  const [closeStockRecovery, setCloseStockRecovery] = useState<CloseStockRecoveryState | null>(null);
  const [fbsBoxSearch, setFbsBoxSearch] = useState<FbsBoxSearchState | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [requestSortField, setRequestSortField] = useState<RequestSortField>(() =>
    (window.localStorage.getItem(`wms-request-sort-field:${session.user.id}`) as RequestSortField | null) ?? 'number',
  );
  const [requestSortDirection, setRequestSortDirection] = useState<RequestSortDirection>(() =>
    (window.localStorage.getItem(`wms-request-sort-direction:${session.user.id}`) as RequestSortDirection | null) ?? 'desc',
  );
  const [archiveBoxSearch, setArchiveBoxSearch] = useState('');
  const [appliedArchiveBoxSearch, setAppliedArchiveBoxSearch] = useState('');
  const [fbsTailClientId, setFbsTailClientId] = useRememberedClientId(session.user.id);
  const [selectedFbsTailRequestIds, setSelectedFbsTailRequestIds] = useState<
    Set<string>
  >(() => new Set());
  const [isPreviewingFbsTails, setPreviewingFbsTails] = useState(false);
  const [fbsTailMergePreview, setFbsTailMergePreview] =
    useState<FbsTailMergePreviewState | null>(null);
  const [isMergingFbsTails, setMergingFbsTails] = useState(false);
  const [fbsSynchronizationAudit, setFbsSynchronizationAudit] =
    useState<FbsSynchronizationAudit | null>(null);
  const [isRunningFbsSynchronizationAudit, setRunningFbsSynchronizationAudit] = useState(false);
  const [resolvingFbsSynchronizationRequestId, setResolvingFbsSynchronizationRequestId] = useState<string | null>(null);

  const visibleClients = useMemo(() => clients.data, [clients.data]);
  const displayedRequests = useMemo(
    () => ({
      ...requests,
      data: requests.data
        .filter((request) => {
          const isArchived = request.status === 'DONE' || request.status === 'CANCELLED';
          return showArchive ? isArchived : !isArchived;
        })
        .sort((left, right) => {
          const leftValue = requestSortField === 'number'
            ? left.number
            : requestSortField === 'createdAt'
              ? new Date(left.createdAt).getTime()
              : left.items.reduce((sum, item) => sum + item.quantity, 0);
          const rightValue = requestSortField === 'number'
            ? right.number
            : requestSortField === 'createdAt'
              ? new Date(right.createdAt).getTime()
              : right.items.reduce((sum, item) => sum + item.quantity, 0);
          const difference = leftValue - rightValue;
          return requestSortDirection === 'asc' ? difference : -difference;
        }),
    }),
    [requests, requestSortDirection, requestSortField, showArchive],
  );
  const fbsTailEligibleRequests = useMemo(
    () =>
      displayedRequests.data.filter((request) =>
        canMergeFbsRequestTail(request),
      ),
    [displayedRequests.data],
  );
  const fbsTailClients = useMemo(
    () => [
      ...new Map(
        fbsTailEligibleRequests.map((request) => [
          request.clientId,
          request.client,
        ]),
      ).values(),
    ],
    [fbsTailEligibleRequests],
  );
  const selectableFbsTailRequestIds = useMemo(
    () =>
      new Set(
        fbsTailEligibleRequests
          .filter((request) => request.clientId === fbsTailClientId)
          .map((request) => request.id),
      ),
    [fbsTailClientId, fbsTailEligibleRequests],
  );
  const selectedFbsTailRequests = useMemo(
    () =>
      fbsTailEligibleRequests.filter((request) =>
        selectedFbsTailRequestIds.has(request.id),
      ),
    [fbsTailEligibleRequests, selectedFbsTailRequestIds],
  );
  const fbsAuditClientIds = useMemo(
    () =>
      [...new Set(
        requests.data
          .filter((request) => (request._count?.fbsOrderLinks ?? 0) > 0)
          .map((request) => request.clientId),
      )],
    [requests.data],
  );

  useEffect(() => {
    setFbsTailClientId((current) => {
      if (fbsTailClients.some((client) => client.id === current)) {
        return current;
      }
      return fbsTailClients.length === 1 ? fbsTailClients[0]!.id : '';
    });
  }, [fbsTailClients]);

  useEffect(() => {
    setSelectedFbsTailRequestIds((current) => {
      const next = new Set(
        [...current].filter((requestId) =>
          selectableFbsTailRequestIds.has(requestId),
        ),
      );
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
      if (
        cancelled ||
        refreshInProgress ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      refreshInProgress = true;
      try {
        const plan = await fetchTsdAssemblyPlan(session.accessToken, requestId);
        if (!cancelled) {
          setOnlinePreview((current) =>
            current?.request.id === requestId ? { ...current, plan, status: 'ready', error: undefined } : current,
          );
        }
      } catch (caught) {
        if (!cancelled) {
          setOnlinePreview((current) =>
            current?.request.id === requestId ? { ...current, status: 'error', error: errorMessage(caught) } : current,
          );
        }
      } finally {
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
        .catch((caught) =>
          setBoxOverlaps((current) => ({
            ...current,
            status: 'error',
            error: errorMessage(caught),
          })),
        );
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
    } catch (caught) {
      const message = errorMessage(caught);
      setRequests((current) => ({ ...current, status: 'error', error: message }));
      setClients((current) => ({ ...current, status: 'error', error: message }));
      setBalanceReviews((current) => ({ ...current, status: 'error', error: message }));
    }
  }

  async function runFbsSynchronizationAudit() {
    if (isRunningFbsSynchronizationAudit) return;
    setRunningFbsSynchronizationAudit(true);
    setError(null);
    setActionMessage(null);
    try {
      const results = await Promise.allSettled(
        fbsAuditClientIds.map((clientId) => fetchFbsOrders(session.accessToken, clientId, true)),
      );
      const responses: ClientFbsOrders[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          responses.push(result.value);
        } else {
          const client = visibleClients.find((item) => item.id === fbsAuditClientIds[index]);
          failures.push(`${client?.name ?? 'Клиент'}: ${errorMessage(result.reason)}`);
        }
      });
      setFbsSynchronizationAudit(buildFbsSynchronizationAudit(responses, failures));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRunningFbsSynchronizationAudit(false);
    }
  }

  async function resolveFbsSynchronizationIssue(
    issue: FbsSynchronizationAuditIssue,
    action: 'RETURN_TO_WORK' | 'CONFIRM_DELIVERED',
  ) {
    if (resolvingFbsSynchronizationRequestId) return;
    const actionLabel = action === 'CONFIRM_DELIVERED' ? 'подтвердить сдачу' : 'вернуть в работу';
    const confirmation = window.prompt(
      `Для действия «${actionLabel}» введите номер заявки ${issue.requestNumber}. Остатки повторно не изменятся.`,
      '',
    );
    if (confirmation?.trim() !== String(issue.requestNumber)) {
      setActionMessage('Действие отменено: номер заявки не подтверждён.');
      return;
    }
    setResolvingFbsSynchronizationRequestId(issue.requestId);
    setError(null);
    try {
      const result = await resolveFbsSynchronization(
        session.accessToken,
        issue.requestId,
        action,
        issue.requestNumber,
      );
      setRequests((current) => ({
        ...current,
        data: current.data.map((request) => request.id === result.request.id ? result.request : request),
      }));
      setActionMessage(result.message);
      await runFbsSynchronizationAudit();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setResolvingFbsSynchronizationRequestId(null);
    }
  }

  async function changeStatus(requestId: string, status: ClientRequestStatus) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function cancelRequest(request: ClientRequestSummary) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function pickOutboundRequest(request: ClientRequestSummary) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openRequestDocument(request: ClientRequestSummary) {
    setError(null);

    try {
      setDocumentPreview(await fetchClientRequestDocument(session.accessToken, request.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openPickInstruction(request: ClientRequestSummary) {
    setError(null);

    try {
      setPickInstructionPreview(await fetchPickInstruction(session.accessToken, request.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openManualBoxSelection(request: ClientRequestSummary) {
    setManualBoxSelection({ request, status: 'loading', data: null });
    setError(null);

    try {
      const data = await fetchClientRequestManualBoxSelection(session.accessToken, request.id);
      setManualBoxSelection({ request, status: 'ready', data });
    } catch (caught) {
      setManualBoxSelection({ request, status: 'ready', data: null, error: errorMessage(caught) });
    }
  }

  async function openFbsBoxSearch(request: ClientRequestSummary) {
    setFbsBoxSearch({ request, status: 'loading', data: null });
    setError(null);

    try {
      const data = await fetchClientRequestFbsBoxSearch(session.accessToken, request.id);
      setFbsBoxSearch({ request, status: 'ready', data });
    } catch (caught) {
      setFbsBoxSearch({ request, status: 'ready', data: null, error: errorMessage(caught) });
    }
  }

  function changeManualBoxQuantity(requestItemId: string, boxId: string, rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    setManualBoxSelection((current) => {
      if (!current?.data || current.status === 'saving') return current;
      const items = current.data.items.map((item) => {
        if (item.requestItemId !== requestItemId) return item;
        const boxes = item.boxes.map((box) =>
          box.boxId === boxId
            ? { ...box, selectedQuantity: Math.min(quantity, box.availableQuantity) }
            : box,
        );
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
    if (!manualBoxSelection?.data) return;
    const data = manualBoxSelection.data;
    const invalidItem = !clear
      ? data.items.find((item) => item.selectedQuantity !== item.requestedQuantity)
      : undefined;
    if (invalidItem) {
      const label = invalidItem.sku?.internalSku ?? invalidItem.requestedBarcode ?? invalidItem.requestedName ?? 'позиции';
      setManualBoxSelection((current) =>
        current
          ? {
              ...current,
              error: `Для ${label} нужно выбрать ${invalidItem.requestedQuantity} шт., сейчас выбрано ${invalidItem.selectedQuantity} шт.`,
            }
          : current,
      );
      return;
    }

    const selections = clear
      ? []
      : data.items.flatMap((item) =>
          item.boxes
            .filter((box) => box.selectedQuantity > 0)
            .map((box) => ({
              requestItemId: item.requestItemId,
              boxId: box.boxId,
              quantity: box.selectedQuantity,
            })),
        );
    setManualBoxSelection((current) => (current ? { ...current, status: 'saving', error: undefined } : current));
    try {
      const saved = await saveClientRequestManualBoxSelection(
        session.accessToken,
        manualBoxSelection.request.id,
        selections,
      );
      setManualBoxSelection((current) =>
        current ? { ...current, status: 'ready', data: saved, error: undefined } : current,
      );
      setActionMessage(clear ? 'Выбор коробов очищен.' : 'Короба для списания сохранены. Остатки пока не изменены.');
    } catch (caught) {
      setManualBoxSelection((current) =>
        current ? { ...current, status: 'ready', error: errorMessage(caught) } : current,
      );
    }
  }

  async function downloadOriginalRequestFile(request: ClientRequestSummary, file: ClientRequestFileSummary) {
    setError(null);

    try {
      const blob = await downloadClientRequestFile(session.accessToken, request.id, file.id);
      downloadBlob(blob, file.fileName);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function openManualClose(request: ClientRequestSummary) {
    const recordedPackages = request.status === 'PACKED' && request.packages.length > 0;
    const boxes = request.packages.filter((item) => !isPalletPackage(item.packageType)).length;
    const pallets = request.packages.filter((item) => isPalletPackage(item.packageType)).length;
    const packageUnits = request.packages.reduce(
      (total, item) => total + item.items.reduce((itemTotal, row) => itemTotal + row.quantity, 0),
      0,
    );
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

  async function submitManualClose(
    allowOverweightPackages = true,
    closeAllUnknownWithoutBox = false,
  ) {
    if (!manualClose) return;

    const boxes = parseNonNegativeInteger(manualClose.boxes);
    const pallets = parseNonNegativeInteger(manualClose.pallets);
    const packedUnits = parseNonNegativeInteger(manualClose.packedUnits);
    const requestedUnits = manualClose.request.items.reduce((total, item) => total + item.quantity, 0);
    let validationError: string | undefined;

    if (boxes == null || pallets == null || packedUnits == null) {
      validationError = 'Заполните короба, паллеты и количество товара целыми числами.';
    } else if (boxes + pallets < 1) {
      validationError = 'Укажите хотя бы один короб или одну паллету.';
    } else if (!manualClose.usesRecordedPackages && packedUnits !== requestedUnits) {
      validationError = `В составе заявки ${requestedUnits} шт. Исправьте количество или сначала отредактируйте заявку.`;
    } else if (!manualClose.comment.trim()) {
      validationError = 'Укажите комментарий к ручному закрытию.';
    }

    if (validationError) {
      setManualClose((current) => (current ? { ...current, error: validationError } : current));
      return;
    }

    setManualClose((current) => (current ? { ...current, status: 'submitting', error: undefined } : current));
    setError(null);

    try {
      let stockSources: Array<{
        requestItemId: string;
        noBox: true;
        quantity: number;
      }> | undefined;
      if (closeAllUnknownWithoutBox) {
        // ADDED: массовая кнопка получает актуальные проблемные позиции перед закрытием.
        const selection = await fetchClientRequestManualBoxSelection(
          session.accessToken,
          manualClose.request.id,
        );
        const bulkNoBox = buildUnknownSourceNoBoxStockSources(selection.items);
        if (bulkNoBox.stockSources.length === 0) {
          throw new Error('В заявке нет проблемных FBS-позиций с неизвестным источником.');
        }
        stockSources = bulkNoBox.stockSources;
      }
      await updateClientRequestStatus(session.accessToken, manualClose.request.id, {
        status: 'DONE',
        managerComment: closeAllUnknownWithoutBox
          ? `${manualClose.comment.trim()} Все проблемные FBS-позиции подтверждены без исходного короба.`
          : manualClose.comment.trim(),
        boxes: boxes!,
        pallets: pallets!,
        packedUnits: packedUnits!,
        // FIX: сохраняем уже опубликованное подтверждение перевеса ручного закрытия.
        allowOverweightPackages,
        stockSources,
      });

      setManualClose(null);
      setActionMessage('Отгрузка закрыта. Остатки списаны, начисления за обработку и черновик счета сформированы.');
      await loadData();
    } catch (caught) {
      const message = errorMessage(caught);
      const failedClose: ManualCloseState = {
        ...manualClose,
        status: 'idle',
        error: message,
      };
      setManualClose(failedClose);
      if (!isOverweightPackageError(message) && isStockSourceResolutionError(message)) {
        await openCloseStockRecovery(failedClose, message);
      }
    }
  }

  async function openCloseStockRecovery(
    closeOverride?: ManualCloseState,
    errorOverride?: string,
  ) {
    const close = closeOverride ?? manualClose;
    if (!close) return;
    const originalError =
      errorOverride ??
      close.error ??
      'Штатное закрытие заявки не выполнено.';
    setCloseStockRecovery({
      close,
      status: 'loading',
      data: null,
      values: {},
      touchedItemIds: [],
      originalError,
    });

    try {
      const data = await fetchClientRequestManualBoxSelection(
        session.accessToken,
        close.request.id,
      );
      const values = Object.fromEntries(
        data.items.map((item) => [
          item.requestItemId,
          {
            boxQuantities: Object.fromEntries(
              item.boxes.map((box) => [
                box.boxCode,
                box.selectedQuantity > 0 ? String(box.selectedQuantity) : '',
              ]),
            ),
            noBoxQuantity: '',
            manualBoxCode: '',
            manualBoxQuantity: '',
          } satisfies CloseStockSourceValue,
        ]),
      );
      setCloseStockRecovery({
        close,
        status: 'ready',
        data,
        values,
        touchedItemIds: [],
        originalError,
      });
    } catch (caught) {
      setCloseStockRecovery((current) =>
        current
          ? { ...current, status: 'ready', error: errorMessage(caught) }
          : current,
      );
    }
  }

  function changeCloseStockSource(
    requestItemId: string,
    patch: (value: CloseStockSourceValue) => CloseStockSourceValue,
  ) {
    setCloseStockRecovery((current) => {
      if (!current || current.status !== 'ready') return current;
      const value = current.values[requestItemId];
      if (!value) return current;
      return {
        ...current,
        error: undefined,
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

  function chooseCloseStockWithoutBox(requestItemId: string, requestedQuantity: number) {
    changeCloseStockSource(requestItemId, (value) => ({
      ...value,
      boxQuantities: Object.fromEntries(
        Object.keys(value.boxQuantities).map((boxCode) => [boxCode, '']),
      ),
      manualBoxCode: '',
      manualBoxQuantity: '',
      noBoxQuantity: String(requestedQuantity),
    }));
  }

  async function submitCloseStockRecovery(options?: { allUnknownWithoutBox?: boolean }) {
    if (!closeStockRecovery?.data || closeStockRecovery.status !== 'ready') return;
    // FIX: массовое действие использует ту же проверку и тот же серверный путь,
    // что и ручное подтверждение каждой отдельной позиции.
    const bulkNoBoxSelection = options?.allUnknownWithoutBox
      ? selectAllUnknownSourcesWithoutBox(
          closeStockRecovery.data.items,
          closeStockRecovery.values,
          closeStockRecovery.touchedItemIds,
        )
      : null;
    const effectiveValues = bulkNoBoxSelection?.values ?? closeStockRecovery.values;
    const effectiveTouchedItemIds =
      bulkNoBoxSelection?.touchedItemIds ?? closeStockRecovery.touchedItemIds;

    if (effectiveTouchedItemIds.length === 0) {
      setCloseStockRecovery((current) =>
        current
          ? { ...current, error: 'Выберите проблемный товар и укажите его фактический источник.' }
          : current,
      );
      return;
    }
    const unresolvedFbsItems = closeStockRecovery.data.items.filter(
      (item) =>
        item.fbsOrders.some(
          (order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending,
        ) &&
        !effectiveTouchedItemIds.includes(item.requestItemId),
    );
    if (unresolvedFbsItems.length > 0) {
      const orderIds = unresolvedFbsItems.flatMap((item) =>
        item.fbsOrders
          .filter(
            (order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending,
          )
          .map((order) => order.orderId),
      );
      setCloseStockRecovery((current) =>
        current
          ? {
              ...current,
              error:
                `Подтвердите фактический источник для незавершённых FBS-заказов: ` +
                `№${orderIds.join(', №')}.`,
            }
          : current,
      );
      return;
    }

    const stockSources: Array<{
      requestItemId: string;
      boxCode?: string;
      noBox?: boolean;
      quantity: number;
    }> = [];
    for (const requestItemId of effectiveTouchedItemIds) {
      const item = closeStockRecovery.data.items.find(
        (candidate) => candidate.requestItemId === requestItemId,
      );
      const value = effectiveValues[requestItemId];
      if (!item || !value) continue;

      const sources = new Map<string, { boxCode?: string; noBox?: boolean; quantity: number }>();
      for (const [boxCode, rawQuantity] of Object.entries(value.boxQuantities)) {
        const quantity = parseNonNegativeInteger(rawQuantity || '0') ?? 0;
        if (quantity <= 0) continue;
        sources.set(`BOX:${boxCode.toLocaleUpperCase('ru-RU')}`, { boxCode, quantity });
      }
      const manualBoxCode = value.manualBoxCode.trim();
      const manualQuantity = parseNonNegativeInteger(value.manualBoxQuantity || '0') ?? 0;
      if (manualQuantity > 0) {
        if (!manualBoxCode) {
          setCloseStockRecovery((current) =>
            current ? { ...current, error: 'Введите номер фактического короба.' } : current,
          );
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
      const confirmedQuantity = [...sources.values()].reduce(
        (sum, source) => sum + source.quantity,
        0,
      );
      if (confirmedQuantity !== item.requestedQuantity) {
        const label =
          item.sku?.name ??
          item.sku?.internalSku ??
          item.requestedName ??
          item.requestedBarcode ??
          'товара';
        setCloseStockRecovery((current) =>
          current
            ? {
                ...current,
                error:
                  `Для «${label}» укажите источник всех ${item.requestedQuantity} шт. ` +
                  `Сейчас указано ${confirmedQuantity} шт.`,
              }
            : current,
        );
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
      setCloseStockRecovery((current) =>
        current ? { ...current, error: 'Параметры закрытия заявки изменились. Откройте закрытие повторно.' } : current,
      );
      return;
    }

    setCloseStockRecovery((current) =>
      current
        ? {
            ...current,
            status: 'submitting',
            values: effectiveValues,
            touchedItemIds: effectiveTouchedItemIds,
            error: undefined,
          }
        : current,
    );
    try {
      await updateClientRequestStatus(session.accessToken, close.request.id, {
        status: 'DONE',
        managerComment:
          `${close.comment.trim()} Фактический источник проблемного товара подтверждён менеджером.`,
        boxes,
        pallets,
        packedUnits,
        stockSources,
      });
      setCloseStockRecovery(null);
      setManualClose(null);
      setActionMessage(
        'Заявка закрыта по подтверждённому факту. Источник товара и корректировка остатков записаны в движениях.',
      );
      await loadData();
    } catch (caught) {
      setCloseStockRecovery((current) =>
        current
          ? { ...current, status: 'ready', error: errorMessage(caught) }
          : current,
      );
    }
  }

  async function openOnlineExecution(request: ClientRequestSummary) {
    setOnlinePreview({ request, plan: null, status: 'loading' });
    setOnlineFbsMove({ orderId: null });
    setOnlineKizResolution({ assemblyId: null });
    setOnlineFbsSyncResolution({ assemblyId: null });
    setError(null);

    try {
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview({ request, plan, status: 'ready' });
    } catch (caught) {
      setOnlinePreview({ request, plan: null, status: 'error', error: errorMessage(caught) });
    }
  }

  async function resolveOnlineFbsKiz(
    request: ClientRequestSummary,
    assemblyId: string,
  ) {
    setOnlineKizResolution({ assemblyId });
    try {
      const result = await resolveTsdFbsKizConflict(
        session.accessToken,
        request.id,
        assemblyId,
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineKizResolution({
        assemblyId: null,
        ...(result.resolved
          ? { message: result.message }
          : { error: result.message }),
      });
    } catch (caught) {
      setOnlineKizResolution({
        assemblyId: null,
        error: errorMessage(caught),
      });
    }
  }

  async function restoreOnlineFbsRescanFromWb(
    request: ClientRequestSummary,
    assemblyId: string,
  ) {
    setOnlineKizResolution({ assemblyId });
    try {
      const result = await restoreTsdFbsRescanFromWildberries(
        session.accessToken,
        request.id,
        assemblyId,
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineKizResolution({ assemblyId: null, message: result.message });
      await loadData();
    } catch (caught) {
      setOnlineKizResolution({ assemblyId: null, error: errorMessage(caught) });
    }
  }

  async function resolveOnlineFbsSyncConflict(
    request: ClientRequestSummary,
    assemblyId: string,
    action: FbsSyncConflictResolutionAction,
  ) {
    let comment: string | undefined;
    if (action === 'RETURN_TO_STOCK') {
      const confirmed = window.confirm(
        'Подтвердите, что товар физически возвращён в указанный короб или в хранение без коробов. Резерв FBS и отсканированные данные будут сняты.',
      );
      if (!confirmed) return;
    } else {
      const managerComment = window.prompt(
        'Опишите решение менеджера. После подтверждения конфликт будет закрыт, а прежний резерв FBS снят:',
        '',
      );
      if (managerComment === null) return;
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
      const result = await resolveTsdFbsSyncConflict(
        session.accessToken,
        request.id,
        assemblyId,
        { action, comment },
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
      await loadData();
    } catch (caught) {
      setOnlineFbsSyncResolution({
        assemblyId: null,
        error: errorMessage(caught),
      });
    }
  }

  async function resolveOnlineFbsSyncConflicts(
    request: ClientRequestSummary,
    assemblyIds: string[],
    action: FbsSyncConflictResolutionAction,
  ) {
    const selectedIds = [...new Set(assemblyIds.filter(Boolean))];
    if (selectedIds.length === 0) return;

    let comment: string | undefined;
    if (action === 'RETURN_TO_STOCK') {
      const confirmed = window.confirm(
        `Вернуть на склад все выбранные товары (${selectedIds.length} шт.)?\n\nПодтвердите, что товары физически возвращены в указанные короба или в хранение без коробов.`,
      );
      if (!confirmed) return;
    } else {
      const managerComment = window.prompt(
        `Опишите одно решение менеджера для всех выбранных товаров (${selectedIds.length} шт.):`,
        '',
      );
      if (managerComment === null) return;
      comment = managerComment.trim();
      if (!comment) {
        setOnlineFbsSyncResolution({
          assemblyId: null,
          error: 'Для подтверждения решения менеджера нужен комментарий.',
        });
        return;
      }
    }

    setOnlineFbsSyncResolution({ assemblyId: '__bulk__' });
    try {
      const result = await resolveFbsSyncConflictBatch(selectedIds, (assemblyId) =>
        resolveTsdFbsSyncConflict(
          session.accessToken,
          request.id,
          assemblyId,
          { action, comment },
        ),
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineFbsSyncResolution({
        assemblyId: null,
        message: `Готово: обработано выбранных позиций — ${result.completed}.`,
      });
      await loadData();
    } catch (caught) {
      try {
        const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
        setOnlinePreview((current) =>
          current?.request.id === request.id
            ? { ...current, plan, status: 'ready', error: undefined }
            : current,
        );
      } catch {
        // Keep the original batch error visible; manual refresh remains available.
      }
      setOnlineFbsSyncResolution({
        assemblyId: null,
        error: errorMessage(caught),
      });
      await loadData();
    }
  }

  async function resetOnlineFbsAssemblyOrder(
    request: ClientRequestSummary,
    assemblyId: string,
    orderId: string,
  ) {
    const confirmed = window.confirm(
      `Сбросить сборку заказа №${orderId}?\n\nWMS снимет резерв и очистит только ШК товара, КИЗ, короб и наклейку этого заказа. Сам заказ на Wildberries не отменяется. Перед сбросом верните товар в исходный короб.`,
    );
    if (!confirmed) return;

    setOnlineFbsSyncResolution({ assemblyId });
    try {
      const result = await resetTsdFbsAssemblyOrder(
        session.accessToken,
        request.id,
        assemblyId,
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
      await loadData();
    } catch (caught) {
      setOnlineFbsSyncResolution({
        assemblyId: null,
        error: errorMessage(caught),
      });
    }
  }

  async function markOnlineFbsOrderPackedWithoutSource(
    request: ClientRequestSummary,
    assemblyId: string,
    orderId: string,
  ) {
    const confirmed = window.confirm(
      `Отметить заказ №${orderId} как «Вложен без короба»?\n\nЗаказ будет засчитан в сборке. При закрытии заявки WMS обязательно попросит указать фактический короб, откуда был взят товар. Для маркируемого товара КИЗ должен быть уже подтверждён Wildberries.`,
    );
    if (!confirmed) return;

    setOnlineFbsSyncResolution({ assemblyId });
    try {
      const result = await markTsdFbsAssemblyPackedWithoutSource(
        session.accessToken,
        request.id,
        assemblyId,
      );
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview((current) =>
        current?.request.id === request.id
          ? { ...current, plan, status: 'ready', error: undefined }
          : current,
      );
      setOnlineFbsSyncResolution({ assemblyId: null, message: result.message });
      await loadData();
    } catch (caught) {
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
    setOnlinePreview((current) => (current ? { ...current, status: current.plan ? 'ready' : 'loading', error: undefined } : current));

    try {
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview({ request, plan, status: 'ready' });
    } catch (caught) {
      setOnlinePreview({ request, plan: onlinePreview.plan, status: 'error', error: errorMessage(caught) });
    }
  }

  async function downloadPickInstruction(request: ClientRequestSummary) {
    setError(null);

    try {
      if (isFbsRequest(request)) {
        const blob = await downloadFbsRequestPickListPdf(session.accessToken, request.id);
        downloadBlob(blob, `Лист_подбора_FBS_${String(request.number).padStart(6, '0')}.pdf`);
      } else {
        const blob = await downloadPickInstructionXlsx(session.accessToken, request.id);
        downloadBlob(blob, `pick-instruction-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function moveOnlineFbsOrders(
    request: ClientRequestSummary,
    selectedOrders: Array<{ id: string; connectionId: string }>,
  ) {
    const orders = [...new Map(
      selectedOrders.map((order) => [`${order.connectionId}:${order.id}`, order]),
    ).values()];
    if (orders.length === 0) return;
    // The action button itself is the explicit confirmation.  Native browser
    // dialogs are easily dismissed on a TSD/touch screen and, in that case,
    // the request never reaches the API at all.  The server still performs
    // the final live WB/status/physical-assembly validation before moving.
    setOnlineFbsMove({ orderId: orders.length === 1 ? orders[0]!.id : '__bulk__' });
    try {
      const result = await moveFbsOrdersToNewSupply(session.accessToken, {
        clientId: request.clientId,
        orders,
      });
      const message =
        `${orders.length === 1 ? `Заказ №${orders[0]!.id} перенесён` : `${orders.length} заказов перенесены`} в поставку ${result.targetSupply.id} ` +
        `и заявку №${String(result.targetRequest.number).padStart(6, '0')}.`;
      setOnlineFbsMove({ orderId: null, message });
      setActionMessage(message);
      try {
        const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
        setOnlinePreview((current) =>
          current?.request.id === request.id
            ? { ...current, plan, status: 'ready', error: undefined }
            : current,
        );
      } catch {
        setOnlinePreview(null);
      }
      void loadData();
    } catch (caught) {
      setOnlineFbsMove({
        orderId: null,
        error: errorMessage(caught),
      });
    }
  }

  async function moveOnlineFbsOrder(
    request: ClientRequestSummary,
    order: { id: string; connectionId: string },
  ) {
    return moveOnlineFbsOrders(request, [order]);
  }

  // ADDED: real recovery action for a mixed/stale WB selection. The API moves
  // only safe orders and returns every order that deliberately stayed behind.
  async function repairOnlineFbsOrders(
    request: ClientRequestSummary,
    selectedOrders: Array<{ id: string; connectionId: string }>,
  ) {
    const orders = [...new Map(
      selectedOrders.map((order) => [`${order.connectionId}:${order.id}`, order]),
    ).values()];
    if (orders.length === 0) return;
    setOnlineFbsMove({ orderId: '__repair__' });
    try {
      const result = await repairFbsOrdersMove(session.accessToken, {
        clientId: request.clientId,
        orders,
        sourceRequestId: request.id,
      });
      const destination = result.targetSupply && result.targetRequest
        ? ` Поставка ${result.targetSupply.id}, заявка №${String(result.targetRequest.number).padStart(6, '0')}.`
        : '';
      const skippedPreview = result.skippedOrders
        .slice(0, 5)
        .map((item) => `№${item.id}: ${item.reason}`)
        .join(' ');
      const skippedMessage = result.skipped > 0
        ? ` Оставлено в исходной заявке: ${result.skipped}.${skippedPreview ? ` ${skippedPreview}` : ''}`
        : '';
      const partialMessage = result.partialFailure
        ? ` Внимание: ${result.partialFailure}`
        : '';
      const message = `Перенесено заказов: ${result.moved}.${destination}${skippedMessage}${partialMessage}`;
      setOnlineFbsMove(
        result.moved > 0
          ? { orderId: null, message }
          : { orderId: null, error: `Ничего не перенесено.${skippedMessage}` },
      );
      if (result.moved > 0) setActionMessage(message);
      try {
        const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
        setOnlinePreview((current) =>
          current?.request.id === request.id
            ? { ...current, plan, status: 'ready', error: undefined }
            : current,
        );
      } catch {
        setOnlinePreview(null);
      }
      void loadData();
    } catch (caught) {
      setOnlineFbsMove({ orderId: null, error: errorMessage(caught) });
    }
  }

  async function openFbsRequestTailsPreview() {
    if (
      selectedFbsTailRequests.length === 0 ||
      isPreviewingFbsTails ||
      isMergingFbsTails
    ) {
      return;
    }

    const requestIds = selectedFbsTailRequests.map((request) => request.id);
    setPreviewingFbsTails(true);
    setError(null);
    setActionMessage(null);
    try {
      const data = await previewFbsRequestTails(
        session.accessToken,
        requestIds,
      );
      setFbsTailMergePreview({ requestIds, data });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    setFbsTailMergePreview((current) =>
      current ? { ...current, error: undefined } : current,
    );
    try {
      const result = await mergeFbsRequestTails(
        session.accessToken,
        fbsTailMergePreview.requestIds,
        fbsTailMergePreview.data.orders.map((order) => ({
          connectionId: order.connectionId,
          id: order.id,
        })),
      );
      setFbsTailMergePreview(null);
      setSelectedFbsTailRequestIds(new Set());
      setActionMessage(
        `Создана заявка №${String(result.targetRequest.number).padStart(6, '0')}: ` +
          `${result.moved} необработанных заказов из ${result.selectedRequestCount} заявок. ` +
          `Новая поставка WB: ${result.targetSupply.id}.` +
          (result.skipped > 0
            ? ` Пропущено заказов: ${result.skipped} (${result.skippedOrders
                .map((order) => `№${order.id}`)
                .join(', ')}).`
            : ''),
      );
      await loadData();
    } catch (caught) {
      setFbsTailMergePreview((current) =>
        current ? { ...current, error: errorMessage(caught) } : current,
      );
    } finally {
      setMergingFbsTails(false);
    }
  }

  async function downloadRequestItems(request: ClientRequestSummary) {
    setError(null);

    try {
      const blob = await downloadClientRequestItemsXlsx(session.accessToken, request.id);
      downloadBlob(blob, `sostav-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadWbProductsTemplate(request: ClientRequestSummary) {
    setError(null);
    try {
      const blob = await downloadClientRequestWbProductsXlsx(session.accessToken, request.id);
      downloadBlob(blob, `wb-products-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadWbPackagesTemplate(request: ClientRequestSummary) {
    setError(null);
    try {
      const blob = await downloadClientRequestWbPackagesXlsx(session.accessToken, request.id);
      downloadBlob(blob, `wb-packages-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function refreshPickInstruction(request: ClientRequestSummary) {
    setError(null);
    setActionMessage(null);
    setRefreshingInstructionId(request.id);

    try {
      const repair = isFbsRequest(request)
        ? await repairFbsRequestSelectionRequest(session.accessToken, request.id)
        : null;
      const document = await refreshPickInstructionDocument(session.accessToken, request.id);
      setPickInstructionPreview(document);
      setActionMessage(
        repair?.message
          ?? `Заявка №${String(request.number).padStart(6, '0')} принудительно пересчитана по текущим остаткам. Архивные короба исключены, история сборки сохранена.`,
      );

      if (onlinePreview?.request.id === request.id) {
        const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
        setOnlinePreview({ request: onlinePreview.request, plan, status: 'ready' });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRefreshingInstructionId((current) => (current === request.id ? null : current));
    }
  }

  async function openFbsRoute(request: ClientRequestSummary) {
    if (routeLoadingRequestId) return;
    setError(null);
    setRouteLoadingRequestId(request.id);
    setFbsRoutePanel({ request, status: 'loading', data: null });
    try {
      // ADDED: Backend returns a live, versioned route.
      const data = await fetchFbsRequestRoute(session.accessToken, request.id);
      setFbsRoutePanel({ request, status: 'ready', data });
    } catch (caught) {
      setFbsRoutePanel({ request, status: 'error', data: null, error: errorMessage(caught) });
    } finally {
      setRouteLoadingRequestId((current) => current === request.id ? null : current);
    }
  }

  async function rebuildOpenFbsRoute() {
    const current = fbsRoutePanel;
    if (!current || current.status === 'rebuilding') return;
    setFbsRoutePanel({ ...current, status: 'rebuilding', error: undefined, diff: undefined });
    try {
      const result = await rebuildFbsRequestRoute(session.accessToken, current.request.id);
      setFbsRoutePanel({ request: current.request, status: 'ready', data: result.route, diff: result.diff });
      setActionMessage(result.message);
    } catch (caught) {
      setFbsRoutePanel({ ...current, status: 'ready', error: errorMessage(caught) });
    }
  }

  async function openFbsSupplyConsistency(request: ClientRequestSummary) {
    setError(null);
    setCheckingSupplyRequestId(request.id);
    setFbsSupplyConsistency({ request, status: 'loading', data: null });
    try {
      const data = await checkFbsRequestSupplyConsistency(session.accessToken, request.id);
      setFbsSupplyConsistency((current) =>
        current?.request.id === request.id
          ? { request, status: 'ready', data }
          : current,
      );
    } catch (caught) {
      setFbsSupplyConsistency((current) =>
        current?.request.id === request.id
          ? { request, status: 'ready', data: null, error: errorMessage(caught) }
          : current,
      );
    } finally {
      setCheckingSupplyRequestId((current) => (current === request.id ? null : current));
    }
  }

  async function repairFbsSupplyConsistency() {
    const current = fbsSupplyConsistency;
    if (!current || current.status === 'repairing') return;
    setFbsSupplyConsistency({ ...current, status: 'repairing', error: undefined });
    try {
      const data = await repairFbsRequestSupplyConsistency(
        session.accessToken,
        current.request.id,
      );
      setFbsSupplyConsistency({
        request: current.request,
        status: 'ready',
        data,
      });
      setActionMessage(data.message);
      await loadData();
    } catch (caught) {
      setFbsSupplyConsistency({
        ...current,
        status: 'ready',
        error: errorMessage(caught),
      });
    }
  }

  async function syncRequestToTsd(request: ClientRequestSummary) {
    setError(null);
    setActionMessage(null);
    setSyncingTsdRequestId(request.id);

    try {
      const result = await syncClientRequestToTsd(session.accessToken, request.id);
      setActionMessage(
        result.message
          ?? `Заявка №${String(request.number).padStart(6, '0')} синхронизирована с ТСД. Обновите очередь на устройстве.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSyncingTsdRequestId((current) => (current === request.id ? null : current));
    }
  }

  async function downloadOnlineOutgoingBoxes(request: ClientRequestSummary) {
    setError(null);

    try {
      const blob = await downloadTsdOutgoingBoxesXlsx(session.accessToken, request.id);
      downloadBlob(blob, `outgoing-boxes-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadOnlineOutgoingContents(request: ClientRequestSummary) {
    setError(null);

    try {
      const blob = await downloadTsdOutgoingContentsXlsx(session.accessToken, request.id);
      downloadBlob(blob, `outgoing-contents-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadOnlineMovements(request: ClientRequestSummary) {
    setError(null);

    try {
      const blob = await downloadTsdMovementsXlsx(session.accessToken, request.id);
      downloadBlob(blob, `movements-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function packageOutboundRequest(request: ClientRequestSummary) {
    setError(null);

    try {
      const result = await packageClientRequest(session.accessToken, {
        requestId: request.id,
        idempotencyKey: `web-pack:${request.id}`,
        comment: 'Упаковка выполнена из web-интерфейса.',
      });
      setRequests((current) => ({
        ...current,
        data: current.data.map((item) =>
          item.id === request.id ? { ...item, status: 'PACKED', packages: result.packages ?? item.packages } : item,
        ),
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function shipOutboundRequest(request: ClientRequestSummary) {
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
    } catch (caught) {
      setError(errorMessage(caught));
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
    } catch (caught) {
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
      setActionMessage(
        `Аварийное закрытие отменено. Восстановлено ${result.restoredUnits} шт. в ${result.restoredBoxes} коробах.`,
      );
      await loadData();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    } catch (caught) {
      setManualInstructionUpload((current) =>
        current ? { ...current, status: 'idle', error: errorMessage(caught) } : current,
      );
    }
  }

  function acceptCreated(request: ClientRequestSummary) {
    setRequests((current) => ({
      status: 'ready',
      data: [request, ...current.data],
    }));
  }

  function acceptUpdated(request: ClientRequestSummary) {
    setRequests((current) => ({
      ...current,
      status: 'ready',
      data: current.data.map((item) => (item.id === request.id ? request : item)),
    }));
    setEditingRequest(null);
  }

  return (
    <section className="client-requests-panel" aria-label="Клиентские заявки">
      <div className="section-heading client-requests-panel__heading">
        <div>
          <p className="eyebrow">Клиентские заявки</p>
          <h2>{showArchive ? 'Архив заявок' : 'Клиентские заявки'}</h2>
        </div>
        <div className="client-requests-panel__heading-actions">
          {onOpenFbsOrders ? (
            <button
              className="client-request-open-fbs-orders"
              type="button"
              onClick={() => onOpenFbsOrders(requests.data.find(isFbsRequest) ?? ({} as ClientRequestSummary))}
              title="Перейти к заказам FBS"
            >
              <ArrowRightLeft size={17} aria-hidden="true" />
              <span>К заказам FBS</span>
            </button>
          ) : null}
          {!showArchive ? (
            <button
              className="client-request-fbs-audit-trigger"
              type="button"
              onClick={() => void runFbsSynchronizationAudit()}
              disabled={isRunningFbsSynchronizationAudit || fbsAuditClientIds.length === 0}
              title="Обновляет статусы FBS из маркетплейсов и показывает расхождения с заявками WMS"
            >
              <ShieldAlert className={isRunningFbsSynchronizationAudit ? 'is-spinning' : undefined} size={17} aria-hidden="true" />
              <span>{isRunningFbsSynchronizationAudit ? 'Проверяю…' : 'Проверить рассинхронизацию FBS'}</span>
            </button>
          ) : null}
          <button
            className={`client-request-archive-toggle ${showArchive ? 'is-active' : ''}`}
            type="button"
            onClick={() => setShowArchive((current) => !current)}
          >
            {showArchive ? <ArrowLeft size={17} aria-hidden="true" /> : <Archive size={17} aria-hidden="true" />}
            <span>{showArchive ? 'К активным заявкам' : 'Архив заявок'}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadData()}
            title="Обновить"
            aria-label="Обновить заявки"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!showArchive && fbsSynchronizationAudit ? (
        <FbsSynchronizationAuditPanel
          audit={fbsSynchronizationAudit}
          canResolve={canChangeStatus}
          resolvingRequestId={resolvingFbsSynchronizationRequestId}
          onResolve={resolveFbsSynchronizationIssue}
          onClose={() => setFbsSynchronizationAudit(null)}
        />
      ) : null}

      {!showArchive && canViewBoxOverlaps ? <BoxOverlapStatistics state={boxOverlaps} /> : null}

      {!showArchive && balanceReviews.status === 'ready' ? (
        <PickWaveBalanceReviewPanel
          session={session}
          reviews={balanceReviews.data}
          canWrite={canWrite}
          onUpdated={() => void loadData()}
        />
      ) : null}

      {!showArchive && canWrite && clients.status === 'ready' ? (
        <>
          <ClientRequestXlsxImportForm clients={visibleClients} session={session} onCreated={acceptCreated} />
          <ClientRequestCreateForm clients={visibleClients} session={session} onCreated={acceptCreated} />
        </>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {actionMessage ? <p className="form-success">{actionMessage}</p> : null}

      {showArchive ? (
        <form
          className="client-request-archive-search"
          onSubmit={(event) => {
            event.preventDefault();
            const nextSearch = archiveBoxSearch.trim();
            if (nextSearch === appliedArchiveBoxSearch) {
              void loadData();
            } else {
              setAppliedArchiveBoxSearch(nextSearch);
            }
          }}
        >
          <label>
            <Search size={17} aria-hidden="true" />
            <input
              value={archiveBoxSearch}
              onChange={(event) => setArchiveBoxSearch(event.target.value)}
              placeholder="Найти короб в архиве заявок"
              aria-label="Номер короба в архиве"
            />
            {archiveBoxSearch ? (
              <button
                className="client-request-archive-search__clear"
                type="button"
                title="Очистить поиск"
                aria-label="Очистить поиск по архиву"
                onClick={() => {
                  setArchiveBoxSearch('');
                  setAppliedArchiveBoxSearch('');
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <button className="primary-button" type="submit">
            <Search size={16} aria-hidden="true" />
            <span>Найти короб</span>
          </button>
          {appliedArchiveBoxSearch ? (
            <span className="client-request-archive-search__result">
              Поиск: {appliedArchiveBoxSearch} · найдено заявок: {displayedRequests.data.length}
            </span>
          ) : null}
        </form>
      ) : null}

      {!showArchive && canWrite && fbsTailEligibleRequests.length > 0 ? (
        <section
          className="client-request-fbs-tails"
          aria-label="Объединение необработанных FBS-заказов"
        >
          <div className="client-request-fbs-tails__copy">
            <ArrowRightLeft size={20} aria-hidden="true" />
            <div>
              <strong>Новая заявка из хвостов FBS</strong>
              <span>
                Выберите клиента, отметьте незавершённые заявки в таблице и
                перенесите их необработанные заказы в одну новую заявку.
              </span>
            </div>
          </div>
          <div className="client-request-fbs-tails__actions">
            <label>
              <span>Клиент</span>
              <select
                value={fbsTailClientId}
                onChange={(event) => {
                  setFbsTailClientId(event.target.value);
                  setSelectedFbsTailRequestIds(new Set());
                  setFbsTailMergePreview(null);
                }}
                disabled={isPreviewingFbsTails || isMergingFbsTails}
              >
                <option value="">Выберите клиента</option>
                {fbsTailClients.map((client) => (
                  <option value={client.id} key={client.id}>
                    {client.code} · {client.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="client-request-fbs-tails__selected">
              Выбрано заявок: <strong>{selectedFbsTailRequests.length}</strong>
            </span>
            <button
              className="primary-button"
              type="button"
              onClick={() => void openFbsRequestTailsPreview()}
              disabled={
                selectedFbsTailRequests.length === 0 ||
                isPreviewingFbsTails ||
                isMergingFbsTails
              }
            >
              <ClipboardList size={16} aria-hidden="true" />
              <span>
                {isPreviewingFbsTails
                  ? 'Проверяю состав…'
                  : 'Показать, что будет перенесено'}
              </span>
            </button>
          </div>
        </section>
      ) : null}

      <div className="client-request-sortbar" aria-label="Сортировка заявок">
        <span>Сортировка</span>
        <label>
          <span className="sr-only">Поле сортировки</span>
          <select
            value={requestSortField}
            onChange={(event) => {
              const value = event.target.value as RequestSortField;
              setRequestSortField(value);
              window.localStorage.setItem(`wms-request-sort-field:${session.user.id}`, value);
            }}
          >
            <option value="number">По номеру</option>
            <option value="createdAt">По дате создания</option>
            <option value="quantity">По количеству товаров</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Направление сортировки</span>
          <select
            value={requestSortDirection}
            onChange={(event) => {
              const value = event.target.value as RequestSortDirection;
              setRequestSortDirection(value);
              window.localStorage.setItem(`wms-request-sort-direction:${session.user.id}`, value);
            }}
          >
            <option value="desc">Сначала большие / новые</option>
            <option value="asc">Сначала маленькие / старые</option>
          </select>
        </label>
        <strong>{displayedRequests.data.length} заявок</strong>
      </div>

      <div className="client-requests-panel__list">
        {renderRequests(
          displayedRequests,
          selectableFbsTailRequestIds,
          selectedFbsTailRequestIds,
          setSelectedFbsTailRequestIds,
          canChangeStatus,
          canPickOutbound,
          canWrite,
          canEditAnyRequest,
          canPickOutbound && canEditAnyRequest,
          canUploadManualInstruction,
          refreshingInstructionId,
          syncingTsdRequestId,
          checkingSupplyRequestId,
          routeLoadingRequestId,
          (requestId, status) => void changeStatus(requestId, status),
          (request) => void cancelRequest(request),
          (request) => setEditingRequest(request),
          (request) => void openRequestDocument(request),
          (request) => void downloadRequestItems(request),
          canDownloadOriginalRequest
            ? (request, file) => void downloadOriginalRequestFile(request, file)
            : undefined,
          onOpenFbsOrders,
          (request) => void openFbsRoute(request),
          canPickOutbound ? (request) => void openOnlineExecution(request) : undefined,
          canPickOutbound ? (request) => void openManualBoxSelection(request) : undefined,
          canPickOutbound ? (request) => void openFbsBoxSearch(request) : undefined,
          (request) => void openPickInstruction(request),
          (request) => void refreshPickInstruction(request),
          canPickOutbound ? (request) => void syncRequestToTsd(request) : undefined,
          canPickOutbound ? (request) => void openFbsSupplyConsistency(request) : undefined,
          (request) => void downloadPickInstruction(request),
          canPickOutbound ? (request) => void downloadWbProductsTemplate(request) : undefined,
          canPickOutbound ? (request) => void downloadWbPackagesTemplate(request) : undefined,
          canUploadManualInstruction
            ? (request) => setManualInstructionUpload({ request, file: null, status: 'idle' })
            : undefined,
          canUploadManualInstruction ? (request) => setEmergencyUpload({ request, file: null, status: 'idle' }) : undefined,
          canUploadManualInstruction ? (request) => setEmergencyRollback(request) : undefined,
          (request) => void pickOutboundRequest(request),
          (request) => void packageOutboundRequest(request),
          (request) => void shipOutboundRequest(request),
        )}
      </div>

      {fbsRoutePanel ? (
        <FbsRouteDrawer
          state={fbsRoutePanel}
          canRebuild={canPickOutbound}
          onRebuild={() => void rebuildOpenFbsRoute()}
          onClose={() => {
            if (fbsRoutePanel.status !== 'rebuilding') setFbsRoutePanel(null);
          }}
        />
      ) : null}

      {fbsTailMergePreview ? (
        <FbsTailMergePreviewModal
          state={fbsTailMergePreview}
          isSubmitting={isMergingFbsTails}
          onConfirm={() => void confirmFbsRequestTailsMerge()}
          onClose={() => {
            if (!isMergingFbsTails) {
              setFbsTailMergePreview(null);
            }
          }}
        />
      ) : null}

      {fbsSupplyConsistency ? (
        <FbsSupplyConsistencyModal
          state={fbsSupplyConsistency}
          onRepair={() => void repairFbsSupplyConsistency()}
          onClose={() => {
            if (fbsSupplyConsistency.status !== 'repairing') {
              setFbsSupplyConsistency(null);
            }
          }}
        />
      ) : null}

      {documentPreview ? (
        <ClientRequestDocumentPreview document={documentPreview} onClose={() => setDocumentPreview(null)} />
      ) : null}

      {editingRequest ? (
        <ClientRequestEditModal
          request={editingRequest}
          session={session}
          canBypassAvailability={canEditAnyRequest}
          onClose={() => setEditingRequest(null)}
          onSaved={acceptUpdated}
        />
      ) : null}

      {pickInstructionPreview ? (
        <HtmlDocumentPreview
          title={pickInstructionPreview.title}
          fileName={pickInstructionPreview.fileName}
          html={pickInstructionPreview.html}
          onClose={() => setPickInstructionPreview(null)}
        />
      ) : null}

      {onlinePreview ? (
        <OnlineExecutionModal
          request={onlinePreview.request}
          plan={onlinePreview.plan}
          status={onlinePreview.status}
          error={onlinePreview.error}
          movingOrderId={onlineFbsMove.orderId}
          moveMessage={onlineFbsMove.message}
          moveError={onlineFbsMove.error}
          resolvingKizId={onlineKizResolution.assemblyId}
          kizResolutionMessage={onlineKizResolution.message}
          kizResolutionError={onlineKizResolution.error}
          resolvingSyncConflictId={onlineFbsSyncResolution.assemblyId}
          syncConflictResolutionMessage={onlineFbsSyncResolution.message}
          syncConflictResolutionError={onlineFbsSyncResolution.error}
          onResolveKiz={
            canWrite
              ? (assemblyId) =>
                  void resolveOnlineFbsKiz(onlinePreview.request, assemblyId)
              : undefined
          }
          onRestoreRescanKiz={
            canWrite
              ? (assemblyId) =>
                  void restoreOnlineFbsRescanFromWb(onlinePreview.request, assemblyId)
              : undefined
          }
          onResolveSyncConflict={
            canWrite
              ? (assemblyId, action) =>
                  void resolveOnlineFbsSyncConflict(
                    onlinePreview.request,
                    assemblyId,
                    action,
                  )
              : undefined
          }
          onResolveSyncConflicts={
            canWrite
              ? (assemblyIds, action) =>
                  void resolveOnlineFbsSyncConflicts(
                    onlinePreview.request,
                    assemblyIds,
                    action,
                  )
              : undefined
          }
          onResetFbsAssembly={
            canWrite
              ? (assemblyId, orderId) =>
                  void resetOnlineFbsAssemblyOrder(
                    onlinePreview.request,
                    assemblyId,
                    orderId,
                  )
              : undefined
          }
          onMarkPackedWithoutSource={
            canWrite
              ? (assemblyId, orderId) =>
                  void markOnlineFbsOrderPackedWithoutSource(
                    onlinePreview.request,
                    assemblyId,
                    orderId,
                  )
              : undefined
          }
          onMoveOrder={
            canWrite
              ? (order) => void moveOnlineFbsOrder(onlinePreview.request, order)
              : undefined
          }
          onMoveOrders={
            canWrite
              ? (orders) => void moveOnlineFbsOrders(onlinePreview.request, orders)
              : undefined
          }
          onRepairMoveOrders={
            canWrite
              ? (orders) => void repairOnlineFbsOrders(onlinePreview.request, orders)
              : undefined
          }
          onClose={() => {
            setOnlinePreview(null);
            setOnlineFbsMove({ orderId: null });
            setOnlineKizResolution({ assemblyId: null });
            setOnlineFbsSyncResolution({ assemblyId: null });
          }}
          onRefresh={() => void refreshOnlineExecution()}
          onDownloadBoxes={() => void downloadOnlineOutgoingBoxes(onlinePreview.request)}
          onDownloadContents={() => void downloadOnlineOutgoingContents(onlinePreview.request)}
          onDownloadMovements={() => void downloadOnlineMovements(onlinePreview.request)}
        />
      ) : null}

      {emergencyUpload ? (
        <EmergencyPackedXlsxModal
          state={emergencyUpload}
          onFileChange={(file) => setEmergencyUpload((current) => (current ? { ...current, file, error: undefined } : current))}
          onSubmit={() => void submitEmergencyPackedXlsx()}
          onClose={() => setEmergencyUpload(null)}
        />
      ) : null}

      {emergencyRollback ? (
        <ConfirmDialog
          title="Отменить аварийное закрытие?"
          message={`Заявка «${emergencyRollback.title}» вернется в состояние до загрузки аварийного файла.`}
          details={[
            'Списанные остатки и КИЗ будут восстановлены в исходных коробах.',
            'Аварийные упаковочные места, файл и автоматически созданные финансовые черновики будут удалены.',
            'Если счет уже выставлен или оплачен, WMS остановит откат без изменения склада.',
          ]}
          confirmLabel="Отменить закрытие"
          isBusy={isRollingBackEmergency}
          onCancel={() => setEmergencyRollback(null)}
          onConfirm={() => void rollbackEmergencyClose()}
        />
      ) : null}

      {manualInstructionUpload ? (
        <ManualInstructionUploadModal
          state={manualInstructionUpload}
          onFileChange={(file) =>
            setManualInstructionUpload((current) => (current ? { ...current, file, error: undefined, status: 'idle' } : current))
          }
          onSubmit={() => void submitManualInstruction()}
          onClose={() => setManualInstructionUpload(null)}
        />
      ) : null}

      {manualClose ? (
        <ManualCloseModal
          state={manualClose}
          onChange={(patch) => setManualClose((current) => (current ? { ...current, ...patch, error: undefined } : current))}
          onSubmit={(allowOverweightPackages) => void submitManualClose(allowOverweightPackages)}
          onSubmitAllUnknownWithoutBox={() => void submitManualClose(true, true)}
          onResolveStock={() => void openCloseStockRecovery()}
          onClose={() => setManualClose(null)}
        />
      ) : null}

      {closeStockRecovery ? (
        <CloseStockRecoveryModal
          state={closeStockRecovery}
          onBoxQuantityChange={(requestItemId, boxCode, quantity) =>
            changeCloseStockSource(requestItemId, (value) => ({
              ...value,
              boxQuantities: { ...value.boxQuantities, [boxCode]: quantity },
              noBoxQuantity: '',
            }))
          }
          onUseSuggestedBox={(requestItemId, boxCode, quantity) =>
            changeCloseStockSource(requestItemId, (value) => ({
              ...value,
              boxQuantities: {
                ...Object.fromEntries(
                  Object.keys(value.boxQuantities).map((knownBoxCode) => [knownBoxCode, '']),
                ),
                [boxCode]: String(quantity),
              },
              noBoxQuantity: '',
              manualBoxCode: '',
              manualBoxQuantity: '',
            }))
          }
          onManualBoxChange={(requestItemId, patch) =>
            changeCloseStockSource(requestItemId, (value) => ({
              ...value,
              ...patch,
              noBoxQuantity: '',
            }))
          }
          onNoBoxQuantityChange={(requestItemId, quantity) =>
            changeCloseStockSource(requestItemId, (value) => ({
              ...value,
              noBoxQuantity: quantity,
            }))
          }
          onChooseNoBox={chooseCloseStockWithoutBox}
          onSubmit={() => void submitCloseStockRecovery()}
          onSubmitAllUnknownWithoutBox={() =>
            void submitCloseStockRecovery({ allUnknownWithoutBox: true })
          }
          onClose={() => setCloseStockRecovery(null)}
        />
      ) : null}

      {manualBoxSelection ? (
        <ManualBoxSelectionModal
          state={manualBoxSelection}
          onQuantityChange={changeManualBoxQuantity}
          onSave={() => void saveManualBoxSelection(false)}
          onClear={() => void saveManualBoxSelection(true)}
          onClose={() => setManualBoxSelection(null)}
        />
      ) : null}

      {fbsBoxSearch ? (
        <FbsBoxSearchModal
          state={fbsBoxSearch}
          onDownload={async () => {
            const blob = await downloadClientRequestFbsBoxSearchXlsx(session.accessToken, fbsBoxSearch.request.id);
            downloadBlob(
              blob,
              `${fbsBoxSearch.data?.stockMode === 'WITHOUT_BOXES' ? 'Остатки_склада_FBS' : 'Совпадающие_короба_FBS'}_${String(fbsBoxSearch.request.number).padStart(6, '0')}.xlsx`,
            );
          }}
          onClose={() => setFbsBoxSearch(null)}
        />
      ) : null}
    </section>
  );
}

function isFbsRequest(request: ClientRequestSummary) {
  return (
    (request._count?.fbsOrderLinks ?? 0) > 0 ||
    request.title.trim().toLocaleUpperCase('ru-RU').startsWith('FBS') ||
    request.comment
      ?.toLocaleLowerCase('ru-RU')
      .includes('создано из fbs-заказов:') === true
  );
}

function canMergeFbsRequestTail(request: ClientRequestSummary) {
  return (
    request.type === 'OUTBOUND' &&
    isFbsRequest(request) &&
    ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(request.status)
  );
}

function FbsTailMergePreviewModal({
  state,
  isSubmitting,
  onConfirm,
  onClose,
}: {
  state: FbsTailMergePreviewState;
  isSubmitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const sourceRequestNumbers = state.data.sourceRequests
    .map((request) => `№${String(request.number).padStart(6, '0')}`)
    .join(', ');

  return (
    <div
      className="online-execution-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Подтверждение переноса хвостов FBS"
    >
      <section className="online-execution-modal__panel fbs-tail-preview-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Предварительный состав новой заявки</span>
            <h3>Хвосты из заявок {sourceRequestNumbers}</h3>
            <small>
              До нажатия кнопки подтверждения заказы никуда не переносятся
            </small>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            title="Закрыть"
            aria-label="Закрыть"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="online-execution-modal__body fbs-tail-preview-modal__body">
          <div className="fbs-tail-preview-modal__summary">
            <span>
              <small>Заказов</small>
              <strong>{state.data.orderCount}</strong>
            </span>
            <span>
              <small>Единиц товара</small>
              <strong>{state.data.itemCount}</strong>
            </span>
            <span>
              <small>Разных SKU</small>
              <strong>{state.data.skuCount}</strong>
            </span>
            <span>
              <small>Исходных заявок</small>
              <strong>{state.data.sourceRequests.length}</strong>
            </span>
          </div>

          <div className="fbs-tail-preview-modal__notice">
            <ClipboardList size={18} aria-hidden="true" />
            <span>
              Ниже показан точный состав, который будет отправлен в новую
              поставку WB и записан в новую заявку WMS.
            </span>
          </div>

          <div className="fbs-tail-preview-modal__table-wrap">
            <table className="fbs-tail-preview-modal__table">
              <thead>
                <tr>
                  <th>Из заявки</th>
                  <th>Заказ WB</th>
                  <th>Товар</th>
                  <th>Размер</th>
                  <th>Количество</th>
                  <th>Где лежит</th>
                </tr>
              </thead>
              <tbody>
                {state.data.orders.map((order) => (
                  <tr key={`${order.connectionId}-${order.id}`}>
                    <td>
                      {order.sourceRequest
                        ? `№${String(order.sourceRequest.number).padStart(6, '0')}`
                        : '—'}
                    </td>
                    <td>
                      <strong>№{order.id}</strong>
                      <small>Поставка {order.sourceSupplyId}</small>
                    </td>
                    <td>
                      <strong>{order.product.name}</strong>
                      <small>
                        Арт. {order.product.article || order.article || '—'} ·
                        SKU {order.product.clientSku || order.product.internalSku}
                      </small>
                      <small>ШК {order.barcodes.join(', ') || '—'}</small>
                    </td>
                    <td>{order.product.size || '—'}</td>
                    <td>
                      <strong>{order.itemCount} шт.</strong>
                    </td>
                    <td>
                      {order.storageBoxes.length > 0
                        ? order.storageBoxes
                            .map((box) => `${box.code} (${box.quantity})`)
                            .join(', ')
                        : 'Короб не найден'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.data.skippedOrders.length > 0 ? (
            <details className="fbs-tail-preview-modal__skipped">
              <summary>
                Не будут перенесены: {state.data.skippedOrders.length}
              </summary>
              <ul>
                {state.data.skippedOrders.map((order, index) => (
                  <li key={`${order.id}-${index}`}>
                    <strong>№{order.id}</strong> — {order.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {state.error ? (
            <p className="form-error fbs-tail-preview-modal__error">
              {state.error}
            </p>
          ) : null}

          <div className="fbs-tail-preview-modal__actions">
            <button
              className="client-request-action-button"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Отмена
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting || state.data.orders.length === 0}
            >
              <ArrowRightLeft size={16} aria-hidden="true" />
              <span>
                {isSubmitting
                  ? 'Создаю новую заявку…'
                  : `Подтвердить перенос ${state.data.orderCount} заказов`}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FbsBoxSearchModal({
  state,
  onDownload,
  onClose,
}: {
  state: FbsBoxSearchState;
  onDownload: () => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading'>('idle');
  const [downloadError, setDownloadError] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const withoutBoxes = state.data?.stockMode === 'WITHOUT_BOXES';
  const boxes = (state.data?.boxes ?? []).filter((box) => {
    if (!normalizedSearch) return true;
    return [
      box.boxCode,
      ...box.orderIds,
      ...box.items.flatMap((item) => [item.productName, item.article ?? '', ...item.barcodes]),
    ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
  });
  const warehouseStock = (state.data?.warehouseStock ?? []).filter((item) => {
    if (!normalizedSearch) return true;
    return [
      ...item.orderIds,
      item.productName,
      item.article ?? '',
      ...item.barcodes,
    ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
  });

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Остатки для FBS-заявки">
      <section className="online-execution-modal__panel fbs-box-search-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>{withoutBoxes ? 'Остатки склада FBS' : 'Совпадающие короба FBS'}</span>
            <h3>№{String(state.request.number).padStart(6, '0')} · {state.request.title}</h3>
            <small>
              {state.request.client.name} · {withoutBoxes
                ? 'поштучный учет без привязки к коробам и палет-сортам'
                : 'показаны только короба, общие для нескольких заказов'}
            </small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="online-execution-modal__body fbs-box-search-modal__body">
          {state.status === 'loading' ? (
            <p className="panel-message">
              <RefreshCw size={18} aria-hidden="true" /> Проверяю остатки на складе.
            </p>
          ) : state.data ? (
            <>
              <div className="fbs-box-search-modal__summary">
                <span><small>Заказов в заявке</small><strong>{state.data.summary.orders}</strong></span>
                <span>
                  <small>{withoutBoxes ? 'Позиций на складе' : 'Совпадающих коробов'}</small>
                  <strong>{withoutBoxes ? state.data.warehouseStock.length : state.data.summary.boxes}</strong>
                </span>
                <span><small>Зарезервировано заказов</small><strong>{state.data.summary.confirmedOrders}</strong></span>
              </div>

              <label className="fbs-box-search-modal__search">
                <Search size={17} aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={withoutBoxes ? 'Номер заказа, ШК, артикул или товар' : 'Номер короба, заказа, ШК или товар'}
                  autoFocus
                />
                {search ? (
                  <button type="button" onClick={() => setSearch('')} title="Очистить поиск" aria-label="Очистить поиск">
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              {withoutBoxes && warehouseStock.length ? (
                <div className="fbs-box-search-results">
                  {warehouseStock.map((item) => (
                    <article className="fbs-box-search-card" key={item.requestItemId}>
                      <header>
                        <div>
                          <Boxes size={19} aria-hidden="true" />
                          <strong>{item.productName}</strong>
                        </div>
                        <span>{item.availableQuantity} шт. на складе</span>
                      </header>
                      <div className="fbs-box-search-card__orders">
                        <strong>
                          {item.orderIds.length
                            ? `Заказы №${item.orderIds.join(', №')}`
                            : 'Заказы по позиции не определены'}
                        </strong>
                        <span>Без коробов и палет-сортов</span>
                      </div>
                      <div className="fbs-box-search-card__items">
                        <div>
                          <span>
                            <strong>Арт. {item.article || '—'}</strong>
                            <small>ШК {item.barcodes.join(', ') || '—'} · нужно {item.requestedQuantity} шт.</small>
                          </span>
                          <span>
                            <strong>{item.freeQuantity} шт. свободно</strong>
                            <small>зарезервировано {item.reservedQuantity} шт.</small>
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : !withoutBoxes && boxes.length ? (
                <div className="fbs-box-search-results">
                  {boxes.map((box) => (
                    <article className={`fbs-box-search-card ${box.confirmedOrderIds.length ? 'is-confirmed' : ''}`} key={box.boxId}>
                      <header>
                        <div>
                          <Boxes size={19} aria-hidden="true" />
                          <strong>{box.boxCode}</strong>
                        </div>
                        <span>{box.items.reduce((sum, item) => sum + item.availableQuantity, 0)} шт. совпавшего товара</span>
                      </header>
                      <div className="fbs-box-search-card__orders">
                        <strong>Заказы №{box.orderIds.join(', №')}</strong>
                        {box.confirmedOrderIds.length ? (
                          <span className="is-confirmed">Точно подтверждено ТСД: №{box.confirmedOrderIds.join(', №')}</span>
                        ) : (
                          <span>В этом коробе совпали товары нескольких заказов</span>
                        )}
                      </div>
                      <div className="fbs-box-search-card__items">
                        {box.items.map((item) => (
                          <div key={`${box.boxId}-${item.requestItemId}`}>
                            <span>
                              <strong>{item.productName}</strong>
                              <small>Арт. {item.article || '—'} · ШК {item.barcodes.join(', ') || '—'}</small>
                            </span>
                            <span>
                              <strong>{item.availableQuantity} шт.</strong>
                              <small>{item.freeQuantity > 0 ? `свободно ${item.freeQuantity}` : 'зарезервировано'}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="panel-message">
                  {withoutBoxes
                    ? state.data.warehouseStock.length
                      ? 'По этому запросу товар не найден.'
                      : 'Поштучного остатка по товарам этой заявки на складе нет.'
                    : state.data.boxes.length
                      ? 'По этому запросу короб не найден.'
                      : 'Общих коробов для нескольких заказов этой заявки нет.'}
                </p>
              )}

              {state.data.unmatchedOrderIds.length ? (
                <p className="form-error fbs-box-search-modal__unmatched">
                  {withoutBoxes
                    ? `Нет доступного складского остатка для заказов №${state.data.unmatchedOrderIds.join(', №')}.`
                    : `Не найдены в активных коробах заказы №${state.data.unmatchedOrderIds.join(', №')}.`}
                </p>
              ) : null}
            </>
          ) : null}

          {state.error ? <p className="form-error">{state.error}</p> : null}
          {downloadError ? <p className="form-error">{downloadError}</p> : null}
          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose}>
              Закрыть
            </button>
            {state.data && (state.data.boxes.length > 0 || state.data.warehouseStock.length > 0) ? (
              <button
                className="client-request-action-button client-request-action-button--xlsx"
                type="button"
                disabled={downloadStatus === 'downloading'}
                onClick={async () => {
                  setDownloadStatus('downloading');
                  setDownloadError('');
                  try {
                    await onDownload();
                  } catch (caught) {
                    setDownloadError(errorMessage(caught));
                  } finally {
                    setDownloadStatus('idle');
                  }
                }}
              >
                <FileDown size={16} aria-hidden="true" />
                {downloadStatus === 'downloading' ? 'Формирую Excel' : 'Скачать Excel'}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ManualBoxSelectionModal({
  state,
  onQuantityChange,
  onSave,
  onClear,
  onClose,
}: {
  state: ManualBoxSelectionState;
  onQuantityChange: (requestItemId: string, boxId: string, value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const isBusy = state.status === 'loading' || state.status === 'saving';
  const isComplete = Boolean(
    state.data?.items.length &&
      state.data.items.every((item) => item.selectedQuantity === item.requestedQuantity),
  );

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Выбор коробов для заявки">
      <section className="online-execution-modal__panel manual-box-selection-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Ручной выбор остатков</span>
            <h3>№{String(state.request.number).padStart(6, '0')} · {state.request.title}</h3>
            <small>{state.request.client.name} · списание только при статусе «Сдано»</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="online-execution-modal__body manual-box-selection-modal__body">
          {state.status === 'loading' ? (
            <p className="panel-message"><RefreshCw size={18} aria-hidden="true" /> Загружаю остатки по коробам.</p>
          ) : state.data ? (
            <>
              <div className="manual-box-selection-modal__notice">
                <Boxes size={21} aria-hidden="true" />
                <div>
                  <strong>Выберите точные короба и количество.</strong>
                  <span>Сохранение только фиксирует выбор. Фактическое списание произойдет после перевода заявки в «Сдано».</span>
                </div>
              </div>

              <div className={`manual-box-selection-modal__summary ${isComplete ? 'is-complete' : 'is-incomplete'}`}>
                <span>Выбрано по заявке</span>
                <strong>{state.data.summary.selectedQuantity} / {state.data.summary.requestedQuantity} шт.</strong>
              </div>

              <div className="manual-box-selection-items">
                {state.data.items.map((item) => {
                  const itemLabel = item.sku?.name ?? item.requestedName ?? 'Товар не сопоставлен';
                  const itemCode = item.sku?.article ?? item.sku?.internalSku ?? item.requestedBarcode ?? 'без артикула';
                  const remaining = Math.max(0, item.requestedQuantity - item.selectedQuantity);
                  const complete = item.selectedQuantity === item.requestedQuantity;
                  return (
                    <article className={`manual-box-selection-item ${complete ? 'is-complete' : 'is-incomplete'}`} key={item.requestItemId}>
                      <header>
                        <div>
                          <h4>{itemLabel}</h4>
                          <span>Артикул: {itemCode}</span>
                          <span>ШК: {item.sku?.barcodes.join(', ') || item.requestedBarcode || 'не указан'}</span>
                        </div>
                        <strong>{item.selectedQuantity} / {item.requestedQuantity} шт.</strong>
                      </header>

                      {item.boxes.length ? (
                        <div className="manual-box-selection-boxes">
                          {item.boxes.map((box) => {
                            const checked = box.selectedQuantity > 0;
                            const suggestedQuantity = Math.min(box.availableQuantity, remaining || box.availableQuantity);
                            return (
                              <label className={`manual-box-selection-box ${checked ? 'is-selected' : ''}`} key={box.boxId}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isBusy || !state.data?.editable}
                                  onChange={(event) =>
                                    onQuantityChange(
                                      item.requestItemId,
                                      box.boxId,
                                      event.target.checked ? String(suggestedQuantity) : '0',
                                    )
                                  }
                                />
                                <div>
                                  <strong>{box.boxCode}</strong>
                                  <span>
                                    Доступно {box.availableQuantity} шт. ·{' '}
                                    {box.statuses.map((row) => `${stockStatusLabel(row.status)} ${row.quantity}`).join(', ') || 'остаток изменился'}
                                  </span>
                                </div>
                                <input
                                  className="manual-box-selection-box__quantity"
                                  type="number"
                                  min="0"
                                  max={box.availableQuantity}
                                  step="1"
                                  inputMode="numeric"
                                  value={box.selectedQuantity || ''}
                                  placeholder="0"
                                  disabled={isBusy || !state.data?.editable}
                                  aria-label={`Количество из короба ${box.boxCode}`}
                                  onChange={(event) => onQuantityChange(item.requestItemId, box.boxId, event.target.value)}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="manual-box-selection-item__empty">В активных коробах нет доступного остатка этой позиции.</p>
                      )}
                    </article>
                  );
                })}
              </div>

              {!state.data.editable ? (
                <p className="form-error">Для текущего статуса выбор доступен только для просмотра.</p>
              ) : null}
            </>
          ) : null}

          {state.error ? <p className="form-error manual-box-selection-modal__error">{state.error}</p> : null}

          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose} disabled={state.status === 'saving'}>
              Закрыть
            </button>
            {state.data?.editable && state.data.summary.selectedQuantity > 0 ? (
              <button className="client-request-action-button client-request-action-button--cancel" type="button" onClick={onClear} disabled={isBusy}>
                Очистить выбор
              </button>
            ) : null}
            {state.data?.editable ? (
              <button className="client-request-action-button client-request-action-button--box-selection" type="button" onClick={onSave} disabled={isBusy || !isComplete}>
                <Boxes size={16} aria-hidden="true" />
                {state.status === 'saving' ? 'Сохраняю' : 'Сохранить короба'}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function stockStatusLabel(status: string) {
  if (status === 'AVAILABLE') return 'доступно';
  if (status === 'PACKING') return 'в сборке';
  if (status === 'SHIPPING') return 'к отгрузке';
  return status;
}

function ManualCloseModal({
  state,
  onChange,
  onSubmit,
  onSubmitAllUnknownWithoutBox,
  onResolveStock,
  onClose,
}: {
  state: ManualCloseState;
  onChange: (patch: Partial<Pick<ManualCloseState, 'boxes' | 'pallets' | 'packedUnits' | 'comment'>>) => void;
  onSubmit: (allowOverweightPackages?: boolean) => void;
  onSubmitAllUnknownWithoutBox: () => void;
  onResolveStock: () => void;
  onClose: () => void;
}) {
  const isSubmitting = state.status === 'submitting';
  const requestedUnits = state.request.items.reduce((total, item) => total + item.quantity, 0);

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Ручное закрытие отгрузки">
      <section className="online-execution-modal__panel manual-close-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Ручное закрытие отгрузки</span>
            <h3>{state.request.title}</h3>
            <small>{state.request.client.name} · {state.request.destinationCity || 'город не указан'}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="online-execution-modal__body">
          <div className="manual-close-modal__notice">
            <Boxes size={20} aria-hidden="true" />
            <div>
              <strong>{state.usesRecordedPackages ? 'Упаковочные места уже зафиксированы.' : 'Укажите фактический результат упаковки.'}</strong>
              <span>
                {state.usesRecordedPackages
                  ? 'Проверьте сводку и подтвердите сдачу. Данные ТСД и состав коробов будут сохранены.'
                  : 'После подтверждения WMS спишет товар, создаст упаковочные места и сформирует черновики счетов.'}
              </span>
            </div>
          </div>

          <div className="manual-close-modal__summary">
            <span>По заявке</span>
            <strong>{requestedUnits} шт.</strong>
          </div>

          <div className="manual-close-modal__fields">
            <label className="form-field">
              <span>Фактически коробов</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={state.boxes}
                disabled={isSubmitting || state.usesRecordedPackages}
                onChange={(event) => onChange({ boxes: event.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Фактически паллет</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={state.pallets}
                disabled={isSubmitting || state.usesRecordedPackages}
                onChange={(event) => onChange({ pallets: event.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Упаковано, шт.</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={state.packedUnits}
                disabled={isSubmitting || state.usesRecordedPackages}
                onChange={(event) => onChange({ packedUnits: event.target.value })}
              />
            </label>
          </div>

          <label className="form-field">
            <span>Комментарий</span>
            <textarea
              rows={3}
              value={state.comment}
              disabled={isSubmitting}
              onChange={(event) => onChange({ comment: event.target.value })}
            />
          </label>

          {state.error ? <p className="form-error manual-close-modal__error">{state.error}</p> : null}

          {state.error && isOverweightPackageError(state.error) ? (
            <div className="manual-close-modal__overweight-action">
              <div>
                <strong>Вес подтвержден фактически?</strong>
                <span>
                  Если товар уже упакован и короб действительно нужно сдать целиком, подтвердите закрытие с перевесом.
                  Остатки и количество товара повторно увеличены не будут.
                </span>
              </div>
              <button
                className="client-request-action-button client-request-action-button--ship"
                type="button"
                onClick={() => onSubmit(true)}
                disabled={isSubmitting}
              >
                <AlertTriangle size={16} aria-hidden="true" />
                Закрыть, несмотря на вес
              </button>
            </div>
          ) : null}

          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose} disabled={isSubmitting}>
              Отмена
            </button>
            <button
              className="client-request-action-button client-request-action-button--box-selection"
              type="button"
              onClick={onSubmitAllUnknownWithoutBox}
              disabled={isSubmitting}
            >
              {/* ADDED: доступно сразу, без обязательной первой неудачной попытки закрытия. */}
              <PackageX size={16} aria-hidden="true" />
              Закрыть все проблемные без короба
            </button>
            {state.error && !isOverweightPackageError(state.error) ? (
              <button
                className="client-request-action-button client-request-action-button--box-selection"
                type="button"
                onClick={onResolveStock}
                disabled={isSubmitting}
              >
                <ShieldAlert size={16} aria-hidden="true" />
                Указать фактический короб / без короба
              </button>
            ) : null}
            <button className="client-request-action-button client-request-action-button--ship" type="button" onClick={() => onSubmit()} disabled={isSubmitting || Boolean(state.error && isOverweightPackageError(state.error))}>
              <Truck size={16} aria-hidden="true" />
              {isSubmitting ? 'Закрываю отгрузку' : 'Подтвердить и сдать'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CloseStockRecoveryModal({
  state,
  onBoxQuantityChange,
  onUseSuggestedBox,
  onManualBoxChange,
  onNoBoxQuantityChange,
  onChooseNoBox,
  onSubmit,
  onSubmitAllUnknownWithoutBox,
  onClose,
}: {
  state: CloseStockRecoveryState;
  onBoxQuantityChange: (requestItemId: string, boxCode: string, quantity: string) => void;
  onUseSuggestedBox: (
    requestItemId: string,
    boxCode: string,
    quantity: number,
  ) => void;
  onManualBoxChange: (
    requestItemId: string,
    patch: Partial<Pick<CloseStockSourceValue, 'manualBoxCode' | 'manualBoxQuantity'>>,
  ) => void;
  onNoBoxQuantityChange: (requestItemId: string, quantity: string) => void;
  onChooseNoBox: (requestItemId: string, requestedQuantity: number) => void;
  onSubmit: () => void;
  onSubmitAllUnknownWithoutBox: () => void;
  onClose: () => void;
}) {
  const isBusy = state.status === 'loading' || state.status === 'submitting';
  const normalizedError = state.originalError.toLocaleLowerCase('ru-RU');
  // FIX: кнопка активна и для сохранённого короба, в котором уже не хватает товара.
  const unknownSourceItemsCount =
    state.data?.items.filter(isProblemCloseStockSourceItem).length ?? 0;

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Фактический источник товара">
      <section className="online-execution-modal__panel manual-box-selection-modal close-stock-recovery-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Закрытие по физическому факту</span>
            <h3>№{String(state.close.request.number).padStart(6, '0')} · {state.close.request.title}</h3>
            <small>Укажите источник только для позиции, из-за которой заявка не закрывается</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть" disabled={isBusy}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="online-execution-modal__body manual-box-selection-modal__body">
          <div className="close-stock-recovery-modal__warning">
            <ShieldAlert size={22} aria-hidden="true" />
            <div>
              <strong>Штатное закрытие остановлено</strong>
              <span>{state.originalError}</span>
            </div>
          </div>

          {state.status === 'loading' ? (
            <p className="panel-message"><RefreshCw size={18} aria-hidden="true" /> Загружаю товары и короба заявки.</p>
          ) : state.data ? (
            <div className="close-stock-recovery-items">
              {state.data.items.map((item) => {
                const value = state.values[item.requestItemId];
                if (!value) return null;
                const itemLabel = item.sku?.name ?? item.requestedName ?? 'Товар не сопоставлен';
                const itemCode = item.sku?.article ?? item.sku?.internalSku ?? item.requestedBarcode ?? 'без артикула';
                const touched = state.touchedItemIds.includes(item.requestItemId);
                const matchesError = [
                  item.sku?.internalSku,
                  item.sku?.article,
                  item.sku?.name,
                  item.requestedBarcode,
                  item.requestedName,
                ].some((candidate) =>
                  candidate
                    ? normalizedError.includes(candidate.toLocaleLowerCase('ru-RU'))
                    : false,
                );
                const confirmedQuantity =
                  Object.values(value.boxQuantities).reduce(
                    (sum, quantity) => sum + (parseNonNegativeInteger(quantity || '0') ?? 0),
                    0,
                  ) +
                  (parseNonNegativeInteger(value.manualBoxQuantity || '0') ?? 0) +
                  (parseNonNegativeInteger(value.noBoxQuantity || '0') ?? 0);
                const availableBoxes = item.boxes.filter((box) => box.availableQuantity > 0);
                const unavailableSelectedBoxes = item.boxes.filter(
                  (box) => box.availableQuantity === 0 && box.selectedQuantity > 0,
                );
                const incompleteFbsOrders = item.fbsOrders.filter(
                  (order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending,
                );
                const isProblem = matchesError || incompleteFbsOrders.length > 0;
                return (
                  <details
                    className={`close-stock-recovery-item ${touched ? 'is-touched' : ''} ${isProblem ? 'is-problem' : ''}`}
                    key={item.requestItemId}
                    open={touched || isProblem}
                  >
                    <summary>
                      <div>
                        <strong>{itemLabel}</strong>
                        <span>Артикул: {itemCode} · ШК: {item.sku?.barcodes.join(', ') || item.requestedBarcode || 'не указан'}</span>
                        {item.itemComment ? <span>{item.itemComment}</span> : null}
                      </div>
                      <b>{confirmedQuantity} / {item.requestedQuantity} шт.</b>
                    </summary>

                    <div className="close-stock-recovery-item__body">
                      {incompleteFbsOrders.length > 0 ? (
                        <div className="close-stock-recovery-fbs-warning">
                          <ShieldAlert size={18} aria-hidden="true" />
                          <div>
                            <strong>Нужно подтвердить источник товара FBS</strong>
                            <span>
                              {incompleteFbsOrders.map((order) => (
                                `№${order.orderId} — ${order.sourceBoxPending ? 'исходный короб не указан' : fbsAssemblyStatusLabel(order.assemblyStatus)}`
                              )).join('; ')}.
                              Подтвердите, откуда фактически взят товар.
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <p>
                        Укажите, где физически находились все {item.requestedQuantity} шт. этой позиции.
                        Данные WMS рядом приведены только для сверки и не ограничивают подтверждение менеджера.
                      </p>

                      <div className="close-stock-recovery-available-heading">
                        <div>
                          <strong>Где товар есть в наличии</strong>
                          <span>
                            WMS нашла коробов: {availableBoxes.length}. Сначала показаны короба с наибольшим остатком.
                          </span>
                        </div>
                        <b>{availableBoxes.reduce((sum, box) => sum + box.availableQuantity, 0)} шт. всего</b>
                      </div>

                      {availableBoxes.length > 0 ? (
                        <div className="close-stock-recovery-boxes">
                          {availableBoxes.map((box) => (
                            <label key={box.boxId}>
                              <span>
                                <strong>{box.boxCode}</strong>
                                <small>
                                  Сейчас в WMS: {box.availableQuantity} шт. ·{' '}
                                  {box.statuses.map((row) => `${stockStatusLabel(row.status)} ${row.quantity}`).join(', ') || 'остаток не найден'}
                                </small>
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={value.boxQuantities[box.boxCode] ?? ''}
                                placeholder="0"
                                disabled={isBusy}
                                aria-label={`Фактически взято из короба ${box.boxCode}`}
                                onChange={(event) =>
                                  onBoxQuantityChange(item.requestItemId, box.boxCode, event.target.value)
                                }
                              />
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  onUseSuggestedBox(
                                    item.requestItemId,
                                    box.boxCode,
                                    Math.min(item.requestedQuantity, box.availableQuantity),
                                  )
                                }
                              >
                                {box.availableQuantity >= item.requestedQuantity
                                  ? 'Взять всё отсюда'
                                  : `Начать с ${box.availableQuantity} шт.`}
                              </button>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="manual-box-selection-item__empty">WMS не нашла активных коробов с этим товаром.</p>
                      )}

                      {unavailableSelectedBoxes.length > 0 ? (
                        <div className="close-stock-recovery-stale-boxes">
                          <strong>Ранее выбранные короба, где сейчас нет остатка</strong>
                          {unavailableSelectedBoxes.map((box) => (
                            <label key={box.boxId}>
                              <span>{box.boxCode}</span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={value.boxQuantities[box.boxCode] ?? ''}
                                placeholder="0"
                                disabled={isBusy}
                                onChange={(event) =>
                                  onBoxQuantityChange(item.requestItemId, box.boxCode, event.target.value)
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}

                      <div className="close-stock-recovery-manual-box">
                        <label className="form-field">
                          <span>Другой фактический короб</span>
                          <input
                            type="text"
                            value={value.manualBoxCode}
                            placeholder="Отсканируйте или введите номер короба"
                            disabled={isBusy}
                            onChange={(event) =>
                              onManualBoxChange(item.requestItemId, { manualBoxCode: event.target.value })
                            }
                          />
                        </label>
                        <label className="form-field close-stock-recovery-manual-box__quantity">
                          <span>Взято, шт.</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={value.manualBoxQuantity}
                            placeholder="0"
                            disabled={isBusy}
                            onChange={(event) =>
                              onManualBoxChange(item.requestItemId, { manualBoxQuantity: event.target.value })
                            }
                          />
                        </label>
                      </div>

                      <div className={`close-stock-recovery-no-box ${value.noBoxQuantity ? 'is-selected' : ''}`}>
                        <div>
                          <strong>Товар физически был без короба</strong>
                          <span>Выберите этот вариант, если номера короба действительно нет.</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={value.noBoxQuantity}
                          placeholder="0"
                          disabled={isBusy}
                          aria-label="Количество товара без короба"
                          onChange={(event) =>
                            onNoBoxQuantityChange(item.requestItemId, event.target.value)
                          }
                        />
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onChooseNoBox(item.requestItemId, item.requestedQuantity)}
                        >
                          Весь товар без короба
                        </button>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : null}

          {state.error ? <p className="form-error manual-box-selection-modal__error">{state.error}</p> : null}

          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose} disabled={isBusy}>
              Назад
            </button>
            <button
              className="client-request-action-button client-request-action-button--instruction"
              type="button"
              onClick={onSubmitAllUnknownWithoutBox}
              disabled={isBusy || !state.data || unknownSourceItemsCount === 0}
            >
              {/* ADDED: известные короба остаются неизменными. */}
              <PackageX size={16} aria-hidden="true" />
              Все неизвестные — без коробов и сдать
            </button>
            <button
              className="client-request-action-button client-request-action-button--ship"
              type="button"
              onClick={onSubmit}
              disabled={isBusy || !state.data}
            >
              <Truck size={16} aria-hidden="true" />
              {state.status === 'submitting' ? 'Закрываю заявку' : 'Подтвердить источник и сдать'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BoxOverlapStatistics({
  state,
}: {
  state: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ClientRequestBoxOverlapStatistics | null;
    error?: string;
  };
}) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading' && !state.data) {
    return <section className="box-overlap-panel is-loading">Проверяю пересечения коробов в активных заявках...</section>;
  }
  if (state.status === 'error' && !state.data) {
    return <section className="box-overlap-panel is-error">Не удалось проверить пересечения: {state.error}</section>;
  }
  const statistics = state.data;
  if (!statistics) return null;
  const hasOverlaps = statistics.overlappingBoxesCount > 0;

  return (
    <details className={`box-overlap-panel ${hasOverlaps ? 'has-conflicts' : 'is-clear'}`}>
      <summary>
        <span className="box-overlap-panel__icon">
          {hasOverlaps ? <ShieldAlert size={20} aria-hidden="true" /> : <Boxes size={20} aria-hidden="true" />}
        </span>
        <span>
          <strong>{hasOverlaps ? 'Обнаружены пересечения коробов' : 'Пересечений коробов нет'}</strong>
          <small>
            Проверено заявок: {statistics.checkedRequestsCount} из {statistics.activeRequestsCount}. Общих коробов:{' '}
            {statistics.overlappingBoxesCount}.
          </small>
        </span>
        <span className="box-overlap-panel__count">{statistics.overlappingBoxesCount}</span>
      </summary>

      <div className="box-overlap-panel__body">
        <div className="box-overlap-metrics">
          <article><span>Активные заявки</span><strong>{statistics.activeRequestsCount}</strong></article>
          <article><span>Заявки с конфликтом</span><strong>{statistics.requestsWithOverlapsCount}</strong></article>
          <article><span>Пересекающиеся короба</span><strong>{statistics.overlappingBoxesCount}</strong></article>
          <article><span>Ошибки проверки</span><strong>{statistics.errors.length}</strong></article>
        </div>

        {statistics.overlaps.length > 0 ? (
          <div className="box-overlap-list">
            {statistics.overlaps.map((overlap) => (
              <article className="box-overlap-card" key={`${overlap.clientId}-${overlap.boxCode}`}>
                <header>
                  <div><span>Короб</span><strong>{overlap.boxCode}</strong></div>
                  <div><span>Клиент</span><strong>{overlap.client.name}</strong></div>
                  <b>{overlap.requests.length} заявки</b>
                </header>
                <div className="box-overlap-card__requests">
                  {overlap.requests.map((request) => (
                    <div key={request.id}>
                      <strong>
                        №{String(request.number).padStart(6, '0')} · {request.title}
                      </strong>
                      <span>{requestStatusLabel(request.status)}</span>
                      <small>{request.destinationCity || 'Город не указан'}</small>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="box-overlap-panel__empty">Каждый складской короб сейчас закреплен только за одной активной заявкой.</p>
        )}

        {statistics.errors.length > 0 ? (
          <div className="box-overlap-errors">
            <strong>Не удалось проверить отдельные заявки</strong>
            {statistics.errors.map((error) => <span key={error.requestId}>{error.title}: {error.message}</span>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ManualInstructionUploadModal({
  state,
  onFileChange,
  onSubmit,
  onClose,
}: {
  state: {
    request: ClientRequestSummary;
    file: File | null;
    status: 'idle' | 'submitting' | 'done';
    error?: string;
    result?: PickInstructionDocument;
  };
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const isSubmitting = state.status === 'submitting';
  const movements = state.result?.warehouseBalanceMoves?.length ?? 0;
  const relabels = state.result?.warehouseMarkRows?.reduce((sum, row) => sum + row.quantity, 0) ?? 0;

  return (
    <div
      className="online-execution-modal manual-instruction-modal-shell"
      role="dialog"
      aria-modal="true"
      aria-label="Загрузка своей складской инструкции"
    >
      <section className="online-execution-modal__panel manual-instruction-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Своя складская инструкция</span>
            <h3>{state.request.title}</h3>
            <small>{state.request.client.name}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="online-execution-modal__body">
          <div className="manual-instruction-modal__warning">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <strong>После подтверждения план заявки будет перестроен сразу.</strong>
              <span>
                Система проверит листы «Инструкция», «Целые короба» и «МАРК», затем заменит поиск коробов,
                переклейку и перемещения в ТСД. Уже выполненные совместимые действия сохранятся.
              </span>
            </div>
          </div>
          <label className="form-field">
            <span>Инструкция XLSX</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={isSubmitting || state.status === 'done'}
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          {state.file ? <p className="manual-instruction-modal__file">Выбран файл: {state.file.name}</p> : null}
          {state.error ? <p className="form-error manual-instruction-modal__error">{state.error}</p> : null}
          {state.result ? (
            <div className="manual-instruction-modal__result">
              <strong>Инструкция загружена, план перестроен.</strong>
              <span>Коробов в поиске: {state.result.boxesCount}</span>
              <span>К отправке: {state.result.totalAllocated} шт.</span>
              <span>Перемещений: {movements} строк</span>
              <span>Переклейка: {relabels} шт.</span>
              <span>Дефицит: {state.result.totalShortage} шт.</span>
            </div>
          ) : null}
          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose}>
              {state.status === 'done' ? 'Закрыть' : 'Отмена'}
            </button>
            <button
              className="client-request-action-button client-request-action-button--manual-instruction"
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting || state.status === 'done' || !state.file}
            >
              <FileUp size={16} aria-hidden="true" />
              {isSubmitting ? 'Проверяю и перестраиваю' : state.status === 'done' ? 'План перестроен' : 'Загрузить и перестроить'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmergencyPackedXlsxModal({
  state,
  onFileChange,
  onSubmit,
  onClose,
}: {
  state: {
    request: ClientRequestSummary;
    file: File | null;
    status: 'idle' | 'submitting' | 'done';
    error?: string;
    result?: EmergencyPackedXlsxResult;
  };
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const isSubmitting = state.status === 'submitting';

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Аварийная упаковка заявки">
      <section className="online-execution-modal__panel emergency-xlsx-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Аварийная упаковка по Excel</span>
            <h3>{state.request.title}</h3>
            <small>{state.request.client.name}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="online-execution-modal__body">
          <div className="emergency-xlsx-modal__warning">
            <strong>Загрузите Excel со списком фактических коробов.</strong>
            <span>В первом столбце укажите по одному номеру FFL на строку. WMS сверит фактическое содержимое коробов с заявкой, спишет его и переведет заявку в статус «Упакована».</span>
          </div>
          <label className="form-field">
            <span>Excel-файл</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={isSubmitting || state.status === 'done'}
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          {state.file ? <p className="emergency-xlsx-modal__file">Выбран файл: {state.file.name}</p> : null}
          {state.error ? <p className="form-error">{state.error}</p> : null}
          {state.result ? (
            <>
              <p className="inline-status">
                Упаковано: коробов {state.result.boxes}, единиц {state.result.packedUnits}, паллет {state.result.pallets}. Файлы WB готовы.
              </p>
              {state.result.warnings.length > 0 ? (
                <div className="emergency-xlsx-modal__warning emergency-xlsx-modal__warning--result">
                  <strong>Упаковано с расхождениями</strong>
                  <span>
                    Не сопоставлено (включая возможную перемаркировку): {state.result.shortageQuantity} шт. Излишек по фактическим коробам: {state.result.excessQuantity} шт.
                  </span>
                  <ul>
                    {state.result.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${warning.boxCode ?? warning.skuId ?? index}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="emergency-xlsx-modal__actions">
            <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose}>
              Отмена
            </button>
            <button
              className="client-request-action-button client-request-action-button--emergency"
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting || state.status === 'done' || !state.file}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? 'Списываю короба и упаковываю'
                : state.status === 'done'
                  ? 'Заявка упакована'
                  : 'Упаковать по списку коробов'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

type OnlineExecutionModalProps = {
  request: ClientRequestSummary;
  plan: TsdAssemblyPlan | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  movingOrderId: string | null;
  moveMessage?: string;
  moveError?: string;
  resolvingKizId: string | null;
  kizResolutionMessage?: string;
  kizResolutionError?: string;
  resolvingSyncConflictId: string | null;
  syncConflictResolutionMessage?: string;
  syncConflictResolutionError?: string;
  onResolveKiz?: (assemblyId: string) => void;
  onRestoreRescanKiz?: (assemblyId: string) => void;
  onResolveSyncConflict?: (
    assemblyId: string,
    action: FbsSyncConflictResolutionAction,
  ) => void;
  onResolveSyncConflicts?: (
    assemblyIds: string[],
    action: FbsSyncConflictResolutionAction,
  ) => void;
  onResetFbsAssembly?: (assemblyId: string, orderId: string) => void;
  onMarkPackedWithoutSource?: (assemblyId: string, orderId: string) => void;
  onMoveOrder?: (order: { id: string; connectionId: string }) => void;
  onMoveOrders?: (orders: Array<{ id: string; connectionId: string }>) => void;
  onRepairMoveOrders?: (orders: Array<{ id: string; connectionId: string }>) => void;
  onClose: () => void;
  onRefresh: () => void;
  onDownloadBoxes: () => void;
  onDownloadContents: () => void;
  onDownloadMovements: () => void;
};

function OnlineExecutionModal({
  request,
  plan,
  status,
  error,
  movingOrderId,
  moveMessage,
  moveError,
  resolvingKizId,
  kizResolutionMessage,
  kizResolutionError,
  resolvingSyncConflictId,
  syncConflictResolutionMessage,
  syncConflictResolutionError,
  onResolveKiz,
  onRestoreRescanKiz,
  onResolveSyncConflict,
  onResolveSyncConflicts,
  onResetFbsAssembly,
  onMarkPackedWithoutSource,
  onMoveOrder,
  onMoveOrders,
  onRepairMoveOrders,
  onClose,
  onRefresh,
  onDownloadBoxes,
  onDownloadContents,
  onDownloadMovements,
}: OnlineExecutionModalProps) {
  const [movementSearch, setMovementSearch] = useState('');
  const [actualMovementSearch, setActualMovementSearch] = useState('');
  const [fbsAssemblySearch, setFbsAssemblySearch] = useState('');
  const [notCollectedSearch, setNotCollectedSearch] = useState('');
  const [selectedNotCollectedOrders, setSelectedNotCollectedOrders] = useState<string[]>([]);
  const [selectedSyncConflictIds, setSelectedSyncConflictIds] = useState<string[]>([]);
  const [wmsBoxesOpen, setWmsBoxesOpen] = useState(false);
  const wmsBoxesRef = useRef<HTMLDetailsElement>(null);
  const searchBoxes = normalizeOnlineBoxes(plan?.searchBoxes ?? plan?.boxesToSearch ?? []);
  const palletSortByBoxCode = new Map(
    searchBoxes
      .filter((box) => box.storageLocation?.palletCode)
      .map((box) => [
        normalizeCode(box.boxCode),
        box.storageLocation!.palletCode,
      ]),
  );
  const foundCodes = new Set(
    [...(plan?.boxSearchProgress?.foundBoxCodes ?? []), ...(plan?.foundBoxCodes ?? []), ...(plan?.foundBoxesCodes ?? [])].map(normalizeCode),
  );
  const searchTotal = plan?.boxSearchProgress?.total ?? searchBoxes.length;
  const foundCount =
    plan?.boxSearchProgress?.found ??
    searchBoxes.filter((box) => box.found || box.isFound || foundCodes.has(normalizeCode(box.boxCode))).length;
  const remainingCount = Math.max(0, searchTotal - foundCount);
  const relabelTotal = plan?.relabelTotal ?? plan?.relabelTasks?.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  const movementTotal = plan?.movementProgress?.totalRequired ?? plan?.movementRequiredTotal ?? plan?.movementTotal ?? 0;
  const movementDone = plan?.movementProgress?.totalMoved ?? 0;
  const movementRemaining = plan?.movementProgress?.totalRemaining ?? Math.max(0, movementTotal - movementDone);
  const isClosedForOnline = plan ? ['PACKED', 'DONE'].includes(plan.status) : false;
  const progressPercent = Math.round(
    averageProgress([
      progressRatio(foundCount, searchTotal),
      relabelTotal > 0 ? (isClosedForOnline ? 1 : 0) : 1,
      progressRatio(movementDone, movementTotal),
    ]) * 100,
  );
  const movementRows = plan?.movementProgress?.rows ?? [];
  const movementSourceBoxes = plan?.movementProgress?.sourceBoxes ?? [];
  const actualMovements = plan?.movementProgress?.actualRows ?? [];
  const fbsAssembly = plan?.fbsAssembly ?? null;
  const wmsBoxes = fbsAssembly?.wmsBoxes ?? null;
  const notCollected = fbsAssembly?.notCollected ?? null;
  const returnRequired = fbsAssembly?.returnRequired ?? null;
  const returnRequiredIds = (returnRequired?.rows ?? []).map((row) => row.id);
  const allSyncConflictsSelected =
    returnRequiredIds.length > 0 &&
    returnRequiredIds.every((id) => selectedSyncConflictIds.includes(id));
  const rescanRequiredRows = (fbsAssembly?.rows ?? []).filter(
    (row) => row.status === 'RESCAN_REQUIRED',
  );
  const normalizedFbsAssemblySearch = fbsAssemblySearch.trim().toLocaleLowerCase('ru-RU');
  const filteredFbsAssemblyRows = (fbsAssembly?.rows ?? []).filter((row) =>
    !normalizedFbsAssemblySearch ||
    [
      row.sourceBoxCode,
      row.orderId,
      row.productBarcode,
      row.kiz,
      row.size,
      row.wbStickerPartB,
      row.wbStickerBarcode,
      row.productName,
      row.article,
    ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(normalizedFbsAssemblySearch)),
  );
  const normalizedNotCollectedSearch = notCollectedSearch.trim().toLocaleLowerCase('ru-RU');
  const filteredNotCollectedRows = (notCollected?.rows ?? []).filter((row) =>
    !normalizedNotCollectedSearch ||
    [
      row.name,
      row.article,
      row.color,
      row.size,
      row.barcode,
      ...row.orderIds,
      ...row.availableBoxes.map((box) => box.boxCode),
    ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(normalizedNotCollectedSearch)),
  );
  const notCollectedOrders = [...new Map(
    (notCollected?.rows ?? [])
      .flatMap((row) => row.orders)
      .map((order) => [onlineFbsOrderKey(order), order]),
  ).values()];
  const notCollectedOrderKeys = notCollectedOrders.map(onlineFbsOrderKey);
  const selectedNotCollectedOrderRows = notCollectedOrders.filter((order) =>
    selectedNotCollectedOrders.includes(onlineFbsOrderKey(order)),
  );
  const allNotCollectedOrdersSelected =
    notCollectedOrderKeys.length > 0 &&
    notCollectedOrderKeys.every((key) => selectedNotCollectedOrders.includes(key));
  useEffect(() => {
    setSelectedNotCollectedOrders((current) =>
      current.filter((key) => notCollectedOrderKeys.includes(key)),
    );
  }, [notCollectedOrderKeys.join('|')]);
  useEffect(() => {
    setSelectedSyncConflictIds((current) =>
      current.filter((id) => returnRequiredIds.includes(id)),
    );
  }, [returnRequiredIds.join('|')]);
  const outgoingBoxes = normalizeOutgoingBoxes(plan);
  const filteredMovementRows = movementRows.filter((row) => movementRowMatchesSearch(row, movementSearch));
  const filteredActualMovements = actualMovements.filter((row) => movementRowMatchesSearch(row, actualMovementSearch));

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Онлайн-выполнение заявки">
      <section className="online-execution-modal__panel">
        <header className="online-execution-modal__header">
          <div>
            <span>Онлайн выполнение</span>
            <h3>{request.title}</h3>
            <small>
              {request.client.name} · {request.destinationCity ?? 'город не указан'}
            </small>
          </div>
          <div className="online-execution-modal__actions">
            <button
              className="client-request-action-button client-request-action-button--wms-boxes"
              type="button"
              onClick={() => {
                setWmsBoxesOpen(true);
                requestAnimationFrame(() => {
                  wmsBoxesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
              disabled={status === 'loading' || !fbsAssembly}
              title="Посмотреть фактически пропиканное содержимое коробов WMS"
            >
              <Boxes size={16} aria-hidden="true" />
              Короба WMS
              {wmsBoxes ? <strong>{wmsBoxes.packedUnits}</strong> : null}
            </button>
            <button
              className="client-request-action-button client-request-action-button--xlsx"
              type="button"
              onClick={onDownloadBoxes}
              disabled={status === 'loading' || !plan}
            >
              <FileDown size={16} aria-hidden="true" />
              Короба Excel
            </button>
            <button
              className="client-request-action-button client-request-action-button--xlsx"
              type="button"
              onClick={onDownloadContents}
              disabled={status === 'loading' || !plan}
            >
              <FileDown size={16} aria-hidden="true" />
              Состав Excel
            </button>
            <button className="icon-button" type="button" onClick={onRefresh} title="Обновить онлайн-данные" disabled={status === 'loading'}>
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={onClose} title="Закрыть">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {status === 'loading' ? <p className="inline-status">Получаю данные выполнения.</p> : null}
        {status === 'error' ? <p className="form-error">{error ?? 'Не удалось получить онлайн-выполнение.'}</p> : null}
        {moveMessage ? <p className="online-execution-action-message">{moveMessage}</p> : null}
        {moveError ? <p className="form-error online-execution-action-error">{moveError}</p> : null}
        {kizResolutionMessage ? <p className="online-execution-action-message">{kizResolutionMessage}</p> : null}
        {kizResolutionError ? <p className="form-error online-execution-action-error">{kizResolutionError}</p> : null}
        {syncConflictResolutionMessage ? <p className="online-execution-action-message">{syncConflictResolutionMessage}</p> : null}
        {syncConflictResolutionError ? <p className="form-error online-execution-action-error">{syncConflictResolutionError}</p> : null}

        {plan ? (
          <div className="online-execution-modal__body">
            <section className="online-execution-progress">
              <div>
                <strong>{progressPercent}%</strong>
                <span>
                  найдено коробов {foundCount} из {searchTotal} · осталось {remainingCount} · перемещено {movementDone} из {movementTotal}
                </span>
              </div>
              <meter min={0} max={100} value={progressPercent} />
            </section>

            <div className="online-execution-metrics">
              <article>
                <span>Статус WMS</span>
                <strong>{plan.statusLabel ?? plan.status}</strong>
              </article>
              <article>
                <span>Поиск коробов</span>
                <strong>
                  {foundCount} / {searchTotal}
                </strong>
              </article>
              <article>
                <span>Переклейка</span>
                <strong>{relabelTotal} шт.</strong>
              </article>
              <article>
                <span>Перемещения</span>
                <strong>
                  {movementDone} / {movementTotal}
                </strong>
              </article>
              <article>
                <span>На отправку</span>
                <strong>{outgoingBoxes.length}</strong>
              </article>
              {notCollected ? (
                <article className={notCollected.remainingUnits > 0 ? 'is-warning' : 'is-done'}>
                  <span>Не собрано</span>
                  <strong>{notCollected.remainingUnits} шт.</strong>
                </article>
              ) : null}
              {returnRequired && returnRequired.orders > 0 ? (
                <article className="is-danger">
                  <span>Требует решения</span>
                  <strong>{returnRequired.orders}</strong>
                </article>
              ) : null}
            </div>

            {fbsAssembly ? (
              <>
                <details
                  className="online-execution-section online-execution-section--wms-boxes"
                  open={wmsBoxesOpen}
                  onToggle={(event) => setWmsBoxesOpen(event.currentTarget.open)}
                  ref={wmsBoxesRef}
                >
                  <summary>
                    <span>
                      <Boxes size={18} aria-hidden="true" />
                      <strong>Короба WMS</strong>
                      <small>нажмите, чтобы посмотреть фактическую упаковку</small>
                    </span>
                    <b>
                      {wmsBoxes?.packedUnits ?? 0} пропикано · {wmsBoxes?.remainingUnits ?? fbsAssembly.totalOrders} ещё нет
                    </b>
                  </summary>
                  <div className="online-execution-wms-boxes">
                    {wmsBoxes && wmsBoxes.boxes.length > 0 ? (
                      <div className="online-execution-wms-box-list">
                        {wmsBoxes.boxes.map((box) => (
                          <details className="online-execution-wms-box" key={box.id}>
                            <summary>
                              <span>
                                <strong>{box.code}</strong>
                                <small>
                                  {box.status === 'CLOSED' ? 'закрыт' : 'открыт'} · {box.items.reduce((sum, item) => sum + item.quantity, 0)} ед.
                                </small>
                              </span>
                              <span>
                                {box.closedByName || box.openedByName || box.deviceCode || 'ТСД'}
                              </span>
                            </summary>
                            <div className="online-execution-table-wrap online-execution-table-wrap--wms-box">
                              <table className="online-execution-table online-execution-table--wms-box">
                                <thead>
                                  <tr>
                                    <th>Заказ WB</th>
                                    <th>Фактически пропикан товар</th>
                                    <th>ШК товара</th>
                                    <th>Размер</th>
                                    <th>КИЗ</th>
                                    <th>Наклейка WB</th>
                                    <th>Когда</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {box.items.map((item) => (
                                    <tr key={item.id}>
                                      <td><strong>№{item.orderId}</strong></td>
                                      <td>
                                        <strong>{item.productName}</strong>
                                        <span>{item.article ? `арт. ${item.article}` : 'артикул не указан'}</span>
                                      </td>
                                      <td>{item.productBarcode ?? '—'}</td>
                                      <td><strong>{item.size ?? '—'}</strong></td>
                                      <td>{item.kiz ?? 'без КИЗ'}</td>
                                      <td><strong className="online-execution-wb-digits">{item.wbStickerPartB ?? '—'}</strong></td>
                                      <td>
                                        <strong>{item.packedByName ?? box.closedByName ?? box.openedByName ?? 'ТСД'}</strong>
                                        <span>{formatOnlineDateTime(item.packedAt ?? box.openedAt)}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <p className="online-execution-empty">В этой заявке пока не пропикан ни один короб WMS.</p>
                    )}

                    <section className="online-execution-wms-boxes__remaining">
                      <div className="online-execution-section__heading">
                        <h4>Что ещё не пропикано в короба WMS</h4>
                        <span>{wmsBoxes?.notPacked.length ?? fbsAssembly.totalOrders} заказов</span>
                      </div>
                      {wmsBoxes && wmsBoxes.notPacked.length > 0 ? (
                        <div className="online-execution-table-wrap online-execution-table-wrap--wms-remaining">
                          <table className="online-execution-table online-execution-table--wms-remaining">
                            <thead>
                              <tr>
                                <th>Заказ WB</th>
                                <th>Товар</th>
                                <th>ШК товара</th>
                                <th>Размер</th>
                                <th>ШК WB</th>
                                <th>Почему ещё не в коробе</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wmsBoxes.notPacked.map((item) => (
                                <tr key={item.orderId}>
                                  <td><strong>№{item.orderId}</strong></td>
                                  <td>
                                    <strong>{item.productName}</strong>
                                    <span>{item.article ? `арт. ${item.article}` : 'артикул не указан'}</span>
                                  </td>
                                  <td>{item.productBarcode ?? '—'}</td>
                                  <td><strong>{item.size ?? '—'}</strong></td>
                                  <td><strong>{item.wbStickerPartB ?? '—'}</strong></td>
                                  <td>
                                    <span className={`online-execution-pill ${item.readyForPacking ? 'is-open' : 'is-danger'}`}>
                                      {item.readyForPacking ? 'Собран — нужно упаковать' : item.assemblyStatusLabel}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="online-execution-empty online-execution-empty--done">
                          Все заказы этой заявки пропиканы в короба WMS.
                        </p>
                      )}
                    </section>
                  </div>
                </details>

                {fbsAssembly.kizConflicts?.length ? (
                  <section className="online-execution-section online-execution-section--kiz-conflict">
                    <div className="online-execution-section__heading">
                      <div>
                        <h4>
                          <ShieldAlert size={18} aria-hidden="true" />
                          КИЗ требует проверки
                        </h4>
                        <span>
                          WMS сохранила неудачный скан. Кнопка сверит маркировку с заказами WB,
                          снимет только устаревшую локальную блокировку и восстановит текущую привязку.
                        </span>
                      </div>
                      <strong>{fbsAssembly.kizConflicts.length}</strong>
                    </div>
                    <div className="online-execution-kiz-conflict-list">
                      {fbsAssembly.kizConflicts.map((conflict) => (
                        <article key={conflict.id}>
                          <div>
                            <strong>Заказ WB №{conflict.orderId}</strong>
                            <span>
                              {conflict.productName}
                              {conflict.article ? ` · арт. ${conflict.article}` : ''}
                              {conflict.sourceBoxCode ? ` · короб ${conflict.sourceBoxCode}` : ''}
                            </span>
                            <code>{conflict.kiz}</code>
                            <small>{conflict.message}</small>
                          </div>
                          {onResolveKiz ? (
                            <button
                              className="client-request-action-button client-request-action-button--kiz-fix"
                              type="button"
                              disabled={Boolean(resolvingKizId)}
                              onClick={() => onResolveKiz(conflict.id)}
                            >
                              <RefreshCw
                                size={16}
                                aria-hidden="true"
                                className={resolvingKizId === conflict.id ? 'is-spinning' : undefined}
                              />
                              {resolvingKizId === conflict.id
                                ? 'Проверяю в WB…'
                                : 'Проверить и исправить КИЗ'}
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {rescanRequiredRows.length > 0 ? (
                  <section className="online-execution-section online-execution-section--sync-conflict">
                    <div className="online-execution-section__heading">
                      <div>
                        <h4>
                          <ShieldAlert size={18} aria-hidden="true" />
                          КИЗ введён вручную в Wildberries
                        </h4>
                        <span>
                          Если КИЗ уже пропикан в кабинете WB, нажмите кнопку: WMS получит его из Wildberries и вернёт заказ в собранные без повторного списания товара.
                        </span>
                      </div>
                      <strong>{rescanRequiredRows.length}</strong>
                    </div>
                    <div className="online-execution-table-wrap online-execution-table-wrap--sync-conflict">
                      <table className="online-execution-table online-execution-table--sync-conflict">
                        <thead>
                          <tr>
                            <th>Заказ WB</th>
                            <th>Товар</th>
                            <th>Короб</th>
                            <th>Состояние</th>
                            <th>Действие</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rescanRequiredRows.map((row) => (
                            <tr key={row.id}>
                              <td><strong>№{row.orderId}</strong></td>
                              <td>
                                <strong>{row.productName}</strong>
                                <span>{[row.article, row.size].filter(Boolean).join(' · ')}</span>
                              </td>
                              <td><strong>{row.sourceBoxCode ?? 'без короба'}</strong></td>
                              <td>{row.statusLabel}</td>
                              <td>
                                {onRestoreRescanKiz ? (
                                  <button
                                    type="button"
                                    className="online-execution-sync-conflict-button is-manager"
                                    onClick={() => onRestoreRescanKiz(row.id)}
                                    disabled={resolvingKizId !== null}
                                  >
                                    <CheckCircle2 size={14} aria-hidden="true" />
                                    {resolvingKizId === row.id
                                      ? 'Проверяю WB…'
                                      : 'КИЗ уже введён в WB'}
                                  </button>
                                ) : (
                                  <span>Нужны права на изменение заявок</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {fbsAssembly.duplicateKizScans?.length ? (
                  <details className="online-execution-section online-execution-section--duplicate-kiz" open>
                    <summary>
                      <span>
                        <AlertTriangle size={18} aria-hidden="true" />
                        <strong>Повторно просканированные КИЗ</strong>
                      </span>
                      <b>{fbsAssembly.duplicateKizScans.length}</b>
                    </summary>
                    <div className="online-execution-duplicate-kiz-list">
                      {fbsAssembly.duplicateKizScans.map((event) => (
                        <article key={event.eventKey || event.id}>
                          <code>{event.kiz}</code>
                          <div className="online-execution-duplicate-kiz-occurrences">
                            <div className="is-attempt">
                              <span>Повторный скан</span>
                              <strong>{formatOnlineDateTime(event.attempt.scannedAt)}</strong>
                              <small>
                                {onlineRequestNumber(event.attempt.requestNumber)} · заказ №{event.attempt.orderId}
                              </small>
                              <small>
                                короб {event.attempt.boxCode} · {event.attempt.workerName || event.attempt.deviceCode || 'сотрудник не указан'}
                              </small>
                              {event.attempt.deviceCode ? <small>ТСД: {event.attempt.deviceCode}</small> : null}
                            </div>
                            <div className="is-existing">
                              <span>Где КИЗ уже был принят</span>
                              <strong>{formatOnlineDateTime(event.existing.scannedAt)}</strong>
                              <small>
                                {onlineRequestNumber(event.existing.requestNumber)} · заказ №{event.existing.orderId}
                              </small>
                              <small>
                                короб {event.existing.boxCode} · {event.existing.workerName || event.existing.deviceCode || 'сотрудник не указан'}
                              </small>
                              {event.existing.deviceCode ? <small>ТСД: {event.existing.deviceCode}</small> : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </details>
                ) : null}

                {returnRequired && returnRequired.rows.length > 0 ? (
                  <section className="online-execution-section online-execution-section--sync-conflict">
                    <div className="online-execution-section__heading">
                      <div>
                        <h4>
                          <AlertTriangle size={17} aria-hidden="true" />
                          Изменения FBS после начала сборки
                        </h4>
                        <span>
                          Эти товары нельзя молча убрать из заявки: верните их на склад или подтвердите решение менеджера.
                        </span>
                      </div>
                      <strong>{returnRequired.units} шт.</strong>
                    </div>
                    {syncConflictResolutionMessage ? (
                      <p className="online-execution-action-message is-success">
                        {syncConflictResolutionMessage}
                      </p>
                    ) : null}
                    {syncConflictResolutionError ? (
                      <p className="online-execution-action-message is-error">
                        {syncConflictResolutionError}
                      </p>
                    ) : null}
                    {onResolveSyncConflicts ? (
                      <div className="online-execution-sync-conflict-bulk">
                        <label>
                          <input
                            type="checkbox"
                            checked={allSyncConflictsSelected}
                            onChange={(event) =>
                              setSelectedSyncConflictIds(
                                event.target.checked ? returnRequiredIds : [],
                              )
                            }
                          />
                          <span>Выбрать все</span>
                        </label>
                        <strong>Выбрано: {selectedSyncConflictIds.length}</strong>
                        <button
                          type="button"
                          className="online-execution-sync-conflict-button is-return"
                          onClick={() => onResolveSyncConflicts(selectedSyncConflictIds, 'RETURN_TO_STOCK')}
                          disabled={selectedSyncConflictIds.length === 0 || resolvingSyncConflictId !== null}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          {resolvingSyncConflictId === '__bulk__'
                            ? 'Обрабатываю…'
                            : 'Вернуть выбранные на склад'}
                        </button>
                        <button
                          type="button"
                          className="online-execution-sync-conflict-button is-manager"
                          onClick={() => onResolveSyncConflicts(selectedSyncConflictIds, 'MANAGER_CONFIRMED')}
                          disabled={selectedSyncConflictIds.length === 0 || resolvingSyncConflictId !== null}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                          {resolvingSyncConflictId === '__bulk__'
                            ? 'Обрабатываю…'
                            : 'Решение менеджера для выбранных'}
                        </button>
                      </div>
                    ) : null}
                    <div className="online-execution-table-wrap online-execution-table-wrap--sync-conflict">
                      <table className="online-execution-table online-execution-table--sync-conflict">
                        <thead>
                          <tr>
                            <th className="online-execution-sync-conflict-check">
                              <input
                                type="checkbox"
                                aria-label="Выбрать все проблемные позиции"
                                checked={allSyncConflictsSelected}
                                onChange={(event) =>
                                  setSelectedSyncConflictIds(
                                    event.target.checked ? returnRequiredIds : [],
                                  )
                                }
                              />
                            </th>
                            <th>Заказ</th>
                            <th>Товар</th>
                            <th>Короб</th>
                            <th>КИЗ</th>
                            <th>Что изменилось</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {returnRequired.rows.map((row) => (
                            <tr key={row.id}>
                              <td className="online-execution-sync-conflict-check">
                                <input
                                  type="checkbox"
                                  aria-label={`Выбрать заказ №${row.orderId}`}
                                  checked={selectedSyncConflictIds.includes(row.id)}
                                  onChange={(event) =>
                                    setSelectedSyncConflictIds((current) =>
                                      event.target.checked
                                        ? [...new Set([...current, row.id])]
                                        : current.filter((id) => id !== row.id),
                                    )
                                  }
                                  disabled={resolvingSyncConflictId !== null}
                                />
                              </td>
                              <td><strong>№{row.orderId}</strong></td>
                              <td>
                                <strong>{row.productName}</strong>
                                <span>
                                  {[row.article ? `арт. ${row.article}` : '', row.size ? `размер ${row.size}` : '', row.productBarcode ? `ШК ${row.productBarcode}` : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </td>
                              <td><strong>{row.sourceBoxCode ?? 'не выбран'}</strong></td>
                              <td>{row.kiz ?? 'не пропикан'}</td>
                              <td><strong>{row.syncIssue ?? 'Требуется решение менеджера.'}</strong></td>
                              <td>
                                {onResolveSyncConflict ? (
                                  <div className="online-execution-sync-conflict-actions">
                                    <button
                                      type="button"
                                      className="online-execution-sync-conflict-button is-return"
                                      onClick={() => onResolveSyncConflict(row.id, 'RETURN_TO_STOCK')}
                                      disabled={resolvingSyncConflictId !== null}
                                    >
                                      <RotateCcw size={14} aria-hidden="true" />
                                      {resolvingSyncConflictId === row.id
                                        ? 'Возвращаю…'
                                        : 'Вернуть на склад'}
                                    </button>
                                    <button
                                      type="button"
                                      className="online-execution-sync-conflict-button is-manager"
                                      onClick={() => onResolveSyncConflict(row.id, 'MANAGER_CONFIRMED')}
                                      disabled={resolvingSyncConflictId !== null}
                                    >
                                      <CheckCircle2 size={14} aria-hidden="true" />
                                      {resolvingSyncConflictId === row.id
                                        ? 'Подтверждаю…'
                                        : 'Решение менеджера'}
                                    </button>
                                  </div>
                                ) : (
                                  <span>Нужны права на изменение заявок</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                <section className="online-execution-section online-execution-section--not-collected">
                  <div className="online-execution-section__heading">
                    <h4>Что ещё не собрано</h4>
                    <span>
                      {notCollected?.remainingUnits ?? 0} шт. · {notCollected?.remainingPositions ?? 0} позиций · {notCollected?.remainingOrders ?? 0} заказов
                    </span>
                  </div>
                  {notCollected && notCollected.rows.length > 0 ? (
                    <>
                      <OnlineSectionSearch
                        value={notCollectedSearch}
                        onChange={setNotCollectedSearch}
                        placeholder="Найти товар, заказ, ШК или короб"
                      />
                      {onMoveOrders && notCollectedOrders.length > 0 ? (
                        <div className="online-execution-bulk-move">
                          <label>
                            <input
                              type="checkbox"
                              checked={allNotCollectedOrdersSelected}
                              onChange={(event) =>
                                setSelectedNotCollectedOrders(
                                  event.target.checked ? notCollectedOrderKeys : [],
                                )
                              }
                              disabled={Boolean(movingOrderId)}
                            />
                            <span>Выбрать все несобранные заказы</span>
                            <strong>{notCollectedOrders.length}</strong>
                          </label>
                          <button
                            type="button"
                            onClick={() => onMoveOrders(selectedNotCollectedOrderRows)}
                            disabled={selectedNotCollectedOrderRows.length === 0 || Boolean(movingOrderId)}
                          >
                            <ArrowRightLeft size={16} aria-hidden="true" />
                            {movingOrderId
                              ? 'Переношу заказы…'
                              : `Перенести выбранные в новую поставку (${selectedNotCollectedOrderRows.length})`}
                          </button>
                          {moveError ? (
                            <div className="online-execution-bulk-move__result is-error" role="alert">
                              <strong>Перенос не выполнен</strong>
                              <span>{moveError}</span>
                              {onRepairMoveOrders && selectedNotCollectedOrderRows.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => onRepairMoveOrders(selectedNotCollectedOrderRows)}
                                  disabled={Boolean(movingOrderId)}
                                >
                                  <RefreshCw size={16} aria-hidden="true" />
                                  {movingOrderId === '__repair__'
                                    ? 'Проверяю и переношу…'
                                    : 'Проверить и перенести доступные'}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {moveMessage ? (
                            <div className="online-execution-bulk-move__result is-success" role="status">
                              <strong>Готово</strong>
                              <span>{moveMessage}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {filteredNotCollectedRows.length > 0 ? (
                        <div className="online-execution-table-wrap online-execution-table-wrap--not-collected">
                          <table className="online-execution-table online-execution-table--not-collected">
                            <thead>
                              <tr>
                                <th>Товар</th>
                                <th>Заказы WB / действия</th>
                                <th>Где лежит</th>
                                <th>Нужно</th>
                                <th>Собрано</th>
                                <th>Осталось</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredNotCollectedRows.map((row) => (
                                <tr key={row.requestItemId}>
                                  <td>
                                    <strong>{row.name ?? 'Товар без названия'}</strong>
                                    <span>
                                      {[row.article ? `арт. ${row.article}` : '', row.color, row.size ? `размер ${row.size}` : '', row.barcode ? `ШК ${row.barcode}` : '']
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </span>
                                  </td>
                                  <td>
                                    {row.orders.length > 0 ? (
                                      <div className="online-execution-order-actions">
                                        {row.orders.map((order) => (
                                          <div key={`${order.connectionId}:${order.id}`}>
                                            <label className="online-execution-order-select">
                                              <input
                                                type="checkbox"
                                                checked={selectedNotCollectedOrders.includes(onlineFbsOrderKey(order))}
                                                onChange={(event) => {
                                                  const key = onlineFbsOrderKey(order);
                                                  setSelectedNotCollectedOrders((current) =>
                                                    event.target.checked
                                                      ? [...new Set([...current, key])]
                                                      : current.filter((item) => item !== key),
                                                  );
                                                }}
                                                disabled={Boolean(movingOrderId)}
                                                aria-label={`Выбрать заказ №${order.id}`}
                                              />
                                              <strong>№{order.id}</strong>
                                            </label>
                                            {onMoveOrder ? (
                                              <button
                                                type="button"
                                                onClick={() => onMoveOrder(order)}
                                                disabled={Boolean(movingOrderId)}
                                                title="Перенести этот несобранный заказ в новую поставку WB и отдельную заявку WMS"
                                              >
                                                <ArrowRightLeft size={14} aria-hidden="true" />
                                                {movingOrderId === order.id
                                                  ? 'Переношу…'
                                                  : 'В новую поставку'}
                                              </button>
                                            ) : null}
                                            {onMarkPackedWithoutSource ? (
                                              <button
                                                type="button"
                                                className="online-execution-pack-without-source"
                                                onClick={() => {
                                                  if (order.assemblyId) {
                                                    onMarkPackedWithoutSource(order.assemblyId, order.id);
                                                  }
                                                }}
                                                disabled={!order.assemblyId || resolvingSyncConflictId !== null}
                                                title={
                                                  order.requiresKiz && !order.kizAccepted
                                                    ? 'Сначала КИЗ должен быть подтверждён Wildberries'
                                                    : 'Засчитать заказ сейчас, а исходный короб указать при закрытии заявки'
                                                }
                                              >
                                                <CheckCircle2 size={14} aria-hidden="true" />
                                                {resolvingSyncConflictId === order.assemblyId
                                                  ? 'Засчитываю…'
                                                  : 'Вложен без короба'}
                                              </button>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    ) : row.orderIds.length > 0 ? (
                                      row.orderIds.map((orderId) => `№${orderId}`).join(', ')
                                    ) : (
                                      'номер уточняется'
                                    )}
                                  </td>
                                  <td>
                                    {row.availableBoxes.length > 0
                                      ? (
                                          <div className="online-execution-storage-list">
                                            {row.availableBoxes.map((box) => {
                                              const storageLocation = box.storageLocation ?? null;
                                              const palletCode =
                                                storageLocation?.palletCode ??
                                                box.palletCode ??
                                                palletSortByBoxCode.get(normalizeCode(box.boxCode));
                                              return (
                                                <span key={normalizeCode(box.boxCode)}>
                                                  <strong>{box.boxCode} — {box.quantity} шт.</strong>
                                                  <small>
                                                    Паллет-сорт: {palletCode ?? 'не назначен'}
                                                    {storageLocation?.zoneName ? ` · зона: ${storageLocation.zoneName}` : ''}
                                                  </small>
                                                </span>
                                              );
                                            })}
                                          </div>
                                        )
                                      : 'доступный короб не найден'}
                                  </td>
                                  <td>{row.requiredQuantity}</td>
                                  <td>{row.collectedQuantity}</td>
                                  <td><strong className="online-execution-remaining-quantity">{row.remainingQuantity}</strong></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="online-execution-empty">По этому запросу несобранные позиции не найдены.</p>
                      )}
                    </>
                  ) : (
                    <p className="online-execution-empty online-execution-empty--done">Все товары этой заявки собраны.</p>
                  )}
                </section>

                <section className="online-execution-section online-execution-section--fbs-fact">
                  <div className="online-execution-section__heading">
                    <h4>Фактическая сборка FBS</h4>
                    <span>
                      собрано {fbsAssembly.completedOrders} из {fbsAssembly.totalOrders} · в работе {Math.max(0, fbsAssembly.startedOrders - fbsAssembly.completedOrders)}
                    </span>
                  </div>
                  <OnlineSectionSearch
                    value={fbsAssemblySearch}
                    onChange={setFbsAssemblySearch}
                    placeholder="Найти заказ, короб, ШК товара или ШК WB"
                  />
                  {filteredFbsAssemblyRows.length ? (
                    <div className="online-execution-table-wrap online-execution-table-wrap--fbs-fact">
                      <table className="online-execution-table online-execution-table--fbs-fact">
                        <thead>
                          <tr>
                            <th>Короб, откуда взят</th>
                            <th>Номер заказа</th>
                            <th>ШК товара</th>
                            <th>Размер</th>
                            <th>ШК WB — большие 4 цифры</th>
                            <th>Статус</th>
                            <th>Действие</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFbsAssemblyRows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <strong>
                                  {row.sourceBoxPending
                                    ? 'Указать при закрытии'
                                    : row.sourceBoxCode ?? 'ещё не выбран'}
                                </strong>
                              </td>
                              <td>
                                <strong>№{row.orderId}</strong>
                                <span>{row.productName}{row.article ? ` · арт. ${row.article}` : ''}</span>
                              </td>
                              <td>
                                <strong>{row.productBarcode ?? 'ещё не пропикан'}</strong>
                                <span className="online-execution-kiz">
                                  КИЗ: {row.kiz ?? 'не записан'}
                                </span>
                              </td>
                              <td><strong>{row.size ?? 'не указан'}</strong></td>
                              <td>
                                <strong className="online-execution-wb-digits">{row.wbStickerPartB ?? '—'}</strong>
                                <span>{row.wbStickerBarcode ? `полный ШК: ${row.wbStickerBarcode}` : 'появится после получения наклейки WB'}</span>
                              </td>
                              <td>
                                <span
                                  className={`online-execution-pill ${
                                    row.completionSource === 'SOS_WB'
                                      ? 'is-sos'
                                      :
                                    row.status === 'COMPLETED'
                                      ? 'is-done'
                                      : row.status === 'RETURN_REQUIRED'
                                        ? 'is-danger'
                                        : 'is-open'
                                  }`}
                                >
                                  {row.completionSource === 'SOS_WB'
                                    ? row.sourceBoxPending
                                      ? 'Сделано SOS · короб ожидается'
                                      : 'Сделано SOS'
                                    : row.sourceBoxPending
                                      ? 'Вложен без короба'
                                      : row.statusLabel}
                                </span>
                                {row.completionSource === 'SOS_WB' ? (
                                  <span>{row.workerName ? `${row.workerName} · ` : ''}{row.completedAt ? formatOnlineDateTime(row.completedAt) : ''}</span>
                                ) : null}
                              </td>
                              <td>
                                {onResetFbsAssembly && ['IN_PROGRESS', 'RESCAN_REQUIRED'].includes(row.status) ? (
                                  <button
                                    type="button"
                                    className="online-execution-sync-conflict-button is-reset"
                                    disabled={resolvingSyncConflictId !== null}
                                    onClick={() => onResetFbsAssembly(row.id, row.orderId)}
                                    title="Очистить сканы и вернуть только этот заказ в очередь ТСД"
                                  >
                                    <RotateCcw size={14} aria-hidden="true" />
                                    {resolvingSyncConflictId === row.id
                                      ? 'Сбрасываю…'
                                      : 'Сбросить сборку'}
                                  </button>
                                ) : (
                                  <span>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="online-execution-empty">
                      {fbsAssembly.rows.length
                        ? 'По этому запросу строки фактической сборки не найдены.'
                        : 'Фактические данные появятся после начала сборки заказов на ТСД.'}
                    </p>
                  )}
                </section>
              </>
            ) : null}

            <OnlineBoxChips
              title="Короба для поиска"
              subtitle={`Найдено: ${foundCount} из ${searchTotal} · осталось: ${remainingCount}`}
              boxes={searchBoxes.map((box) => ({
                code: box.boxCode,
                done: box.found || box.isFound || foundCodes.has(normalizeCode(box.boxCode)),
                doneText: ['найден', box.multiCityLabel].filter(Boolean).join(' · '),
                todoText: ['не найден', box.multiCityLabel].filter(Boolean).join(' · '),
              }))}
            />

            <OnlineBoxChips
              title="Короба, где перемещения уже сделаны"
              subtitle={movementSourceBoxes.length ? `Готово: ${movementSourceBoxes.filter((box) => box.done).length} из ${movementSourceBoxes.length}` : 'Перемещений нет'}
              boxes={movementSourceBoxes.map((box) => ({
                code: box.sourceBox,
                done: box.done,
                doneText: `готов · ${box.movedQuantity} шт.`,
                todoText: `осталось ${box.remainingQuantity} шт.`,
              }))}
              emptyText="По этой заявке нет коробов с перемещениями."
            />

            <section className="online-execution-section">
              <div className="online-execution-section__heading">
                <h4>Перемещения</h4>
                <span>{movementRows.length ? `${movementRows.length} строк` : 'нет строк'}</span>
                <button
                  className="client-request-action-button client-request-action-button--xlsx client-request-action-button--compact"
                  type="button"
                  onClick={onDownloadMovements}
                  disabled={status === 'loading' || !plan}
                  title="Скачать Excel с перемещениями"
                >
                  <FileDown size={14} aria-hidden="true" />
                  <span>Excel</span>
                </button>
              </div>
              <OnlineSectionSearch value={movementSearch} onChange={setMovementSearch} placeholder="Найти короб в перемещениях" />
              {filteredMovementRows.length ? (
                <div className="online-execution-table-wrap">
                  <table className="online-execution-table">
                    <thead>
                      <tr>
                        <th>Из короба</th>
                        <th>В короб</th>
                        <th>Товар</th>
                        <th>Кол-во</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMovementRows.map((row, index) => (
                        <tr key={`${row.sourceBox}-${row.barcode}-${row.targetBox}-${index}`}>
                          <td>{row.sourceBox}</td>
                          <td>{targetBoxesText(row)}</td>
                          <td>
                            <strong>{row.name ?? row.barcode ?? '-'}</strong>
                            <span>
                              {row.barcode ?? '-'}
                              {row.size ? ` · ${row.size}` : ''}
                            </span>
                          </td>
                          <td>
                            {row.movedQuantity ?? 0} / {row.requiredQuantity ?? row.quantity}
                          </td>
                          <td>
                            <span className={`online-execution-pill ${row.done ? 'is-done' : 'is-open'}`}>
                              {row.done ? 'готово' : `осталось ${row.remainingQuantity ?? row.quantity}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="online-execution-empty">
                  {movementRows.length ? 'По этому номеру короба перемещений не найдено.' : 'Перемещения по заявке не требуются.'}
                </p>
              )}
            </section>

            <section className="online-execution-section">
              <div className="online-execution-section__heading">
                <h4>Факт перемещений</h4>
                <span>{actualMovements.length ? `${actualMovements.length} строк` : 'пока нет факта'}</span>
              </div>
              <OnlineSectionSearch value={actualMovementSearch} onChange={setActualMovementSearch} placeholder="Найти короб в выполненных перемещениях" />
              {filteredActualMovements.length ? (
                <div className="online-execution-table-wrap">
                  <table className="online-execution-table">
                    <thead>
                      <tr>
                        <th>Из</th>
                        <th>В</th>
                        <th>Что перенесено</th>
                        <th>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActualMovements.map((row, index) => (
                        <tr key={`${row.sourceBox}-${row.targetBox}-${row.barcode}-${index}`}>
                          <td>{row.sourceBox}</td>
                          <td>{row.targetBox}</td>
                          <td>
                            <strong>{row.name ?? row.barcode ?? '-'}</strong>
                            <span>
                              {row.barcode ?? '-'}
                              {row.size ? ` · ${row.size}` : ''}
                            </span>
                          </td>
                          <td>{row.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="online-execution-empty">
                  {actualMovements.length ? 'По этому номеру короба выполненных перемещений не найдено.' : 'Фактические переносы появятся после синхронизации ТСД.'}
                </p>
              )}
            </section>

            <OnlineBoxChips
              title="НА ОТПРАВКУ"
              subtitle={outgoingBoxes.length ? `Актуально коробов: ${outgoingBoxes.length}` : 'короба пока не определены'}
              boxes={outgoingBoxes.map((box) => ({
                code: box.boxCode,
                done: true,
                doneText: [box.typeLabel, box.quantity ? `${box.quantity} шт.` : '', box.sourceBox ? `из ${box.sourceBox}` : '']
                  .filter(Boolean)
                  .join(' · '),
                todoText: '',
              }))}
              emptyText="После поиска и перемещений здесь появится актуальный список коробов, которые уезжают."
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function OnlineBoxChips({
  title,
  subtitle,
  boxes,
  emptyText = 'Список пуст.',
}: {
  title: string;
  subtitle: string;
  boxes: Array<{ code: string; done: boolean; doneText: string; todoText: string }>;
  emptyText?: string;
}) {
  const [search, setSearch] = useState('');
  const filteredBoxes = boxes.filter((box) => box.code.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));

  return (
    <section className="online-execution-section">
      <div className="online-execution-section__heading">
        <h4>{title}</h4>
        <span>{subtitle}</span>
      </div>
      <OnlineSectionSearch value={search} onChange={setSearch} placeholder="Найти короб в этом разделе" />
      {filteredBoxes.length ? (
        <div className="online-execution-chips">
          {filteredBoxes.map((box) => (
            <span className={`online-execution-chip ${box.done ? 'is-done' : 'is-open'}`} key={`${title}-${box.code}`}>
              <strong>{box.code}</strong>
              <small>{box.done ? box.doneText : box.todoText}</small>
            </span>
          ))}
        </div>
      ) : (
        <p className="online-execution-empty">{boxes.length ? 'Короб с таким номером не найден.' : emptyText}</p>
      )}
    </section>
  );
}

function OnlineSectionSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="online-execution-search">
      <Search size={16} aria-hidden="true" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value ? (
        <button type="button" onClick={() => onChange('')} title="Очистить поиск" aria-label="Очистить поиск">
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

function FbsSynchronizationAuditPanel({
  audit,
  canResolve,
  resolvingRequestId,
  onResolve,
  onClose,
}: {
  audit: FbsSynchronizationAudit;
  canResolve: boolean;
  resolvingRequestId: string | null;
  onResolve: (
    issue: FbsSynchronizationAuditIssue,
    action: 'RETURN_TO_WORK' | 'CONFIRM_DELIVERED',
  ) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <section
      className={`client-request-fbs-audit${audit.issues.length ? ' is-warning' : ' is-ok'}`}
      aria-live="polite"
    >
      <header className="client-request-fbs-audit__header">
        <div>
          <div className="client-request-fbs-audit__title">
            {audit.issues.length ? <AlertTriangle size={19} aria-hidden="true" /> : <CheckCircle2 size={19} aria-hidden="true" />}
            <strong>{audit.issues.length ? `Найдено расхождений: ${audit.issues.length}` : 'Рассинхронизаций не найдено'}</strong>
          </div>
          <span>
            Проверено клиентов: {audit.clients} · заказов: {audit.orders}
          </span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Скрыть результат" aria-label="Скрыть результат проверки">
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      {audit.issues.length ? (
        <div className="client-request-fbs-audit__issues">
          {audit.issues.map((issue) => {
            const isResolving = resolvingRequestId === issue.requestId;
            const canConfirmDelivery = issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED';
            return (
              <article className="client-request-fbs-audit__issue" key={issue.requestId}>
                <div className="client-request-fbs-audit__issue-copy">
                  <strong>Заявка №{String(issue.requestNumber).padStart(6, '0')} · {issue.requestTitle}</strong>
                  <span>{issue.clientName} · {issue.marketplaceNames.join(', ')}</span>
                  <p>
                    В WMS: <b>{fbsSynchronizationStatusLabel(issue.wmsStatus)}</b> · на сдаче/в доставке: {issue.shippedOrders} · доставлено: {issue.deliveredOrders} · отменено: {issue.cancelledOrders}.
                  </p>
                  <small>
                    {issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED'
                      ? 'Все заказы маркетплейса доставлены либо отменены. Выберите, оставить заявку в работе или подтвердить её сдачу без повторного списания остатков.'
                      : 'В WMS заявка закрыта, но в маркетплейсе ещё есть активные заказы. Верните её в работу для проверки.'}
                  </small>
                </div>
                {canResolve ? (
                  <div className="client-request-fbs-audit__actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isResolving}
                      onClick={() => void onResolve(issue, 'RETURN_TO_WORK')}
                    >
                      Вернуть в работу
                    </button>
                    {canConfirmDelivery ? (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={isResolving}
                        onClick={() => void onResolve(issue, 'CONFIRM_DELIVERED')}
                      >
                        {isResolving ? 'Сохраняю…' : 'Подтвердить сдачу'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {audit.failures.length ? (
        <p className="client-request-fbs-audit__failures">
          Не удалось обновить: {audit.failures.join(' · ')}
        </p>
      ) : null}
    </section>
  );
}

function FbsSupplyConsistencyModal({
  state,
  onRepair,
  onClose,
}: {
  state: FbsSupplyConsistencyState;
  onRepair: () => void;
  onClose: () => void;
}) {
  const { data } = state;
  const isBusy = state.status === 'loading' || state.status === 'repairing';
  return (
    <div
      className="online-execution-modal fbs-supply-consistency-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Проверка состава FBS-заявки с Wildberries"
    >
      <section className="online-execution-modal__panel fbs-supply-consistency-modal__panel">
        <header className="online-execution-modal__header">
          <div>
            <span>Контроль состава WB</span>
            <h3>Заявка №{String(state.request.number).padStart(6, '0')}</h3>
            <small>{state.request.client.name}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={isBusy} title="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="fbs-supply-consistency-modal__body">
          {state.status === 'loading' ? (
            <p className="inline-status">Запрашиваю фактический состав поставки у Wildberries…</p>
          ) : null}
          {state.status === 'repairing' ? (
            <p className="inline-status">Добавляю недостающие заказы и пересчитываю состав заявки…</p>
          ) : null}
          {state.error ? <p className="form-error">{state.error}</p> : null}

          {data ? (
            <>
              <div className={`fbs-supply-consistency-summary ${data.consistent ? 'is-ok' : 'is-error'}`}>
                {data.consistent ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
                <div>
                  <strong>{data.consistent ? 'Состав совпадает' : 'Есть расхождение состава'}</strong>
                  <span>{data.message}</span>
                </div>
              </div>
              <div className="fbs-supply-consistency-metrics">
                <article><span>В поставке WB</span><strong>{data.wbOrders}</strong></article>
                <article><span>В заявке WMS</span><strong>{data.wmsOrders}</strong></article>
                <article className={data.missingInWms > 0 ? 'is-error' : ''}><span>Не хватает в WMS</span><strong>{data.missingInWms}</strong></article>
                <article className={data.extraInWms > 0 ? 'is-error' : ''}><span>Лишних в WMS</span><strong>{data.extraInWms}</strong></article>
              </div>
              <div className="fbs-supply-consistency-table-wrap">
                <table className="data-table fbs-supply-consistency-table">
                  <thead>
                    <tr>
                      <th>Поставка WB</th>
                      <th>Склад</th>
                      <th>WB</th>
                      <th>WMS</th>
                      <th>Не хватает</th>
                      <th>Лишние</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.supplies.map((supply) => (
                      <tr key={`${supply.connectionId}:${supply.supplyId}`}>
                        <td><strong>{supply.supplyId}</strong><small>{supply.accountName}</small></td>
                        <td>{supply.warehouseName ?? 'Не указан'}</td>
                        <td>{supply.wbOrders}</td>
                        <td>{supply.wmsOrders}</td>
                        <td className={supply.missingInWms > 0 ? 'is-error' : ''}>{supply.missingInWms}</td>
                        <td className={supply.extraInWms > 0 ? 'is-error' : ''}>{supply.extraInWms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.supplies.some((supply) => supply.missingOrderIds.length || supply.extraOrderIds.length) ? (
                <details className="fbs-supply-consistency-details">
                  <summary>Показать номера заказов с расхождениями</summary>
                  {data.supplies.map((supply) => (
                    supply.missingOrderIds.length || supply.extraOrderIds.length ? (
                      <div key={supply.supplyId}>
                        <strong>{supply.supplyId}</strong>
                        {supply.missingOrderIds.length ? <p>Нет в WMS: {supply.missingOrderIds.join(', ')}</p> : null}
                        {supply.extraOrderIds.length ? <p>Лишние в WMS: {supply.extraOrderIds.join(', ')}</p> : null}
                      </div>
                    ) : null
                  ))}
                </details>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="fbs-supply-consistency-modal__footer">
          <button className="client-request-action-button client-request-action-button--instruction" type="button" onClick={onClose} disabled={isBusy}>
            Закрыть
          </button>
          {data && !data.consistent ? (
            <button className="primary-button" type="button" onClick={onRepair} disabled={isBusy}>
              <RefreshCw className={state.status === 'repairing' ? 'is-spinning' : undefined} size={16} aria-hidden="true" />
              <span>{state.status === 'repairing' ? 'Исправляю…' : 'Исправить состав заявки'}</span>
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function FbsRouteDrawer({ state, canRebuild, onRebuild, onClose }: {
  state: {
    request: ClientRequestSummary;
    status: 'loading' | 'ready' | 'rebuilding' | 'error';
    data: FbsRequestRoute | null;
    error?: string;
    diff?: { addedBoxes: string[]; removedBoxes: string[] };
  };
  canRebuild: boolean;
  onRebuild: () => void;
  onClose: () => void;
}) {
  const data = state.data;
  const busy = state.status === 'loading' || state.status === 'rebuilding';
  return (
    <div className="fbs-route-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="fbs-route-drawer" role="dialog" aria-modal="true"
        aria-label={`Маршрут FBS-заявки №${String(state.request.number).padStart(6, '0')}`}
        onMouseDown={(event) => event.stopPropagation()}>
        <header className="fbs-route-drawer__header">
          <div>
            <h3><MapPinned size={20} aria-hidden="true" /> Маршрут заявки №{String(state.request.number).padStart(6, '0')}</h3>
            <p>Живые паллетсорты, короба и состояние каждой позиции.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Закрыть маршрут"><X size={18} /></button>
        </header>
        {state.status === 'loading' ? <p className="panel-message"><RefreshCw className="is-spinning" size={18} /> Получаю актуальный маршрут…</p> : null}
        {state.error ? <p className="panel-message panel-message--error">{state.error}</p> : null}
        {data ? <div className="fbs-route-drawer__body">
          <div className="fbs-route-summary">
            <span><strong>{data.summary.routed}</strong> в маршруте</span>
            <span><strong>{data.summary.gathered}</strong> собрано</span>
            <span className={data.summary.unavailable > 0 ? 'is-warning' : undefined}><strong>{data.summary.unavailable}</strong> недоступно</span>
          </div>
          <p className="fbs-route-version">Версия {data.version} · {new Date(data.generatedAt).toLocaleString('ru-RU')}</p>
          {state.diff && (state.diff.addedBoxes.length || state.diff.removedBoxes.length) ? <div className="fbs-route-diff" role="status">
            {state.diff.addedBoxes.length ? <span>Добавлены: {state.diff.addedBoxes.join(', ')}</span> : null}
            {state.diff.removedBoxes.length ? <span>Убраны: {state.diff.removedBoxes.join(', ')}</span> : null}
          </div> : null}
          <section className="fbs-route-pallets"><h4>Паллетсорты и короба</h4>
            {data.pallets.length ? data.pallets.map((pallet) => <div key={pallet.palletCode} className="fbs-route-pallet-row"><strong>{pallet.palletCode}</strong><span>{pallet.boxes.join(', ')}</span></div>) : <p>Свободные короба не найдены.</p>}
          </section>
          <section className="fbs-route-items"><h4>Позиции</h4><div className="fbs-route-items__scroll"><table className="data-table">
            <thead><tr><th>Заказ</th><th>Товар</th><th>Кол-во</th><th>Источник</th><th>Состояние</th></tr></thead>
            <tbody>{data.items.map((item) => <tr key={item.taskId}>
              <td>№{item.orderId}</td><td><strong>{item.productName}</strong>{item.article ? <span>{item.article}</span> : null}</td>
              <td>{item.quantity}</td><td>{item.palletCode && item.boxCode ? `${item.palletCode} · ${item.boxCode}` : '—'}</td>
              <td><span className={`fbs-route-state fbs-route-state--${item.state.toLowerCase()}`}>{item.state === 'GATHERED' ? 'Собрано' : item.state === 'ROUTED' ? 'В маршруте' : 'Недоступно'}</span>{item.reason ? <small>{item.reason}</small> : null}</td>
            </tr>)}</tbody>
          </table></div></section>
        </div> : null}
        <footer className="fbs-route-drawer__footer"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Закрыть</button>
          {canRebuild ? <button className="primary-button" type="button" onClick={onRebuild} disabled={busy}><RefreshCw className={state.status === 'rebuilding' ? 'is-spinning' : undefined} size={16} />{state.status === 'rebuilding' ? 'Перестраиваю…' : 'Перестроить маршрут'}</button> : null}
        </footer>
      </aside>
    </div>
  );
}

function renderRequests(
  state: LoadState<ClientRequestSummary>,
  selectableRequestIds: Set<string>,
  selectedRequestIds: Set<string>,
  onRequestSelectionChange: (requestIds: Set<string>) => void,
  canChangeStatus: boolean,
  canPickOutbound: boolean,
  canCancelRequests: boolean,
  canEditAnyRequest: boolean,
  canRefreshPickInstruction: boolean,
  canUploadManualInstruction: boolean,
  refreshingInstructionId: string | null,
  syncingTsdRequestId: string | null,
  checkingSupplyRequestId: string | null,
  routeLoadingRequestId: string | null,
  onStatusChange: (requestId: string, status: ClientRequestStatus) => void,
  onCancelRequest: (request: ClientRequestSummary) => void,
  onEditRequest: (request: ClientRequestSummary) => void,
  onOpenDocument: (request: ClientRequestSummary) => void,
  onDownloadRequestItems: (request: ClientRequestSummary) => void,
  onDownloadOriginalFile: ((request: ClientRequestSummary, file: ClientRequestFileSummary) => void) | undefined,
  onOpenFbsOrders: ((request: ClientRequestSummary) => void) | undefined,
  onOpenFbsRoute: (request: ClientRequestSummary) => void,
  onOpenOnlineExecution: ((request: ClientRequestSummary) => void) | undefined,
  onSelectManualBoxes: ((request: ClientRequestSummary) => void) | undefined,
  onOpenFbsBoxSearch: ((request: ClientRequestSummary) => void) | undefined,
  onOpenPickInstruction: (request: ClientRequestSummary) => void,
  onRefreshPickInstruction: (request: ClientRequestSummary) => void,
  onSyncTsd: ((request: ClientRequestSummary) => void) | undefined,
  onCheckSupplyConsistency: ((request: ClientRequestSummary) => void) | undefined,
  onDownloadPickInstruction: (request: ClientRequestSummary) => void,
  onDownloadWbProducts: ((request: ClientRequestSummary) => void) | undefined,
  onDownloadWbPackages: ((request: ClientRequestSummary) => void) | undefined,
  onUploadManualInstruction: ((request: ClientRequestSummary) => void) | undefined,
  onEmergencyPackedXlsx: ((request: ClientRequestSummary) => void) | undefined,
  onRollbackEmergencyClose: ((request: ClientRequestSummary) => void) | undefined,
  onPickOutbound: (request: ClientRequestSummary) => void,
  onPackageOutbound: (request: ClientRequestSummary) => void,
  onShipOutbound: (request: ClientRequestSummary) => void,
) {
  if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
    return (
      <p className="panel-message">
        <ClipboardList size={22} aria-hidden="true" />
        <span>Загружаю заявки.</span>
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="panel-message panel-message--error">{state.error ?? 'Не удалось загрузить заявки.'}</p>;
  }

  if (state.data.length === 0) {
    return <p className="panel-message">Заявок пока нет.</p>;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю заявки.</p> : null}
      <ClientRequestsTable
        items={state.data}
        selectableRequestIds={selectableRequestIds}
        selectedRequestIds={selectedRequestIds}
        onRequestSelectionChange={onRequestSelectionChange}
        canChangeStatus={canChangeStatus}
        canPickOutbound={canPickOutbound}
        canCancelRequests={canCancelRequests}
        canEditAnyRequest={canEditAnyRequest}
        canRefreshPickInstruction={canRefreshPickInstruction}
        refreshingInstructionId={refreshingInstructionId}
        syncingTsdRequestId={syncingTsdRequestId}
        checkingSupplyRequestId={checkingSupplyRequestId}
        routeLoadingRequestId={routeLoadingRequestId}
        onStatusChange={onStatusChange}
        onCancelRequest={onCancelRequest}
        onEditRequest={onEditRequest}
        onOpenDocument={onOpenDocument}
        onDownloadRequestItems={onDownloadRequestItems}
        onDownloadOriginalFile={onDownloadOriginalFile}
        onOpenFbsOrders={onOpenFbsOrders}
        onOpenFbsRoute={onOpenFbsRoute}
        onOpenOnlineExecution={onOpenOnlineExecution}
        onSelectManualBoxes={onSelectManualBoxes}
        onOpenFbsBoxSearch={onOpenFbsBoxSearch}
        onOpenPickInstruction={onOpenPickInstruction}
        onRefreshPickInstruction={onRefreshPickInstruction}
        onSyncTsd={onSyncTsd}
        onCheckSupplyConsistency={onCheckSupplyConsistency}
        onDownloadPickInstruction={onDownloadPickInstruction}
        onDownloadWbProducts={onDownloadWbProducts}
        onDownloadWbPackages={onDownloadWbPackages}
        onUploadManualInstruction={canUploadManualInstruction ? onUploadManualInstruction : undefined}
        onEmergencyPackedXlsx={onEmergencyPackedXlsx}
        onRollbackEmergencyClose={onRollbackEmergencyClose}
        onPickOutbound={onPickOutbound}
        onPackageOutbound={onPackageOutbound}
        onShipOutbound={onShipOutbound}
      />
    </>
  );
}

function isManualStockClosingRequest(request: ClientRequestSummary) {
  return (
    (request.type === 'OUTBOUND' || request.type === 'DELIVERY') &&
    request.items.length > 0 &&
    !request.comment?.toLocaleLowerCase('ru-RU').includes('создано из excel:')
  );
}

function normalizeOnlineBoxes(
  values: Array<{
    boxCode?: string;
    code?: string;
    found?: boolean;
    isFound?: boolean;
    servesMultipleCities?: boolean;
    multiCityLabel?: string;
    storageLocation?: {
      palletId: string;
      palletCode: string;
      zoneId: string | null;
      zoneCode: string | null;
      zoneName: string | null;
    } | null;
  }>,
) {
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

function normalizeOutgoingBoxes(plan: TsdAssemblyPlan | null) {
  if (!plan) {
    return [];
  }

  const boxes = new Map<
    string,
    {
      boxCode: string;
      typeLabel: string;
      sourceBox: string;
      quantity: number;
    }
  >();

  const addBox = (boxCode: string | undefined, typeLabel: string, sourceBox = '', quantity = 0) => {
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

function targetBoxesText(row: { actualTargetBoxes?: string[]; targetBox?: string; purpose?: string; targetRole?: string }) {
  if (row.actualTargetBoxes?.length) {
    return row.actualTargetBoxes.join(', ');
  }
  if (row.targetBox) {
    return row.targetBox;
  }
  return row.purpose === 'SHIPMENT' || row.targetRole === 'SHIPMENT' ? 'новый короб поставки' : 'короб баланса';
}

function progressRatio(done: number, total: number) {
  if (total <= 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, done / total));
}

function averageProgress(values: number[]) {
  const safeValues = values.length ? values : [0];
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function normalizeCode(value?: string | null) {
  return value?.trim().toLocaleLowerCase('ru-RU') ?? '';
}

function onlineFbsOrderKey(order: { id: string; connectionId: string }) {
  return `${order.connectionId}:${order.id}`;
}

function onlineRequestNumber(value: number | null) {
  return value == null ? 'заявка без номера' : `заявка №${String(value).padStart(6, '0')}`;
}

function formatOnlineDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'время не записано';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function movementRowMatchesSearch(
  row: { sourceBox?: string; targetBox?: string; actualTargetBoxes?: string[]; barcode?: string; name?: string | null },
  query: string,
) {
  const normalizedQuery = normalizeCode(query);
  if (!normalizedQuery) return true;
  return [row.sourceBox, row.targetBox, ...(row.actualTargetBoxes ?? []), row.barcode, row.name]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeCode(value).includes(normalizedQuery));
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}

function canEditRequestAnyStatus(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

function canUploadOwnInstruction(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER'].includes(role));
}

function canAdministerRequestFiles(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER'].includes(role));
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
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'request';
}

function parseNonNegativeInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function isStockSourceResolutionError(message: string) {
  const normalized = message.toLocaleLowerCase('ru-RU');
  return (
    normalized.includes('остат') ||
    normalized.includes('списан') ||
    normalized.includes('фактическ') ||
    normalized.includes('короб')
  );
}

// FIX: перевес не должен открывать форму исправления складского источника.
function isOverweightPackageError(message: string) {
  const normalized = message.toLocaleLowerCase('ru-RU');
  return normalized.includes('вес короба') && normalized.includes('превышает 25 кг');
}

function buildFbsSynchronizationAudit(
  responses: ClientFbsOrders[],
  failures: string[],
): FbsSynchronizationAudit {
  const byRequest = new Map<
    string,
    Omit<FbsSynchronizationAuditIssue, 'kind'>
  >();
  let orders = 0;

  for (const response of responses) {
    for (const order of response.orders) {
      if (!order.request) continue;
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
      if (order.category === 'active') current.activeOrders += 1;
      else if (order.category === 'cancelled') current.cancelledOrders += 1;
      else if (order.category === 'shipped') current.shippedOrders += 1;
      else if (order.category === 'archive') current.deliveredOrders += 1;
      byRequest.set(order.request.id, current);
    }
  }

  const closed = new Set<ClientRequestStatus>(['DONE', 'CANCELLED', 'REJECTED']);
  const issues: FbsSynchronizationAuditIssue[] = [];
  byRequest.forEach((request) => {
    // `shipped` in WB means handover to delivery, not delivery to the buyer.
    // Such a request must remain in work; #161 is exactly this case.
    if (
      !closed.has(request.wmsStatus) &&
      request.activeOrders === 0 &&
      request.shippedOrders === 0 &&
      (request.deliveredOrders > 0 || request.cancelledOrders > 0)
    ) {
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

function fbsSynchronizationStatusLabel(status: ClientRequestStatus) {
  const labels: Record<ClientRequestStatus, string> = {
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

function fbsAssemblyStatusLabel(status: string) {
  if (status === 'COMPLETED') return 'собран';
  if (status === 'IN_PROGRESS') return 'сборка не завершена';
  if (status === 'RELEASED') return 'отложен на ТСД';
  if (status === 'CANCELLED') return 'сборка отменена';
  return 'не начинался на ТСД';
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
