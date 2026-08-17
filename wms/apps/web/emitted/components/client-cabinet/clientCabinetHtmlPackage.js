import { fetchBillingInvoiceActDocument, fetchBillingInvoiceDocument, fetchClientRequestDocument, } from '../../lib/api';
export async function downloadClientCabinetHtmlPackage(accessToken, data) {
    const documents = await loadPackageDocuments(accessToken, data);
    const html = buildHtmlPackage(data, documents);
    const fileName = htmlPackageFileName(data.client.code);
    downloadHtml(fileName, html);
    return documents.length;
}
async function loadPackageDocuments(accessToken, data) {
    const requestDocuments = data.requests.map((request) => fetchClientRequestDocument(accessToken, request.id));
    const invoiceDocuments = data.invoices.flatMap((invoice) => [
        fetchBillingInvoiceDocument(accessToken, invoice.id),
        ...(isInvoicePaid(invoice) ? [fetchBillingInvoiceActDocument(accessToken, invoice.id)] : []),
    ]);
    return (await Promise.all([...requestDocuments, ...invoiceDocuments])).map(toPrintableDocument);
}
function isInvoicePaid(invoice) {
    return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}
function toPrintableDocument(document) {
    return {
        title: document.title,
        fileName: document.fileName,
        html: document.html,
    };
}
function buildHtmlPackage(data, documents) {
    const parsedDocuments = documents.map((document) => ({
        ...parsePrintableHtml(document.html),
        title: document.title,
    }));
    const styles = uniqueText(parsedDocuments.flatMap((document) => document.styles));
    const period = packagePeriodLabel(data.filters);
    const title = `Пакет документов ${data.client.code}`;
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, sans-serif; }
    .package-cover { padding: 28px; background: #ffffff; border-bottom: 1px solid #d1d5db; }
    .package-cover h1 { margin: 0 0 8px; font-size: 24px; }
    .package-cover p { margin: 4px 0; color: #4b5563; }
    .package-toc { margin-top: 18px; display: grid; gap: 6px; }
    .package-toc a { color: #991b1b; text-decoration: none; font-weight: 700; }
    .package-document { margin: 18px auto; max-width: 980px; background: #ffffff; padding: 20px; page-break-before: always; }
    .package-document:first-of-type { page-break-before: auto; }
    .package-document__title { margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid #d1d5db; font-size: 18px; }
    @media print {
      body { background: #ffffff; }
      .package-cover { page-break-after: always; }
      .package-document { margin: 0; max-width: none; box-shadow: none; }
    }
    ${styles.join('\n')}
  </style>
</head>
<body>
  <section class="package-cover">
    <h1>${escapeHtml(title)}</h1>
    <p>Клиент: ${escapeHtml(data.client.name)}</p>
    <p>Период: ${escapeHtml(period)}</p>
    <p>Документов: ${documents.length}</p>
    <nav class="package-toc" aria-label="Состав пакета">
      ${parsedDocuments.map((document, index) => `<a href="#doc-${index + 1}">${index + 1}. ${escapeHtml(document.title)}</a>`).join('\n')}
    </nav>
  </section>
  ${parsedDocuments
        .map((document, index) => `
  <section class="package-document" id="doc-${index + 1}">
    <h2 class="package-document__title">${index + 1}. ${escapeHtml(document.title)}</h2>
    ${document.body}
  </section>`)
        .join('\n')}
</body>
</html>`;
}
function parsePrintableHtml(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const styles = Array.from(parsed.querySelectorAll('style'))
        .map((style) => style.textContent?.trim() ?? '')
        .filter(Boolean);
    return {
        styles,
        body: parsed.body.innerHTML || html,
    };
}
function packagePeriodLabel(filters) {
    if (filters.dateFrom && filters.dateTo) {
        return `${filters.dateFrom} - ${filters.dateTo}`;
    }
    if (filters.dateFrom) {
        return `с ${filters.dateFrom}`;
    }
    if (filters.dateTo) {
        return `по ${filters.dateTo}`;
    }
    return 'без ограничения периода';
}
function uniqueText(values) {
    return values.filter((value, index, list) => list.indexOf(value) === index);
}
function htmlPackageFileName(clientCode) {
    const safeClient = clientCode.replace(/[\\/:*?"<>|]/g, '_') || 'client';
    return `client-cabinet-${safeClient}-documents-${new Date().toISOString().slice(0, 10)}.html`;
}
function downloadHtml(fileName, html) {
    // Русский комментарий: пакет собирается на стороне браузера из уже доступных клиенту документов.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
