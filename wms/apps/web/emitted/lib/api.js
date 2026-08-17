function sanitizeFbsOrderSelectionPayload(payload) {
    return {
        clientId: payload.clientId,
        orders: payload.orders.map(({ connectionId, id }) => ({ connectionId, id })),
        ...(payload.deliveryDestination === undefined
            ? {}
            : { deliveryDestination: payload.deliveryDestination }),
        ...(payload.marketplaceWarehouseKey === undefined
            ? {}
            : { marketplaceWarehouseKey: payload.marketplaceWarehouseKey }),
    };
}
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';
export async function login(payload) {
    return request('/auth/login', {
        method: 'POST',
        body: payload,
    });
}
export async function bootstrapAdmin(payload) {
    return request('/auth/bootstrap', {
        method: 'POST',
        body: payload,
    });
}
export async function fetchMe(accessToken) {
    return request('/auth/me', {
        accessToken,
    });
}
export async function fetchAdministrationOverview(accessToken) {
    return request('/administration/overview', { accessToken });
}
export async function fetchAdministrationTsdWorkloads(accessToken) {
    return request('/administration/tsd-workloads', { accessToken });
}
export async function fetchTsdMonitoring(accessToken) {
    return request('/administration/tsd-monitor', { accessToken });
}
export async function sendTsdMonitorAction(accessToken, deviceCode, action) {
    return request(`/administration/tsd-monitor/devices/${encodeURIComponent(deviceCode)}/action`, { method: 'POST', body: { action }, accessToken });
}
export async function fetchAdministrationFbsErrorRequests(accessToken) {
    return request('/administration/fbs-request-errors/requests', { accessToken });
}
export async function checkAdministrationFbsRequestErrors(accessToken, requestId) {
    return request('/administration/fbs-request-errors/check', {
        method: 'POST',
        body: { requestId },
        accessToken,
    });
}
export async function repairAdministrationFbsRequestErrors(accessToken, requestId) {
    return request('/administration/fbs-request-errors/repair', {
        method: 'POST',
        body: { requestId, confirmation: 'ИСПРАВИТЬ' },
        accessToken,
    });
}
export async function releaseAdministrationTsdWorkload(accessToken, payload) {
    return request('/administration/tsd-workloads/release', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function disconnectAdministrationTsdRequest(accessToken, payload) {
    return request('/administration/tsd-workloads/disconnect-request', { method: 'POST', body: payload, accessToken });
}
export async function fetchAdministrationSettings(accessToken) {
    return request('/administration/settings', { accessToken });
}
export async function updateAdministrationSetting(accessToken, key, value, reason) {
    return request(`/administration/settings/${encodeURIComponent(key)}`, { method: 'PATCH', body: { value, reason }, accessToken });
}
export async function fetchAdministrationWorkspaceVisibility(accessToken) {
    return request('/administration/users/workspaces', {
        accessToken,
    });
}
export async function updateAdministrationWorkspaceVisibility(accessToken, userId, overrides, reason) {
    return request(`/administration/users/${encodeURIComponent(userId)}/workspaces`, { method: 'PUT', body: { overrides, reason }, accessToken });
}
export async function runAdministrationMarketplaceDiagnostics(accessToken, filter = {}) {
    return request('/administration/marketplaces/diagnostics', {
        method: 'POST',
        body: filter,
        accessToken,
    });
}
export async function optimizeAdministrationPerformance(accessToken) {
    return request('/administration/performance/optimize', {
        method: 'POST',
        accessToken,
    });
}
export async function fetchAdministrationPhantomStocks(accessToken) {
    return request('/administration/phantom-stocks', { accessToken });
}
export async function fixAdministrationPhantomStock(accessToken, balanceId) {
    return request(`/administration/phantom-stocks/${encodeURIComponent(balanceId)}/fix`, { method: 'POST', accessToken });
}
export async function fixAllAdministrationPhantomStocks(accessToken) {
    return request('/administration/phantom-stocks/fix-all', { method: 'POST', accessToken });
}
export async function fetchAdministrationAudit(accessToken, search = '', take = 80) {
    return request(withQuery('/administration/audit', { search, take }), { accessToken });
}
export async function previewAdministrationAssistant(accessToken, prompt) {
    return request('/administration/assistant/preview', {
        method: 'POST',
        body: { prompt },
        accessToken,
    });
}
export async function applyAdministrationAssistant(accessToken, previewId, confirmation) {
    return request('/administration/assistant/apply', { method: 'POST', body: { previewId, confirmation }, accessToken });
}
export async function fetchAdministrationDocumentation(accessToken) {
    return request('/administration/documentation', { accessToken });
}
export async function compareAdministrationWbStockFile(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart(withQuery('/administration/stocks/compare-file', {
        clientId: payload.clientId,
        warehouseId: payload.warehouseId,
        connectionId: payload.connectionId,
        marketplaceWarehouseId: payload.marketplaceWarehouseId,
    }), form, accessToken);
}
export async function compareAdministrationWbStockApi(accessToken, payload) {
    return request('/administration/stocks/compare-wb', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function fetchClients(accessToken, options = {}) {
    return request(withQuery('/clients', {
        includeArchived: options.includeArchived ? 'true' : undefined,
    }), {
        accessToken,
    });
}
export async function fetchClientRequests(accessToken, filter = {}) {
    return request(withQuery('/client-requests', filter), {
        accessToken,
    });
}
export async function mergeFbsRequestTails(accessToken, requestIds, confirmedOrders) {
    return request('/client-requests/fbs/merge-tails', {
        method: 'POST',
        body: { requestIds, confirmedOrders },
        accessToken,
    });
}
export async function previewFbsRequestTails(accessToken, requestIds) {
    return request('/client-requests/fbs/merge-tails/preview', {
        method: 'POST',
        body: { requestIds },
        accessToken,
    });
}
export async function fetchContracts(accessToken) {
    return request('/contracts', { accessToken });
}
export async function fetchContractClients(accessToken) {
    return request('/contracts/clients', { accessToken });
}
export async function createClientContract(accessToken, payload) {
    return request('/contracts', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function checkClientContractRequisites(accessToken, contractId) {
    return request(`/contracts/${contractId}/requisites-check`, {
        accessToken,
    });
}
export async function refreshClientContractRequisites(accessToken, contractId, payload) {
    return request(`/contracts/${contractId}/requisites-refresh`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function downloadClientContract(accessToken, contractId, signed = false) {
    return requestBlob(`/contracts/${contractId}/${signed ? 'signed-pdf' : 'pdf'}`, accessToken);
}
export async function uploadSignedClientContract(accessToken, contractId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/contracts/${contractId}/signed-pdf`, form, accessToken);
}
export async function uploadContractAdditionalAgreement(accessToken, contractId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/contracts/${contractId}/additional-agreements`, form, accessToken);
}
export async function downloadContractAdditionalAgreement(accessToken, contractId, attachmentId) {
    return requestBlob(`/contracts/${contractId}/additional-agreements/${attachmentId}/pdf`, accessToken);
}
export async function fetchClientRequestManualBoxSelection(accessToken, requestId) {
    return request(`/client-requests/${requestId}/manual-box-selection`, {
        accessToken,
    });
}
export async function fetchClientRequestFbsBoxSearch(accessToken, requestId) {
    return request(`/client-requests/${requestId}/fbs-box-search`, {
        accessToken,
    });
}
export async function downloadClientRequestFbsBoxSearchXlsx(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/fbs-box-search.xlsx`, accessToken);
}
export async function saveClientRequestManualBoxSelection(accessToken, requestId, selections) {
    return request(`/client-requests/${requestId}/manual-box-selection`, {
        method: 'PUT',
        body: { selections },
        accessToken,
    });
}
export async function fetchClientRequestDocument(accessToken, requestId) {
    return request(`/client-requests/${requestId}/document`, {
        accessToken,
    });
}
export async function downloadClientRequestPdf(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/document.pdf`, accessToken);
}
export async function fetchClientRequestFiles(accessToken, requestId) {
    return request(`/client-requests/${requestId}/files`, {
        accessToken,
    });
}
export async function fetchClientRequestTimeline(accessToken, requestId) {
    return request(`/client-requests/${requestId}/timeline`, {
        accessToken,
    });
}
export async function createClientRequestComment(accessToken, requestId, payload) {
    return request(`/client-requests/${requestId}/comments`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function uploadClientRequestFile(accessToken, requestId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/client-requests/${requestId}/files`, form, accessToken);
}
export async function downloadClientRequestFile(accessToken, requestId, fileId) {
    return requestBlob(`/client-requests/${requestId}/files/${fileId}`, accessToken);
}
export async function fetchClientNotifications(accessToken, filter = {}) {
    return request(withQuery('/client-notifications', {
        clientId: filter.clientId,
        unreadOnly: filter.unreadOnly ? 'true' : undefined,
    }), {
        accessToken,
    });
}
export async function markClientNotificationRead(accessToken, notificationId) {
    return request(`/client-notifications/${notificationId}/read`, {
        method: 'PATCH',
        accessToken,
    });
}
export async function fetchClientNotificationPreferences(accessToken, filter = {}) {
    return request(withQuery('/client-notifications/preferences', {
        clientId: filter.clientId,
    }), {
        accessToken,
    });
}
export async function fetchClientTelegramSettings(accessToken, clientId) {
    return request(withQuery('/client-notifications/telegram-settings', { clientId }), {
        accessToken,
    });
}
export async function updateClientTelegramSettings(accessToken, payload) {
    return request('/client-notifications/telegram-settings', {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateClientNotificationPreference(accessToken, payload) {
    return request('/client-notifications/preferences', {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchBillingServices(accessToken) {
    return request('/billing/services', {
        accessToken,
    });
}
export async function fetchClientBillingServices(accessToken, clientId) {
    return request(`/billing/clients/${clientId}/services`, {
        accessToken,
    });
}
export async function fetchClientFbsTurnkeyPricing(accessToken, clientId) {
    return request(`/billing/clients/${clientId}/fbs-turnkey`, {
        accessToken,
    });
}
export async function updateClientFbsTurnkeyPricing(accessToken, clientId, payload) {
    return request(`/billing/clients/${clientId}/fbs-turnkey`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function createBillingService(accessToken, payload) {
    return request('/billing/services', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function upsertClientBillingService(accessToken, clientId, payload) {
    return request(`/billing/clients/${clientId}/services`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function fetchOwnCompanies(accessToken) {
    return request('/own-companies', {
        accessToken,
    });
}
export async function parseRequisitesDocument(accessToken, target, file) {
    const form = new FormData();
    form.append('file', file);
    const path = target === 'own-company' ? '/own-companies/parse-requisites' : '/clients/parse-requisites';
    return requestMultipart(path, form, accessToken);
}
export async function createOwnCompany(accessToken, payload) {
    return request('/own-companies', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateOwnCompany(accessToken, companyId, payload) {
    return request(`/own-companies/${companyId}`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function uploadOwnCompanyAsset(accessToken, companyId, kind, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/own-companies/${companyId}/assets/${kind}`, form, accessToken);
}
export async function deleteOwnCompanyAsset(accessToken, companyId, kind) {
    return request(`/own-companies/${companyId}/assets/${kind}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function fetchBillingCharges(accessToken, filter = {}) {
    return request(withQuery('/billing/charges', filter), {
        accessToken,
    });
}
export async function fetchBillingServiceHistory(accessToken, filter = {}) {
    return request(withQuery('/billing/service-history', filter), {
        accessToken,
    });
}
export async function fetchBillingReconciliation(accessToken, filter = {}) {
    return request(withQuery('/billing/reconciliation', filter), {
        accessToken,
    });
}
export async function fetchExpenseEntries(accessToken, filter = {}) {
    return request(withQuery('/expenses/entries', filter), {
        accessToken,
    });
}
export async function createExpenseEntry(accessToken, payload) {
    return request('/expenses/entries', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function cancelExpenseEntry(accessToken, entryId) {
    return request(`/expenses/entries/${entryId}/cancel`, {
        method: 'PATCH',
        accessToken,
    });
}
export async function fetchExpenseMaterials(accessToken) {
    return request('/expenses/materials', { accessToken });
}
export async function createExpenseMaterial(accessToken, payload) {
    return request('/expenses/materials', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateExpenseMaterial(accessToken, materialId, payload) {
    return request(`/expenses/materials/${materialId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function addExpenseMaterialStock(accessToken, materialId, payload) {
    return request(`/expenses/materials/${materialId}/stock`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchExpenseMaterialMovements(accessToken, materialId) {
    return request(`/expenses/materials/${materialId}/movements`, { accessToken });
}
export async function fetchClientExpenseMaterialRules(accessToken, clientId) {
    return request(`/expenses/clients/${clientId}/material-rules`, { accessToken });
}
export async function updateClientExpenseMaterialRule(accessToken, clientId, materialId, payload) {
    return request(`/expenses/clients/${clientId}/material-rules/${materialId}`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function fetchExpenseReport(accessToken, filter = {}) {
    return request(withQuery('/expenses/report', filter), {
        accessToken,
    });
}
export async function fetchExpenseDebts(accessToken, clientId) {
    return request(withQuery('/expenses/debts', { clientId }), { accessToken });
}
export async function downloadExpenseReportXlsx(accessToken, filter = {}) {
    return requestBlob(withQuery('/expenses/report.xlsx', filter), accessToken);
}
export async function createBillingCharge(accessToken, payload) {
    return request('/billing/charges', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateBillingChargeStatus(accessToken, chargeId, payload) {
    return request(`/billing/charges/${chargeId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateFbsBillingLogisticsTrip(accessToken, chargeId, payload) {
    return request(`/billing/charges/${chargeId}/fbs-logistics-trip`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function generateStorageCharge(accessToken, payload) {
    return request('/billing/charges/storage', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchBillingInvoices(accessToken, filter = {}) {
    return request(withQuery('/billing/invoices', filter), {
        accessToken,
    });
}
export async function recheckBillingInvoice(accessToken, invoiceId) {
    return request(`/billing/invoices/${invoiceId}/recheck`, {
        accessToken,
    });
}
export async function addBillingInvoicePrimaryProcessing(accessToken, invoiceId) {
    return request(`/billing/invoices/${invoiceId}/primary-processing`, {
        method: 'POST',
        accessToken,
    });
}
export async function fetchBillingInvoiceDocument(accessToken, invoiceId) {
    return request(`/billing/invoices/${invoiceId}/document`, {
        accessToken,
    });
}
export async function downloadBillingInvoicePdf(accessToken, invoiceId) {
    return requestBlob(`/billing/invoices/${invoiceId}/document.pdf`, accessToken);
}
export async function downloadCombinedBillingInvoicesPdf(accessToken, filter = {}) {
    return requestBlob(withQuery('/billing/invoices/combined.pdf', filter), accessToken);
}
export async function fetchBillingInvoiceActDocument(accessToken, invoiceId) {
    return request(`/billing/invoices/${invoiceId}/act`, {
        accessToken,
    });
}
export async function downloadBillingInvoiceActPdf(accessToken, invoiceId) {
    return requestBlob(`/billing/invoices/${invoiceId}/act.pdf`, accessToken);
}
export async function createBillingInvoice(accessToken, payload) {
    return request('/billing/invoices', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createManualBillingInvoice(accessToken, payload) {
    return request('/billing/invoices/manual', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchClientPaymentAccounts(accessToken, clientId) {
    return request(`/billing/clients/${clientId}/payment-accounts`, {
        accessToken,
    });
}
export async function updateBillingInvoicePaymentAccount(accessToken, invoiceId, paymentBankAccountId) {
    return request(`/billing/invoices/${invoiceId}/payment-account`, {
        method: 'PATCH',
        body: { paymentBankAccountId },
        accessToken,
    });
}
export async function fetchFbsInvoiceMergePreview(accessToken, clientId, invoiceIds) {
    return request(withQuery('/billing/invoices/fbs-merge-preview', {
        clientId,
        invoiceIds: invoiceIds?.length ? invoiceIds.join(',') : undefined,
    }), { accessToken });
}
export async function mergeFbsInvoices(accessToken, payload) {
    return request('/billing/invoices/fbs-merge', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function mergeBillingInvoices(accessToken, payload) {
    return request('/billing/invoices/merge', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchBillingAdvances(accessToken, clientId) {
    return request(withQuery('/billing/advances', { clientId }), {
        accessToken,
    });
}
export async function createBillingAdvance(accessToken, payload) {
    return request('/billing/advances', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function cancelBillingAdvance(accessToken, advanceId) {
    return request(`/billing/advances/${advanceId}/cancel`, {
        method: 'PATCH',
        accessToken,
    });
}
export async function applyBillingAdvance(accessToken, advanceId) {
    return request(`/billing/advances/${advanceId}/apply`, {
        method: 'POST',
        accessToken,
    });
}
export async function restoreBillingAdvance(accessToken, advanceId) {
    return request(`/billing/advances/${advanceId}/restore`, {
        method: 'POST',
        accessToken,
    });
}
export function fetchInventoryDashboard(accessToken) {
    return request('/inventory/dashboard', { accessToken });
}
export function fetchInventorySession(accessToken, id) {
    return request(`/inventory/sessions/${id}`, { accessToken });
}
export function startInventorySession(accessToken, payload) {
    return request('/inventory/sessions', { method: 'POST', body: payload, accessToken });
}
export function openInventoryBox(accessToken, sessionId, boxCode) {
    return request(`/inventory/sessions/${sessionId}/boxes/open`, {
        method: 'POST',
        body: { boxCode },
        accessToken,
    });
}
export function scanInventoryItem(accessToken, auditBoxId, barcode, quantity = 1) {
    return request(`/inventory/boxes/${auditBoxId}/scan`, {
        method: 'POST',
        body: { barcode, quantity },
        accessToken,
    });
}
export function setInventoryCount(accessToken, auditBoxId, lineId, countedQuantity) {
    return request(`/inventory/boxes/${auditBoxId}/count`, {
        method: 'PATCH',
        body: { lineId, countedQuantity },
        accessToken,
    });
}
export function finishInventoryBox(accessToken, auditBoxId) {
    return request(`/inventory/boxes/${auditBoxId}/finish`, {
        method: 'POST',
        accessToken,
    });
}
export function approveInventoryBoxRescan(accessToken, requestId) {
    return request(`/inventory/rescan-requests/${requestId}/approve`, {
        method: 'POST',
        accessToken,
    });
}
export function sendInventoryToReview(accessToken, sessionId) {
    return request(`/inventory/sessions/${sessionId}/review`, {
        method: 'POST',
        accessToken,
    });
}
export function decideInventoryLine(accessToken, lineId, action, comment) {
    return request(`/inventory/lines/${lineId}/decision`, {
        method: 'PATCH',
        body: { action, comment },
        accessToken,
    });
}
export function completeInventorySession(accessToken, sessionId, comment) {
    return request(`/inventory/sessions/${sessionId}/complete`, {
        method: 'POST',
        body: { comment },
        accessToken,
    });
}
export function cancelInventorySession(accessToken, sessionId, comment) {
    return request(`/inventory/sessions/${sessionId}/cancel`, {
        method: 'POST',
        body: { comment },
        accessToken,
    });
}
export async function fetchClientRequestBoxOverlaps(accessToken) {
    return request('/client-requests/box-overlaps', { accessToken });
}
export async function updateManualBillingInvoice(accessToken, invoiceId, payload) {
    return request(`/billing/invoices/${invoiceId}/manual`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function updateBillingInvoiceStatus(accessToken, invoiceId, payload) {
    return request(`/billing/invoices/${invoiceId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function issueClientRequestInvoice(accessToken, requestId) {
    return request(`/billing/requests/${requestId}/issue`, {
        method: 'POST',
        accessToken,
    });
}
export async function createBillingPayment(accessToken, payload) {
    return request('/billing/payments', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createClientRequest(accessToken, payload) {
    return request('/client-requests', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createIncomingPayment(accessToken, payload) {
    return request('/billing/payments/incoming', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateClientRequest(accessToken, requestId, payload) {
    return request(`/client-requests/${requestId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function previewClientRequestAvailability(accessToken, payload) {
    return request('/client-requests/availability-preview', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function previewOutboundRequestXlsx(accessToken, payload) {
    return requestMultipart('/client-requests/outbound-xlsx/preview', outboundRequestXlsxForm(payload), accessToken);
}
export async function commitOutboundRequestXlsx(accessToken, payload) {
    return requestMultipart('/client-requests/outbound-xlsx/commit', outboundRequestXlsxForm(payload), accessToken);
}
export async function updateClientRequestStatus(accessToken, requestId, payload) {
    return request(`/client-requests/${requestId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function cancelClientRequest(accessToken, requestId) {
    return request(`/client-requests/${requestId}/cancel`, {
        method: 'POST',
        accessToken,
    });
}
export async function resolveFbsSynchronization(accessToken, requestId, action, requestNumber) {
    return request(`/client-requests/${requestId}/fbs-synchronization/resolve`, {
        method: 'POST',
        body: { action, requestNumber },
        accessToken,
    });
}
export async function emergencyCloseClientRequestFromXlsx(accessToken, requestId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/client-requests/${requestId}/emergency-packed-xlsx`, form, accessToken);
}
export async function rollbackEmergencyCloseClientRequest(accessToken, requestId) {
    return request(`/client-requests/${requestId}/emergency-packed-xlsx/rollback`, {
        method: 'POST',
        accessToken,
    });
}
export async function createClient(accessToken, payload) {
    return request('/clients', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateClient(accessToken, clientId, payload) {
    return request(`/clients/${clientId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateClientStatus(accessToken, clientId, status) {
    return request(`/clients/${clientId}/status`, {
        method: 'PATCH',
        body: { status },
        accessToken,
    });
}
export async function deleteClient(accessToken, clientId) {
    return request(`/clients/${clientId}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function importClientsXlsx(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart('/clients/import-xlsx', form, accessToken);
}
export async function fetchSkus(accessToken, filter = {}) {
    return request(withQuery('/skus', filter), {
        accessToken,
    });
}
export async function fetchFactoryShipments(accessToken, clientId) {
    const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    return request(`/factory-shipments${query}`, { accessToken });
}
export async function createFactoryShipment(accessToken, payload) {
    return request('/factory-shipments', { method: 'POST', body: payload, accessToken });
}
export async function shipFactoryShipment(accessToken, id) {
    return request(`/factory-shipments/${id}/ship`, { method: 'POST', accessToken });
}
export async function reconcileFactoryShipment(accessToken, id, requestId) {
    return request(`/factory-shipments/${id}/reconcile`, { method: 'POST', body: { requestId }, accessToken });
}
export async function fetchBulkSkuVolume(accessToken, filter) {
    return request(withQuery('/skus/bulk-volume', filter), {
        accessToken,
    });
}
export async function updateBulkSkuVolume(accessToken, payload) {
    return request('/skus/bulk-volume', {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function downloadSkuDraftTemplate(accessToken) {
    return requestBlob('/skus/drafts/template.xlsx', accessToken);
}
export async function importSkuDraftsXlsx(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart(withQuery('/skus/drafts/import-xlsx', { clientId: payload.clientId }), form, accessToken);
}
export async function fetchSku(accessToken, skuId) {
    return request(`/skus/${skuId}`, {
        accessToken,
    });
}
export async function createSku(accessToken, payload) {
    return request('/skus', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateSku(accessToken, skuId, payload) {
    return request(`/skus/${skuId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function deleteSku(accessToken, skuId) {
    return request(`/skus/${skuId}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function fetchNomenclature(accessToken, filter = {}) {
    return request(withQuery('/skus/nomenclature', filter), {
        accessToken,
    });
}
export async function createNomenclatureItem(accessToken, payload) {
    return request('/skus/nomenclature', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function importNomenclatureXlsx(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart('/skus/nomenclature/import-xlsx', form, accessToken);
}
export async function fetchArticleMappings(accessToken, clientId) {
    return request(withQuery('/skus/article-mappings', { clientId }), {
        accessToken,
    });
}
export async function createArticleMapping(accessToken, payload) {
    return request('/skus/article-mappings', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function importArticleMappingsXlsx(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart(withQuery('/skus/article-mappings/import-xlsx', { clientId: payload.clientId }), form, accessToken);
}
export async function fetchStockBalances(accessToken, filter = {}) {
    return request(withQuery('/stock/balances', filter), {
        accessToken,
    });
}
export async function fetchBranches(accessToken) {
    return request('/branches', { accessToken });
}
export async function activateBranch(accessToken, branchId) {
    return request(`/branches/${branchId}/activate`, {
        method: 'POST',
        accessToken,
    });
}
export async function createBranch(accessToken, payload) {
    return request('/branches', { method: 'POST', body: payload, accessToken });
}
export async function updateBranch(accessToken, branchId, payload) {
    return request(`/branches/${branchId}`, { method: 'PATCH', body: payload, accessToken });
}
export async function assignBranchManager(accessToken, branchId, userId) {
    return request(`/branches/${branchId}/manager`, { method: 'PUT', body: { userId }, accessToken });
}
export async function fetchBranchStockSummary(accessToken, clientId) {
    return request(withQuery('/branches/stock-summary', { clientId }), { accessToken });
}
export async function fetchInterBranchTransfers(accessToken, clientId) {
    return request(withQuery('/branches/transfers', { clientId }), { accessToken });
}
export async function previewInterBranchTransferBoxesFile(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart(withQuery('/branches/transfers/boxes-xlsx/preview', {
        clientId: payload.clientId,
        fromWarehouseId: payload.fromWarehouseId,
    }), form, accessToken);
}
export async function createInterBranchTransfer(accessToken, payload) {
    return request('/branches/transfers', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function receiveInterBranchTransferBox(accessToken, transferId, boxCode) {
    return request(`/branches/transfers/${transferId}/receive-box`, {
        method: 'POST',
        body: { boxCode },
        accessToken,
    });
}
export async function fetchTurnoverReport(accessToken, filter = {}) {
    return request(withQuery('/turnover', turnoverReportQuery(filter)), {
        accessToken,
    });
}
export async function fetchTurnoverSuggestions(accessToken, filter = {}) {
    return request(withQuery('/turnover/suggestions', {
        clientId: filter.clientId,
        search: filter.search,
        scope: filter.scope,
    }), {
        accessToken,
    });
}
export async function fetchFbsRelabelReconciliation(accessToken, filter) {
    return request(withQuery('/marketplace-connections/fbs/relabel-reconciliation', {
        clientId: filter.clientId,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        barcode: filter.barcode,
        refreshWb: filter.refreshWb === false ? 'false' : 'true',
    }), { accessToken });
}
export async function applyFbsRelabelReconciliation(accessToken, payload) {
    return request('/marketplace-connections/fbs/relabel-reconciliation/apply', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchKizIssues(accessToken, filter = {}) {
    return request(withQuery('/kiz/issues', {
        status: filter.status,
        search: filter.search,
        clientId: filter.clientId,
        limit: filter.limit,
    }), { accessToken });
}
export async function resolveKizIssue(accessToken, issueKey, payload) {
    return request(`/kiz/issues/${encodeURIComponent(issueKey)}/resolve`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function markKizIssueRead(accessToken, issueKey) {
    return request(`/kiz/issues/${encodeURIComponent(issueKey)}/read`, {
        method: 'POST',
        accessToken,
    });
}
export async function fetchBoxKizDiscrepancies(accessToken, filter = {}) {
    return request(withQuery('/kiz/discrepancies', filter), { accessToken });
}
export async function writeOffBoxKizDiscrepancy(accessToken, boxId, skuId, payload) {
    return request(`/kiz/discrepancies/${encodeURIComponent(boxId)}/${encodeURIComponent(skuId)}/write-off`, { method: 'POST', body: payload, accessToken });
}
export async function writeOffAllBoxKizDiscrepancies(accessToken, filter, payload) {
    return request(withQuery('/kiz/discrepancies/write-off-all', filter), {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function deleteArticleMapping(accessToken, id) {
    return request(`/skus/article-mappings/${id}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function updateNomenclatureItem(accessToken, nomenclatureId, payload) {
    return request(`/skus/nomenclature/${nomenclatureId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchTurnoverBoxDetails(accessToken, boxCode, filter = {}) {
    return request(withQuery(`/turnover/boxes/${encodeURIComponent(boxCode)}`, {
        clientId: filter.clientId,
    }), {
        accessToken,
    });
}
export async function fetchTurnoverStatistics(accessToken, filter = {}) {
    return request(withQuery('/turnover/statistics', turnoverQuery(filter)), {
        accessToken,
    });
}
export async function fetchTurnoverMovementDocument(accessToken, movementId) {
    return request(`/turnover/movements/${movementId}/document`, {
        accessToken,
    });
}
export async function downloadTurnoverMovementDocumentXlsx(accessToken, movementId) {
    return requestBlob(`/turnover/movements/${movementId}/document.xlsx`, accessToken);
}
export async function downloadTurnoverReceiptPeriodXlsx(accessToken, filter = {}) {
    return requestBlob(withQuery('/turnover/receipts.xlsx', {
        clientId: filter.clientId,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        receiptBatchDate: filter.receiptBatchDate,
    }), accessToken);
}
export async function downloadTurnoverStockXlsx(accessToken, filter = {}) {
    return requestBlob(withQuery('/turnover/stock.xlsx', {
        clientId: filter.clientId,
        ignoreActiveRequests: filter.ignoreActiveRequests ? 'true' : 'false',
    }), accessToken);
}
export async function runTurnoverAction(accessToken, payload) {
    return request('/turnover/actions', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchServiceClientStockCleanupPreview(accessToken, clientId) {
    return request(`/service/clients/${clientId}/stock-cleanup`, {
        accessToken,
    });
}
export async function purgeServiceClientStock(accessToken, clientId, confirmation) {
    return request(`/service/clients/${clientId}/stock-cleanup`, {
        method: 'POST',
        body: { confirmation },
        accessToken,
    });
}
export async function fetchServiceClientRequestsCleanupPreview(accessToken, clientId) {
    return request(`/service/clients/${clientId}/requests-cleanup`, {
        accessToken,
    });
}
export async function purgeServiceClientRequests(accessToken, clientId, confirmation) {
    return request(`/service/clients/${clientId}/requests-cleanup`, {
        method: 'POST',
        body: { confirmation },
        accessToken,
    });
}
export async function fetchServiceMaintenance(accessToken) {
    return request('/service/maintenance', {
        accessToken,
    });
}
export async function updateServiceMaintenance(accessToken, payload) {
    return request('/service/maintenance', {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchServiceSessions(accessToken) {
    return request('/service/sessions', {
        accessToken,
    });
}
export async function fetchServiceTelegramSettings(accessToken, clientId) {
    return request(withQuery('/service/telegram', { clientId }), {
        accessToken,
    });
}
export async function fetchServiceTelegramGroups(accessToken) {
    return request('/service/telegram/groups', {
        accessToken,
    });
}
export async function updateServiceTelegramGlobal(accessToken, payload) {
    return request('/service/telegram/global', {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateServiceTelegramClient(accessToken, clientId, payload) {
    return request(`/service/telegram/clients/${clientId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function testServiceTelegramFulfillment(accessToken) {
    return request('/service/telegram/test/fulfillment', {
        method: 'POST',
        accessToken,
    });
}
export async function testServiceTelegramClient(accessToken, clientId) {
    return request(`/service/telegram/test/clients/${clientId}`, {
        method: 'POST',
        accessToken,
    });
}
export async function searchServiceKiz(accessToken, filter) {
    return request(withQuery('/service/kiz', filter), {
        accessToken,
    });
}
export async function fetchBillingStorageBreakdown(accessToken, chargeId) {
    return request(`/billing/charges/${chargeId}/storage-breakdown`, {
        accessToken,
    });
}
export async function deleteBillingStorageBreakdownDay(accessToken, chargeId, date) {
    return request(`/billing/charges/${chargeId}/storage-breakdown/${date}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function fetchStorageOverview(accessToken, filter) {
    return request(withQuery('/stock/storage', filter), {
        accessToken,
    });
}
export async function downloadStorageOverviewXlsx(accessToken, filter) {
    return requestBlob(withQuery('/stock/storage.xlsx', filter), accessToken);
}
export async function updateStorageTariff(accessToken, clientId, payload) {
    return request(`/stock/storage/${clientId}/tariff`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchMarketplaceConnections(accessToken, filter = {}) {
    return request(withQuery('/marketplace-connections', filter), {
        accessToken,
    });
}
export async function closeServiceSession(accessToken, sessionId) {
    return request(`/service/sessions/${sessionId}/close`, {
        method: 'POST',
        accessToken,
    });
}
export async function logout(accessToken) {
    return request('/auth/logout', {
        method: 'POST',
        accessToken,
    });
}
export async function fetchAnalyticsClients(accessToken) {
    return request('/analytics/clients', { accessToken });
}
export async function fetchAnalyticsDashboard(accessToken, clientId) {
    return request(withQuery('/analytics/dashboard', { clientId, limit: 500 }), { accessToken });
}
export async function syncAnalyticsDashboard(accessToken, clientId, periodDays) {
    return request('/analytics/sync', {
        method: 'POST',
        accessToken,
        body: { clientId, periodDays },
    });
}
export async function connectAnalyticsApi(accessToken, clientId, apiKey) {
    return request(`/analytics/connections/${clientId}`, {
        method: 'PUT',
        accessToken,
        body: { apiKey },
    });
}
export async function fetchFbsOrders(accessToken, clientId, refresh = false) {
    return request(withQuery('/marketplace-connections/fbs/orders', {
        clientId,
        refresh: refresh ? '1' : undefined,
    }), { accessToken });
}
export async function fetchFbsPackedItems(accessToken, filter) {
    return request(withQuery('/marketplace-connections/fbs/packed-items', filter), { accessToken });
}
export async function reconcileFbsPackedItems(accessToken, payload) {
    return request('/marketplace-connections/fbs/packed-items/reconcile', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function fetchFbsProductShipmentReport(accessToken, filter) {
    return request(withQuery('/marketplace-connections/fbs/product-shipments-report', filter), { accessToken });
}
export async function downloadFbsProductShipmentReport(accessToken, filter) {
    return requestBlob(withQuery('/marketplace-connections/fbs/product-shipments-report.xlsx', filter), accessToken);
}
export async function fetchFbsActiveClients(accessToken, marketplace) {
    return request(withQuery('/marketplace-connections/fbs/active-clients', { marketplace }), { accessToken });
}
export async function fetchFbsCargoPackings(accessToken, clientId) {
    return request(withQuery('/marketplace-connections/fbs/cargo-packings', { clientId }), { accessToken });
}
export async function updateFbsCargoPackingIgnore(accessToken, planId, ignored, reason) {
    return request(`/marketplace-connections/fbs/cargo-packings/${encodeURIComponent(planId)}/ignore`, {
        method: 'PATCH',
        accessToken,
        body: JSON.stringify({ ignored, reason }),
    });
}
export async function fetchFbsStocks(accessToken, clientId, connectionId, warehouseId, refreshReserves = false) {
    return request(withQuery('/marketplace-connections/fbs/stocks', {
        clientId,
        connectionId,
        warehouseId,
        refresh: refreshReserves || undefined,
    }), { accessToken });
}
export async function updateFbsStockPublication(accessToken, payload) {
    return request('/marketplace-connections/fbs/stocks/publication', { method: 'PUT', accessToken, body: payload });
}
export async function reconcileFbsStockItem(accessToken, payload) {
    return request('/marketplace-connections/fbs/stocks/reconcile-item', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function updateFbsStockPublicationBulk(accessToken, payload) {
    return request('/marketplace-connections/fbs/stocks/publication/bulk', {
        method: 'PUT',
        accessToken,
        body: payload,
    });
}
export async function syncFbsStocks(accessToken, payload) {
    return request('/marketplace-connections/fbs/stocks/sync', { method: 'POST', accessToken, body: payload });
}
export async function connectFbsStockWarehouse(accessToken, payload) {
    return request('/marketplace-connections/fbs/stocks/warehouse', {
        method: 'PUT',
        accessToken,
        body: payload,
    });
}
export async function fetchFbsWarehouseRoutes(accessToken, connectionId) {
    return request(`/marketplace-connections/${encodeURIComponent(connectionId)}/fbs-warehouse-routes`, { accessToken });
}
export async function updateFbsWarehouseRoutes(accessToken, connectionId, payload) {
    return request(`/marketplace-connections/${encodeURIComponent(connectionId)}/fbs-warehouse-routes`, { method: 'PUT', accessToken, body: payload });
}
export async function assembleFbsOrders(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/assemble', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function reshipFbsOrders(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/reship', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function moveFbsOrdersToNewSupply(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/move-to-new-supply', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function cancelFbsOrders(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/cancel', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function removeCancelledFbsOrder(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/remove-cancelled', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function deliverFbsSupplies(accessToken, payload) {
    return request('/marketplace-connections/fbs/supplies/deliver', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function changeFbsSuppliesDestination(accessToken, payload) {
    return request('/marketplace-connections/fbs/supplies/change-destination', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function createFbsRequest(accessToken, payload) {
    return request('/marketplace-connections/fbs/orders/request', {
        method: 'POST',
        accessToken,
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function enableFbsEmergencyAssembly(accessToken, requestId) {
    return request(`/marketplace-connections/fbs/requests/${requestId}/emergency-assembly`, {
        method: 'POST',
        accessToken,
    });
}
export async function downloadFbsOrderStickersPdf(accessToken, payload) {
    return requestBlob('/marketplace-connections/fbs/orders/stickers.pdf', accessToken, {
        method: 'POST',
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function downloadFbsCargoPlaceStickersPdf(accessToken, payload) {
    return requestBlob('/marketplace-connections/fbs/orders/cargo-place-stickers.pdf', accessToken, {
        method: 'POST',
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function downloadFbsSupplyStickersPdf(accessToken, payload) {
    return requestBlob('/marketplace-connections/fbs/orders/supply-stickers.pdf', accessToken, {
        method: 'POST',
        body: sanitizeFbsOrderSelectionPayload(payload),
    });
}
export async function downloadFbsRequestPickListPdf(accessToken, requestId) {
    return requestBlob(`/marketplace-connections/fbs/requests/${requestId}/pick-list.pdf`, accessToken);
}
export async function createFbsMarketplaceConnection(accessToken, payload) {
    return request('/marketplace-connections/fbs/connections', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchFbsPasses(accessToken, clientId, connectionId) {
    return request(withQuery('/marketplace-connections/fbs/passes', { clientId, connectionId }), { accessToken });
}
export async function createFbsPass(accessToken, payload) {
    return request('/marketplace-connections/fbs/passes', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function updateFbsPass(accessToken, passId, payload) {
    return request(`/marketplace-connections/fbs/passes/${passId}`, {
        method: 'PUT',
        accessToken,
        body: payload,
    });
}
export async function deleteFbsPass(accessToken, passId, clientId, connectionId) {
    return request(withQuery(`/marketplace-connections/fbs/passes/${passId}`, { clientId, connectionId }), { method: 'DELETE', accessToken });
}
export async function fetchFbsBillingSettings(accessToken, clientId) {
    return request(`/marketplace-connections/fbs/billing-settings/${clientId}`, {
        accessToken,
    });
}
export async function updateFbsBillingSettings(accessToken, clientId, payload) {
    return request(`/marketplace-connections/fbs/billing-settings/${clientId}`, {
        method: 'PUT',
        body: payload,
        accessToken,
    });
}
export async function fetchFbsCalculatorDestinations(accessToken) {
    return request('/marketplace-connections/fbs/calculator/destinations', {
        accessToken,
    });
}
export async function quoteFbsCalculator(accessToken, payload) {
    return request('/marketplace-connections/fbs/calculator/quote', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createMarketplaceConnection(accessToken, payload) {
    return request('/marketplace-connections', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateMarketplaceConnection(accessToken, connectionId, payload) {
    return request(`/marketplace-connections/${connectionId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function deleteMarketplaceConnection(accessToken, connectionId) {
    return request(`/marketplace-connections/${connectionId}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function syncMarketplaceProducts(accessToken, connectionId) {
    return request(`/marketplace-connections/${connectionId}/sync-products`, {
        method: 'POST',
        accessToken,
    });
}
export async function fetchDbsIntegrations(accessToken, filter = {}) {
    return request(withQuery('/marketplace-connections/dbs/integrations', filter), {
        accessToken,
    });
}
export async function createDbsIntegration(accessToken, payload) {
    return request('/marketplace-connections/dbs/integrations', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateDbsIntegration(accessToken, integrationId, payload) {
    return request(`/marketplace-connections/dbs/integrations/${encodeURIComponent(integrationId)}`, { method: 'PATCH', body: payload, accessToken });
}
export async function checkDbsIntegration(accessToken, integrationId) {
    return request(`/marketplace-connections/dbs/integrations/${encodeURIComponent(integrationId)}/check`, { method: 'POST', accessToken });
}
export async function checkMarketplaceConnection(accessToken, connectionId) {
    return request(`/marketplace-connections/${connectionId}/check`, {
        method: 'POST',
        accessToken,
    });
}
export async function fetchBoxes(accessToken, filter = {}) {
    return request(withQuery('/warehouse/boxes', filter), {
        accessToken,
    });
}
export async function fetchWarehouseBoxChecks(accessToken, clientId) {
    return request(withQuery('/warehouse/box-checks', { clientId }), { accessToken });
}
export async function runWarehouseBoxCheck(accessToken, payload) {
    return request('/warehouse/box-checks', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function decideWarehouseBoxCheckRow(accessToken, rowId, payload) {
    return request(`/warehouse/box-check-rows/${rowId}/decision`, {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function fetchShippedKizHistory(accessToken, filter = {}) {
    return request(withQuery('/warehouse/shipment-history', filter), { accessToken });
}
export async function syncShippedKizHistory(accessToken, clientId) {
    return request('/warehouse/shipment-history/sync', {
        method: 'POST',
        accessToken,
        body: { clientId },
    });
}
export async function fetchStorageLayout(accessToken, filter = {}) {
    return request(withQuery('/warehouse/storage-locations', {
        warehouseId: filter.warehouseId,
        query: filter.query,
        sync: filter.sync === undefined ? undefined : String(filter.sync),
    }), { accessToken });
}
export async function syncStorageLayout(accessToken, warehouseId, clientId) {
    return request('/warehouse/storage-locations/sync-google', {
        method: 'POST',
        accessToken,
        body: { warehouseId, clientId },
    });
}
export async function createStorageZone(accessToken, payload) {
    return request('/warehouse/storage-locations/zones', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function createStoragePallet(accessToken, payload) {
    return request('/warehouse/storage-locations/pallets', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function updateStoragePallet(accessToken, id, payload) {
    return request(`/warehouse/storage-locations/pallets/${id}`, {
        method: 'PATCH',
        accessToken,
        body: payload,
    });
}
export async function deleteStoragePallet(accessToken, id) {
    return request(`/warehouse/storage-locations/pallets/${id}`, { method: 'DELETE', accessToken });
}
export async function addStoragePalletBox(accessToken, palletId, boxCode) {
    return request(`/warehouse/storage-locations/pallets/${palletId}/boxes`, {
        method: 'POST',
        accessToken,
        body: { boxCode },
    });
}
export async function relocateStoragePalletBox(accessToken, payload) {
    return request('/warehouse/storage-locations/pallets/boxes/relocate', {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function removeStoragePalletBox(accessToken, palletId, boxCode) {
    return request(`/warehouse/storage-locations/pallets/${palletId}/boxes/${encodeURIComponent(boxCode)}`, { method: 'DELETE', accessToken });
}
export async function fetchOnlineReceipts(accessToken, filter = {}) {
    return request(withQuery('/warehouse/online-receipts', filter), {
        accessToken,
    });
}
export async function fetchReceiptBatches(accessToken, clientId) {
    return request(withQuery('/warehouse/receipt-batches', { clientId }), { accessToken });
}
export async function fetchGoodsArrivals(accessToken, filter) {
    return request(withQuery('/warehouse/goods-arrivals', filter), { accessToken });
}
export async function fetchGoodsArrivalEstimate(accessToken, clientId) {
    return request(withQuery('/warehouse/goods-arrivals/summary', { clientId }), { accessToken });
}
export async function createGoodsArrival(accessToken, payload) {
    return request('/warehouse/goods-arrivals', { method: 'POST', accessToken, body: payload });
}
export async function deleteGoodsArrival(accessToken, id) {
    return request(`/warehouse/goods-arrivals/${id}`, { method: 'DELETE', accessToken });
}
export async function billGoodsArrivals(accessToken, payload) {
    return request('/warehouse/goods-arrivals/bill', { method: 'POST', accessToken, body: payload });
}
export async function openOnlineReceiptBox(accessToken, payload) {
    return request('/warehouse/online-receipts/boxes/open', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function closeOnlineReceiptBox(accessToken, payload) {
    return request('/warehouse/online-receipts/boxes/close', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function closeAllOnlineReceiptBoxes(accessToken, payload) {
    return request('/warehouse/online-receipts/boxes/close-open', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function finishOnlineReceipt(accessToken, payload) {
    return request('/warehouse/online-receipts/finish', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function deleteOnlineReceiptBox(accessToken, payload) {
    return request('/warehouse/online-receipts/boxes', {
        method: 'DELETE',
        body: payload,
        accessToken,
    });
}
export async function restoreOnlineReceiptBox(accessToken, payload) {
    return request('/warehouse/online-receipts/boxes/restore', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function addOnlineReceiptItem(accessToken, payload) {
    return request('/warehouse/online-receipts/items', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateOnlineReceiptItem(accessToken, movementId, payload) {
    return request(`/warehouse/online-receipts/items/${movementId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function deleteOnlineReceiptItem(accessToken, movementId, payload = {}) {
    return request(`/warehouse/online-receipts/items/${movementId}`, {
        method: 'DELETE',
        body: payload,
        accessToken,
    });
}
export async function fetchPallets(accessToken, filter = {}) {
    return request(withQuery('/warehouse/pallets', filter), {
        accessToken,
    });
}
export async function fetchRoles(accessToken) {
    return request('/users/roles', {
        accessToken,
    });
}
export async function fetchUsers(accessToken) {
    return request('/users', {
        accessToken,
    });
}
export async function createUser(accessToken, payload) {
    return request('/users', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateUserClientScopes(accessToken, userId, payload) {
    return request(`/users/${userId}/client-scopes`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchUserReferralClients(accessToken, userId) {
    return request(`/users/${userId}/referrals`, {
        accessToken,
    });
}
export async function updateUserReferralClients(accessToken, userId, payload) {
    return request(`/users/${userId}/referrals`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateUserRoles(accessToken, userId, payload) {
    return request(`/users/${userId}/roles`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function updateUserProfile(accessToken, userId, payload) {
    return request(`/users/${userId}/profile`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function setUserTsdActivationCode(accessToken, userId, code) {
    return request(`/users/${userId}/tsd-activation-code`, {
        method: 'PATCH',
        body: { code },
        accessToken,
    });
}
export async function clearUserTsdActivationCode(accessToken, userId) {
    return request(`/users/${userId}/tsd-activation-code`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function updateUserPrinterScopes(accessToken, userId, payload) {
    return request(`/users/${userId}/printer-scopes`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchReferralReport(accessToken, filter = {}) {
    return request(withQuery('/referrals/report', filter), {
        accessToken,
    });
}
export async function fetchTsdDevices(accessToken) {
    return request('/tsd/devices', {
        accessToken,
    });
}
export async function fetchTsdAssemblyPlan(accessToken, requestId) {
    return request(`/tsd/requests/${requestId}`, {
        accessToken,
    });
}
export async function resolveTsdFbsKizConflict(accessToken, requestId, assemblyId) {
    return request(`/tsd/requests/${requestId}/fbs-kiz-conflicts/${assemblyId}/resolve`, {
        method: 'POST',
        accessToken,
    });
}
export async function restoreTsdFbsRescanFromWildberries(accessToken, requestId, assemblyId) {
    return request(`/tsd/requests/${requestId}/fbs-rescan/${assemblyId}/restore-from-wb`, {
        method: 'POST',
        accessToken,
    });
}
export async function resolveTsdFbsSyncConflict(accessToken, requestId, assemblyId, payload) {
    return request(`/tsd/requests/${requestId}/fbs-sync-conflicts/${assemblyId}/resolve`, {
        method: 'POST',
        accessToken,
        body: payload,
    });
}
export async function resetTsdFbsAssemblyOrder(accessToken, requestId, assemblyId) {
    return request(`/tsd/requests/${requestId}/fbs-assembly/${assemblyId}/reset`, {
        method: 'POST',
        accessToken,
    });
}
export async function markTsdFbsAssemblyPackedWithoutSource(accessToken, requestId, assemblyId) {
    return request(`/tsd/requests/${requestId}/fbs-assembly/${assemblyId}/packed-without-source`, {
        method: 'POST',
        accessToken,
    });
}
/**
 * Publishes the current request composition to the handheld queue.  The TSD
 * receives the refreshed plan on its next queue request; repeating this call
 * is safe and is used when a newly-created request has not appeared yet.
 */
export async function syncClientRequestToTsd(accessToken, requestId) {
    return request(`/client-requests/${requestId}/sync-tsd`, {
        method: 'POST',
        accessToken,
    });
}
export async function downloadTsdOutgoingBoxesXlsx(accessToken, requestId) {
    return requestBlob(`/tsd/requests/${requestId}/outgoing-boxes.xlsx`, accessToken);
}
export async function downloadTsdOutgoingContentsXlsx(accessToken, requestId) {
    return requestBlob(`/tsd/requests/${requestId}/outgoing-contents.xlsx`, accessToken);
}
export async function downloadTsdMovementsXlsx(accessToken, requestId) {
    return requestBlob(`/tsd/requests/${requestId}/movements.xlsx`, accessToken);
}
export async function createTsdDevice(accessToken, payload) {
    return request('/tsd/devices', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchTsdReviewQueue(accessToken) {
    return request('/tsd/review', {
        accessToken,
    });
}
export async function fetchTsdReviewHistory(accessToken) {
    return request('/tsd/review/history', {
        accessToken,
    });
}
export async function resolveTsdReviewOperation(accessToken, operationId, payload) {
    return request(`/tsd/review/${operationId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchLogisticsTariffSets(accessToken) {
    return request('/logistics/tariff-sets', {
        accessToken,
    });
}
export async function fetchLogisticsTariffSet(accessToken, tariffSetId) {
    return request(`/logistics/tariff-sets/${tariffSetId}`, {
        accessToken,
    });
}
export async function downloadTsdReceiptReviewBoxesXlsx(accessToken, clientId) {
    return requestBlob(withQuery('/tsd/review/receipts.xlsx', { clientId }), accessToken);
}
export async function fetchTsdReceiptReviewDashboard(accessToken) {
    return request('/tsd/review/receipts', {
        accessToken,
    });
}
export async function fetchLogisticsDestinationSuggestions(accessToken, filter = {}) {
    return request(withQuery('/logistics/destinations', filter), {
        accessToken,
    });
}
export async function fetchLogisticsCarriers(accessToken) {
    return request('/logistics/carriers', {
        accessToken,
    });
}
export async function createLogisticsCarrier(accessToken, payload) {
    return request('/logistics/carriers', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchLogisticsTrips(accessToken, filter = {}) {
    return request(withQuery('/logistics/trips', filter), {
        accessToken,
    });
}
export async function createLogisticsTrip(accessToken, payload) {
    return request('/logistics/trips', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateLogisticsTripStatus(accessToken, tripId, payload) {
    return request(`/logistics/trips/${tripId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchLogisticsDeliveryRequests(accessToken, filter = {}) {
    return request(withQuery('/logistics/delivery-requests', filter), {
        accessToken,
    });
}
export async function quoteLogistics(accessToken, payload) {
    return request('/logistics/quote', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createLogisticsDeliveryRequest(accessToken, payload) {
    return request('/logistics/delivery-requests', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateLogisticsDeliveryStatus(accessToken, deliveryId, payload) {
    return request(`/logistics/delivery-requests/${deliveryId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function finalizeLogisticsDeliveryQuote(accessToken, deliveryId, payload) {
    return request(`/logistics/delivery-requests/${deliveryId}/quote`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function generateLogisticsDeliveryBillingCharge(accessToken, deliveryId) {
    return request(`/logistics/delivery-requests/${deliveryId}/billing-charge`, {
        method: 'POST',
        accessToken,
    });
}
export async function assignLogisticsDeliveryTrip(accessToken, deliveryId, payload) {
    return request(`/logistics/delivery-requests/${deliveryId}/trip`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function previewBoxLabel(accessToken, payload) {
    return request('/print/box-label/preview', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function previewSkuLabel(accessToken, payload) {
    return request('/print/sku-label/preview', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function previewPalletLabel(accessToken, payload) {
    return request('/print/pallet-label/preview', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchLabelTemplates(accessToken, filter = {}) {
    return request(withQuery('/print/templates', filter), {
        accessToken,
    });
}
export async function createLabelTemplate(accessToken, payload) {
    return request('/print/templates', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updateLabelTemplate(accessToken, templateId, payload) {
    return request(`/print/templates/${templateId}`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function fetchLabelTemplateVersions(accessToken, templateId) {
    return request(`/print/templates/${templateId}/versions`, {
        accessToken,
    });
}
export async function previewLabelTemplate(accessToken, templateId, payload) {
    return request(`/print/templates/${templateId}/preview`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchPrintJobs(accessToken, filter = {}) {
    return request(withQuery('/print/jobs', filter), {
        accessToken,
    });
}
export async function fetchPrintPrinters(accessToken) {
    return request('/print/printers', {
        accessToken,
    });
}
export async function fetchPrintPrinterGroups(accessToken) {
    return request('/print/printer-groups', {
        accessToken,
    });
}
export async function upsertPrintPrinter(accessToken, payload) {
    return request('/print/printers', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function processPrintQueue(accessToken, payload = {}) {
    return request('/print/jobs/process', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function createPrintJobFromTemplate(accessToken, templateId, payload) {
    return request(`/print/templates/${templateId}/jobs`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function updatePrintJobStatus(accessToken, jobId, payload) {
    return request(`/print/jobs/${jobId}/status`, {
        method: 'PATCH',
        body: payload,
        accessToken,
    });
}
export async function reprintPrintJob(accessToken, jobId, payload = {}) {
    return request(`/print/jobs/${jobId}/reprint`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function previewStockImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('clientId', payload.clientId);
    return requestMultipart('/imports/stocks/preview', form, accessToken);
}
export async function commitStockImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('clientId', payload.clientId);
    if (payload.sourceDocument) {
        form.append('sourceDocument', payload.sourceDocument);
    }
    if (payload.stockDate) {
        form.append('stockDate', payload.stockDate);
    }
    return requestMultipart('/imports/stocks/commit', form, accessToken);
}
export async function previewReceiptImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('clientId', payload.clientId);
    return requestMultipart('/imports/receipts/preview', form, accessToken);
}
export async function commitReceiptImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('clientId', payload.clientId);
    if (payload.sourceDocument) {
        form.append('sourceDocument', payload.sourceDocument);
    }
    return requestMultipart('/imports/receipts/commit', form, accessToken);
}
export async function previewLogisticsImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    return requestMultipart('/imports/logistics/preview', form, accessToken);
}
export async function commitLogisticsImport(accessToken, payload) {
    const form = new FormData();
    form.append('file', payload.file);
    if (payload.name) {
        form.append('name', payload.name);
    }
    if (payload.activeFrom) {
        form.append('activeFrom', payload.activeFrom);
    }
    if (payload.activeTo) {
        form.append('activeTo', payload.activeTo);
    }
    return requestMultipart('/imports/logistics/commit', form, accessToken);
}
export async function transferBetweenBoxes(accessToken, payload) {
    return request('/stock/transfers/box-to-box', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function importBoxTransfersXlsx(accessToken, clientId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(withQuery('/stock/transfers/box-to-box/import-xlsx', { clientId }), form, accessToken);
}
export async function previewBoxTransfersXlsx(accessToken, clientId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(withQuery('/stock/transfers/box-to-box/preview-xlsx', { clientId }), form, accessToken);
}
export async function commitBoxTransfersXlsx(accessToken, clientId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(withQuery('/stock/transfers/box-to-box/commit-xlsx', { clientId }), form, accessToken);
}
export async function fetchBoxTransferBatches(accessToken, clientId) {
    return request(withQuery('/stock/transfers/box-to-box/batches', { clientId }), {
        accessToken,
    });
}
export async function downloadBoxTransferBatchFile(accessToken, batchId) {
    return requestBlob(`/stock/transfers/box-to-box/batches/${batchId}/file`, accessToken);
}
export async function reverseBoxTransferBatch(accessToken, batchId) {
    return request(`/stock/transfers/box-to-box/batches/${batchId}`, {
        method: 'DELETE',
        accessToken,
    });
}
export async function pickClientRequest(accessToken, payload) {
    return request('/stock/fulfillment/pick-request', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchPendingPickWaveBalanceReviews(accessToken) {
    return request('/client-requests/balance-reviews/pending', {
        accessToken,
    });
}
export async function fetchPickWaveBalanceReview(accessToken, waveId) {
    return request(`/client-requests/balance-reviews/${waveId}`, {
        accessToken,
    });
}
export async function savePickWaveBalanceReview(accessToken, waveId, decisions) {
    return request(`/client-requests/balance-reviews/${waveId}`, {
        method: 'PATCH',
        body: { decisions },
        accessToken,
    });
}
export async function submitPickWaveBalanceReview(accessToken, waveId) {
    return request(`/client-requests/balance-reviews/${waveId}/submit`, {
        method: 'POST',
        accessToken,
    });
}
export async function fetchPickWaves(accessToken, filter = {}) {
    return request(withQuery('/stock/fulfillment/waves', filter), {
        accessToken,
    });
}
export async function createPickWave(accessToken, payload) {
    return request('/stock/fulfillment/waves', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function runPickWave(accessToken, waveId, payload = {}) {
    return request(`/stock/fulfillment/waves/${waveId}/pick`, {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function fetchPickWaveDocument(accessToken, waveId) {
    return request(`/stock/fulfillment/waves/${waveId}/document`, {
        accessToken,
    });
}
export async function downloadPickWaveDocumentXlsx(accessToken, waveId) {
    return requestBlob(`/stock/fulfillment/waves/${waveId}/document.xlsx`, accessToken);
}
export async function fetchPickInstruction(accessToken, requestId) {
    return request(`/client-requests/${requestId}/pick-instruction`, {
        accessToken,
    });
}
export async function cancelPickWave(accessToken, waveId) {
    return request(`/stock/fulfillment/waves/${waveId}/cancel`, {
        method: 'POST',
        accessToken,
    });
}
export async function refreshPickInstruction(accessToken, requestId) {
    return request(`/client-requests/${requestId}/pick-instruction/refresh`, {
        method: 'POST',
        accessToken,
    });
}
export async function repairFbsRequestSelection(accessToken, requestId) {
    return request(`/marketplace-connections/fbs/requests/${requestId}/repair-selection`, {
        method: 'POST',
        accessToken,
    });
}
export async function checkFbsRequestSupplyConsistency(accessToken, requestId) {
    return request(`/marketplace-connections/fbs/requests/${requestId}/supply-consistency`, { accessToken });
}
export async function repairFbsRequestSupplyConsistency(accessToken, requestId) {
    return request(`/marketplace-connections/fbs/requests/${requestId}/supply-consistency/repair`, { method: 'POST', accessToken });
}
export async function uploadManualPickInstruction(accessToken, requestId, file) {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart(`/client-requests/${requestId}/pick-instruction/manual`, form, accessToken);
}
export async function downloadPickInstructionXlsx(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/pick-instruction.xlsx`, accessToken);
}
export async function downloadClientRequestItemsXlsx(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/items.xlsx`, accessToken);
}
export async function downloadClientRequestWbProductsXlsx(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/marketplace/wb-products.xlsx`, accessToken);
}
export async function downloadClientRequestWbPackagesXlsx(accessToken, requestId) {
    return requestBlob(`/client-requests/${requestId}/marketplace/wb-packages.xlsx`, accessToken);
}
export async function packageClientRequest(accessToken, payload) {
    return request('/stock/fulfillment/package-request', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
export async function shipClientRequest(accessToken, payload) {
    return request('/stock/fulfillment/ship-request', {
        method: 'POST',
        body: payload,
        accessToken,
    });
}
function outboundRequestXlsxForm(payload) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('clientId', payload.clientId);
    appendOptional(form, 'title', payload.title);
    appendOptional(form, 'priority', payload.priority);
    appendOptional(form, 'comment', payload.comment);
    appendOptional(form, 'contactName', payload.contactName);
    appendOptional(form, 'contactPhone', payload.contactPhone);
    appendOptional(form, 'destinationCity', payload.destinationCity);
    appendOptional(form, 'deliveryAddress', payload.deliveryAddress);
    appendOptional(form, 'desiredDate', payload.desiredDate);
    return form;
}
function appendOptional(form, key, value) {
    if (value?.trim()) {
        form.append(key, value.trim());
    }
}
export async function fetchOzonFboOverview(accessToken, clientId) {
    return request(withQuery('/ozon-fbo/overview', { clientId }), { accessToken });
}
export async function fetchOzonFboPlan(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}`, { accessToken });
}
export async function syncOzonFboSkus(accessToken, connectionId) {
    return request('/ozon-fbo/skus/sync', { method: 'POST', accessToken, body: { connectionId } });
}
export async function deleteOzonFboPlan(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}`, { method: 'DELETE', accessToken });
}
export async function fetchOzonFboClusters(accessToken, connectionId) {
    return request(withQuery('/ozon-fbo/clusters', { connectionId }), { accessToken });
}
export async function fetchOzonFboDropoffs(accessToken, connectionId, search) {
    return request(withQuery('/ozon-fbo/dropoff-warehouses', { connectionId, search, supplyType: 'CROSSDOCK' }), { accessToken });
}
export async function importOzonFboPlan(accessToken, payload) {
    const form = new FormData();
    form.append('clientId', payload.clientId);
    form.append('connectionId', payload.connectionId);
    form.append('title', payload.title);
    form.append('file', payload.file);
    return requestMultipart('/ozon-fbo/plans/import', form, accessToken);
}
export async function mapOzonFboCluster(accessToken, planId, rowId, cluster) {
    return request(`/ozon-fbo/plans/${planId}/clusters/${rowId}`, {
        method: 'PATCH', accessToken,
        body: { clusterId: cluster.id, macrolocalClusterId: cluster.macrolocalClusterId, clusterName: cluster.name },
    });
}
export async function setOzonFboDropoff(accessToken, planId, warehouse) {
    return request(`/ozon-fbo/plans/${planId}/dropoff`, {
        method: 'PATCH', accessToken,
        body: { warehouseId: String(warehouse.warehouse_id), name: warehouse.name, type: warehouse.warehouse_type, deliveryType: 'DROPOFF' },
    });
}
export async function createOzonFboDraft(accessToken, planId, preferences) {
    return request(`/ozon-fbo/plans/${planId}/draft`, { method: 'POST', accessToken, body: preferences });
}
export async function refreshOzonFboDraft(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}/draft/refresh`, { method: 'POST', accessToken });
}
export async function fetchOzonFboTimeslots(accessToken, planId, dateFrom, dateTo) {
    return request(`/ozon-fbo/plans/${planId}/timeslots`, { method: 'POST', accessToken, body: { dateFrom, dateTo } });
}
export async function bookOzonFboSlot(accessToken, planId, from, to) {
    return request(`/ozon-fbo/plans/${planId}/book-slot`, {
        method: 'POST', accessToken, body: { from, to, confirm: true },
    });
}
export async function refreshOzonFboSupply(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}/supply/refresh`, { method: 'POST', accessToken });
}
export async function generateOzonFboBoxes(accessToken, planId, maxUnitsPerBox, packingMode, mixedThreshold = 20) {
    return request(`/ozon-fbo/plans/${planId}/boxes/generate`, {
        method: 'POST', accessToken, body: { maxUnitsPerBox, packingMode, mixedThreshold },
    });
}
export async function scanOzonFboBox(accessToken, boxId, code) {
    return request(`/ozon-fbo/boxes/${boxId}/scan`, { method: 'POST', accessToken, body: { code } });
}
export async function closeOzonFboBox(accessToken, boxId) {
    return request(`/ozon-fbo/boxes/${boxId}/close`, { method: 'POST', accessToken });
}
export async function reportOzonFboBoxShortage(accessToken, boxId, reason) {
    return request(`/ozon-fbo/boxes/${boxId}/shortage`, {
        method: 'POST', accessToken, body: { reason },
    });
}
export async function resolveOzonFboBoxShortage(accessToken, boxId, decision, comment = '') {
    return request(`/ozon-fbo/boxes/${boxId}/shortage/resolve`, {
        method: 'POST', accessToken, body: { decision, comment },
    });
}
export async function uploadOzonFboCargoes(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}/cargoes/upload`, {
        method: 'POST', accessToken, body: { confirm: true },
    });
}
export async function refreshOzonFboCargoes(accessToken, planId) {
    return request(`/ozon-fbo/plans/${planId}/cargoes/refresh`, { method: 'POST', accessToken });
}
export async function downloadOzonFboAssembly(accessToken, planId) {
    return requestBlob(`/ozon-fbo/plans/${planId}/assembly.xlsx`, accessToken);
}
export async function downloadOzonFboBoxLabels(accessToken, planId) {
    return requestBlob(`/ozon-fbo/plans/${planId}/box-labels.pdf`, accessToken);
}
async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
        throw new Error(await responseError(response));
    }
    return (await response.json());
}
function withQuery(path, params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== false) {
            search.set(key, String(value));
        }
    });
    const query = search.toString();
    return query ? `${path}?${query}` : path;
}
function turnoverQuery(filter) {
    return {
        clientId: filter.clientId,
        skuId: filter.skuId,
        barcode: filter.barcode,
        kiz: filter.kiz,
        search: filter.search,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        limit: filter.limit ? String(filter.limit) : undefined,
        groupBy: filter.groupBy,
    };
}
function turnoverReportQuery(filter) {
    return {
        clientId: filter.clientId,
        skuId: filter.skuId,
        barcode: filter.barcode,
        kiz: filter.kiz,
        search: filter.search,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        limit: filter.limit ? String(filter.limit) : undefined,
    };
}
async function requestMultipart(path, body, accessToken) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        body,
    });
    if (!response.ok) {
        throw new Error(await responseError(response));
    }
    return (await response.json());
}
async function requestBlob(path, accessToken, init = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: init.method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
        throw new Error(await responseError(response));
    }
    return response.blob();
}
async function responseError(response) {
    try {
        const payload = (await response.json());
        if (Array.isArray(payload.message)) {
            return payload.message.join('\n');
        }
        return payload.message || `HTTP ${response.status}`;
    }
    catch {
        return `HTTP ${response.status}`;
    }
}
