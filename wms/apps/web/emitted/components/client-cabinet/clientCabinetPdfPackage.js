import { downloadBillingInvoiceActPdf, downloadBillingInvoicePdf, downloadClientRequestPdf, } from '../../lib/api';
export async function downloadClientCabinetPdfPackage(accessToken, data) {
    const files = await loadPdfPackageFiles(accessToken, data);
    if (files.length === 0) {
        throw new Error('Выберите хотя бы один вид документов для PDF-пакета.');
    }
    const zip = await buildZip(files);
    downloadBlob(pdfPackageFileName(data.client.code), zip);
    return files.length;
}
async function loadPdfPackageFiles(accessToken, data) {
    const options = data.options ?? defaultPdfPackageOptions;
    const prefix = options.groupByLegalEntity ? `${legalEntityFolder(data.client)}/` : '';
    const requestFiles = options.includeRequests
        ? data.requests.map(async (request) => ({
            fileName: `${prefix}Заявки/${documentFileName('Заявка', request.title, request.id)}`,
            blob: await downloadClientRequestPdf(accessToken, request.id),
        }))
        : [];
    const invoiceFiles = data.invoices.flatMap((invoice) => [
        ...(options.includeInvoices
            ? [
                asyncPdfFile(`${prefix}Счета/Счет_${safeFileName(invoice.number)}.pdf`, () => downloadBillingInvoicePdf(accessToken, invoice.id)),
            ]
            : []),
        ...(options.includeActs && isInvoicePaid(invoice)
            ? [
                asyncPdfFile(`${prefix}Акты/Акт_${safeFileName(actNumber(invoice.number))}.pdf`, () => downloadBillingInvoiceActPdf(accessToken, invoice.id)),
            ]
            : []),
    ]);
    return uniqueFileNames(await Promise.all([...requestFiles, ...invoiceFiles]));
}
export const defaultPdfPackageOptions = {
    includeRequests: true,
    includeInvoices: true,
    includeActs: true,
    groupByLegalEntity: true,
};
export function countClientCabinetPdfDocuments(data) {
    const options = data.options ?? defaultPdfPackageOptions;
    return ((options.includeRequests ? data.requests.length : 0) +
        (options.includeInvoices ? data.invoices.length : 0) +
        (options.includeActs ? data.invoices.filter(isInvoicePaid).length : 0));
}
async function asyncPdfFile(fileName, load) {
    return {
        fileName,
        blob: await load(),
    };
}
async function buildZip(files) {
    const entries = await prepareEntries(files);
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
        entry.localOffset = offset;
        const localHeader = localFileHeader(entry);
        localParts.push(localHeader, entry.nameBytes, entry.content);
        offset += localHeader.length + entry.nameBytes.length + entry.content.length;
    }
    const centralOffset = offset;
    for (const entry of entries) {
        const centralHeader = centralDirectoryHeader(entry);
        centralParts.push(centralHeader, entry.nameBytes);
        offset += centralHeader.length + entry.nameBytes.length;
    }
    const centralSize = offset - centralOffset;
    const end = endOfCentralDirectory(entries.length, centralSize, centralOffset);
    const zipBytes = concatBytes([...localParts, ...centralParts, end]);
    return new Blob([zipBytes.buffer], { type: 'application/zip' });
}
async function prepareEntries(files) {
    const encoder = new TextEncoder();
    return Promise.all(files.map(async (file) => {
        const content = new Uint8Array(await file.blob.arrayBuffer());
        return {
            fileName: file.fileName,
            nameBytes: encoder.encode(file.fileName),
            content,
            crc32: crc32(content),
            localOffset: 0,
        };
    }));
}
function localFileHeader(entry) {
    const { dosDate, dosTime } = zipTime();
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, entry.crc32, true);
    view.setUint32(18, entry.content.length, true);
    view.setUint32(22, entry.content.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    return header;
}
function centralDirectoryHeader(entry) {
    const { dosDate, dosTime } = zipTime();
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.content.length, true);
    view.setUint32(24, entry.content.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.localOffset, true);
    return header;
}
function endOfCentralDirectory(entriesCount, centralSize, centralOffset) {
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entriesCount, true);
    view.setUint16(10, entriesCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return end;
}
function concatBytes(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
function zipTime() {
    const now = new Date();
    return {
        dosTime: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
        dosDate: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    };
}
const crcTable = new Uint32Array(256).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});
function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
        value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}
function uniqueFileNames(files) {
    const used = new Map();
    return files.map((file) => {
        const count = used.get(file.fileName) ?? 0;
        used.set(file.fileName, count + 1);
        if (count === 0) {
            return file;
        }
        return {
            ...file,
            fileName: file.fileName.replace(/\.pdf$/i, `_${count + 1}.pdf`),
        };
    });
}
function documentFileName(prefix, title, id) {
    return `${prefix}_${safeFileName(title)}_${id.slice(0, 8)}.pdf`;
}
function legalEntityFolder(client) {
    const inn = client.inn ? `_ИНН_${client.inn}` : '';
    return safeFileName(`${client.legalName || client.name || client.code}${inn}`);
}
function actNumber(invoiceNumber) {
    return invoiceNumber.startsWith('INV-') ? `ACT-${invoiceNumber.slice(4)}` : `ACT-${invoiceNumber}`;
}
function pdfPackageFileName(clientCode) {
    const safeClient = safeFileName(clientCode) || 'client';
    return `client-cabinet-${safeClient}-pdf-${new Date().toISOString().slice(0, 10)}.zip`;
}
function safeFileName(value) {
    return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'document';
}
function isInvoicePaid(invoice) {
    return invoice.status === 'PAID' || Number(invoice.paidRub) >= Number(invoice.totalRub);
}
function downloadBlob(fileName, blob) {
    // Русский комментарий: PDF-пакет собирается в браузере из документов, доступных клиенту по его правам.
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
