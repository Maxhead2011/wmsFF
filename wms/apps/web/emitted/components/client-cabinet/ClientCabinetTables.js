import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, MessageSquareText, ReceiptText, Search } from 'lucide-react';
import { downloadBillingInvoiceActPdf, downloadBillingInvoicePdf, fetchSku } from '../../lib/api';
import { billingInvoiceStatusTone } from '../billing/billingMeta';
import { BillingReconciliationPanel } from '../billing/BillingReconciliationPanel';
import { ProductCardModal } from '../catalog/ProductCardModal';
import { requestStatusTone } from '../client-requests/clientRequestMeta';
import { billingInvoiceStatusLabel, billingUnitLabel, formatCabinetDate, formatCabinetMoney, formatCabinetNumber, primaryBarcode, requestStatusLabel, requestTypeLabel, stockStatusLabel, } from './clientCabinetFormat';
import { ClientCabinetNotifications } from './ClientCabinetNotifications';
import { ClientCabinetReceiptImport } from './ClientCabinetReceiptImport';
import { ClientCabinetPeriodSummary } from './ClientCabinetPeriodSummary';
import { ClientCabinetServiceHistory } from './ClientCabinetServiceHistory';
import { ClientCabinetStockImport } from './ClientCabinetStockImport';
import { downloadClientCabinetStockExcel } from './clientCabinetStockExcelExport';
import { ClientRequestFilesCell } from './ClientRequestFilesCell';
const pageSizeOptions = [10, 20, 50, 100];
export function ClientCabinetTables({ accessToken, client, currentUser, stock, visibleStock, stockReservationRequests, stockSearch, requests, invoices, charges, reconciliation, serviceHistory, notifications, notificationPreferences, browserNotificationPermission, activeSection, onSectionChange, onStockSearchChange, onStockImported, onOpenRequestDocument, onOpenRequestTimeline, onOpenInvoiceDocument, onUploadRequestFile, onDownloadRequestFile, onEnableBrowserNotifications, onMarkNotificationRead, onToggleNotificationPreference, }) {
    const canSeeStoragePlaces = currentUser.clientScopeMode === 'ALL' || !currentUser.roleCodes.includes('CLIENT');
    const canImportStock = canUse(currentUser, 'imports:write');
    const [pageSize, setPageSize] = useState(20);
    const [pageByTab, setPageByTab] = useState({
        skus: 1,
        stock: 1,
        requests: 1,
        invoices: 1,
    });
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [productError, setProductError] = useState('');
    const skuRows = useMemo(() => buildSkuRows(visibleStock), [visibleStock]);
    const allSkuRows = useMemo(() => buildSkuRows(stock), [stock]);
    const activePage = pageByTab[activeSection] ?? 1;
    const activeTotal = totalForTab(activeSection, skuRows, visibleStock, requests, invoices);
    const allTotal = totalForTab(activeSection, allSkuRows, stock, requests, invoices);
    const activeQuantity = quantityForTab(activeSection, skuRows, visibleStock);
    const allQuantity = quantityForTab(activeSection, allSkuRows, stock);
    const stockTabQuantity = quantityForTab('stock', skuRows, visibleStock) ?? 0;
    const pageCount = Math.max(1, Math.ceil(activeTotal / pageSize));
    const currentPage = Math.min(activePage, pageCount);
    useEffect(() => {
        setPageByTab((current) => ({ ...current, [activeSection]: 1 }));
    }, [activeSection, pageSize, stockSearch]);
    function changePage(nextPage) {
        const normalized = Math.min(Math.max(nextPage, 1), pageCount);
        setPageByTab((current) => ({ ...current, [activeSection]: normalized }));
    }
    async function openProductCard(skuId) {
        setProductError('');
        try {
            setSelectedProduct(await fetchSku(accessToken, skuId));
        }
        catch (caught) {
            setProductError(caught instanceof Error ? caught.message : 'Не удалось открыть карточку товара.');
        }
    }
    const visibleSkuRows = paginate(skuRows, currentPage, pageSize);
    const visibleStockRows = paginate(visibleStock, currentPage, pageSize);
    const visibleRequestRows = paginate(requests, currentPage, pageSize);
    const visibleInvoiceRows = paginate(invoices, currentPage, pageSize);
    return (_jsxs("div", { className: `client-cabinet-sections client-cabinet-sections--active-${activeSection}`, children: [_jsx(ClientCabinetNotifications, { notifications: notifications, preferences: notificationPreferences, browserNotificationPermission: browserNotificationPermission, onEnableBrowserNotifications: onEnableBrowserNotifications, onMarkRead: onMarkNotificationRead, onTogglePreference: onToggleNotificationPreference }), _jsx(ClientCabinetServiceHistory, { history: serviceHistory }), _jsx(ClientCabinetPeriodSummary, { accessToken: accessToken, invoices: invoices, charges: charges }), _jsx(BillingReconciliationPanel, { report: reconciliation, title: "\u0417\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u0438 \u0441\u0432\u0435\u0440\u043A\u0430" }), _jsxs("section", { id: "client-cabinet-workspace", className: "client-cabinet-section", "aria-label": "\u0422\u0430\u0431\u043B\u0438\u0446\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("div", { className: "client-cabinet-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsx(TabButton, { label: "SKU", count: skuRows.length, tab: "skus", activeTab: activeSection, onClick: onSectionChange }), _jsx(TabButton, { label: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438", count: stockTabQuantity, tab: "stock", activeTab: activeSection, onClick: onSectionChange }), _jsx(TabButton, { label: "\u0417\u0430\u044F\u0432\u043A\u0438", count: requests.length, tab: "requests", activeTab: activeSection, onClick: onSectionChange }), _jsx(TabButton, { label: "\u0421\u0447\u0435\u0442\u0430", count: invoices.length, tab: "invoices", activeTab: activeSection, onClick: onSectionChange })] }), _jsxs("div", { className: "client-cabinet-table-toolbar", children: [_jsxs("label", { className: "client-cabinet-stock-search", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { type: "search", value: stockSearch, onChange: (event) => onStockSearchChange(event.target.value), placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E SKU, \u0442\u043E\u0432\u0430\u0440\u0443, \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434\u0443, \u043A\u043E\u0440\u043E\u0431\u0443" })] }), _jsx("span", { className: "client-cabinet-table-count", children: tableCountText(activeSection, activeTotal, allTotal, activeQuantity, allQuantity) }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => downloadClientCabinetStockExcel(client, visibleStock, canSeeStoragePlaces, stockReservationRequests), disabled: visibleStock.length === 0, children: [_jsx(FileSpreadsheet, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 Excel" })] })] }), canImportStock && (activeSection === 'skus' || activeSection === 'stock') ? (_jsxs("div", { className: "client-cabinet-import-grid", children: [_jsx(ClientCabinetStockImport, { accessToken: accessToken, client: client, onImported: onStockImported }), _jsx(ClientCabinetReceiptImport, { accessToken: accessToken, client: client, onImported: onStockImported })] })) : null, productError ? _jsx("p", { className: "form-error", children: productError }) : null, renderActiveTable({
                        activeSection,
                        skuRows: visibleSkuRows,
                        stock: visibleStockRows,
                        canSeeStoragePlaces,
                        canSeeRequestFiles: canSeeStoragePlaces,
                        onOpenProductCard: (skuId) => void openProductCard(skuId),
                        requests: visibleRequestRows,
                        invoices: visibleInvoiceRows,
                        onOpenRequestDocument,
                        onOpenRequestTimeline,
                        onOpenInvoiceDocument,
                        accessToken,
                        onUploadRequestFile,
                        onDownloadRequestFile,
                    }), _jsx(TablePager, { page: currentPage, pageCount: pageCount, pageSize: pageSize, total: activeTotal, quantity: activeSection === 'stock' ? activeQuantity : null, onPageChange: changePage, onPageSizeChange: setPageSize })] }), selectedProduct ? _jsx(ProductCardModal, { sku: selectedProduct, onClose: () => setSelectedProduct(null) }) : null] }));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function TabButton({ label, count, tab, activeTab, onClick, }) {
    return (_jsxs("button", { className: tab === activeTab ? 'is-active' : '', type: "button", role: "tab", onClick: () => onClick(tab), children: [_jsx("span", { children: label }), _jsx("strong", { children: formatCabinetNumber(count) })] }));
}
function renderActiveTable({ activeSection, skuRows, stock, canSeeStoragePlaces, canSeeRequestFiles, onOpenProductCard, requests, invoices, onOpenRequestDocument, onOpenRequestTimeline, onOpenInvoiceDocument, accessToken, onUploadRequestFile, onDownloadRequestFile, }) {
    if (activeSection === 'skus') {
        return skuRows.length > 0 ? renderSkuTable(skuRows, canSeeStoragePlaces, onOpenProductCard) : _jsx(EmptyTable, { children: "SKU \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." });
    }
    if (activeSection === 'stock') {
        return stock.length > 0 ? renderStockTable(stock, canSeeStoragePlaces, onOpenProductCard) : _jsx(EmptyTable, { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." });
    }
    if (activeSection === 'requests') {
        return requests.length > 0 ? (renderRequestTable(requests, onOpenRequestDocument, onOpenRequestTimeline, onUploadRequestFile, onDownloadRequestFile, canSeeRequestFiles)) : (_jsx(EmptyTable, { children: "\u0417\u0430\u044F\u0432\u043E\u043A \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }));
    }
    return invoices.length > 0 ? (_jsx(ClientCabinetInvoiceTable, { accessToken: accessToken, items: invoices, onOpenInvoiceDocument: onOpenInvoiceDocument })) : (_jsx(EmptyTable, { children: "\u0421\u0447\u0435\u0442\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }));
}
function EmptyTable({ children }) {
    return _jsx("p", { className: "panel-message", children: children });
}
function renderSkuTable(items, canSeeStoragePlaces, onOpenProductCard) {
    return (_jsx("div", { id: "client-cabinet-skus", className: "client-cabinet-table-wrap", children: _jsxs("table", { className: "data-table client-cabinet-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SKU" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), canSeeStoragePlaces ? _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432" }) : null, _jsx("th", { children: "\u0415\u0434\u0438\u043D\u0438\u0446" }), _jsx("th", { children: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E" })] }) }), _jsx("tbody", { children: items.map((item) => (_jsxs("tr", { onClick: () => onOpenProductCard(item.skuId), onKeyDown: (event) => openProductCardFromKeyboard(event, item.skuId, onOpenProductCard), tabIndex: 0, children: [_jsx("td", { children: _jsx("strong", { children: item.internalSku }) }), _jsx("td", { children: item.name }), _jsx("td", { children: item.primaryBarcode }), canSeeStoragePlaces ? _jsx("td", { children: formatCabinetNumber(item.boxesCount) }) : null, _jsx("td", { children: formatCabinetNumber(item.quantity) }), _jsx("td", { children: formatCabinetDate(item.updatedAt) })] }, item.skuId))) })] }) }));
}
function renderStockTable(items, canSeeStoragePlaces, onOpenProductCard) {
    return (_jsx("div", { id: "client-cabinet-stock", className: "client-cabinet-table-wrap", children: _jsxs("table", { className: "data-table client-cabinet-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SKU" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), canSeeStoragePlaces ? _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }) : null, canSeeStoragePlaces ? _jsx("th", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u0430" }) : null, _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E" })] }) }), _jsx("tbody", { children: items.map((balance) => (_jsxs("tr", { onClick: () => onOpenProductCard(balance.skuId), onKeyDown: (event) => openProductCardFromKeyboard(event, balance.skuId, onOpenProductCard), tabIndex: 0, children: [_jsxs("td", { children: [_jsx("strong", { children: balance.sku.internalSku }), _jsx("span", { children: balance.sku.name })] }), _jsx("td", { children: primaryBarcode(balance) }), canSeeStoragePlaces ? _jsx("td", { children: balance.box?.code ?? '-' }) : null, canSeeStoragePlaces ? _jsx("td", { children: balance.pallet?.code ?? '-' }) : null, _jsx("td", { children: _jsx("span", { className: "status status--planned", children: stockStatusLabel(balance.status) }) }), _jsx("td", { children: formatCabinetNumber(Number(balance.quantity)) }), _jsx("td", { children: formatCabinetDate(balance.updatedAt) })] }, balance.id))) })] }) }));
}
function renderRequestTable(items, onOpenRequestDocument, onOpenRequestTimeline, onUploadRequestFile, onDownloadRequestFile, canSeeRequestFiles) {
    return (_jsx("div", { id: "client-cabinet-requests", className: "client-cabinet-table-wrap", children: _jsxs("table", { className: "data-table client-cabinet-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0430" }), _jsx("th", { children: "\u0422\u0438\u043F" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u0430\u0432" }), _jsx("th", { children: "\u0421\u0440\u043E\u043A" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" }), canSeeRequestFiles ? _jsx("th", { children: "\u0424\u0430\u0439\u043B\u044B" }) : null] }) }), _jsx("tbody", { children: items.map((request) => (_jsxs("tr", { className: `client-cabinet-request-row client-cabinet-request-row--${requestStatusTone(request.status)}`, children: [_jsxs("td", { children: [_jsxs("span", { className: "client-request-number", children: ["\u2116", String(request.number).padStart(6, '0')] }), _jsx("strong", { children: request.title }), request.comment ? _jsx("span", { children: request.comment }) : null] }), _jsx("td", { children: requestTypeLabel(request.type) }), _jsx("td", { children: requestItemsSummary(request) }), _jsx("td", { children: formatCabinetDate(request.desiredDate) }), _jsxs("td", { children: [_jsx("span", { className: `status status--${requestStatusTone(request.status)} client-request-status-badge`, children: requestStatusLabel(request.status) }), request.managerComment ? _jsx("span", { children: request.managerComment }) : null] }), _jsx("td", { children: _jsxs("div", { className: "client-request-actions-cell", children: [_jsxs("button", { className: "document-open-button", type: "button", onClick: () => onOpenRequestDocument(request), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(FileText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0430" })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: () => onOpenRequestTimeline(request), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0437\u0430\u044F\u0432\u043A\u0438", children: [_jsx(MessageSquareText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F" })] })] }) }), canSeeRequestFiles ? (_jsx("td", { children: _jsx(ClientRequestFilesCell, { request: request, onUpload: onUploadRequestFile, onDownload: onDownloadRequestFile }) })) : null] }, request.id))) })] }) }));
}
function ClientCabinetInvoiceTable({ accessToken, items, onOpenInvoiceDocument, }) {
    const [expandedInvoiceId, setExpandedInvoiceId] = useState('');
    const [downloadingId, setDownloadingId] = useState('');
    const [downloadError, setDownloadError] = useState('');
    useEffect(() => {
        if (expandedInvoiceId && !items.some((invoice) => invoice.id === expandedInvoiceId)) {
            setExpandedInvoiceId('');
        }
    }, [expandedInvoiceId, items]);
    async function downloadInvoice(invoice) {
        setDownloadError('');
        setDownloadingId(`invoice:${invoice.id}`);
        try {
            const blob = await downloadBillingInvoicePdf(accessToken, invoice.id);
            downloadBlobFile(blob, `Счет_${safeFileName(invoice.number)}.pdf`);
        }
        catch (caught) {
            setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать счет.');
        }
        finally {
            setDownloadingId('');
        }
    }
    async function downloadAct(invoice) {
        setDownloadError('');
        if (!isInvoicePaid(invoice)) {
            setDownloadError(`Акт по счету № ${invoice.number} будет доступен после оплаты.`);
            return;
        }
        setDownloadingId(`act:${invoice.id}`);
        try {
            const blob = await downloadBillingInvoiceActPdf(accessToken, invoice.id);
            downloadBlobFile(blob, `Акт_${safeFileName(actNumber(invoice.number))}.pdf`);
        }
        catch (caught) {
            setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать акт.');
        }
        finally {
            setDownloadingId('');
        }
    }
    return (_jsxs("div", { id: "client-cabinet-invoices", className: "client-cabinet-table-wrap", children: [downloadError ? _jsx("p", { className: "form-error", children: downloadError }) : null, _jsxs("table", { className: "data-table client-cabinet-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0421\u0447\u0435\u0442" }), _jsx("th", { children: "\u041F\u0435\u0440\u0438\u043E\u0434" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { children: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u0430\u0432" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" })] }) }), _jsx("tbody", { children: items.map((invoice) => {
                            const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
                            const expanded = expandedInvoiceId === invoice.id;
                            const isPaid = isInvoicePaid(invoice);
                            return (_jsxs(Fragment, { children: [_jsxs("tr", { className: expanded ? 'is-expanded' : '', onClick: () => setExpandedInvoiceId(expanded ? '' : invoice.id), onKeyDown: (event) => toggleInvoiceFromKeyboard(event, invoice.id, expanded, setExpandedInvoiceId), tabIndex: 0, children: [_jsxs("td", { children: [_jsx("button", { className: "client-invoice-number-button", type: "button", onClick: (event) => {
                                                            event.stopPropagation();
                                                            setExpandedInvoiceId(expanded ? '' : invoice.id);
                                                        }, children: invoice.number }), invoice.dueDate ? _jsxs("span", { children: ["\u0434\u043E ", formatCabinetDate(invoice.dueDate)] }) : null] }), _jsxs("td", { children: [_jsx("strong", { children: formatCabinetDate(invoice.periodFrom) }), _jsx("span", { children: formatCabinetDate(invoice.periodTo) })] }), _jsxs("td", { children: [_jsxs("strong", { children: [formatCabinetMoney(invoice.totalRub), " \u20BD"] }), _jsxs("span", { children: ["\u043E\u0441\u0442\u0430\u0442\u043E\u043A ", formatCabinetMoney(remaining), " \u20BD"] })] }), _jsxs("td", { children: [_jsxs("strong", { children: [formatCabinetMoney(invoice.paidRub), " \u20BD"] }), invoice.paidAt ? _jsx("span", { children: formatCabinetDate(invoice.paidAt) }) : null] }), _jsx("td", { children: _jsx("span", { className: `status status--${billingInvoiceStatusTone(invoice.status)}`, children: billingInvoiceStatusLabel(invoice.status) }) }), _jsxs("td", { children: [_jsx("button", { className: "client-invoice-expand-button", type: "button", onClick: (event) => {
                                                            event.stopPropagation();
                                                            setExpandedInvoiceId(expanded ? '' : invoice.id);
                                                        }, "aria-expanded": expanded, children: expanded ? 'Скрыть состав' : 'Показать состав' }), _jsxs("span", { children: [invoice.items.length, " \u043F\u043E\u0437. \u00B7 ", invoice.payments.length, " \u043E\u043F\u043B\u0430\u0442"] })] }), _jsx("td", { children: _jsxs("div", { className: "client-request-actions-cell", children: [_jsxs("button", { className: "document-open-button", type: "button", onClick: (event) => {
                                                                event.stopPropagation();
                                                                onOpenInvoiceDocument(invoice);
                                                            }, title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442", children: [_jsx(ReceiptText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0447\u0435\u0442" })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: (event) => {
                                                                event.stopPropagation();
                                                                void downloadInvoice(invoice);
                                                            }, disabled: downloadingId === `invoice:${invoice.id}`, title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441\u0447\u0435\u0442 PDF", children: [_jsx(Download, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: downloadingId === `invoice:${invoice.id}` ? 'Скачиваю' : 'PDF' })] })] }) })] }), expanded ? (_jsx("tr", { className: "client-invoice-detail-row", children: _jsx("td", { colSpan: 7, children: _jsxs("div", { className: "client-invoice-detail", children: [_jsxs("div", { className: "client-invoice-detail__head", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0421\u043E\u0441\u0442\u0430\u0432 \u0441\u0447\u0435\u0442\u0430 \u2116 ", invoice.number] }), _jsxs("span", { children: [invoice.items.length, " \u043F\u043E\u0437\u0438\u0446\u0438\u0439 \u00B7 \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ", formatCabinetMoney(invoice.paidRub), " \u20BD"] })] }), _jsxs("div", { className: "client-invoice-detail__actions", children: [_jsxs("button", { className: "document-open-button", type: "button", onClick: () => void downloadInvoice(invoice), disabled: downloadingId === `invoice:${invoice.id}`, children: [_jsx(Download, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441\u0447\u0435\u0442" })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: () => void downloadAct(invoice), disabled: !isPaid || downloadingId === `act:${invoice.id}`, title: isPaid ? 'Скачать акт PDF' : 'Акт доступен после оплаты счета', children: [_jsx(FileText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: downloadingId === `act:${invoice.id}` ? 'Скачиваю' : 'Скачать акт' })] })] })] }), !isPaid ? (_jsx("p", { className: "client-invoice-detail__notice", children: "\u0410\u043A\u0442 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043F\u043E\u0441\u043B\u0435 \u043E\u043F\u043B\u0430\u0442\u044B \u0441\u0447\u0435\u0442\u0430." })) : null, _jsxs("table", { className: "client-invoice-detail-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0423\u0441\u043B\u0443\u0433\u0430" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0415\u0434." }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0426\u0435\u043D\u0430" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" })] }) }), _jsx("tbody", { children: invoice.items.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: item.description }), _jsx("td", { children: formatCabinetDate(item.serviceDate) }), _jsx("td", { children: billingUnitLabel(item.unit) }), _jsx("td", { children: formatCabinetNumber(Number(item.quantity)) }), _jsxs("td", { children: [formatCabinetMoney(item.unitPriceRub), " \u20BD"] }), _jsxs("td", { children: [formatCabinetMoney(item.totalRub), " \u20BD"] })] }, item.id))) })] })] }) }) })) : null] }, invoice.id));
                        }) })] })] }));
}
function toggleInvoiceFromKeyboard(event, invoiceId, expanded, setExpandedInvoiceId) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setExpandedInvoiceId(expanded ? '' : invoiceId);
    }
}
function isInvoicePaid(invoice) {
    return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}
function actNumber(invoiceNumber) {
    return invoiceNumber.startsWith('INV-') ? `ACT-${invoiceNumber.slice(4)}` : `ACT-${invoiceNumber}`;
}
function safeFileName(value) {
    return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
}
function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}
function openProductCardFromKeyboard(event, skuId, onOpenProductCard) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenProductCard(skuId);
    }
}
function TablePager({ page, pageCount, pageSize, total, quantity, onPageChange, onPageSizeChange, }) {
    return (_jsxs("div", { className: "client-cabinet-pager", children: [_jsx("span", { children: pagerText(page, pageCount, total, quantity) }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435" }), _jsx("select", { value: pageSize, onChange: (event) => onPageSizeChange(Number(event.target.value)), children: pageSizeOptions.map((option) => (_jsx("option", { value: option, children: option }, option))) })] }), _jsxs("div", { className: "client-cabinet-pager__buttons", children: [_jsx("button", { type: "button", onClick: () => onPageChange(page - 1), disabled: page <= 1, children: "\u041D\u0430\u0437\u0430\u0434" }), _jsx("button", { type: "button", onClick: () => onPageChange(page + 1), disabled: page >= pageCount, children: "\u0412\u043F\u0435\u0440\u0435\u0434" })] })] }));
}
function buildSkuRows(stock) {
    const rows = new Map();
    stock.forEach((balance) => {
        const current = rows.get(balance.skuId);
        const updatedAt = current && current.updatedAt > balance.updatedAt ? current.updatedAt : balance.updatedAt;
        const row = current ??
            {
                skuId: balance.skuId,
                internalSku: balance.sku.internalSku,
                name: balance.sku.name,
                primaryBarcode: primaryBarcode(balance),
                boxesCount: 0,
                quantity: 0,
                updatedAt,
                boxCodes: new Set(),
            };
        if (balance.box?.code) {
            row.boxCodes.add(balance.box.code);
        }
        row.quantity += Number(balance.quantity);
        row.updatedAt = updatedAt;
        row.boxesCount = row.boxCodes.size;
        rows.set(balance.skuId, row);
    });
    return [...rows.values()]
        .map(({ boxCodes, ...row }) => row)
        .sort((left, right) => right.quantity - left.quantity || left.internalSku.localeCompare(right.internalSku));
}
function totalForTab(tab, skuRows, stock, requests, invoices) {
    if (tab === 'skus') {
        return skuRows.length;
    }
    if (tab === 'stock') {
        return stock.length;
    }
    if (tab === 'requests') {
        return requests.length;
    }
    return invoices.length;
}
function quantityForTab(tab, skuRows, stock) {
    if (tab === 'skus') {
        return skuRows.reduce((sum, row) => sum + row.quantity, 0);
    }
    if (tab === 'stock') {
        return stock.reduce((sum, balance) => sum + Number(balance.quantity), 0);
    }
    return null;
}
function tableCountText(tab, activeTotal, allTotal, activeQuantity, allQuantity) {
    if (tab === 'stock') {
        return `Найдено единиц ${formatCabinetNumber(activeQuantity ?? 0)} из ${formatCabinetNumber(allQuantity ?? 0)}`;
    }
    if (tab === 'skus') {
        return `Найдено SKU ${formatCabinetNumber(activeTotal)} из ${formatCabinetNumber(allTotal)}`;
    }
    return `Найдено ${formatCabinetNumber(activeTotal)} из ${formatCabinetNumber(allTotal)}`;
}
function pagerText(page, pageCount, total, quantity) {
    const base = `Страница ${formatCabinetNumber(page)} из ${formatCabinetNumber(pageCount)}`;
    return quantity === null ? `${base}, всего ${formatCabinetNumber(total)}` : `${base}, единиц ${formatCabinetNumber(quantity)}`;
}
function paginate(items, page, pageSize) {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
}
function requestItemsSummary(request) {
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
