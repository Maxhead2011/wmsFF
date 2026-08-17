import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { CalendarDays, Download, FileText, ListChecks, Printer, ReceiptText, WalletCards } from 'lucide-react';
import { downloadBillingInvoiceActPdf } from '../../lib/api';
import { billingSourceLabel, formatCabinetDate, formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';
const periodFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const operationFilters = [
    { key: 'all', label: 'Все' },
    { key: 'services', label: 'Услуги' },
    { key: 'invoices', label: 'Счета' },
    { key: 'acts', label: 'Акты' },
    { key: 'payments', label: 'Оплаты' },
];
export function ClientCabinetPeriodSummary({ accessToken, invoices, charges }) {
    const periods = useMemo(() => buildPeriodGroups(invoices, charges), [invoices, charges]);
    const [selectedKey, setSelectedKey] = useState('');
    const selectedPeriod = periods.find((period) => period.key === selectedKey) ?? periods[0] ?? null;
    return (_jsxs("section", { className: "client-period-summary", "aria-label": "\u041F\u0435\u0440\u0438\u043E\u0434\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("div", { className: "client-cabinet-section__heading", children: [_jsx("h3", { children: "\u041F\u0435\u0440\u0438\u043E\u0434\u044B" }), _jsxs("span", { className: "status status--planned", children: [periods.length, " \u043F\u0435\u0440\u0438\u043E\u0434\u043E\u0432"] })] }), periods.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u041F\u0435\u0440\u0438\u043E\u0434\u043D\u043E\u0439 \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "client-period-summary-list", children: periods.slice(0, 10).map((period) => (_jsxs("button", { className: `client-period-summary-item${period.key === selectedPeriod?.key ? ' is-active' : ''}`, type: "button", onClick: () => setSelectedKey(period.key), children: [_jsx(CalendarDays, { size: 18, "aria-hidden": "true" }), _jsxs("div", { className: "client-period-summary-item__title", children: [_jsx("strong", { children: period.label }), _jsxs("span", { children: [period.chargesCount, " \u043D\u0430\u0447\u0438\u0441\u043B. \u00B7 ", period.invoicesCount, " \u0441\u0447\u0435\u0442\u043E\u0432 \u00B7 ", period.paymentsCount, " \u043E\u043F\u043B\u0430\u0442"] })] }), _jsxs("div", { className: "client-period-summary-item__money", children: [_jsx("span", { children: "\u0423\u0441\u043B\u0443\u0433\u0438" }), _jsxs("strong", { children: [formatCabinetMoney(period.chargesRub), " \u20BD"] })] }), _jsxs("div", { className: "client-period-summary-item__money", children: [_jsx("span", { children: "\u0421\u0447\u0435\u0442\u0430" }), _jsxs("strong", { children: [formatCabinetMoney(period.invoicesRub), " \u20BD"] }), _jsxs("small", { children: ["\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ", formatCabinetMoney(period.paidRub), " \u20BD"] })] }), _jsxs("div", { className: "client-period-summary-item__money", children: [_jsx("span", { children: "\u0414\u043E\u043B\u0433" }), _jsxs("strong", { children: [formatCabinetMoney(period.debtRub), " \u20BD"] }), _jsxs("small", { children: [formatCabinetNumber(period.documentsCount), " \u0434\u043E\u043A."] })] }), _jsx(FileText, { size: 17, "aria-hidden": "true" })] }, period.key))) }), selectedPeriod ? _jsx(ClientCabinetPeriodDetails, { accessToken: accessToken, period: selectedPeriod }) : null] }))] }));
}
function ClientCabinetPeriodDetails({ accessToken, period }) {
    const [operationFilter, setOperationFilter] = useState('all');
    const [downloadingActId, setDownloadingActId] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const showServices = operationFilter === 'all' || operationFilter === 'services';
    const showInvoices = operationFilter === 'all' || operationFilter === 'invoices';
    const showActs = operationFilter === 'all' || operationFilter === 'acts';
    const showPayments = operationFilter === 'all' || operationFilter === 'payments';
    const filteredRowsCount = useMemo(() => buildPeriodExportRows(period, operationFilter).length - 1, [period, operationFilter]);
    async function downloadAct(invoice) {
        setDownloadError('');
        if (!isInvoicePaid(invoice)) {
            setDownloadError(`Акт по счету № ${invoice.number} будет доступен после оплаты.`);
            return;
        }
        setDownloadingActId(invoice.id);
        try {
            const blob = await downloadBillingInvoiceActPdf(accessToken, invoice.id);
            downloadBlobFile(blob, `Акт_${safeFileName(actNumber(invoice.number))}.pdf`);
        }
        catch (caught) {
            setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать акт.');
        }
        finally {
            setDownloadingActId('');
        }
    }
    return (_jsxs("div", { className: "client-period-detail", "aria-label": `Детализация ${period.label}`, children: [_jsxs("div", { className: "client-period-detail__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434" }), _jsx("strong", { children: period.label })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" }), _jsx("strong", { children: formatCabinetNumber(period.documentsCount) })] })] }), _jsxs("div", { className: "client-period-detail-actions", "aria-label": "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043F\u0435\u0440\u0438\u043E\u0434\u0430", children: [_jsx("div", { className: "client-period-filter", role: "group", "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439 \u043F\u0435\u0440\u0438\u043E\u0434\u0430", children: operationFilters.map((filter) => (_jsx("button", { className: filter.key === operationFilter ? 'is-active' : '', type: "button", onClick: () => setOperationFilter(filter.key), children: filter.label }, filter.key))) }), _jsxs("div", { className: "client-period-detail-buttons", children: [_jsxs("button", { type: "button", onClick: () => downloadPeriodCsv(period, operationFilter), disabled: filteredRowsCount === 0, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), "CSV \u043F\u0435\u0440\u0438\u043E\u0434\u0430"] }), _jsxs("button", { type: "button", onClick: () => downloadPeriodPackage(period, operationFilter), disabled: filteredRowsCount === 0, children: [_jsx(Printer, { size: 16, "aria-hidden": "true" }), "\u041F\u0430\u043A\u0435\u0442 \u043F\u0435\u0440\u0438\u043E\u0434\u0430"] })] })] }), downloadError ? _jsx("p", { className: "form-error", children: downloadError }) : null, _jsxs("div", { className: "client-period-detail-grid", children: [showServices ? (_jsx(PeriodDetailColumn, { icon: _jsx(ListChecks, { size: 17, "aria-hidden": "true" }), title: "\u041E\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438", emptyText: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0439 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: period.services.map((service) => (_jsxs("div", { className: "client-period-detail-row", children: [_jsxs("div", { children: [_jsx("strong", { children: service.title }), _jsxs("span", { children: [service.chargesCount, " \u043D\u0430\u0447\u0438\u0441\u043B. \u00B7 ", billingSourceLabel(service.source), " \u00B7 \u043A\u043E\u043B-\u0432\u043E ", formatCabinetNumber(service.quantity)] })] }), _jsxs("strong", { children: [formatCabinetMoney(service.totalRub), " \u20BD"] })] }, service.key))) })) : null, showInvoices ? (_jsx(PeriodDetailColumn, { icon: _jsx(ReceiptText, { size: 17, "aria-hidden": "true" }), title: "\u0421\u0447\u0435\u0442\u0430", emptyText: "\u0421\u0447\u0435\u0442\u043E\u0432 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: period.invoices.map((invoice) => (_jsxs("div", { className: "client-period-detail-row", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0421\u0447\u0435\u0442 \u2116 ", invoice.number] }), _jsxs("span", { children: [formatCabinetDate(invoice.periodFrom), " - ", formatCabinetDate(invoice.periodTo), " \u00B7 ", invoice.items.length, " \u043F\u043E\u0437."] })] }), _jsxs("strong", { children: [formatCabinetMoney(invoice.totalRub), " \u20BD"] })] }, invoice.id))) })) : null, showActs ? (_jsx(PeriodDetailColumn, { icon: _jsx(FileText, { size: 17, "aria-hidden": "true" }), title: "\u0410\u043A\u0442\u044B", emptyText: "\u0410\u043A\u0442\u043E\u0432 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: period.invoices.map((invoice) => {
                            const isPaid = isInvoicePaid(invoice);
                            return (_jsxs("div", { className: "client-period-detail-row client-period-detail-row--action", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0410\u043A\u0442 \u2116 ", actNumber(invoice.number)] }), _jsxs("span", { children: ["\u0441\u0447\u0435\u0442 \u2116 ", invoice.number, " \u00B7 ", isPaid ? 'доступен для скачивания' : 'доступен после оплаты'] })] }), _jsxs("button", { type: "button", onClick: () => void downloadAct(invoice), disabled: !isPaid || downloadingActId === invoice.id, title: isPaid ? 'Скачать акт PDF' : 'Оплатите счет, чтобы скачать акт', children: [_jsx(Download, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: downloadingActId === invoice.id ? 'Скачиваю' : 'Скачать' })] })] }, invoice.id));
                        }) })) : null, showPayments ? (_jsxs(PeriodDetailColumn, { icon: _jsx(WalletCards, { size: 17, "aria-hidden": "true" }), title: "\u041E\u043F\u043B\u0430\u0442\u044B \u0438 \u0434\u043E\u043B\u0433", emptyText: "\u041E\u043F\u043B\u0430\u0442 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: [period.payments.map((payment) => (_jsxs("div", { className: "client-period-detail-row", children: [_jsxs("div", { children: [_jsx("strong", { children: formatCabinetDate(payment.paidAt) }), _jsxs("span", { children: ["\u0441\u0447\u0435\u0442 \u2116 ", payment.invoiceNumber, payment.method ? ` · ${payment.method}` : '', payment.reference ? ` · ${payment.reference}` : ''] })] }), _jsxs("strong", { children: [formatCabinetMoney(payment.amountRub), " \u20BD"] })] }, payment.id))), _jsxs("div", { className: "client-period-detail-row client-period-detail-row--total", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0434\u043E\u043B\u0433\u0430" }), _jsx("span", { children: "\u043F\u043E\u0441\u043B\u0435 \u0443\u0447\u0442\u0435\u043D\u043D\u044B\u0445 \u043E\u043F\u043B\u0430\u0442" })] }), _jsxs("strong", { children: [formatCabinetMoney(period.debtRub), " \u20BD"] })] })] })) : null] })] }));
}
function PeriodDetailColumn({ icon, title, emptyText, children, }) {
    const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
    return (_jsxs("div", { className: "client-period-detail-column", children: [_jsxs("div", { className: "client-period-detail-column__title", children: [icon, _jsx("strong", { children: title })] }), items.length > 0 ? children : _jsx("p", { className: "client-period-detail-empty", children: emptyText })] }));
}
function buildPeriodGroups(invoices, charges) {
    const groups = new Map();
    charges.filter((charge) => charge.status !== 'CANCELLED').forEach((charge) => {
        const group = ensurePeriod(groups, charge.serviceDate);
        group.chargesCount += 1;
        group.chargesRub += Number(charge.totalRub);
        group.documentsCount += 1;
        group.charges.push(charge);
    });
    invoices.filter((invoice) => invoice.status !== 'CANCELLED').forEach((invoice) => {
        const group = ensurePeriod(groups, invoice.periodFrom);
        group.invoicesCount += 1;
        group.paymentsCount += invoice.payments.length;
        group.invoicesRub += Number(invoice.totalRub);
        group.paidRub += Number(invoice.paidRub);
        group.debtRub += Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
        group.documentsCount += 2 + invoice.payments.length;
        group.invoices.push(invoice);
        invoice.payments.forEach((payment) => {
            group.payments.push({
                id: payment.id,
                invoiceNumber: invoice.number,
                paidAt: payment.paidAt,
                amountRub: payment.amountRub,
                method: payment.method,
                reference: payment.reference,
            });
        });
    });
    groups.forEach((group) => {
        group.services = buildServiceGroups(group.charges);
        group.invoices.sort((left, right) => right.periodFrom.localeCompare(left.periodFrom));
        group.payments.sort((left, right) => right.paidAt.localeCompare(left.paidAt));
    });
    return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}
function ensurePeriod(groups, dateValue) {
    const key = periodKey(dateValue);
    const current = groups.get(key);
    if (current) {
        return current;
    }
    const created = {
        key,
        label: periodFormatter.format(new Date(`${key}-01T00:00:00.000Z`)),
        chargesCount: 0,
        invoicesCount: 0,
        paymentsCount: 0,
        chargesRub: 0,
        invoicesRub: 0,
        paidRub: 0,
        debtRub: 0,
        documentsCount: 0,
        charges: [],
        invoices: [],
        payments: [],
        services: [],
    };
    groups.set(key, created);
    return created;
}
function buildServiceGroups(charges) {
    const services = new Map();
    charges.forEach((charge) => {
        const serviceKey = `${charge.service?.id ?? charge.serviceId ?? charge.source}:${charge.source}:${charge.unit}`;
        const current = services.get(serviceKey);
        const quantity = Number(charge.quantity);
        const totalRub = Number(charge.totalRub);
        if (!current) {
            services.set(serviceKey, {
                key: serviceKey,
                title: charge.service?.name ?? charge.description,
                source: charge.source,
                chargesCount: 1,
                quantity,
                totalRub,
            });
            return;
        }
        current.chargesCount += 1;
        current.quantity += quantity;
        current.totalRub += totalRub;
    });
    return [...services.values()].sort((left, right) => right.totalRub - left.totalRub);
}
function periodKey(dateValue) {
    return dateValue.slice(0, 7);
}
function downloadPeriodCsv(period, filter) {
    const rows = buildPeriodExportRows(period, filter);
    const csv = rows.map((row) => row.map(csvCell).join(';')).join('\n');
    downloadTextFile(`period-${period.key}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}
function downloadPeriodPackage(period, filter) {
    const rows = buildPeriodExportRows(period, filter);
    const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Пакет периода ${escapeHtml(period.label)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 24px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p { margin: 0 0 16px; color: #667085; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d7dde8; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f4f6f9; }
    .total { margin-top: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Пакет документов за период: ${escapeHtml(period.label)}</h1>
  <p>Счета, акты, услуги и оплаты по выбранному фильтру.</p>
  <table>
    <thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>
    <tbody>${rows
        .slice(1)
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>
  </table>
  <div class="total">Итого услуг: ${formatCabinetMoney(period.chargesRub)} ₽ · Счета: ${formatCabinetMoney(period.invoicesRub)} ₽ · Оплачено: ${formatCabinetMoney(period.paidRub)} ₽ · Долг: ${formatCabinetMoney(period.debtRub)} ₽</div>
</body>
</html>`;
    downloadTextFile(`period-${period.key}-${filter}.html`, html, 'text/html;charset=utf-8');
}
function buildPeriodExportRows(period, filter) {
    const rows = [['Тип', 'Дата', 'Документ', 'Описание', 'Количество', 'Сумма, ₽']];
    if (filter === 'all' || filter === 'services') {
        period.charges.forEach((charge) => {
            rows.push([
                'Услуга',
                formatCabinetDate(charge.serviceDate),
                charge.service?.name ?? charge.description,
                charge.comment ?? charge.description,
                formatCabinetNumber(Number(charge.quantity)),
                formatCabinetMoney(charge.totalRub),
            ]);
        });
    }
    if (filter === 'all' || filter === 'invoices') {
        period.invoices.forEach((invoice) => {
            rows.push([
                'Счет',
                `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`,
                `Счет № ${invoice.number}`,
                `${invoice.items.length} позиций`,
                String(invoice.items.length),
                formatCabinetMoney(invoice.totalRub),
            ]);
        });
    }
    if (filter === 'all' || filter === 'acts') {
        period.invoices.forEach((invoice) => {
            rows.push([
                'Акт',
                `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`,
                `Акт № ${actNumber(invoice.number)}`,
                isInvoicePaid(invoice) ? 'Доступен для скачивания' : 'Доступен после оплаты счета',
                String(invoice.items.length),
                formatCabinetMoney(invoice.totalRub),
            ]);
        });
    }
    if (filter === 'all' || filter === 'payments') {
        period.payments.forEach((payment) => {
            rows.push([
                'Оплата',
                formatCabinetDate(payment.paidAt),
                `Счет № ${payment.invoiceNumber}`,
                [payment.method, payment.reference].filter(Boolean).join(' · ') || 'Оплата по счету',
                '',
                formatCabinetMoney(payment.amountRub),
            ]);
        });
    }
    return rows;
}
function downloadTextFile(fileName, content, type) {
    const blob = new Blob([content], { type });
    downloadBlobFile(blob, fileName);
}
function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
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
function csvCell(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
