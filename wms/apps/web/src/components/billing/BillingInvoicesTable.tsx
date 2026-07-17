import { ClipboardCheck, FileCheck2, FileDown, Pencil, ReceiptText } from 'lucide-react';
import type { BillingInvoiceStatus, BillingInvoiceSummary } from '../../lib/api';
import { billingInvoiceStatusLabel, billingInvoiceStatusOptions, billingInvoiceStatusTone } from './billingMeta';

type BillingInvoicesTableProps = {
  invoices: BillingInvoiceSummary[];
  canWrite: boolean;
  onOpenDocument?: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void;
  onDownloadPdf?: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void;
  onEdit?: (invoice: BillingInvoiceSummary) => void;
  onStatusChange: (invoiceId: string, status: BillingInvoiceStatus) => void;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function BillingInvoicesTable({
  invoices,
  canWrite,
  onOpenDocument,
  onDownloadPdf,
  onEdit,
  onStatusChange,
}: BillingInvoicesTableProps) {
  return (
    <div className="billing-table-wrap billing-table-wrap--invoices">
      <table className="data-table billing-table billing-table--invoices">
        <thead>
          <tr>
            <th>Счет</th>
            <th>Клиент</th>
            <th>Период</th>
            <th>Сумма</th>
            <th>Оплачено</th>
            <th>Статус</th>
            <th>Состав</th>
            {onOpenDocument || onDownloadPdf ? <th>Документы</th> : null}
            {canWrite ? <th>Процесс</th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));

            return (
              <tr key={invoice.id}>
                <td>
                  <strong>{invoice.number}</strong>
                  {invoice.dueDate ? <span>до {formatDate(invoice.dueDate)}</span> : null}
                </td>
                <td>
                  <strong>{invoice.client.code}</strong>
                  <span>{invoice.client.name}</span>
                </td>
                <td>
                  <strong>{formatDate(invoice.periodFrom)}</strong>
                  <span>{formatDate(invoice.periodTo)}</span>
                </td>
                <td>
                  <strong>{formatMoney(invoice.totalRub)} ₽</strong>
                  <span>остаток {formatMoney(remaining)} ₽</span>
                </td>
                <td>
                  <strong>{formatMoney(invoice.paidRub)} ₽</strong>
                  {invoice.paidAt ? <span>{formatDate(invoice.paidAt)}</span> : null}
                </td>
                <td>
                  <span className={`status status--${billingInvoiceStatusTone(invoice.status)}`}>
                    {billingInvoiceStatusLabel(invoice.status)}
                  </span>
                  {invoice.issuedAt ? <span>{formatDate(invoice.issuedAt)}</span> : null}
                </td>
                <td>
                  <strong>{invoice.items.length} поз.</strong>
                  <span>{invoice.payments.length} оплат</span>
                </td>
                {onOpenDocument || onDownloadPdf ? (
                  <td>
                    <div className="billing-document-actions">
                      {onOpenDocument ? (
                        <>
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onOpenDocument(invoice, 'invoice')}
                            title="Открыть счет HTML"
                          >
                            <ReceiptText size={15} aria-hidden="true" />
                            <span>Счет</span>
                          </button>
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onOpenDocument(invoice, 'act')}
                            title="Открыть акт HTML"
                          >
                            <ClipboardCheck size={15} aria-hidden="true" />
                            <span>Акт</span>
                          </button>
                        </>
                      ) : null}
                      {onDownloadPdf ? (
                        <>
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onDownloadPdf(invoice, 'invoice')}
                            title="Скачать счет PDF"
                          >
                            <FileDown size={15} aria-hidden="true" />
                            <span>Счет PDF</span>
                          </button>
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onDownloadPdf(invoice, 'act')}
                            title="Скачать акт PDF"
                          >
                            <FileDown size={15} aria-hidden="true" />
                            <span>Акт PDF</span>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                ) : null}
                {canWrite ? (
                  <td>
                    <div className="billing-invoice-process-actions">
                      {(invoice.status === 'DRAFT' || invoice.status === 'ISSUED') && onEdit ? (
                        <button className="document-open-button" type="button" onClick={() => onEdit(invoice)} title="Редактировать счет">
                          <Pencil size={15} aria-hidden="true" />
                          <span>Изменить</span>
                        </button>
                      ) : null}
                      <label className="billing-status-select">
                        <FileCheck2 size={15} aria-hidden="true" />
                        <select
                          value={invoice.status}
                          onChange={(event) => onStatusChange(invoice.id, event.target.value as BillingInvoiceStatus)}
                        >
                          {billingInvoiceStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
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

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}
