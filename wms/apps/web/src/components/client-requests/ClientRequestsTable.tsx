import { Activity, AlertTriangle, Boxes, CheckCircle2, ClipboardList, Edit3, FileDown, FileSpreadsheet, FileText, FileUp, MapPinned, PackageCheck, RefreshCw, Search, Send, ShieldCheck, Truck, Undo2, XCircle } from 'lucide-react';
import {
  type ClientRequestFileSummary,
  type ClientRequestStatus,
  type ClientRequestSummary,
} from '../../lib/api';
import {
  requestPriorityLabel,
  requestStatusLabel,
  requestStatusOptions,
  requestStatusTone,
  requestTypeLabel,
} from './clientRequestMeta';
import { isSkuCollectionRequest } from './skuCollectionRow';

type ClientRequestsTableProps = {
  items: ClientRequestSummary[];
  selectableRequestIds?: Set<string>;
  selectedRequestIds?: Set<string>;
  onRequestSelectionChange?: (requestIds: Set<string>) => void;
  canChangeStatus: boolean;
  canPickOutbound: boolean;
  canCancelRequests: boolean;
  canEditAnyRequest: boolean;
  canRefreshPickInstruction: boolean;
  refreshingInstructionId?: string | null;
  syncingTsdRequestId?: string | null;
  checkingSupplyRequestId?: string | null;
  routeLoadingRequestId?: string | null;
  onStatusChange: (requestId: string, status: ClientRequestStatus) => void;
  onCancelRequest: (request: ClientRequestSummary) => void;
  onEditRequest: (request: ClientRequestSummary) => void;
  onOpenDocument?: (request: ClientRequestSummary) => void;
  onDownloadRequestItems?: (request: ClientRequestSummary) => void;
  onDownloadOriginalFile?: (request: ClientRequestSummary, file: ClientRequestFileSummary) => void;
  onOpenOnlineExecution?: (request: ClientRequestSummary) => void;
  onOpenFbsOrders?: (request: ClientRequestSummary) => void;
  onOpenFbsRoute?: (request: ClientRequestSummary) => void;
  onSelectManualBoxes?: (request: ClientRequestSummary) => void;
  onOpenFbsBoxSearch?: (request: ClientRequestSummary) => void;
  onOpenPickInstruction?: (request: ClientRequestSummary) => void;
  onRefreshPickInstruction?: (request: ClientRequestSummary) => void;
  onSyncTsd?: (request: ClientRequestSummary) => void;
  onCheckSupplyConsistency?: (request: ClientRequestSummary) => void;
  onDownloadPickInstruction?: (request: ClientRequestSummary) => void;
  onDownloadWbProducts?: (request: ClientRequestSummary) => void;
  onDownloadWbPackages?: (request: ClientRequestSummary) => void;
  onUploadManualInstruction?: (request: ClientRequestSummary) => void;
  onEmergencyPackedXlsx?: (request: ClientRequestSummary) => void;
  onRollbackEmergencyClose?: (request: ClientRequestSummary) => void;
  onPickOutbound: (request: ClientRequestSummary) => void;
  onPackageOutbound: (request: ClientRequestSummary) => void;
  onShipOutbound: (request: ClientRequestSummary) => void;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const createdAtFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function ClientRequestsTable({
  items,
  selectableRequestIds = new Set<string>(),
  selectedRequestIds = new Set<string>(),
  onRequestSelectionChange,
  canChangeStatus,
  canPickOutbound,
  canCancelRequests,
  canEditAnyRequest,
  canRefreshPickInstruction,
  refreshingInstructionId,
  syncingTsdRequestId,
  checkingSupplyRequestId,
  routeLoadingRequestId,
  onStatusChange,
  onCancelRequest,
  onEditRequest,
  onOpenDocument,
  onDownloadRequestItems,
  onDownloadOriginalFile,
  onOpenOnlineExecution,
  onOpenFbsOrders,
  onOpenFbsRoute,
  onSelectManualBoxes,
  onOpenFbsBoxSearch,
  onOpenPickInstruction,
  onRefreshPickInstruction,
  onSyncTsd,
  onCheckSupplyConsistency,
  onDownloadPickInstruction,
  onDownloadWbProducts,
  onDownloadWbPackages,
  onUploadManualInstruction,
  onEmergencyPackedXlsx,
  onRollbackEmergencyClose,
  onPickOutbound,
  onPackageOutbound,
  onShipOutbound,
}: ClientRequestsTableProps) {
  const selectableItems = items.filter((request) =>
    selectableRequestIds.has(request.id),
  );
  const showRequestSelection =
    Boolean(onRequestSelectionChange) && selectableItems.length > 0;
  const allSelectableSelected =
    selectableItems.length > 0 &&
    selectableItems.every((request) => selectedRequestIds.has(request.id));
  function toggleAllSelectable() {
    if (!onRequestSelectionChange) return;
    const next = new Set(selectedRequestIds);
    if (allSelectableSelected) {
      selectableItems.forEach((request) => next.delete(request.id));
    } else {
      selectableItems.forEach((request) => next.add(request.id));
    }
    onRequestSelectionChange(next);
  }

  function toggleRequest(requestId: string) {
    if (!onRequestSelectionChange || !selectableRequestIds.has(requestId)) {
      return;
    }
    const next = new Set(selectedRequestIds);
    if (next.has(requestId)) next.delete(requestId);
    else next.add(requestId);
    onRequestSelectionChange(next);
  }

  return (
    <div className="client-request-table-wrap">
      <table className="data-table client-request-table">
        <thead>
          <tr>
            {showRequestSelection ? (
              <th className="client-request-table__select-heading">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={toggleAllSelectable}
                  aria-label="Выбрать все незавершённые FBS-заявки"
                />
              </th>
            ) : null}
            <th className="client-request-table__request-heading">Заявка</th>
            <th className="client-request-table__client-heading">Клиент</th>
            <th className="client-request-table__composition-heading">Состав</th>
            <th className="client-request-table__due-heading">Срок</th>
            <th className="client-request-table__status-heading">Статус</th>
            {canPickOutbound ? <th className="client-request-table__warehouse-heading">Склад</th> : null}
            {canCancelRequests ? <th className="client-request-table__actions-heading">Действия</th> : null}
            {canChangeStatus ? <th className="client-request-table__process-heading">Процесс</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((request) => {
            const originalFile = findOriginalRequestFile(request);
            const emergencyClosed = isEmergencyClosedRequest(request);
            const formattedRequestNumber = formatRequestNumber(request.number);
            const requestNumberPrefix = formattedRequestNumber.slice(0, -3);
            const requestNumberAccent = formattedRequestNumber.slice(-3);
            const transferOrigin = parseFbsTransferOrigin(request.comment);
            // FIX: distinguish only auto-created WB delivery recovery requests;
            // ordinary emergency operations keep their existing status colour.
            const deliveryRecovery = Boolean(
              request.fbsEmergencyAssemblyAt && request.title.startsWith('FBS ДОВОЗ'),
            );

            return (
            <tr
              key={request.id}
              className={`client-request-row client-request-row--${requestStatusTone(request.status)}${
                deliveryRecovery ? ' client-request-row--fbs-recovery' : ''
              }${isSkuCollectionRequest(request) ? ' client-request-row--sku-collection' : ''}`}
            >
              {showRequestSelection ? (
                <td
                  className="client-request-table__select-cell"
                  data-label="В хвосты"
                >
                  {selectableRequestIds.has(request.id) ? (
                    <input
                      type="checkbox"
                      checked={selectedRequestIds.has(request.id)}
                      onChange={() => toggleRequest(request.id)}
                      aria-label={`Выбрать FBS-заявку №${formatRequestNumber(request.number)}`}
                    />
                  ) : null}
                </td>
              ) : null}
              <td className="client-request-table__request-cell" data-label="Заявка">
                <span className="client-request-number" aria-label={`Заявка №${formattedRequestNumber}`}>
                  <span className="client-request-number__prefix">№{requestNumberPrefix}</span>
                  <strong className="client-request-number__accent">{requestNumberAccent}</strong>
                </span>
                {deliveryRecovery ? (
                  <span className="client-request-fbs-recovery-badge">ДОВОЗ WB</span>
                ) : null}
                {isSkuCollectionRequest(request) ? (
                  <span className="client-request-sku-collection-badge">СБОРКА ПО SKU</span>
                ) : null}
                {/* ADDED: shipped and archived requests share this table, so the WB supply stays visible. */}
                {request.status === 'DONE' && request.wbSupplyIds?.length ? (
                  <span className="client-request-wb-supplies">
                    <span>{request.wbSupplyIds.length === 1 ? 'Поставка WB' : 'Поставки WB'}</span>
                    {request.wbSupplyIds.map((supplyId) => (
                      <strong key={supplyId}>{supplyId}</strong>
                    ))}
                  </span>
                ) : null}
                {transferOrigin ? (
                  <span className="client-request-transfer-origin" title={request.comment ?? undefined}>
                    <strong>Из заявок: {transferOrigin.sourceRequests}</strong>
                    <span>Из поставок: {transferOrigin.sourceSupplies}</span>
                  </span>
                ) : null}
                {onOpenDocument ? (
                  <button
                    className="client-request-title client-request-title--button"
                    type="button"
                    onClick={() => onOpenDocument(request)}
                    title={`Открыть заявку: ${request.title}`}
                    aria-label={`Открыть заявку ${request.title}`}
                  >
                    {request.title}
                  </button>
                ) : (
                  <strong className="client-request-title" title={request.title}>{request.title}</strong>
                )}
                <span className="client-request-list-meta">
                  {requestTypeLabel(request.type)} · {requestPriorityLabel(request.priority)}
                </span>
                <span className="client-request-city">
                  <span>Склад</span>
                  <strong>{request.destinationCity ?? '-'}</strong>
                </span>
                <span className="client-request-list-meta">
                  Создана: {createdAtFormatter.format(new Date(request.createdAt))}
                </span>
                {onOpenFbsOrders && isFbsRequest(request) ? (
                  <button
                    className="client-request-row-fbs-link"
                    type="button"
                    onClick={() => onOpenFbsOrders(request)}
                    title="Открыть FBS-заказы этой заявки"
                  >
                    <Activity size={15} aria-hidden="true" />
                    <span>К заказам FBS</span>
                  </button>
                ) : null}
                {onOpenFbsRoute && isFbsRequest(request) ? (
                  <button
                    className="client-request-row-fbs-link client-request-row-fbs-link--route"
                    type="button"
                    onClick={() => onOpenFbsRoute(request)}
                    disabled={routeLoadingRequestId === request.id}
                    title="Показать живой маршрут: паллетсорты, короба и недоступные позиции"
                  >
                    <MapPinned size={15} aria-hidden="true" />
                    <span>{routeLoadingRequestId === request.id ? 'Открываю маршрут' : 'Маршрут'}</span>
                  </button>
                ) : null}
                {request.comment && !transferOrigin ? (
                  <span className="client-request-list-comment" title={request.comment}>{request.comment}</span>
                ) : null}
              </td>
              <td className="client-request-table__client-cell" data-label="Клиент">
                <strong>{request.client.code}</strong>
                <span>{request.client.name}</span>
              </td>
              <td className="client-request-table__composition-cell" data-label="Состав">
                <span className="client-request-items-count">{itemsCountSummary(request)}</span>
                {request.fbsCompletion ? (
                  <span
                    className={`client-request-fbs-completion ${
                      request.fbsCompletion.completed ? 'client-request-fbs-completion--done' : ''
                    }`}
                  >
                    {request.fbsCompletion.completed
                      ? `Выполнено 100% · ${request.fbsCompletion.completedOrders} из ${request.fbsCompletion.totalOrders} заказов`
                      : `FBS собрано ${request.fbsCompletion.completedOrders} из ${request.fbsCompletion.totalOrders} · ${request.fbsCompletion.percent}%`}
                  </span>
                ) : null}
                <span className="client-request-items-preview">{itemsSummary(request)}</span>
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
                {onDownloadRequestItems ? (
                  <button
                    className="document-open-button document-open-button--source"
                    type="button"
                    onClick={() => onDownloadRequestItems(request)}
                    title="Скачать состав заявки в Excel"
                  >
                    <FileSpreadsheet size={15} aria-hidden="true" />
                    <span>Состав XLSX</span>
                  </button>
                ) : null}
                {onDownloadOriginalFile && originalFile ? (
                  <button
                    className="document-open-button document-open-button--source"
                    type="button"
                    onClick={() => onDownloadOriginalFile(request, originalFile)}
                    title={`Скачать первоначальный файл клиента: ${originalFile.fileName}`}
                  >
                    <FileDown size={15} aria-hidden="true" />
                    <span>Файл клиента</span>
                  </button>
                ) : null}
                {onOpenOnlineExecution && request.type === 'OUTBOUND' ? (
                  <button
                    className="document-open-button document-open-button--online"
                    type="button"
                    onClick={() => onOpenOnlineExecution(request)}
                    title="Онлайн-выполнение заявки"
                  >
                    <Activity size={15} aria-hidden="true" />
                    <span>Онлайн</span>
                  </button>
                ) : null}
              </td>
              <td className="client-request-table__due-cell" data-label="Срок">{formatDate(request.desiredDate)}</td>
              <td className="client-request-table__status-cell" data-label="Статус">
                <span className={`status status--${requestStatusTone(request.status)}`}>
                  {emergencyClosed ? 'Аварийно упакована' : requestStatusLabel(request.status)}
                </span>
                {request.managerComment ? (
                  <span className="client-request-status-comment" title={request.managerComment}>
                    {request.managerComment}
                  </span>
                ) : null}
              </td>
              {canPickOutbound ? (
                <td className="client-request-table__warehouse-cell" data-label="Склад">
                  {canShowWarehouseActions(request) ? (
                    <div className="client-request-actions">
                       {onOpenFbsBoxSearch && isFbsRequest(request) ? (
                         <button
                           className="client-request-action-button client-request-action-button--fbs-box-search"
                           type="button"
                           onClick={() => onOpenFbsBoxSearch(request)}
                           title="Показать складские остатки по товарам FBS-заявки"
                         >
                           <Search size={15} aria-hidden="true" />
                           <span>Остатки FBS</span>
                         </button>
                       ) : null}
                       {onCheckSupplyConsistency && isFbsRequest(request) ? (
                         <button
                           className="client-request-action-button client-request-action-button--supply-check"
                           type="button"
                           onClick={() => onCheckSupplyConsistency(request)}
                           disabled={checkingSupplyRequestId === request.id}
                           title="Сравнить состав этой заявки с фактическим составом поставки Wildberries"
                         >
                           <ShieldCheck size={15} aria-hidden="true" />
                           <span>{checkingSupplyRequestId === request.id ? 'Проверяю WB' : 'Проверить с WB'}</span>
                         </button>
                       ) : null}
                       {onSelectManualBoxes && canSelectManualBoxes(request) ? (
                         <button
                           className="client-request-action-button client-request-action-button--box-selection"
                           type="button"
                           onClick={() => onSelectManualBoxes(request)}
                           title="Выбрать короба, из которых будет списан товар"
                         >
                           <Boxes size={15} aria-hidden="true" />
                           <span>Выбрать короба</span>
                         </button>
                       ) : null}
                       {onOpenPickInstruction && request.type === 'OUTBOUND' ? (
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
                      {onSyncTsd && canSyncTsdRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--sync-tsd"
                          type="button"
                          onClick={() => onSyncTsd(request)}
                          disabled={syncingTsdRequestId === request.id}
                          title="Обновить заявку в очереди ТСД"
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          <span>{syncingTsdRequestId === request.id ? 'Синхронизирую' : 'В ТСД'}</span>
                        </button>
                      ) : null}
                      {onRefreshPickInstruction && canRefreshPickInstruction && canSyncTsdRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--refresh-instruction"
                          type="button"
                          onClick={() => onRefreshPickInstruction(request)}
                          disabled={refreshingInstructionId === request.id}
                          title={isFbsRequest(request)
                            ? 'Проверить состав заявки, восстановить недостающие задания и маршруты до паллет-сортов'
                            : 'Принудительно пересчитать оставшиеся товары и короба по текущим остаткам'}
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          <span>{refreshingInstructionId === request.id
                            ? isFbsRequest(request)
                              ? 'Проверяю паллет-сорты'
                              : 'Пересчитываю заявку'
                            : isFbsRequest(request)
                              ? 'Проверить паллет-сорты'
                              : 'Пересчитать заявку'}</span>
                        </button>
                      ) : null}
                      {onDownloadPickInstruction && request.type === 'OUTBOUND' ? (
                        <button
                          className="client-request-action-button client-request-action-button--xlsx"
                          type="button"
                          onClick={() => onDownloadPickInstruction(request)}
                          title={isFbsRequest(request)
                            ? 'Скачать лист подбора FBS для маркетплейса заявки'
                            : 'Скачать Excel-инструкцию сборки'}
                        >
                          <FileDown size={15} aria-hidden="true" />
                          <span>{isFbsRequest(request) ? 'Лист подбора' : 'Инструкция Excel'}</span>
                        </button>
                      ) : null}
                      {canPickRequest(request) ? (
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
                      {canPackageRequest(request) ? (
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
                      {canShipRequest(request) ? (
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
                      {canDownloadMarketplaceTemplates(request) ? (
                        <>
                          <button
                            className="client-request-action-button client-request-action-button--xlsx"
                            type="button"
                            onClick={() => onDownloadWbProducts?.(request)}
                            title="Скачать файл товаров для загрузки в WB"
                          >
                            <FileSpreadsheet size={15} aria-hidden="true" />
                            <span>WB товары</span>
                          </button>
                          <button
                            className="client-request-action-button client-request-action-button--xlsx"
                            type="button"
                            onClick={() => onDownloadWbPackages?.(request)}
                            title="Скачать файл упаковки для загрузки в WB"
                          >
                            <FileSpreadsheet size={15} aria-hidden="true" />
                            <span>WB упаковка</span>
                          </button>
                        </>
                      ) : null}
                      {onUploadManualInstruction && canUploadManualInstruction(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--manual-instruction"
                          type="button"
                          onClick={() => onUploadManualInstruction(request)}
                          title="Загрузить свою складскую инструкцию и перестроить план заявки"
                        >
                          <FileUp size={15} aria-hidden="true" />
                          <span>Своя инструкция</span>
                        </button>
                      ) : null}
                      {onRollbackEmergencyClose && emergencyClosed ? (
                        <button
                          className="client-request-action-button client-request-action-button--emergency-rollback"
                          type="button"
                          onClick={() => onRollbackEmergencyClose(request)}
                          title="Отменить аварийное закрытие и восстановить остатки"
                        >
                          <Undo2 size={15} aria-hidden="true" />
                          <span>Отмена аварийного закрытия</span>
                        </button>
                      ) : onEmergencyPackedXlsx && canEmergencyPackRequest(request) ? (
                        <button
                          className="client-request-action-button client-request-action-button--emergency"
                          type="button"
                          onClick={() => onEmergencyPackedXlsx(request)}
                          title="Аварийно упаковать заявку по Excel со списком коробов"
                        >
                          <AlertTriangle size={15} aria-hidden="true" />
                          <span>Короба XLSX</span>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
              {canCancelRequests ? (
                <td className="client-request-table__actions-cell" data-label="Действия">
                  <div className="client-request-actions client-request-actions--main">
                  {!isSkuCollectionRequest(request) && canEditRequest(request, canEditAnyRequest) ? (
                    <button
                      className="client-request-action-button client-request-action-button--edit"
                      type="button"
                      onClick={() => onEditRequest(request)}
                      title="Редактировать заявку"
                    >
                      <Edit3 size={15} aria-hidden="true" />
                      <span>Редактировать</span>
                    </button>
                  ) : null}
                  {!isSkuCollectionRequest(request) && canCancelRequest(request) ? (
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
                    canEditRequest(request, canEditAnyRequest) ? null : '-'
                  )}
                  </div>
                </td>
              ) : null}
              {canChangeStatus ? (
                <td className="client-request-table__process-cell" data-label="Процесс">
                  {isSkuCollectionRequest(request) ? (
                    <span className="client-request-sku-collection-process">Управляется ТСД</span>
                  ) : <label className="client-request-status-select">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    <select
                      aria-label={`Статус заявки ${request.title}`}
                      title="Изменить статус заявки"
                      value={request.status}
                      onChange={(event) => onStatusChange(request.id, event.target.value as ClientRequestStatus)}
                    >
                      {requestStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>}
                </td>
              ) : null}
            </tr>
            );
          })}
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

function canRunFulfillment(request: ClientRequestSummary) {
  return canPickRequest(request) || canPackageRequest(request) || canShipRequest(request);
}

function canShowWarehouseActions(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' || canSelectManualBoxes(request) || canRunFulfillment(request);
}

function canSyncTsdRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}

function canCancelRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
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

function canSelectManualBoxes(request: ClientRequestSummary) {
  return (
    (request.type === 'OUTBOUND' || request.type === 'DELIVERY') &&
    request.items.length > 0 &&
    ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(request.status) &&
    !request.client.storesWithoutBoxes &&
    !request.comment?.toLocaleLowerCase('ru-RU').includes('создано из excel:')
  );
}

function formatRequestNumber(value: number) {
  return String(value).padStart(6, '0');
}

function parseFbsTransferOrigin(comment: string | null | undefined) {
  if (!comment) return null;

  const match = comment.match(
    /\u0438\u0437 \u0437\u0430\u044f\u0432\u043e\u043a\s+(.+?)\s+\u0438 \u043f\u043e\u0441\u0442\u0430\u0432\u043e\u043a\s+(.+?)\s+\u0432 \u043f\u043e\u0441\u0442\u0430\u0432\u043a\u0443\s+([^\s:]+)/iu,
  );
  if (!match) return null;

  return {
    sourceRequests: match[1]!.trim(),
    sourceSupplies: match[2]!.trim(),
  };
}

function canDownloadMarketplaceTemplates(request: ClientRequestSummary) {
  return (
    request.type === 'OUTBOUND' &&
    ['PACKED', 'DONE'].includes(request.status) &&
    request.packages.length > 0
  );
}

function canEmergencyPackRequest(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}

function isEmergencyClosedRequest(request: ClientRequestSummary) {
  if (request.type !== 'OUTBOUND' || request.status !== 'PACKED') {
    return false;
  }
  return request.packages.some((packagePlace) => packagePlace.comment === 'Фактический короб из аварийного Excel');
}

function findOriginalRequestFile(request: ClientRequestSummary) {
  const requestCreatedAt = Date.parse(request.createdAt);
  const creatorId = request.createdBy?.id;
  const sourceWindowMs = 5 * 60 * 1000;
  const sourceFileName = request.comment
    ?.match(/Создано из Excel:\s*(.+?\.(?:xlsx|xlsm|xls))(?=\.\s*Позиций:|$)/i)?.[1]
    ?.trim()
    .toLocaleLowerCase('ru-RU');
  const workbooks = [...request.files]
    .filter((file) => /\.(xlsx|xlsm|xls)$/i.test(file.fileName)
      || file.mimeType.includes('spreadsheet')
      || file.mimeType.includes('excel'))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

  if (sourceFileName) {
    const matchingName = workbooks.find(
      (file) => file.fileName.trim().toLocaleLowerCase('ru-RU') === sourceFileName,
    );
    if (matchingName) {
      return matchingName;
    }
  }

  return workbooks
    .filter((file) => {
      const uploadedByCreator = !creatorId || file.uploadedByUserId === creatorId;
      const fileCreatedAt = Date.parse(file.createdAt);
      const uploadedWithRequest = Number.isFinite(requestCreatedAt)
        && Number.isFinite(fileCreatedAt)
        && Math.abs(fileCreatedAt - requestCreatedAt) <= sourceWindowMs;

      return uploadedByCreator && uploadedWithRequest;
    })
    [0] ?? null;
}

function canUploadManualInstruction(request: ClientRequestSummary) {
  return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}

function canEditRequest(request: ClientRequestSummary, canEditAnyRequest: boolean) {
  return canEditAnyRequest || ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}

function itemsSummary(request: ClientRequestSummary) {
  if (request.items.length === 0) {
    return '-';
  }

  const previewItems = request.items.slice(0, 4);
  const restCount = request.items.length - previewItems.length;
  const preview = previewItems
    .map((item) => {
      const itemName = item.sku?.internalSku ?? item.name ?? item.barcode ?? 'позиция';
      return `${itemName} x ${item.quantity}`;
    })
    .join(', ');

  return restCount > 0 ? `${preview} · еще ${restCount}` : preview;
}

function itemsCountSummary(request: ClientRequestSummary) {
  if (request.items.length === 0) {
    return '0 позиций';
  }

  const totalQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
  return `${request.items.length} позиций · ${totalQuantity} шт.`;
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
