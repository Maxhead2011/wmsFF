import {
  CheckCircle2,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  FileText,
  PackageCheck,
  Pencil,
  ReceiptText,
  Send,
  Truck,
  XCircle,
} from 'lucide-react';
import { type ClientRequestStatus, type ClientRequestSummary } from '../../lib/api';
import {
  requestPriorityLabel,
  requestStatusLabel,
  requestStatusOptions,
  requestStatusTone,
  requestTypeLabel,
} from './clientRequestMeta';
import { canEditClientRequest } from './ClientRequestEditForm';

type ClientRequestsTableProps = {
  items: ClientRequestSummary[];
  canChangeStatus: boolean;
  canPickOutbound: boolean;
  canIssueInvoice: boolean;
  canCancelRequests: boolean;
  canEditRequests: boolean;
  canDownloadSourceFiles: boolean;
  issuingInvoiceRequestId: string;
  onStatusChange: (request: ClientRequestSummary, status: ClientRequestStatus) => void;
  onEditRequest: (request: ClientRequestSummary) => void;
  onCancelRequest: (request: ClientRequestSummary) => void;
  onOpenDocument?: (request: ClientRequestSummary) => void;
  onOpenPickInstruction?: (request: ClientRequestSummary) => void;
  onDownloadPickInstruction?: (request: ClientRequestSummary) => void;
  onDownloadSourceRequest?: (request: ClientRequestSummary) => void;
  onDownloadWbProducts?: (request: ClientRequestSummary) => void;
  onDownloadWbPackages?: (request: ClientRequestSummary) => void;
  onPickOutbound: (request: ClientRequestSummary) => void;
  onPackageOutbound: (request: ClientRequestSummary) => void;
  onShipOutbound: (request: ClientRequestSummary) => void;
  onIssueInvoice: (request: ClientRequestSummary) => void;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function ClientRequestsTable({
  items,
  canChangeStatus,
  canPickOutbound,
  canIssueInvoice,
  canCancelRequests,
  canEditRequests,
  canDownloadSourceFiles,
  issuingInvoiceRequestId,
  onStatusChange,
  onEditRequest,
  onCancelRequest,
  onOpenDocument,
  onOpenPickInstruction,
  onDownloadPickInstruction,
  onDownloadSourceRequest,
  onDownloadWbProducts,
  onDownloadWbPackages,
  onPickOutbound,
  onPackageOutbound,
  onShipOutbound,
  onIssueInvoice,
}: ClientRequestsTableProps) {
  const showOperationActions = canPickOutbound || canIssueInvoice || canDownloadSourceFiles;

  return (
    <div className="client-request-table-wrap">
      <table className="data-table client-request-table">
        <thead>
          <tr>
            <th>Заявка</th>
            <th>Клиент</th>
            <th>Состав</th>
            <th>Срок</th>
            <th>Статус</th>
            {showOperationActions ? <th>Операции</th> : null}
            {canCancelRequests ? <th>Действия</th> : null}
            {canChangeStatus ? <th>Процесс</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((request) => (
            <tr key={request.id}>
              <td>
                <strong>{request.title}</strong>
                <span>
                  {requestTypeLabel(request.type)} · {requestPriorityLabel(request.priority)}
                </span>
                <span>Город: {request.destinationCity ?? '-'}</span>
                {request.comment ? <span>{request.comment}</span> : null}
              </td>
              <td>
                <strong>{request.client.code}</strong>
                <span>{request.client.name}</span>
              </td>
              <td>
                <span>{itemsSummary(request)}</span>
                {request.packages.length ? (
                  <span className="request-package-summary">{packagesSummary(request)}</span>
                ) : null}
                {onOpenDocument ? (
                  <button
                    className="document-open-button"
                    type="button"
                    onClick={() => onOpenDocument(request)}
                    title="Открыть состав заявки"
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>Состав</span>
                  </button>
                ) : null}
              </td>
              <td>{formatDate(request.desiredDate)}</td>
              <td>
                <span className={`status status--${requestStatusTone(request.status)}`}>
                  {requestStatusLabel(request.status)}
                </span>
                {request.managerComment ? <span>{request.managerComment}</span> : null}
              </td>
              {showOperationActions ? (
                <td>
                  {canShowOperationActions(request, canPickOutbound, canIssueInvoice, canDownloadSourceFiles) ? (
                    <div className="client-request-actions">
                      {canDownloadSourceFiles && onDownloadSourceRequest && request.files.length > 0 ? (
                        <button
                          className="client-request-action-button client-request-action-button--xlsx"
                          type="button"
                          onClick={() => onDownloadSourceRequest(request)}
                          title="Скачать залитую клиентом заявку"
                        >
                          <FileDown size={15} aria-hidden="true" />
                          <span>Заявка Excel</span>
                        </button>
                      ) : null}
                      {canPickOutbound && onOpenPickInstruction && request.type === 'OUTBOUND' ? (
                        <button
                          className="client-request-action-button client-request-action-button--instruction"
                          type="button"
                          onClick={() => onOpenPickInstruction(request)}
                          title="Открыть складскую инструкцию"
                        >
                          <ClipboardList size={15} aria-hidden="true" />
                          <span>Инструкция</span>
                        </button>
                      ) : null}
                      {canPickOutbound && onDownloadPickInstruction && request.type === 'OUTBOUND' ? (
                        <button
                          className="client-request-action-button client-request-action-button--xlsx"
                          type="button"
                          onClick={() => onDownloadPickInstruction(request)}
                          title="Скачать Excel-инструкцию сборки"
                        >
                          <FileDown size={15} aria-hidden="true" />
                          <span>Инструкция Excel</span>
                        </button>
                      ) : null}
                      {canPickOutbound && canDownloadMarketplaceTemplates(request) ? (
                        <>
                          <button
                            className="client-request-action-button client-request-action-button--xlsx"
                            type="button"
                            onClick={() => onDownloadWbProducts?.(request)}
                            title="Скачать шаблон товаров WB"
                          >
                            <FileSpreadsheet size={15} aria-hidden="true" />
                            <span>ВБ товары</span>
                          </button>
                          <button
                            className="client-request-action-button client-request-action-button--xlsx"
                            type="button"
                            onClick={() => onDownloadWbPackages?.(request)}
                            title="Скачать шаблон упаковки WB"
                          >
                            <FileSpreadsheet size={15} aria-hidden="true" />
                            <span>ВБ упаковка</span>
                          </button>
                        </>
                      ) : null}
                      {canPickOutbound && canPickRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--pick"
                          type="button"
                          onClick={() => onPickOutbound(request)}
                          title="Собрать заявку"
                        >
                          <PackageCheck size={15} aria-hidden="true" />
                          <span>Собрать</span>
                        </button>
                      ) : null}
                      {canPickOutbound && canPackageRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--pack"
                          type="button"
                          onClick={() => onPackageOutbound(request)}
                          title="Упаковать заявку"
                        >
                          <Send size={15} aria-hidden="true" />
                          <span>Упаковать</span>
                        </button>
                      ) : null}
                      {canPickOutbound && canShipRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--ship"
                          type="button"
                          onClick={() => onShipOutbound(request)}
                          title="Закрыть отгрузку"
                        >
                          <Truck size={15} aria-hidden="true" />
                          <span>Отгрузить</span>
                        </button>
                      ) : null}
                      {canIssueInvoice && canIssueRequestInvoice(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--invoice"
                          disabled={issuingInvoiceRequestId === request.id}
                          type="button"
                          onClick={() => onIssueInvoice(request)}
                          title="Выставить счет по сданной заявке"
                        >
                          <ReceiptText size={15} aria-hidden="true" />
                          <span>{issuingInvoiceRequestId === request.id ? 'Выставляю' : 'Выставить счет'}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
              {canCancelRequests ? (
                <td>
                  {canEditRequests && canEditClientRequest(request) ? (
                    <button
                      className="client-request-action-button client-request-action-button--edit"
                      type="button"
                      onClick={() => onEditRequest(request)}
                      title="Редактировать заявку до начала работы"
                    >
                      <Pencil size={15} aria-hidden="true" />
                      <span>Редактировать</span>
                    </button>
                  ) : null}
                  {canCancelRequest(request) ? (
                    <button
                      className="client-request-action-button client-request-action-button--cancel"
                      type="button"
                      onClick={() => onCancelRequest(request)}
                      title="Отменить заявку"
                    >
                      <XCircle size={15} aria-hidden="true" />
                      <span>Отменить</span>
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
              {canChangeStatus ? (
                <td>
                  <label className="client-request-status-select">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    <select
                      value={request.status}
                      onChange={(event) => onStatusChange(request, event.target.value as ClientRequestStatus)}
                    >
                      {requestStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function canPickRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}

function canPackageRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && request.status === 'IN_WORK';
}

function canShipRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && request.status === 'PACKED';
}

function canDownloadMarketplaceTemplates(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && ['PACKED', 'DONE'].includes(request.status) && request.packages.length > 0;
}

function canRunFulfillment(request: ClientRequestSummary) {
  return canPickRequest(request) || canPackageRequest(request) || canShipRequest(request);
}

function canShowWarehouseActions(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' || canRunFulfillment(request);
}

function canShowOperationActions(
  request: ClientRequestSummary,
  canPickOutbound: boolean,
  canIssueInvoice: boolean,
  canDownloadSourceFiles: boolean,
) {
  return (
    (canDownloadSourceFiles && request.files.length > 0) ||
    (canPickOutbound && canShowWarehouseActions(request)) ||
    (canIssueInvoice && canIssueRequestInvoice(request))
  );
}

function canIssueRequestInvoice(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && request.status === 'DONE';
}

function canCancelRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}

function itemsSummary(request: ClientRequestSummary) {
  if (request.items.length === 0) {
    return '-';
  }

  return request.items
    .map((item) => {
      const itemName = item.sku?.internalSku ?? item.name ?? item.barcode ?? 'позиция';
      return `${itemName} x ${item.quantity}`;
    })
    .join(', ');
}

function packagesSummary(request: ClientRequestSummary) {
  const totalQuantity = request.packages.reduce(
    (sum, packagePlace) => sum + packagePlace.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
    0,
  );
  const codes = request.packages.map((packagePlace) => packagePlace.packageCode).join(', ');
  return `Места: ${codes} · ${totalQuantity} шт.`;
}

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return dateFormatter.format(new Date(value));
}
