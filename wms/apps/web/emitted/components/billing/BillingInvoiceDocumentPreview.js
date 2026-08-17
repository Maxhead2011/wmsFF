import { jsx as _jsx } from "react/jsx-runtime";
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';
export function BillingInvoiceDocumentPreview({ document, onClose }) {
    return _jsx(HtmlDocumentPreview, { title: document.title, fileName: document.fileName, html: document.html, onClose: onClose });
}
