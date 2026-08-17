import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Activity, AlertTriangle, Boxes, CheckCircle2, ClipboardList, Edit3, FileDown, FileSpreadsheet, FileText, FileUp, PackageCheck, RefreshCw, Search, Send, ShieldCheck, ShoppingBasket, Truck, Undo2, XCircle } from 'lucide-react';
import { requestPriorityLabel, requestStatusLabel, requestStatusOptions, requestStatusTone, requestTypeLabel, } from './clientRequestMeta';
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
export function ClientRequestsTable({ items, selectableRequestIds = new Set(), selectedRequestIds = new Set(), onRequestSelectionChange, canChangeStatus, canPickOutbound, canCancelRequests, canEditAnyRequest, canRefreshPickInstruction, refreshingInstructionId, syncingTsdRequestId, checkingSupplyRequestId, onStatusChange, onCancelRequest, onEditRequest, onOpenDocument, onDownloadRequestItems, onDownloadOriginalFile, onOpenOnlineExecution, onSelectManualBoxes, onOpenFbsBoxSearch, onOpenPickInstruction, onRefreshPickInstruction, onSyncTsd, onCheckSupplyConsistency, onOpenFbsOrders, onDownloadPickInstruction, onDownloadWbProducts, onDownloadWbPackages, onUploadManualInstruction, onEmergencyPackedXlsx, onRollbackEmergencyClose, onPickOutbound, onPackageOutbound, onShipOutbound, }) {
    const selectableItems = items.filter((request) => selectableRequestIds.has(request.id));
    const showRequestSelection = Boolean(onRequestSelectionChange) && selectableItems.length > 0;
    const allSelectableSelected = selectableItems.length > 0 &&
        selectableItems.every((request) => selectedRequestIds.has(request.id));
    function toggleAllSelectable() {
        if (!onRequestSelectionChange)
            return;
        const next = new Set(selectedRequestIds);
        if (allSelectableSelected) {
            selectableItems.forEach((request) => next.delete(request.id));
        }
        else {
            selectableItems.forEach((request) => next.add(request.id));
        }
        onRequestSelectionChange(next);
    }
    function toggleRequest(requestId) {
        if (!onRequestSelectionChange || !selectableRequestIds.has(requestId)) {
            return;
        }
        const next = new Set(selectedRequestIds);
        if (next.has(requestId))
            next.delete(requestId);
        else
            next.add(requestId);
        onRequestSelectionChange(next);
    }
    return (_jsx("div", { className: "client-request-table-wrap", children: _jsxs("table", { className: "data-table client-request-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [showRequestSelection ? (_jsx("th", { className: "client-request-table__select-heading", children: _jsx("input", { type: "checkbox", checked: allSelectableSelected, onChange: toggleAllSelectable, "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 FBS-\u0437\u0430\u044F\u0432\u043A\u0438" }) })) : null, _jsx("th", { className: "client-request-table__request-heading", children: "\u0417\u0430\u044F\u0432\u043A\u0430" }), _jsx("th", { className: "client-request-table__client-heading", children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { className: "client-request-table__composition-heading", children: "\u0421\u043E\u0441\u0442\u0430\u0432" }), _jsx("th", { className: "client-request-table__due-heading", children: "\u0421\u0440\u043E\u043A" }), _jsx("th", { className: "client-request-table__status-heading", children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), canPickOutbound ? _jsx("th", { className: "client-request-table__warehouse-heading", children: "\u0421\u043A\u043B\u0430\u0434" }) : null, canCancelRequests ? _jsx("th", { className: "client-request-table__actions-heading", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }) : null, canChangeStatus ? _jsx("th", { className: "client-request-table__process-heading", children: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441" }) : null] }) }), _jsx("tbody", { children: items.map((request) => {
                        const originalFile = findOriginalRequestFile(request);
                        const emergencyClosed = isEmergencyClosedRequest(request);
                        const formattedRequestNumber = formatRequestNumber(request.number);
                        const requestNumberPrefix = formattedRequestNumber.slice(0, -3);
                        const requestNumberAccent = formattedRequestNumber.slice(-3);
                        return (_jsxs("tr", { className: `client-request-row client-request-row--${requestStatusTone(request.status)}`, children: [showRequestSelection ? (_jsx("td", { className: "client-request-table__select-cell", "data-label": "\u0412 \u0445\u0432\u043E\u0441\u0442\u044B", children: selectableRequestIds.has(request.id) ? (_jsx("input", { type: "checkbox", checked: selectedRequestIds.has(request.id), onChange: () => toggleRequest(request.id), "aria-label": `Выбрать FBS-заявку №${formatRequestNumber(request.number)}` })) : null })) : null, _jsxs("td", { className: "client-request-table__request-cell", "data-label": "\u0417\u0430\u044F\u0432\u043A\u0430", children: [_jsxs("span", { className: "client-request-number", "aria-label": `Заявка №${formattedRequestNumber}`, children: [_jsxs("span", { className: "client-request-number__prefix", children: ["\u2116", requestNumberPrefix] }), _jsx("strong", { className: "client-request-number__accent", children: requestNumberAccent })] }), onOpenDocument ? (_jsx("button", { className: "client-request-title client-request-title--button", type: "button", onClick: () => onOpenDocument(request), title: `Открыть заявку: ${request.title}`, "aria-label": `Открыть заявку ${request.title}`, children: request.title })) : (_jsx("strong", { className: "client-request-title", title: request.title, children: request.title })), _jsxs("span", { className: "client-request-list-meta", children: [requestTypeLabel(request.type), " \u00B7 ", requestPriorityLabel(request.priority)] }), _jsxs("span", { className: "client-request-city", children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434" }), _jsx("strong", { children: request.destinationCity ?? '-' })] }), _jsxs("span", { className: "client-request-list-meta", children: ["\u0421\u043E\u0437\u0434\u0430\u043D\u0430: ", createdAtFormatter.format(new Date(request.createdAt))] }), request.comment ? (_jsx("span", { className: "client-request-list-comment", title: request.comment, children: request.comment })) : null] }), _jsxs("td", { className: "client-request-table__client-cell", "data-label": "\u041A\u043B\u0438\u0435\u043D\u0442", children: [_jsx("strong", { children: request.client.code }), _jsx("span", { children: request.client.name })] }), _jsxs("td", { className: "client-request-table__composition-cell", "data-label": "\u0421\u043E\u0441\u0442\u0430\u0432", children: [_jsx("span", { className: "client-request-items-count", children: itemsCountSummary(request) }), request.fbsCompletion ? (_jsx("span", { className: `client-request-fbs-completion ${request.fbsCompletion.completed ? 'client-request-fbs-completion--done' : ''}`, children: request.fbsCompletion.completed
                                                ? `Выполнено 100% · ${request.fbsCompletion.completedOrders} из ${request.fbsCompletion.totalOrders} заказов`
                                                : `FBS собрано ${request.fbsCompletion.completedOrders} из ${request.fbsCompletion.totalOrders} · ${request.fbsCompletion.percent}%` })) : null, _jsx("span", { className: "client-request-items-preview", children: itemsSummary(request) }), request.packages.length ? (_jsx("span", { className: "request-package-summary", children: packagesSummary(request) })) : null, onOpenDocument ? (_jsxs("button", { className: "document-open-button", type: "button", onClick: () => onOpenDocument(request), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(FileText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0441\u0442\u0430\u0432" })] })) : null, onDownloadRequestItems ? (_jsxs("button", { className: "document-open-button document-open-button--source", type: "button", onClick: () => onDownloadRequestItems(request), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438 \u0432 Excel", children: [_jsx(FileSpreadsheet, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0441\u0442\u0430\u0432 XLSX" })] })) : null, onDownloadOriginalFile && originalFile ? (_jsxs("button", { className: "document-open-button document-open-button--source", type: "button", onClick: () => onDownloadOriginalFile(request, originalFile), title: `Скачать первоначальный файл клиента: ${originalFile.fileName}`, children: [_jsx(FileDown, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0424\u0430\u0439\u043B \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] })) : null, onOpenOnlineExecution && request.type === 'OUTBOUND' ? (_jsxs("button", { className: "document-open-button document-open-button--online", type: "button", onClick: () => onOpenOnlineExecution(request), title: "\u041E\u043D\u043B\u0430\u0439\u043D-\u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(Activity, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u043D\u043B\u0430\u0439\u043D" })] })) : null, onOpenFbsOrders && isFbsRequest(request) ? (_jsxs("button", { className: "document-open-button document-open-button--online", type: "button", onClick: () => onOpenFbsOrders(request), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0437\u0430\u043A\u0430\u0437\u044B FBS, \u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432 \u044D\u0442\u0443 \u0437\u0430\u044F\u0432\u043A\u0443", children: [_jsx(ShoppingBasket, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041A \u0437\u0430\u043A\u0430\u0437\u0430\u043C FBS" })] })) : null] }), _jsx("td", { className: "client-request-table__due-cell", "data-label": "\u0421\u0440\u043E\u043A", children: formatDate(request.desiredDate) }), _jsxs("td", { className: "client-request-table__status-cell", "data-label": "\u0421\u0442\u0430\u0442\u0443\u0441", children: [_jsx("span", { className: `status status--${requestStatusTone(request.status)}`, children: emergencyClosed ? 'Аварийно упакована' : requestStatusLabel(request.status) }), request.managerComment ? (_jsx("span", { className: "client-request-status-comment", title: request.managerComment, children: request.managerComment })) : null] }), canPickOutbound ? (_jsx("td", { className: "client-request-table__warehouse-cell", "data-label": "\u0421\u043A\u043B\u0430\u0434", children: canShowWarehouseActions(request) ? (_jsxs("div", { className: "client-request-actions", children: [onOpenFbsBoxSearch && isFbsRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--fbs-box-search", type: "button", onClick: () => onOpenFbsBoxSearch(request), title: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u0442\u043E\u0432\u0430\u0440\u0430\u043C FBS-\u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(Search, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 FBS" })] })) : null, onCheckSupplyConsistency && isFbsRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--supply-check", type: "button", onClick: () => onCheckSupplyConsistency(request), disabled: checkingSupplyRequestId === request.id, title: "\u0421\u0440\u0430\u0432\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u044D\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438 \u0441 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u043C \u0441\u043E\u0441\u0442\u0430\u0432\u043E\u043C \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 Wildberries", children: [_jsx(ShieldCheck, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: checkingSupplyRequestId === request.id ? 'Проверяю WB' : 'Проверить с WB' })] })) : null, onSelectManualBoxes && canSelectManualBoxes(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--box-selection", type: "button", onClick: () => onSelectManualBoxes(request), title: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430, \u0438\u0437 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0431\u0443\u0434\u0435\u0442 \u0441\u043F\u0438\u0441\u0430\u043D \u0442\u043E\u0432\u0430\u0440", children: [_jsx(Boxes, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430" })] })) : null, onOpenPickInstruction && request.type === 'OUTBOUND' ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--instruction", type: "button", onClick: () => onOpenPickInstruction(request), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0443\u044E \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E", children: [_jsx(ClipboardList, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F" })] })) : null, onSyncTsd && canSyncTsdRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--sync-tsd", type: "button", onClick: () => onSyncTsd(request), disabled: syncingTsdRequestId === request.id, title: "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C, \u043F\u043E\u0447\u0435\u043C\u0443 \u0437\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u0432\u0438\u0434\u043D\u0430 \u043D\u0430 \u0422\u0421\u0414, \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u043C \u0441\u043F\u043E\u0441\u043E\u0431\u043E\u043C", children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: syncingTsdRequestId === request.id ? 'Проверяю ТСД' : 'Проверить ТСД' })] })) : null, onRefreshPickInstruction && canRefreshPickInstruction && canSyncTsdRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--refresh-instruction", type: "button", onClick: () => onRefreshPickInstruction(request), disabled: refreshingInstructionId === request.id, title: isFbsRequest(request)
                                                    ? 'Снять устаревшие резервы и заново подобрать доступные короба и паллет-сорты'
                                                    : 'Принудительно пересчитать оставшиеся товары и короба по текущим остаткам', children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: refreshingInstructionId === request.id
                                                            ? 'Исправляю подбор'
                                                            : isFbsRequest(request)
                                                                ? 'Исправить подбор FBS'
                                                                : 'Пересчитать заявку' })] })) : null, onDownloadPickInstruction && request.type === 'OUTBOUND' ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", onClick: () => onDownloadPickInstruction(request), title: isFbsRequest(request)
                                                    ? 'Скачать лист подбора FBS для маркетплейса заявки'
                                                    : 'Скачать Excel-инструкцию сборки', children: [_jsx(FileDown, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isFbsRequest(request) ? 'Лист подбора' : 'Инструкция Excel' })] })) : null, canPickRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--pick", type: "button", onClick: () => onPickOutbound(request), title: "\u0421\u043E\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443", children: [_jsx(PackageCheck, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0431\u0440\u0430\u0442\u044C" })] })) : null, canPackageRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--pack", type: "button", onClick: () => onPackageOutbound(request), title: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443", children: [_jsx(Send, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u0442\u044C" })] })) : null, canShipRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--ship", type: "button", onClick: () => onShipOutbound(request), title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0443", children: [_jsx(Truck, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u0433\u0440\u0443\u0437\u0438\u0442\u044C" })] })) : null, canDownloadMarketplaceTemplates(request) ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", onClick: () => onDownloadWbProducts?.(request), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0444\u0430\u0439\u043B \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0434\u043B\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0432 WB", children: [_jsx(FileSpreadsheet, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "WB \u0442\u043E\u0432\u0430\u0440\u044B" })] }), _jsxs("button", { className: "client-request-action-button client-request-action-button--xlsx", type: "button", onClick: () => onDownloadWbPackages?.(request), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0444\u0430\u0439\u043B \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438 \u0434\u043B\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0432 WB", children: [_jsx(FileSpreadsheet, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "WB \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0430" })] })] })) : null, onUploadManualInstruction && canUploadManualInstruction(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--manual-instruction", type: "button", onClick: () => onUploadManualInstruction(request), title: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0432\u043E\u044E \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0443\u044E \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E \u0438 \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043F\u043B\u0430\u043D \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(FileUp, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0432\u043E\u044F \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F" })] })) : null, onRollbackEmergencyClose && emergencyClosed ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--emergency-rollback", type: "button", onClick: () => onRollbackEmergencyClose(request), title: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0430\u0432\u0430\u0440\u0438\u0439\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438", children: [_jsx(Undo2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043C\u0435\u043D\u0430 \u0430\u0432\u0430\u0440\u0438\u0439\u043D\u043E\u0433\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F" })] })) : onEmergencyPackedXlsx && canEmergencyPackRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--emergency", type: "button", onClick: () => onEmergencyPackedXlsx(request), title: "\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u043E \u0443\u043F\u0430\u043A\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043F\u043E Excel \u0441\u043E \u0441\u043F\u0438\u0441\u043A\u043E\u043C \u043A\u043E\u0440\u043E\u0431\u043E\u0432", children: [_jsx(AlertTriangle, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 XLSX" })] })) : null] })) : ('-') })) : null, canCancelRequests ? (_jsx("td", { className: "client-request-table__actions-cell", "data-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F", children: _jsxs("div", { className: "client-request-actions client-request-actions--main", children: [canEditRequest(request, canEditAnyRequest) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--edit", type: "button", onClick: () => onEditRequest(request), title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443", children: [_jsx(Edit3, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] })) : null, canCancelRequest(request) ? (_jsxs("button", { className: "client-request-action-button client-request-action-button--cancel", type: "button", onClick: () => onCancelRequest(request), title: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443", children: [_jsx(XCircle, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C" })] })) : (canEditRequest(request, canEditAnyRequest) ? null : '-')] }) })) : null, canChangeStatus ? (_jsx("td", { className: "client-request-table__process-cell", "data-label": "\u041F\u0440\u043E\u0446\u0435\u0441\u0441", children: _jsxs("label", { className: "client-request-status-select", children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("select", { "aria-label": `Статус заявки ${request.title}`, title: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u044F\u0432\u043A\u0438", value: request.status, onChange: (event) => onStatusChange(request.id, event.target.value), children: requestStatusOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }) })) : null] }, request.id));
                    }) })] }) }));
}
function canPickRequest(request) {
    return request.type === 'OUTBOUND' && ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}
function canPackageRequest(request) {
    return request.type === 'OUTBOUND' && request.status === 'IN_WORK';
}
function canShipRequest(request) {
    return request.type === 'OUTBOUND' && request.status === 'PACKED';
}
function canRunFulfillment(request) {
    return canPickRequest(request) || canPackageRequest(request) || canShipRequest(request);
}
function canShowWarehouseActions(request) {
    return request.type === 'OUTBOUND' || canSelectManualBoxes(request) || canRunFulfillment(request);
}
function canSyncTsdRequest(request) {
    return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}
function canCancelRequest(request) {
    return request.type === 'OUTBOUND' && ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}
function isFbsRequest(request) {
    return ((request._count?.fbsOrderLinks ?? 0) > 0 ||
        request.title.trim().toLocaleUpperCase('ru-RU').startsWith('FBS') ||
        request.comment
            ?.toLocaleLowerCase('ru-RU')
            .includes('создано из fbs-заказов:') === true);
}
function canSelectManualBoxes(request) {
    return ((request.type === 'OUTBOUND' || request.type === 'DELIVERY') &&
        request.items.length > 0 &&
        ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(request.status) &&
        !request.client.storesWithoutBoxes &&
        !request.comment?.toLocaleLowerCase('ru-RU').includes('создано из excel:'));
}
function formatRequestNumber(value) {
    return String(value).padStart(6, '0');
}
function canDownloadMarketplaceTemplates(request) {
    return (request.type === 'OUTBOUND' &&
        ['PACKED', 'DONE'].includes(request.status) &&
        request.packages.length > 0);
}
function canEmergencyPackRequest(request) {
    return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}
function isEmergencyClosedRequest(request) {
    if (request.type !== 'OUTBOUND' || request.status !== 'PACKED') {
        return false;
    }
    return request.packages.some((packagePlace) => packagePlace.comment === 'Фактический короб из аварийного Excel');
}
function findOriginalRequestFile(request) {
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
        const matchingName = workbooks.find((file) => file.fileName.trim().toLocaleLowerCase('ru-RU') === sourceFileName);
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
    })[0] ?? null;
}
function canUploadManualInstruction(request) {
    return request.type === 'OUTBOUND' && !['DONE', 'CANCELLED', 'REJECTED'].includes(request.status);
}
function canEditRequest(request, canEditAnyRequest) {
    return canEditAnyRequest || ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}
function itemsSummary(request) {
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
function itemsCountSummary(request) {
    if (request.items.length === 0) {
        return '0 позиций';
    }
    const totalQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
    return `${request.items.length} позиций · ${totalQuantity} шт.`;
}
function packagesSummary(request) {
    const totalQuantity = request.packages.reduce((sum, packagePlace) => sum + packagePlace.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
    const codes = request.packages.map((packagePlace) => packagePlace.packageCode).join(', ');
    return `Места: ${codes} · ${totalQuantity} шт.`;
}
function formatDate(value) {
    if (!value) {
        return '-';
    }
    return dateFormatter.format(new Date(value));
}
