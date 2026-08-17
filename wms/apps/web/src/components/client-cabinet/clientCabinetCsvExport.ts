import type {
  BillingChargeSummary,
  BillingInvoiceSummary,
  BillingServiceHistory,
  ClientRequestSummary,
  ClientSummary,
} from '../../lib/api';
import type { ClientCabinetFiltersValue } from './ClientCabinetFilters';
import {
  billingInvoiceStatusLabel,
  billingStatusLabel,
  billingUnitLabel,
  formatCabinetDate,
  formatCabinetMoney,
  formatCabinetNumber,
  requestStatusLabel,
  requestTypeLabel,
} from './clientCabinetFormat';

export type ClientCabinetExportData = {
  client: ClientSummary;
  filters: ClientCabinetFiltersValue;
  requests: ClientRequestSummary[];
  invoices: BillingInvoiceSummary[];
  charges: BillingChargeSummary[];
  serviceHistory: BillingServiceHistory | null;
};

type CsvRow = Array<string | number | null | undefined>;

export function downloadClientCabinetDocumentsCsv(data: ClientCabinetExportData) {
  const rows: CsvRow[] = [
    ['Клиент', data.client.code, data.client.name],
    ['Период', exportPeriodLabel(data.filters)],
    [],
    ['Тип документа', 'Номер/название', 'Период/дата', 'Статус', 'Сумма', 'Оплачено', 'Остаток', 'Файлы', 'Комментарий'],
  ];

  data.requests.forEach((request) => {
    rows.push([
      'Заявка',
      request.title,
      formatCabinetDate(request.desiredDate ?? request.createdAt),
      `${requestTypeLabel(request.type)} / ${requestStatusLabel(request.status)}`,
      '',
      '',
      '',
      request.files.length,
      request.managerComment ?? request.comment ?? '',
    ]);
  });

  data.invoices.forEach((invoice) => {
    const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
    const invoicePeriod = `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`;
    rows.push([
      'Счет',
      `Счет № ${invoice.number}`,
      invoicePeriod,
      billingInvoiceStatusLabel(invoice.status),
      formatCabinetMoney(invoice.totalRub),
      formatCabinetMoney(invoice.paidRub),
      formatCabinetMoney(remaining),
      '',
      invoice.comment ?? '',
    ]);
    rows.push([
      'Акт',
      `Акт № ${invoice.number}`,
      invoicePeriod,
      billingInvoiceStatusLabel(invoice.status),
      formatCabinetMoney(invoice.totalRub),
      formatCabinetMoney(invoice.paidRub),
      formatCabinetMoney(remaining),
      '',
      'Акт формируется на основании счета.',
    ]);
  });

  downloadCsv(csvFileName(data.client.code, 'documents'), rows);
}

export function downloadClientCabinetFinanceCsv(data: ClientCabinetExportData) {
  const rows: CsvRow[] = [
    ['Клиент', data.client.code, data.client.name],
    ['Период', exportPeriodLabel(data.filters)],
    [],
    [
      'Раздел',
      'Номер/описание',
      'Дата/период',
      'Услуга/источник',
      'Кол-во',
      'Ед.',
      'Цена',
      'Сумма',
      'Оплачено',
      'Остаток',
      'Статус',
      'Связанная заявка',
      'Комментарий',
    ],
  ];

  data.serviceHistory?.groups.forEach((group) => {
    rows.push([
      'Итог услуги',
      group.serviceName,
      `${formatCabinetDate(group.firstServiceDate)} - ${formatCabinetDate(group.lastServiceDate)}`,
      group.serviceCode,
      formatCabinetNumber(group.quantity),
      billingUnitLabel(group.unit),
      '',
      formatCabinetMoney(group.totalRub),
      '',
      '',
      billingStatusLabel(group.latestStatus),
      '',
      `${group.chargesCount} начислений`,
    ]);
  });

  data.charges.forEach((charge) => {
    rows.push([
      'Начисление',
      charge.description,
      formatCabinetDate(charge.serviceDate),
      charge.service?.code ?? charge.source,
      formatCabinetNumber(Number(charge.quantity)),
      billingUnitLabel(charge.unit),
      formatCabinetMoney(charge.unitPriceRub),
      formatCabinetMoney(charge.totalRub),
      '',
      '',
      billingStatusLabel(charge.status),
      charge.request?.title ?? '',
      charge.comment ?? '',
    ]);
  });

  data.invoices.forEach((invoice) => {
    const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
    const invoicePeriod = `${formatCabinetDate(invoice.periodFrom)} - ${formatCabinetDate(invoice.periodTo)}`;
    rows.push([
      'Счет',
      `Счет № ${invoice.number}`,
      invoicePeriod,
      `${invoice.items.length} позиций`,
      '',
      '',
      '',
      formatCabinetMoney(invoice.totalRub),
      formatCabinetMoney(invoice.paidRub),
      formatCabinetMoney(remaining),
      billingInvoiceStatusLabel(invoice.status),
      '',
      invoice.comment ?? '',
    ]);

    invoice.payments.forEach((payment) => {
      rows.push([
        'Оплата',
        payment.reference || `Оплата счета № ${invoice.number}`,
        formatCabinetDate(payment.paidAt),
        payment.method ?? 'Способ не указан',
        '',
        '',
        '',
        '',
        formatCabinetMoney(payment.amountRub),
        '',
        payment.status === 'RECORDED' ? 'Проведена' : 'Отменена',
        '',
        payment.comment ?? '',
      ]);
    });
  });

  downloadCsv(csvFileName(data.client.code, 'finance'), rows);
}

function exportPeriodLabel(filters: ClientCabinetFiltersValue) {
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

function csvFileName(clientCode: string, suffix: string) {
  const safeClient = clientCode.replace(/[\\/:*?"<>|]/g, '_') || 'client';
  return `client-cabinet-${safeClient}-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function downloadCsv(fileName: string, rows: CsvRow[]) {
  // Русский комментарий: BOM нужен, чтобы Excel в Windows сразу открывал кириллицу без ручного выбора кодировки.
  const csv = `\uFEFF${rows.map(csvLine).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvLine(row: CsvRow) {
  return row.map(csvCell).join(';');
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
