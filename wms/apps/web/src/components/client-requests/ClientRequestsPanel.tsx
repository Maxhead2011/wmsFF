import { ClipboardList, RefreshCw } from 'lucide-react';
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
  type ClientRequestDocument,
  type ClientRequestStatus,
  type ClientRequestSummary,
  type ClientSummary,
  type PickInstructionDocument,
} from '../../lib/api';
import { ClientRequestCreateForm } from './ClientRequestCreateForm';
import { ClientRequestDocumentPreview } from './ClientRequestDocumentPreview';
import { ClientRequestXlsxImportForm } from './ClientRequestXlsxImportForm';
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

  async function changeStatus(requestId: string, status: ClientRequestStatus) {
    setError(null);
    setNotice(null);

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
          ? `Счет по заявке "${request.title}" выставлен: ${invoiceNumbers}.`
          : `Счет по заявке "${request.title}" выставлен.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIssuingInvoiceRequestId('');
    }
  }

  function acceptCreated(request: ClientRequestSummary) {
    setRequests((current) => ({
      status: 'ready',
      data: [request, ...current.data],
    }));
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
          (requestId, status) => void changeStatus(requestId, status),
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
  onStatusChange: (requestId: string, status: ClientRequestStatus) => void,
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
        issuingInvoiceRequestId={issuingInvoiceRequestId}
        onStatusChange={onStatusChange}
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

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
