import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ChevronDown, FileArchive, FileDown, Files, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { downloadClientCabinetDocumentsCsv, downloadClientCabinetFinanceCsv, } from './clientCabinetCsvExport';
import { downloadClientCabinetHtmlPackage } from './clientCabinetHtmlPackage';
import { countClientCabinetPdfDocuments, defaultPdfPackageOptions, downloadClientCabinetPdfPackage, } from './clientCabinetPdfPackage';
export function ClientCabinetExports({ accessToken, client, filters, requests, invoices, charges, serviceHistory, }) {
    const [isOpen, setOpen] = useState(false);
    const [isHtmlPackaging, setHtmlPackaging] = useState(false);
    const [isPdfPackaging, setPdfPackaging] = useState(false);
    const [pdfOptions, setPdfOptions] = useState(defaultPdfPackageOptions);
    const [message, setMessage] = useState('');
    const exportData = { client, filters, requests, invoices, charges, serviceHistory };
    const htmlPackageData = { client, filters, requests, invoices };
    const pdfPackageData = { client, filters, requests, invoices, options: pdfOptions };
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
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось подготовить HTML-пакет.');
        }
        finally {
            setHtmlPackaging(false);
        }
    }
    async function downloadPdfPackage() {
        setPdfPackaging(true);
        setMessage('');
        try {
            const count = await downloadClientCabinetPdfPackage(accessToken, pdfPackageData);
            setMessage(`PDF-пакет готов: ${count} документов.`);
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось подготовить PDF-пакет.');
        }
        finally {
            setPdfPackaging(false);
        }
    }
    return (_jsxs("section", { className: `client-cabinet-exports ${isOpen ? 'is-open' : 'is-collapsed'}`, "aria-label": "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u043E\u0433\u043E \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430", children: [_jsxs("div", { className: "client-cabinet-exports__header", children: [_jsxs("button", { className: "client-cabinet-exports__toggle", type: "button", onClick: () => setOpen((current) => !current), "aria-expanded": isOpen, title: isOpen ? 'Свернуть выгрузки' : 'Показать выгрузки', children: [_jsx(FileDown, { size: 17, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0438" }), _jsx("small", { children: "\u043F\u043E \u0442\u0435\u043A\u0443\u0449\u0438\u043C \u0444\u0438\u043B\u044C\u0442\u0440\u0430\u043C" })] }), _jsx(ChevronDown, { className: "client-cabinet-exports__chevron", size: 17, "aria-hidden": "true" })] }), _jsxs("div", { className: "client-cabinet-exports__metrics", "aria-label": "\u0421\u043E\u0441\u0442\u0430\u0432 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438", children: [_jsxs("span", { children: [documentsCount, " \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u0432"] }), _jsxs("span", { children: [pdfDocumentsCount, " PDF \u0432 \u043F\u0430\u043A\u0435\u0442\u0435"] }), _jsxs("span", { children: [financeRowsCount, " \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0445 \u0441\u0442\u0440\u043E\u043A"] })] })] }), isOpen ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "client-cabinet-exports__pdf-options", "aria-label": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 PDF-\u043F\u0430\u043A\u0435\u0442\u0430", children: [_jsx(PdfOption, { label: "\u0417\u0430\u044F\u0432\u043A\u0438", checked: pdfOptions.includeRequests, onChange: (checked) => setPdfOptions((current) => ({ ...current, includeRequests: checked })) }), _jsx(PdfOption, { label: "\u0421\u0447\u0435\u0442\u0430", checked: pdfOptions.includeInvoices, onChange: (checked) => setPdfOptions((current) => ({ ...current, includeInvoices: checked })) }), _jsx(PdfOption, { label: "\u0410\u043A\u0442\u044B", checked: pdfOptions.includeActs, onChange: (checked) => setPdfOptions((current) => ({ ...current, includeActs: checked })) }), _jsx(PdfOption, { label: "\u041F\u0430\u043F\u043A\u0430 \u044E\u0440\u043B\u0438\u0446\u0430", checked: pdfOptions.groupByLegalEntity, onChange: (checked) => setPdfOptions((current) => ({ ...current, groupByLegalEntity: checked })) })] }), _jsxs("div", { className: "client-cabinet-exports__actions", children: [_jsxs("button", { className: "icon-text-button", type: "button", onClick: () => downloadClientCabinetDocumentsCsv(exportData), disabled: documentsCount === 0, children: [_jsx(FileDown, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B CSV" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void downloadHtmlPackage(), disabled: documentsCount === 0 || isHtmlPackaging, children: [_jsx(Files, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isHtmlPackaging ? 'Готовлю HTML' : 'Пакет HTML' })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void downloadPdfPackage(), disabled: pdfDocumentsCount === 0 || isPdfPackaging, children: [_jsx(FileArchive, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isPdfPackaging ? 'Готовлю PDF' : 'Пакет PDF' })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => downloadClientCabinetFinanceCsv(exportData), disabled: financeRowsCount === 0, children: [_jsx(ReceiptText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0424\u0438\u043D\u0430\u043D\u0441\u044B CSV" })] })] })] })) : null, message ? _jsx("p", { className: "inline-status client-cabinet-exports__message", children: message }) : null] }));
}
function isInvoicePaid(invoice) {
    return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}
function PdfOption({ label, checked, onChange, }) {
    return (_jsxs("label", { className: "client-cabinet-exports__pdf-option", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) }), _jsx("span", { children: label })] }));
}
