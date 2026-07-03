import { ChevronDown, FileArchive, FileDown, Files, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import type {
  BillingChargeSummary,
  BillingInvoiceSummary,
  BillingServiceHistory,
  ClientRequestSummary,
  ClientSummary,
} from '../../lib/api';
import type { ClientCabinetFiltersValue } from './ClientCabinetFilters';
import {
  downloadClientCabinetDocumentsCsv,
  downloadClientCabinetFinanceCsv,
  type ClientCabinetExportData,
} from './clientCabinetCsvExport';
import { downloadClientCabinetHtmlPackage, type ClientCabinetHtmlPackageData } from './clientCabinetHtmlPackage';
import {
  countClientCabinetPdfDocuments,
  defaultPdfPackageOptions,
  downloadClientCabinetPdfPackage,
  type ClientCabinetPdfPackageData,
  type ClientCabinetPdfPackageOptions,
} from './clientCabinetPdfPackage';

type ClientCabinetExportsProps = {
  accessToken: string;
  client: ClientSummary;
  filters: ClientCabinetFiltersValue;
  requests: ClientRequestSummary[];
  invoices: BillingInvoiceSummary[];
  charges: BillingChargeSummary[];
  serviceHistory: BillingServiceHistory | null;
};

export function ClientCabinetExports({
  accessToken,
  client,
  filters,
  requests,
  invoices,
  charges,
  serviceHistory,
}: ClientCabinetExportsProps) {
  const [isOpen, setOpen] = useState(false);
  const [isHtmlPackaging, setHtmlPackaging] = useState(false);
  const [isPdfPackaging, setPdfPackaging] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<ClientCabinetPdfPackageOptions>(defaultPdfPackageOptions);
  const [message, setMessage] = useState('');
  const exportData: ClientCabinetExportData = { client, filters, requests, invoices, charges, serviceHistory };
  const htmlPackageData: ClientCabinetHtmlPackageData = { client, filters, requests, invoices };
  const pdfPackageData: ClientCabinetPdfPackageData = { client, filters, requests, invoices, options: pdfOptions };
  const paidActsCount = invoices.filter(isInvoicePaid).length;
  const documentsCount = requests.length + invoices.length + paidActsCount;
  const pdfDocumentsCount = countClientCabinetPdfDocuments(pdfPackageData);
  const financeRowsCount = charges.length + invoices.length + invoices.reduce((total, invoice) => total + invoice.payments.length, 0);

  async function downloadHtmlPackage() {
    setHtmlPackaging(true);
    setMessage('');

    try {
      const count = await downloadClientCabinetHtmlPackage(accessToken, htmlPackageData);
      setMessage(`HTML-пакет готов: ${count} документов.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось подготовить HTML-пакет.');
    } finally {
      setHtmlPackaging(false);
    }
  }

  async function downloadPdfPackage() {
    setPdfPackaging(true);
    setMessage('');

    try {
      const count = await downloadClientCabinetPdfPackage(accessToken, pdfPackageData);
      setMessage(`PDF-пакет готов: ${count} документов.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось подготовить PDF-пакет.');
    } finally {
      setPdfPackaging(false);
    }
  }

  return (
    <section
      className={`client-cabinet-exports ${isOpen ? 'is-open' : 'is-collapsed'}`}
      aria-label="Выгрузки клиентского кабинета"
    >
      <div className="client-cabinet-exports__header">
        <button
          className="client-cabinet-exports__toggle"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={isOpen}
          title={isOpen ? 'Свернуть выгрузки' : 'Показать выгрузки'}
        >
          <FileDown size={17} aria-hidden="true" />
          <span>
            <strong>Выгрузки</strong>
            <small>по текущим фильтрам</small>
          </span>
          <ChevronDown className="client-cabinet-exports__chevron" size={17} aria-hidden="true" />
        </button>

        <div className="client-cabinet-exports__metrics" aria-label="Состав выгрузки">
          <span>{documentsCount} документов</span>
          <span>{pdfDocumentsCount} PDF в пакете</span>
          <span>{financeRowsCount} финансовых строк</span>
        </div>
      </div>

      {isOpen ? (
        <>
          <div className="client-cabinet-exports__pdf-options" aria-label="Настройки PDF-пакета">
            <PdfOption
              label="Заявки"
              checked={pdfOptions.includeRequests}
              onChange={(checked) => setPdfOptions((current) => ({ ...current, includeRequests: checked }))}
            />
            <PdfOption
              label="Счета"
              checked={pdfOptions.includeInvoices}
              onChange={(checked) => setPdfOptions((current) => ({ ...current, includeInvoices: checked }))}
            />
            <PdfOption
              label="Акты"
              checked={pdfOptions.includeActs}
              onChange={(checked) => setPdfOptions((current) => ({ ...current, includeActs: checked }))}
            />
            <PdfOption
              label="Папка юрлица"
              checked={pdfOptions.groupByLegalEntity}
              onChange={(checked) => setPdfOptions((current) => ({ ...current, groupByLegalEntity: checked }))}
            />
          </div>

          <div className="client-cabinet-exports__actions">
            <button
              className="icon-text-button"
              type="button"
              onClick={() => downloadClientCabinetDocumentsCsv(exportData)}
              disabled={documentsCount === 0}
            >
              <FileDown size={15} aria-hidden="true" />
              <span>Документы CSV</span>
            </button>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => void downloadHtmlPackage()}
              disabled={documentsCount === 0 || isHtmlPackaging}
            >
              <Files size={15} aria-hidden="true" />
              <span>{isHtmlPackaging ? 'Готовлю HTML' : 'Пакет HTML'}</span>
            </button>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => void downloadPdfPackage()}
              disabled={pdfDocumentsCount === 0 || isPdfPackaging}
            >
              <FileArchive size={15} aria-hidden="true" />
              <span>{isPdfPackaging ? 'Готовлю PDF' : 'Пакет PDF'}</span>
            </button>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => downloadClientCabinetFinanceCsv(exportData)}
              disabled={financeRowsCount === 0}
            >
              <ReceiptText size={15} aria-hidden="true" />
              <span>Финансы CSV</span>
            </button>
          </div>
        </>
      ) : null}

      {message ? <p className="inline-status client-cabinet-exports__message">{message}</p> : null}
    </section>
  );
}

function isInvoicePaid(invoice: BillingInvoiceSummary) {
  return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}

function PdfOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="client-cabinet-exports__pdf-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
