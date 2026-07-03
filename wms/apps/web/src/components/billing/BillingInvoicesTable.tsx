import { ChevronDown, ClipboardCheck, CreditCard, FileCheck2, FileDown, ReceiptText } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import type { BillingInvoiceStatus, BillingInvoiceSummary } from '../../lib/api';
import {
  billingInvoiceStatusLabel,
  billingInvoiceStatusOptions,
  billingInvoiceStatusTone,
  billingUnitLabel,
} from './billingMeta';

type BillingInvoicesTableProps = {
  invoices: BillingInvoiceSummary[];
  canWrite: boolean;
  onOpenDocument?: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void;
  onDownloadPdf?: (invoice: BillingInvoiceSummary, kind: 'invoice' | 'act') => void;
  onPayInvoice?: (invoice: BillingInvoiceSummary) => void;
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
  onPayInvoice,
  onStatusChange,
}: BillingInvoicesTableProps) {
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(invoices[0]?.id ?? '');
  const showDocuments = Boolean(onOpenDocument || onDownloadPdf);
  const columnsCount = 7 + (showDocuments ? 1 : 0) + (canWrite ? 1 : 0);

  useEffect(() => {
    if (expandedInvoiceId && !invoices.some((invoice) => invoice.id === expandedInvoiceId)) {
      setExpandedInvoiceId(invoices[0]?.id ?? '');
    }
  }, [expandedInvoiceId, invoices]);

  return (
    <div className="billing-table-wrap billing-table-wrap--invoices">
      <table className="data-table billing-table billing-table--invoices">
        <thead>
          <tr>
            <th>Счет</th>
            <th>Клиент</th>
            <th>Период</th>
            <th>Сумма</th>
            <th>Оплата</th>
            <th>Статус</th>
            <th>Состав</th>
            {showDocuments ? <th>Документы</th> : null}
            {canWrite ? <th>Управление</th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
            const expanded = expandedInvoiceId === invoice.id;
            const canPay = canWrite && invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && remaining > 0;

            return (
              <Fragment key={invoice.id}>
                <tr className={expanded ? 'billing-invoice-row is-expanded' : 'billing-invoice-row'}>
                  <td>
                    <button
                      className="billing-invoice-number"
                      type="button"
                      onClick={() => setExpandedInvoiceId(expanded ? '' : invoice.id)}
                      aria-expanded={expanded}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                      <span>№ {invoice.number}</span>
                    </button>
                    {invoice.dueDate ? <span>оплатить до {formatDate(invoice.dueDate)}</span> : null}
                    <span className="billing-invoice-source">{invoiceSourceLabel(invoice.source)}</span>
                  </td>
                  <td>
                    <strong>{invoice.client.name}</strong>
                    <span>{invoice.client.code}</span>
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
                    {invoice.paidAt ? <span>{formatDate(invoice.paidAt)}</span> : <span>оплат пока нет</span>}
                  </td>
                  <td>
                    <span className={`status status--${billingInvoiceStatusTone(invoice.status)}`}>
                      {billingInvoiceStatusLabel(invoice.status)}
                    </span>
                    {invoice.issuedAt ? <span>выставлен {formatDate(invoice.issuedAt)}</span> : null}
                  </td>
                  <td>
                    <strong>{invoice.items.length} поз.</strong>
                    <span>{invoice.payments.length} оплат</span>
                  </td>
                  {showDocuments ? (
                    <td>
                      <div className="billing-document-actions">
                        {onOpenDocument ? (
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onOpenDocument(invoice, 'invoice')}
                            title="Открыть счет"
                          >
                            <ReceiptText size={15} aria-hidden="true" />
                            <span>Счет</span>
                          </button>
                        ) : null}
                        {onDownloadPdf ? (
                          <button
                            className="document-open-button"
                            type="button"
                            onClick={() => onDownloadPdf(invoice, 'invoice')}
                            title="Скачать счет PDF"
                          >
                            <FileDown size={15} aria-hidden="true" />
                            <span>PDF</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {canWrite ? (
                    <td>
                      <div className="billing-row-actions">
                        {canPay ? (
                          <button className="icon-text-button" type="button" onClick={() => onPayInvoice?.(invoice)}>
                            <CreditCard size={15} aria-hidden="true" />
                            <span>Оплата</span>
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

                {expanded ? (
                  <tr className="billing-invoice-detail-row">
                    <td colSpan={columnsCount}>
                      <div className="billing-invoice-detail">
                        <div className="billing-invoice-detail__head">
                          <div>
                            <strong>Состав счета № {invoice.number}</strong>
                            <span>
                              {invoice.items.length} позиций, оплачено {formatMoney(invoice.paidRub)} ₽
                            </span>
                          </div>
                          <div className="billing-invoice-detail__actions">
                            {onOpenDocument ? (
                              <>
                                <button className="document-open-button" type="button" onClick={() => onOpenDocument(invoice, 'invoice')}>
                                  <ReceiptText size={15} aria-hidden="true" />
                                  <span>Открыть счет</span>
                                </button>
                                <button className="document-open-button" type="button" onClick={() => onOpenDocument(invoice, 'act')}>
                                  <ClipboardCheck size={15} aria-hidden="true" />
                                  <span>Открыть акт</span>
                                </button>
                              </>
                            ) : null}
                            {onDownloadPdf ? (
                              <>
                                <button className="document-open-button" type="button" onClick={() => onDownloadPdf(invoice, 'invoice')}>
                                  <FileDown size={15} aria-hidden="true" />
                                  <span>Счет PDF</span>
                                </button>
                                <button className="document-open-button" type="button" onClick={() => onDownloadPdf(invoice, 'act')}>
                                  <FileDown size={15} aria-hidden="true" />
                                  <span>Акт PDF</span>
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>

                        {invoice.comment ? <p className="billing-invoice-detail__notice">{invoice.comment}</p> : null}

                        <div className="billing-invoice-detail__grid">
                          <div className="billing-invoice-detail__table-wrap">
                            <table className="data-table billing-invoice-lines-table">
                              <thead>
                                <tr>
                                  <th>Услуга</th>
                                  <th>Ед.</th>
                                  <th>Кол-во</th>
                                  <th>Цена</th>
                                  <th>Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {invoice.items.map((item) => (
                                  <tr key={item.id}>
                                    <td>{item.description}</td>
                                    <td>{billingUnitLabel(item.unit)}</td>
                                    <td>{formatNumber(item.quantity)}</td>
                                    <td>{formatMoney(item.unitPriceRub)} ₽</td>
                                    <td>
                                      <strong>{formatMoney(item.totalRub)} ₽</strong>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="billing-invoice-payments">
                            <strong>Оплаты</strong>
                            {invoice.payments.length > 0 ? (
                              invoice.payments.map((payment) => (
                                <div className="billing-invoice-payment" key={payment.id}>
                                  <span>{formatDate(payment.paidAt)}</span>
                                  <strong>{formatMoney(payment.amountRub)} ₽</strong>
                                  <small>{payment.reference || payment.method || 'без номера платежа'}</small>
                                </div>
                              ))
                            ) : (
                              <p>Оплат по счету пока нет.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function invoiceSourceLabel(value: BillingInvoiceSummary['source']) {
  if (value === 'REQUEST_DONE') {
    return 'авто по заявке';
  }

  if (value === 'LOGISTICS') {
    return 'логистика';
  }

  return 'ручной счет';
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatNumber(value: string | number) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}
