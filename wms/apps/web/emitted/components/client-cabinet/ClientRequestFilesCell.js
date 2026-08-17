import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Download, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatCabinetDate } from './clientCabinetFormat';
export function ClientRequestFilesCell({ request, onUpload, onDownload }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function uploadSelected(file) {
        if (!file) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onUpload(request, file);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить файл.');
        }
        finally {
            setBusy(false);
            if (inputRef.current) {
                inputRef.current.value = '';
            }
        }
    }
    async function downloadFile(file) {
        setBusy(true);
        setError(null);
        try {
            await onDownload(request, file);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось скачать файл.');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "client-request-files-cell", children: [_jsx("input", { ref: inputRef, type: "file", onChange: (event) => void uploadSelected(event.currentTarget.files?.[0]), "aria-label": "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0444\u0430\u0439\u043B \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsxs("button", { className: "document-open-button", type: "button", disabled: busy, onClick: () => inputRef.current?.click(), title: "\u041F\u0440\u0438\u043B\u043E\u0436\u0438\u0442\u044C \u0444\u0430\u0439\u043B \u043A \u0437\u0430\u044F\u0432\u043A\u0435", children: [_jsx(FileUp, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: busy ? 'Жду' : 'Файл' })] }), request.files.length > 0 ? (_jsx("div", { className: "client-request-file-list", children: request.files.map((file) => (_jsxs("button", { className: "client-request-file-link", type: "button", disabled: busy, onClick: () => void downloadFile(file), title: `${file.fileName} · ${formatFileSize(file.sizeBytes)}`, children: [_jsx(Download, { size: 13, "aria-hidden": "true" }), _jsx("span", { children: file.fileName }), _jsx("small", { children: formatCabinetDate(file.createdAt) })] }, file.id))) })) : (_jsx("span", { className: "client-request-files-empty", children: "\u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432" })), error ? _jsx("span", { className: "client-request-file-error", children: error }) : null] }));
}
function formatFileSize(sizeBytes) {
    if (sizeBytes < 1024) {
        return `${sizeBytes} Б`;
    }
    const sizeKb = sizeBytes / 1024;
    if (sizeKb < 1024) {
        return `${sizeKb.toFixed(1)} КБ`;
    }
    return `${(sizeKb / 1024).toFixed(1)} МБ`;
}
