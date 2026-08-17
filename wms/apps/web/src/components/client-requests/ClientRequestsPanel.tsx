import { AlertTriangle, Archive, ArrowLeft, ArrowRightLeft, Boxes, ClipboardList, FileDown, FileUp, RefreshCw, Search, ShieldAlert, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  cancelClientRequest,
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
  fetchPickInstruction,
  fetchPendingPickWaveBalanceReviews,
  fetchTsdAssemblyPlan,
  moveFbsOrdersToNewSupply,
  packageClientRequest,
  pickClientRequest,
  refreshPickInstruction as refreshPickInstructionDocument,
  rollbackEmergencyCloseClientRequest,
  saveClientRequestManualBoxSelection,
  shipClientRequest,
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
  type ClientSummary,
  type EmergencyPackedXlsxResult,
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
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';
import { requestStatusLabel } from './clientRequestMeta';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PickWaveBalanceReviewPanel } from './PickWaveBalanceReviewPanel';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type ClientRequestsPanelProps = {
  session: AuthSession;
};

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

type FbsBoxSearchState = {
  request: ClientRequestSummary;
  status: 'loading' | 'ready';
  data: ClientRequestFbsBoxSearch | null;
  error?: string;
};

export function ClientRequestsPanel({ session }: ClientRequestsPanelProps) {
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
  const [editingRequest, setEditingRequest] = useState<ClientRequestSummary | null>(null);
  const [onlinePreview, setOnlinePreview] = useState<{ request: ClientRequestSummary; plan: TsdAssemblyPlan | null; status: 'loading' | 'ready' | 'error'; error?: string } | null>(null);
  const [onlineFbsMove, setOnlineFbsMove] = useState<{
    orderId: string | null;
    message?: string;
    error?: string;
  }>({ orderId: null });
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
  const [fbsBoxSearch, setFbsBoxSearch] = useState<FbsBoxSearchState | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveBoxSearch, setArchiveBoxSearch] = useState('');
  const [appliedArchiveBoxSearch, setAppliedArchiveBoxSearch] = useState('');

  const visibleClients = useMemo(() => clients.data, [clients.data]);
  const displayedRequests = useMemo(
    () => ({
      ...requests,
      data: requests.data.filter((request) => (showArchive ? request.status === 'DONE' : request.status !== 'DONE')),
    }),
    [requests, showArchive],
  );

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
    const refresh = async () => {
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
      }
    };

    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);

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

  async function submitManualClose(allowOverweightPackages = false) {
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
      if (manualClose.usesRecordedPackages) {
        await shipClientRequest(session.accessToken, {
          requestId: manualClose.request.id,
          idempotencyKey: `web-ship:${manualClose.request.id}`,
          comment: manualClose.comment.trim(),
        });
      } else {
        await updateClientRequestStatus(session.accessToken, manualClose.request.id, {
          status: 'DONE',
          managerComment: manualClose.comment.trim(),
          boxes: boxes!,
          pallets: pallets!,
          packedUnits: packedUnits!,
          // FIX: флаг отправляется только по отдельной кнопке подтверждения перевеса.
          allowOverweightPackages,
        });
      }

      setManualClose(null);
      setActionMessage('Отгрузка закрыта. Остатки списаны, начисления за обработку и черновик счета сформированы.');
      await loadData();
    } catch (caught) {
      setManualClose((current) =>
        current ? { ...current, status: 'idle', error: errorMessage(caught) } : current,
      );
    }
  }

  async function openOnlineExecution(request: ClientRequestSummary) {
    setOnlinePreview({ request, plan: null, status: 'loading' });
    setOnlineFbsMove({ orderId: null });
    setError(null);

    try {
      const plan = await fetchTsdAssemblyPlan(session.accessToken, request.id);
      setOnlinePreview({ request, plan, status: 'ready' });
    } catch (caught) {
      setOnlinePreview({ request, plan: null, status: 'error', error: errorMessage(caught) });
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
    const orderDescription = orders.length === 1
      ? `несобранный заказ №${orders[0]!.id}`
      : `${orders.length} выбранных несобранных заказов`;
    if (!window.confirm(
      `Перенести ${orderDescription} в новую поставку WB?\n\n` +
      'Для них будет создана отдельная заявка WMS, а текущая заявка пересчитается автоматически.',
    )) return;

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
    setRefreshingInstructionId(request.id);

    try {
      const document = await refreshPickInstructionDocument(session.accessToken, request.id);
      setPickInstructionPreview(document);

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

      <div className="client-requests-panel__list">
        {renderRequests(
          displayedRequests,
          canChangeStatus,
          canPickOutbound,
          canWrite,
          canEditAnyRequest,
          canPickOutbound && canEditAnyRequest,
          canUploadManualInstruction,
          refreshingInstructionId,
          (requestId, status) => void changeStatus(requestId, status),
          (request) => void cancelRequest(request),
          (request) => setEditingRequest(request),
          (request) => void openRequestDocument(request),
          (request) => void downloadRequestItems(request),
          canDownloadOriginalRequest
            ? (request, file) => void downloadOriginalRequestFile(request, file)
            : undefined,
          canPickOutbound ? (request) => void openOnlineExecution(request) : undefined,
          canPickOutbound ? (request) => void openManualBoxSelection(request) : undefined,
          canPickOutbound ? (request) => void openFbsBoxSearch(request) : undefined,
          (request) => void openPickInstruction(request),
          (request) => void refreshPickInstruction(request),
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
          onClose={() => {
            setOnlinePreview(null);
            setOnlineFbsMove({ orderId: null });
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
          onClose={() => setManualClose(null)}
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
            downloadBlob(blob, `Совпадающие_короба_FBS_${String(fbsBoxSearch.request.number).padStart(6, '0')}.xlsx`);
          }}
          onClose={() => setFbsBoxSearch(null)}
        />
      ) : null}
    </section>
  );
}

function isFbsRequest(request: ClientRequestSummary) {
  return request.title.trim().toLocaleUpperCase('ru-RU').startsWith('FBS')
    || request.comment?.toLocaleLowerCase('ru-RU').includes('создано из fbs-заказов:') === true;
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
  const boxes = (state.data?.boxes ?? []).filter((box) => {
    if (!normalizedSearch) return true;
    return [
      box.boxCode,
      ...box.orderIds,
      ...box.items.flatMap((item) => [item.productName, item.article ?? '', ...item.barcodes]),
    ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
  });

  return (
    <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Поиск коробов для FBS-заявки">
      <section className="online-execution-modal__panel fbs-box-search-modal">
        <header className="online-execution-modal__header">
          <div>
            <span>Совпадающие короба FBS</span>
            <h3>№{String(state.request.number).padStart(6, '0')} · {state.request.title}</h3>
            <small>{state.request.client.name} · показаны только короба, общие для нескольких заказов</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="online-execution-modal__body fbs-box-search-modal__body">
          {state.status === 'loading' ? (
            <p className="panel-message"><RefreshCw size={18} aria-hidden="true" /> Ищу остатки по коробам.</p>
          ) : state.data ? (
            <>
              <div className="fbs-box-search-modal__summary">
                <span><small>Заказов в заявке</small><strong>{state.data.summary.orders}</strong></span>
                <span><small>Совпадающих коробов</small><strong>{state.data.summary.boxes}</strong></span>
                <span><small>Подтверждено ТСД</small><strong>{state.data.summary.confirmedOrders}</strong></span>
              </div>

              <label className="fbs-box-search-modal__search">
                <Search size={17} aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Номер короба, заказа, ШК или товар"
                  autoFocus
                />
                {search ? (
                  <button type="button" onClick={() => setSearch('')} title="Очистить поиск" aria-label="Очистить поиск">
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              {boxes.length ? (
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
                  {state.data.boxes.length ? 'По этому запросу короб не найден.' : 'Общих коробов для нескольких заказов этой заявки нет.'}
                </p>
              )}

              {state.data.unmatchedOrderIds.length ? (
                <p className="form-error fbs-box-search-modal__unmatched">
                  Не найдены в активных коробах заказы №{state.data.unmatchedOrderIds.join(', №')}.
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
            {state.data?.boxes.length ? (
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
  onClose,
}: {
  state: ManualCloseState;
  onChange: (patch: Partial<Pick<ManualCloseState, 'boxes' | 'pallets' | 'packedUnits' | 'comment'>>) => void;
  onSubmit: (allowOverweightPackages?: boolean) => void;
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
    <details className={`box-overlap-panel ${hasOverlaps ? 'has-conflicts' : 'is-clear'}`} open={hasOverlaps}>
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
                      <strong>{request.title}</strong>
                      <span>{requestStatusLabel(request.status)}</span>
                      <small>{request.destinationCity || 'Город не указан'} · {request.id.slice(0, 8)}</small>
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
  onMoveOrder?: (order: { id: string; connectionId: string }) => void;
  onMoveOrders?: (orders: Array<{ id: string; connectionId: string }>) => void;
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
  onMoveOrder,
  onMoveOrders,
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
  const searchBoxes = normalizeOnlineBoxes(plan?.searchBoxes ?? plan?.boxesToSearch ?? []);
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
  const notCollected = fbsAssembly?.notCollected ?? null;
  const returnRequired = fbsAssembly?.returnRequired ?? null;
  const normalizedFbsAssemblySearch = fbsAssemblySearch.trim().toLocaleLowerCase('ru-RU');
  const filteredFbsAssemblyRows = (fbsAssembly?.rows ?? []).filter((row) =>
    !normalizedFbsAssemblySearch ||
    [
      row.sourceBoxCode,
      row.orderId,
      row.productBarcode,
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
                    <div className="online-execution-table-wrap online-execution-table-wrap--sync-conflict">
                      <table className="online-execution-table online-execution-table--sync-conflict">
                        <thead>
                          <tr>
                            <th>Заказ</th>
                            <th>Товар</th>
                            <th>Короб</th>
                            <th>КИЗ</th>
                            <th>Что изменилось</th>
                          </tr>
                        </thead>
                        <tbody>
                          {returnRequired.rows.map((row) => (
                            <tr key={row.id}>
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
                                      ? row.availableBoxes.map((box) => `${box.boxCode} — ${box.quantity} шт.`).join(', ')
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
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFbsAssemblyRows.map((row) => (
                            <tr key={row.id}>
                              <td><strong>{row.sourceBoxCode ?? 'ещё не выбран'}</strong></td>
                              <td>
                                <strong>№{row.orderId}</strong>
                                <span>{row.productName}{row.article ? ` · арт. ${row.article}` : ''}</span>
                              </td>
                              <td>{row.productBarcode ?? 'ещё не пропикан'}</td>
                              <td><strong>{row.size ?? 'не указан'}</strong></td>
                              <td>
                                <strong className="online-execution-wb-digits">{row.wbStickerPartB ?? '—'}</strong>
                                <span>{row.wbStickerBarcode ? `полный ШК: ${row.wbStickerBarcode}` : 'появится после получения наклейки WB'}</span>
                              </td>
                              <td>
                                <span
                                  className={`online-execution-pill ${
                                    row.status === 'COMPLETED'
                                      ? 'is-done'
                                      : row.status === 'RETURN_REQUIRED'
                                        ? 'is-danger'
                                        : 'is-open'
                                  }`}
                                >
                                  {row.statusLabel}
                                </span>
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

function renderRequests(
  state: LoadState<ClientRequestSummary>,
  canChangeStatus: boolean,
  canPickOutbound: boolean,
  canCancelRequests: boolean,
  canEditAnyRequest: boolean,
  canRefreshPickInstruction: boolean,
  canUploadManualInstruction: boolean,
  refreshingInstructionId: string | null,
  onStatusChange: (requestId: string, status: ClientRequestStatus) => void,
  onCancelRequest: (request: ClientRequestSummary) => void,
  onEditRequest: (request: ClientRequestSummary) => void,
  onOpenDocument: (request: ClientRequestSummary) => void,
  onDownloadRequestItems: (request: ClientRequestSummary) => void,
  onDownloadOriginalFile: ((request: ClientRequestSummary, file: ClientRequestFileSummary) => void) | undefined,
  onOpenOnlineExecution: ((request: ClientRequestSummary) => void) | undefined,
  onSelectManualBoxes: ((request: ClientRequestSummary) => void) | undefined,
  onOpenFbsBoxSearch: ((request: ClientRequestSummary) => void) | undefined,
  onOpenPickInstruction: (request: ClientRequestSummary) => void,
  onRefreshPickInstruction: (request: ClientRequestSummary) => void,
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
        canChangeStatus={canChangeStatus}
        canPickOutbound={canPickOutbound}
        canCancelRequests={canCancelRequests}
        canEditAnyRequest={canEditAnyRequest}
        canRefreshPickInstruction={canRefreshPickInstruction}
        refreshingInstructionId={refreshingInstructionId}
        onStatusChange={onStatusChange}
        onCancelRequest={onCancelRequest}
        onEditRequest={onEditRequest}
        onOpenDocument={onOpenDocument}
        onDownloadRequestItems={onDownloadRequestItems}
        onDownloadOriginalFile={onDownloadOriginalFile}
        onOpenOnlineExecution={onOpenOnlineExecution}
        onSelectManualBoxes={onSelectManualBoxes}
        onOpenFbsBoxSearch={onOpenFbsBoxSearch}
        onOpenPickInstruction={onOpenPickInstruction}
        onRefreshPickInstruction={onRefreshPickInstruction}
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
  }>,
) {
  return values
    .map((box) => ({
      boxCode: (box.boxCode ?? box.code ?? '').trim(),
      found: Boolean(box.found),
      isFound: Boolean(box.isFound),
      servesMultipleCities: Boolean(box.servesMultipleCities),
      multiCityLabel: box.multiCityLabel?.trim() ?? '',
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

// FIX: распознаём только точную весовую блокировку, не остальные ошибки короба.
function isOverweightPackageError(message: string) {
  const normalized = message.toLocaleLowerCase('ru-RU');
  return normalized.includes('вес короба') && normalized.includes('превышает 25 кг');
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
