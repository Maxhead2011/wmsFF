import { ClipboardList, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  cancelClientRequest,
  downloadPickInstructionXlsx,
  fetchClientRequestDocument,
  fetchClientRequests,
  fetchClients,
  fetchPickInstruction,
  issueClientRequestInvoice,
  packageClientRequest,
  pickClientRequest,
  shipClientRequest,
  updateClientRequestStatus,
  type AuthSession,
  type AuthUser,
  type BillingInvoiceSummary,
  type ClientRequestDocument,
  type ClientRequestStatus,
  type ClientRequestSummary,
  type ClientSummary,
  type PickInstructionDocument,
} from '../../lib/api';
import { ClientRequestCreateForm } from './ClientRequestCreateForm';
import { ClientRequestDocumentPreview } from './ClientRequestDocumentPreview';
import { ClientRequestEditForm } from './ClientRequestEditForm';
import { ClientRequestXlsxImportForm } from './ClientRequestXlsxImportForm';
import { ManualShipmentCloseModal, type ManualShipmentClosePayload } from './ManualShipmentCloseModal';
import '../billing/billing.css';
import { BillingInvoiceForm } from '../billing/BillingInvoiceForm';
import './client-requests.css';
import { ClientRequestsTable } from './ClientRequestsTable';
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type ClientRequestsPanelProps = {
  session: AuthSession;
};

export function ClientRequestsPanel({ session }: ClientRequestsPanelProps) {
  const canRead = canUse(session.user, 'client-requests:read');
  const canWrite = canUse(session.user, 'client-requests:write');
  const canChangeStatus = canUse(session.user, 'client-requests:status');
  const canPickOutbound = canUse(session.user, 'stock:write');
  const [requests, setRequests] = useState<LoadState<ClientRequestSummary>>({ status: 'idle', data: [] });
  const [clients, setClients] = useState<LoadState<ClientSummary>>({ status: 'idle', data: [] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuingInvoiceRequestId, setIssuingInvoiceRequestId] = useState('');
  const [manualInvoiceRequest, setManualInvoiceRequest] = useState<ClientRequestSummary | null>(null);
  const [editingRequest, setEditingRequest] = useState<ClientRequestSummary | null>(null);
  const [manualShipmentRequest, setManualShipmentRequest] = useState<ClientRequestSummary | null>(null);
  const [manualShipmentError, setManualShipmentError] = useState<string | null>(null);
  const [isManualShipmentSubmitting, setManualShipmentSubmitting] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<ClientRequestDocument | null>(null);
  const [pickInstructionPreview, setPickInstructionPreview] = useState<PickInstructionDocument | null>(null);

  const visibleClients = useMemo(() => clients.data, [clients.data]);

  useEffect(() => {
    if (canRead) {
      void loadData();
    }
  }, [canRead]);

  if (!canRead) {
    return null;
  }

  async function loadData() {
    setError(null);
    setNotice(null);
    setRequests((current) => ({ ...current, status: 'loading', error: undefined }));
    setClients((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const [nextRequests, nextClients] = await Promise.all([
        fetchClientRequests(session.accessToken),
        fetchClients(session.accessToken),
      ]);
      setRequests({ status: 'ready', data: nextRequests });
      setClients({ status: 'ready', data: nextClients });
    } catch (caught) {
      const message = errorMessage(caught);
      setRequests((current) => ({ ...current, status: 'error', error: message }));
      setClients((current) => ({ ...current, status: 'error', error: message }));
    }
  }

  async function changeStatus(request: ClientRequestSummary, status: ClientRequestStatus) {
    setError(null);
    setNotice(null);
    setManualShipmentError(null);

    if (request.status === status) {
      return;
    }

    if (request.type === 'OUTBOUND' && status === 'DONE') {
      if (request.status === 'PACKED') {
        await shipOutboundRequest(request);
      } else {
        setManualShipmentRequest(request);
      }
      return;
    }

    try {
      const updated = await updateClientRequestStatus(session.accessToken, request.id, { status });
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
    setNotice(null);

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
    setNotice(null);

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
    setNotice(null);

    try {
      setDocumentPreview(await fetchClientRequestDocument(session.accessToken, request.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openPickInstruction(request: ClientRequestSummary) {
    setError(null);
    setNotice(null);

    try {
      setPickInstructionPreview(await fetchPickInstruction(session.accessToken, request.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadPickInstruction(request: ClientRequestSummary) {
    setError(null);
    setNotice(null);

    try {
      const blob = await downloadPickInstructionXlsx(session.accessToken, request.id);
      downloadBlob(blob, `pick-instruction-${safeDownloadName(request.title)}-${request.id.slice(0, 8)}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function packageOutboundRequest(request: ClientRequestSummary) {
    setError(null);
    setNotice(null);

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
    setNotice(null);

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

  async function issueInvoiceForRequest(request: ClientRequestSummary) {
    setError(null);
    setNotice(null);
    setIssuingInvoiceRequestId(request.id);

    try {
      const result = await issueClientRequestInvoice(session.accessToken, request.id);
      const invoiceNumbers = result.invoices.map((invoice) => `№ ${invoice.number}`).join(', ');
      setNotice(
        invoiceNumbers
          ? `Черновик счета по заявке "${request.title}" создан на согласование: ${invoiceNumbers}.`
          : `Черновик счета по заявке "${request.title}" создан на согласование.`,
      );
    } catch (caught) {
      const message = errorMessage(caught);
      if (shouldOpenManualInvoice(message)) {
        setManualInvoiceRequest(request);
        setNotice(`По заявке "${request.title}" нет автоматических начислений. Заполните счет вручную.`);
      } else {
        setError(message);
      }
    } finally {
      setIssuingInvoiceRequestId('');
    }
  }

  async function closeShipmentManually(payload: ManualShipmentClosePayload) {
    if (!manualShipmentRequest) {
      return;
    }

    setManualShipmentSubmitting(true);
    setManualShipmentError(null);
    setError(null);
    setNotice(null);

    try {
      const updated = await closeShipmentByCurrentStage(manualShipmentRequest, payload);
      setRequests((current) => ({
        ...current,
        data: current.data.map((request) => (request.id === updated.id ? updated : request)),
      }));
      setManualShipmentRequest(null);
      setNotice(`Заявка "${updated.title}" сдана. Остатки списаны, упаковочные места зафиксированы.`);
    } catch (caught) {
      setManualShipmentError(errorMessage(caught));
    } finally {
      setManualShipmentSubmitting(false);
    }
  }

  async function closeShipmentByCurrentStage(request: ClientRequestSummary, payload: ManualShipmentClosePayload) {
    if (request.status === 'IN_WORK') {
      const packed = await packageClientRequest(session.accessToken, {
        requestId: request.id,
        idempotencyKey: `manual-close-pack:${request.id}`,
        comment: payload.managerComment,
        packages: payload.packages,
      });
      await shipClientRequest(session.accessToken, {
        requestId: request.id,
        idempotencyKey: `manual-close-ship:${request.id}`,
        comment: payload.managerComment,
      });

      return {
        ...request,
        status: 'DONE' as ClientRequestStatus,
        managerComment: payload.managerComment,
        packages: packed.packages ?? request.packages,
      };
    }

    if (request.status === 'PACKED') {
      await shipClientRequest(session.accessToken, {
        requestId: request.id,
        idempotencyKey: `manual-close-ship:${request.id}`,
        comment: payload.managerComment,
      });

      return {
        ...request,
        status: 'DONE' as ClientRequestStatus,
        managerComment: payload.managerComment,
      };
    }

    return updateClientRequestStatus(session.accessToken, request.id, {
      status: 'DONE',
      managerComment: payload.managerComment,
      boxes: payload.boxes,
      pallets: payload.pallets,
      packedUnits: payload.packedUnits,
      packages: payload.packages,
    });
  }

  function acceptManualInvoice(invoice: BillingInvoiceSummary) {
    setManualInvoiceRequest(null);
    setNotice(`Черновик счета № ${invoice.number} сохранен. Он станет образцом для следующих похожих заявок клиента.`);
  }

  function acceptCreated(request: ClientRequestSummary) {
    setRequests((current) => ({
      status: 'ready',
      data: [request, ...current.data],
    }));
  }

  function acceptUpdated(request: ClientRequestSummary) {
    setEditingRequest(null);
    setRequests((current) => ({
      ...current,
      status: 'ready',
      data: current.data.map((item) => (item.id === request.id ? request : item)),
    }));
    setNotice(`Заявка "${request.title}" обновлена.`);
  }

  return (
    <section className="client-requests-panel" aria-label="Клиентские заявки">
      <div className="section-heading client-requests-panel__heading">
        <div>
          <p className="eyebrow">Клиентские заявки</p>
          <h2>Клиентские заявки</h2>
        </div>
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

      {canWrite && clients.status === 'ready' ? (
        <>
          <ClientRequestXlsxImportForm clients={visibleClients} session={session} onCreated={acceptCreated} />
          <ClientRequestCreateForm clients={visibleClients} session={session} onCreated={acceptCreated} />
        </>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="inline-status">{notice}</p> : null}

      <div className="client-requests-panel__list">
        {renderRequests(
          requests,
          canChangeStatus,
          canPickOutbound,
          canUse(session.user, 'billing:write'),
          canWrite,
          issuingInvoiceRequestId,
          (request, status) => void changeStatus(request, status),
          (request) => setEditingRequest(request),
          (request) => void cancelRequest(request),
          (request) => void openRequestDocument(request),
          (request) => void openPickInstruction(request),
          (request) => void downloadPickInstruction(request),
          (request) => void pickOutboundRequest(request),
          (request) => void packageOutboundRequest(request),
          (request) => void shipOutboundRequest(request),
          (request) => void issueInvoiceForRequest(request),
        )}
      </div>

      {documentPreview ? (
        <ClientRequestDocumentPreview document={documentPreview} onClose={() => setDocumentPreview(null)} />
      ) : null}

      {pickInstructionPreview ? (
        <HtmlDocumentPreview
          title={pickInstructionPreview.title}
          fileName={pickInstructionPreview.fileName}
          html={pickInstructionPreview.html}
          onClose={() => setPickInstructionPreview(null)}
        />
      ) : null}

      {manualInvoiceRequest ? (
        <div className="client-request-invoice-modal" role="dialog" aria-modal="true" aria-label="Ручной счет по заявке">
          <div className="client-request-invoice-modal__content">
            <div className="client-request-invoice-modal__head">
              <div>
                <p className="eyebrow">Ручное заполнение счета</p>
                <h3>{manualInvoiceRequest.title}</h3>
                <span>
                  {manualInvoiceRequest.client.name}
                  {manualInvoiceRequest.destinationCity ? ` · ${manualInvoiceRequest.destinationCity}` : ''}
                </span>
              </div>
              <button className="icon-button" type="button" onClick={() => setManualInvoiceRequest(null)} aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <BillingInvoiceForm
              clients={visibleClients}
              session={session}
              initialClientId={manualInvoiceRequest.clientId}
              initialMode="manual"
              initialPeriodFrom={dateInput(manualInvoiceRequest.createdAt)}
              initialPeriodTo={dateInput(manualInvoiceRequest.updatedAt)}
              initialComment={`Счет по заявке ${manualInvoiceRequest.title}`}
              initialQuantitiesByServiceCode={requestBillingQuantities(manualInvoiceRequest)}
              requestId={manualInvoiceRequest.id}
              lockClient
              lockMode
              submitButtonLabel="Сохранить черновик счета"
              onCreated={acceptManualInvoice}
            />
          </div>
        </div>
      ) : null}

      {editingRequest ? (
        <div className="client-request-edit-modal" role="dialog" aria-modal="true" aria-label="Редактирование заявки">
          <div className="client-request-edit-modal__content">
            <ClientRequestEditForm
              request={editingRequest}
              session={session}
              onCancel={() => setEditingRequest(null)}
              onUpdated={acceptUpdated}
            />
          </div>
        </div>
      ) : null}

      {manualShipmentRequest ? (
        <ManualShipmentCloseModal
          request={manualShipmentRequest}
          isSubmitting={isManualShipmentSubmitting}
          error={manualShipmentError}
          onClose={() => {
            if (!isManualShipmentSubmitting) {
              setManualShipmentRequest(null);
              setManualShipmentError(null);
            }
          }}
          onSubmit={(payload) => void closeShipmentManually(payload)}
        />
      ) : null}
    </section>
  );
}

function renderRequests(
  state: LoadState<ClientRequestSummary>,
  canChangeStatus: boolean,
  canPickOutbound: boolean,
  canIssueInvoice: boolean,
  canCancelRequests: boolean,
  issuingInvoiceRequestId: string,
  onStatusChange: (request: ClientRequestSummary, status: ClientRequestStatus) => void,
  onEditRequest: (request: ClientRequestSummary) => void,
  onCancelRequest: (request: ClientRequestSummary) => void,
  onOpenDocument: (request: ClientRequestSummary) => void,
  onOpenPickInstruction: (request: ClientRequestSummary) => void,
  onDownloadPickInstruction: (request: ClientRequestSummary) => void,
  onPickOutbound: (request: ClientRequestSummary) => void,
  onPackageOutbound: (request: ClientRequestSummary) => void,
  onShipOutbound: (request: ClientRequestSummary) => void,
  onIssueInvoice: (request: ClientRequestSummary) => void,
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
        canIssueInvoice={canIssueInvoice}
        canCancelRequests={canCancelRequests}
        canEditRequests={canCancelRequests}
        issuingInvoiceRequestId={issuingInvoiceRequestId}
        onStatusChange={onStatusChange}
        onEditRequest={onEditRequest}
        onCancelRequest={onCancelRequest}
        onOpenDocument={onOpenDocument}
        onOpenPickInstruction={onOpenPickInstruction}
        onDownloadPickInstruction={onDownloadPickInstruction}
        onPickOutbound={onPickOutbound}
        onPackageOutbound={onPackageOutbound}
        onShipOutbound={onShipOutbound}
        onIssueInvoice={onIssueInvoice}
      />
    </>
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
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

function requestBillingQuantities(request: ClientRequestSummary) {
  const counts = request.packages.reduce(
    (result, packagePlace) => {
      if (isPalletPackage(packagePlace.packageType)) {
        result.pallets += 1;
      } else {
        result.boxes += 1;
      }
      return result;
    },
    { boxes: 0, pallets: 0 },
  );

  return {
    BOX_60_40_40: counts.boxes,
    BOX_ASSEMBLY: counts.boxes,
    PALLET: counts.pallets,
    PALLET_ASSEMBLY: counts.pallets,
  };
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function dateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function shouldOpenManualInvoice(message: string) {
  const normalized = message.toLocaleLowerCase('ru-RU');
  return normalized.includes('нет счетов') || normalized.includes('начислен');
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
