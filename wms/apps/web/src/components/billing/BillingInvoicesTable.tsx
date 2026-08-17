import { ChevronDown, ChevronRight, ClipboardCheck, FileCheck2, FileDown, Layers3, Pencil, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import type { BillingInvoiceStatus, BillingInvoiceSummary } from '../../lib/api';
import { billingInvoiceStatusLabel, billingInvoiceStatusOptions, billingInvoiceStatusTone } from './billingMeta';

type BillingInvoicesTableProps = {
  invoices: BillingInvoiceSummary[];
  canWrite: boolean;
  showClientColumn?: boolean;
  selectableInvoiceIds?: Set<string>;
  selectedInvoiceIds?: Set<string>;
  onInvoiceSelectionChange?: (invoiceIds: Set<string>) => void;
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
  showClientColumn = true,
  selectableInvoiceIds = new Set<string>(),
  selectedInvoiceIds = new Set<string>(),
  onInvoiceSelectionChange,
  onOpenDocument,
  onDownloadPdf,
  onEdit,
  onStatusChange,
}: BillingInvoicesTableProps) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const invoiceGroups = groupBillingInvoices(invoices);
  const selectableInvoices = invoices.filter((invoice) => selectableInvoiceIds.has(invoice.id));
  const showInvoiceSelection = Boolean(onInvoiceSelectionChange) && selectableInvoices.length > 0;
  const allSelectableSelected =
    selectableInvoices.length > 0 && selectableInvoices.every((invoice) => selectedInvoiceIds.has(invoice.id));
  const tableColumnCount =
    7 +
    (showInvoiceSelection ? 1 : 0) +
    (showClientColumn ? 1 : 0) +
    (onOpenDocument || onDownloadPdf ? 1 : 0) +
    (canWrite ? 1 : 0);

  function toggleGroup(groupKey: string) {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function toggleInvoice(invoiceId: string) {
    if (!onInvoiceSelectionChange || !selectableInvoiceIds.has(invoiceId)) {
      return;
    }
    const next = new Set(selectedInvoiceIds);
    if (next.has(invoiceId)) {
      next.delete(invoiceId);
    } else {
      next.add(invoiceId);
    }
    onInvoiceSelectionChange(next);
  }

  function toggleInvoices(invoiceIds: string[]) {
    if (!onInvoiceSelectionChange) {
      return;
    }
    const allowedIds = invoiceIds.filter((id) => selectableInvoiceIds.has(id));
    const allSelected = allowedIds.length > 0 && allowedIds.every((id) => selectedInvoiceIds.has(id));
    const next = new Set(selectedInvoiceIds);
    allowedIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    onInvoiceSelectionChange(next);
  }

  return (
    <div className="billing-table-wrap billing-table-wrap--invoices">
      <table className="data-table billing-table billing-table--invoices">
        <thead>
          <tr>
            {showInvoiceSelection ? (
              <th className="billing-invoice-selection-cell">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={() => toggleInvoices(selectableInvoices.map((invoice) => invoice.id))}
                  aria-label="Выбрать все доступные черновики"
                />
              </th>
            ) : null}
            <th>Счет</th>
            <th>Вид</th>
            {showClientColumn ? <th>Клиент</th> : null}
            <th>Период</th>
            <th>Сумма</th>
            <th>Оплачено</th>
            <th>Статус</th>
            <th>Состав</th>
            {onOpenDocument || onDownloadPdf ? <th>Документы</th> : null}
            {canWrite ? <th>Процесс</th> : null}
          </tr>
        </thead>
        {invoiceGroups.map((group) => {
          const isCollapsed = group.isGrouped && !expandedGroupKeys.has(group.key);
          const groupTotalRub = group.invoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0);
          const groupItems = group.invoices.reduce((sum, invoice) => sum + invoice.items.length, 0);
          const periodFrom = group.invoices.reduce(
            (earliest, invoice) => (invoice.periodFrom < earliest ? invoice.periodFrom : earliest),
            group.invoices[0].periodFrom,
          );
          const periodTo = group.invoices.reduce(
            (latest, invoice) => (invoice.periodTo > latest ? invoice.periodTo : latest),
            group.invoices[0].periodTo,
          );

          return (
          <tbody className={group.isGrouped ? 'billing-invoice-draft-group' : undefined} key={group.key}>
            {group.isGrouped ? (
              <tr className="billing-invoice-draft-group__heading">
                <td colSpan={tableColumnCount}>
                  <div className="billing-invoice-draft-group__summary">
                    {showInvoiceSelection ? (
                      <input
                        type="checkbox"
                        checked={group.invoices
                          .filter((invoice) => selectableInvoiceIds.has(invoice.id))
                          .every((invoice) => selectedInvoiceIds.has(invoice.id))}
                        onChange={() => toggleInvoices(group.invoices.map((invoice) => invoice.id))}
                        aria-label="Выбрать всю группу FBS-черновиков"
                      />
                    ) : null}
                    <Layers3 size={16} aria-hidden="true" />
                    <button
                      className="billing-invoice-draft-group__toggle"
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? 'Развернуть FBS-черновики' : 'Свернуть FBS-черновики'}
                    >
                      {isCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                    </button>
                    <div>
                      <strong>FBS-черновики</strong>
                      <span>
                        {showClientColumn ? `${group.invoices[0].client.name} · ` : ''}
                        {group.invoices.length} сч. · {formatMoney(groupTotalRub)} ₽ · {groupItems} поз. · {formatDate(periodFrom)}–{formatDate(periodTo)}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
            {!isCollapsed ? group.invoices.map((invoice) => {
            const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));

            return (
              <tr key={invoice.id}>
                {showInvoiceSelection ? (
                  <td className="billing-invoice-selection-cell">
                    {selectableInvoiceIds.has(invoice.id) ? (
                      <input
                        type="checkbox"
                        checked={selectedInvoiceIds.has(invoice.id)}
                        onChange={() => toggleInvoice(invoice.id)}
                        aria-label={`Выбрать счёт ${invoice.number}`}
                      />
                    ) : null}
                  </td>
                ) : null}
                <td>
                  <strong>{invoice.number}</strong>
                  {invoice.dueDate ? <span>до {formatDate(invoice.dueDate)}</span> : null}
                </td>
                <td>
                  <div className="billing-invoice-kinds">
                    {invoiceKindLabels(invoice).map((label) => (
                      <span key={label} className={`billing-invoice-kind billing-invoice-kind--${invoiceKindTone(label)}`}>
                        {label}
                      </span>
                    ))}
                  </div>
                </td>
                {showClientColumn ? (
                  <td>
                    <strong>{invoice.client.code}</strong>
                    <span>{invoice.client.name}</span>
                  </td>
                ) : null}
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
            }) : null}
          </tbody>
          );
        })}
      </table>
    </div>
  );
}

type BillingInvoiceGroup = {
  key: string;
  invoices: BillingInvoiceSummary[];
  isGrouped: boolean;
};

function groupBillingInvoices(invoices: BillingInvoiceSummary[]): BillingInvoiceGroup[] {
  const fbsDraftsByClient = new Map<string, BillingInvoiceSummary[]>();
  invoices.forEach((invoice) => {
    if (!isAutomaticFbsDraft(invoice)) {
      return;
    }
    const current = fbsDraftsByClient.get(invoice.clientId) ?? [];
    current.push(invoice);
    fbsDraftsByClient.set(invoice.clientId, current);
  });

  const emittedClients = new Set<string>();
  const groups: BillingInvoiceGroup[] = [];
  invoices.forEach((invoice) => {
    const clientDrafts = fbsDraftsByClient.get(invoice.clientId) ?? [];
    if (isAutomaticFbsDraft(invoice) && clientDrafts.length > 1) {
      if (emittedClients.has(invoice.clientId)) {
        return;
      }
      emittedClients.add(invoice.clientId);
      groups.push({
        key: `fbs-drafts:${invoice.clientId}`,
        invoices: clientDrafts,
        isGrouped: true,
      });
      return;
    }

    groups.push({ key: `invoice:${invoice.id}`, invoices: [invoice], isGrouped: false });
  });
  return groups;
}

function isAutomaticFbsDraft(invoice: BillingInvoiceSummary) {
  return (
    invoice.status === 'DRAFT' &&
    (invoice.sourceKey?.startsWith('fbs-invoice:') === true ||
      invoice.sourceKey?.startsWith('fbs-primary-invoice:') === true ||
      invoice.sourceKey?.startsWith('fbs-merged:') === true)
  );
}

function invoiceKindLabels(invoice: BillingInvoiceSummary) {
  const kinds = new Set<string>();
  if (invoice.sourceKey?.startsWith('fbs-')) {
    kinds.add('FBS');
  }
  if (invoice.sourceKey?.startsWith('fbs-primary-invoice:')) {
    kinds.add('Первичная обработка');
  }
  invoice.items.forEach((item) => {
    const metadata = item.charge?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return;
    }
    const kind = (metadata as { kind?: unknown }).kind;
    if (kind === 'FBS' || kind === 'FBS_DAILY_LOGISTICS') {
      kinds.add('FBS');
    }
    if (kind === 'FBS_PRIMARY_PROCESSING') {
      kinds.add('FBS');
      kinds.add('Первичная обработка');
    }
  });

  if (kinds.size > 0) {
    return [...kinds];
  }
  if (invoice.source === 'LOGISTICS') {
    return ['Логистика'];
  }
  if (invoice.source === 'REQUEST_DONE') {
    return ['Услуги по заявке'];
  }
  return ['Другие услуги'];
}

function invoiceKindTone(label: string) {
  if (label === 'FBS') {
    return 'fbs';
  }
  if (label === 'Первичная обработка') {
    return 'primary';
  }
  if (label === 'Логистика') {
    return 'logistics';
  }
  return 'service';
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}
