import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, FileSearch, RotateCcw, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { commitStockImport, previewStockImport, } from '../../lib/api';
import { StockCommitResultBlock, StockPreviewResult } from '../imports/ImportResultBlocks';
export function ClientCabinetStockImport({ accessToken, client, onImported }) {
    const [file, setFile] = useState(null);
    const [sourceDocument, setSourceDocument] = useState('');
    const [preview, setPreview] = useState(null);
    const [commitResult, setCommitResult] = useState(null);
    const [error, setError] = useState('');
    const [busyAction, setBusyAction] = useState(null);
    const fileInputRef = useRef(null);
    function changeFile(event) {
        const nextFile = event.target.files?.[0] ?? null;
        setFile(nextFile);
        setPreview(null);
        setCommitResult(null);
        setError('');
        if (nextFile && !sourceDocument) {
            setSourceDocument(nextFile.name);
        }
    }
    function clearImport() {
        setFile(null);
        setSourceDocument('');
        setPreview(null);
        setCommitResult(null);
        setError('');
        setBusyAction(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
    async function runPreview() {
        if (!file) {
            return;
        }
        setBusyAction('preview');
        setError('');
        setCommitResult(null);
        try {
            setPreview(await previewStockImport(accessToken, { file, clientId: client.id }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл остатков.');
        }
        finally {
            setBusyAction(null);
        }
    }
    async function runCommit() {
        if (!file) {
            return;
        }
        setBusyAction('commit');
        setError('');
        try {
            setCommitResult(await commitStockImport(accessToken, {
                file,
                clientId: client.id,
                sourceDocument: sourceDocument.trim() || file.name,
            }));
            await onImported();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить остатки.');
        }
        finally {
            setBusyAction(null);
        }
    }
    const hasErrors = Boolean(preview?.issues.some((issue) => issue.severity === 'error'));
    const isBusy = busyAction != null;
    const canSubmit = Boolean(file && !isBusy);
    return (_jsxs("div", { className: "client-cabinet-stock-import", children: [_jsx("div", { className: "client-cabinet-stock-import__heading", children: _jsxs("div", { children: [_jsx("h3", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432" }), _jsxs("span", { children: ["\u041A\u043B\u0438\u0435\u043D\u0442: ", client.code, " - ", client.name] })] }) }), _jsxs("div", { className: "client-cabinet-stock-import__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442-\u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A" }), _jsx("input", { value: sourceDocument, onChange: (event) => setSourceDocument(event.target.value) })] }), _jsxs("label", { className: "client-cabinet-file-field", children: [_jsx(UploadCloud, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: file?.name ?? 'Выберите XLSX-файл остатков' }), _jsx("input", { ref: fileInputRef, accept: ".xlsx,.xls", type: "file", onChange: changeFile })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "client-cabinet-stock-import__actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: runPreview, disabled: !canSubmit, children: [_jsx(FileSearch, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'preview' ? 'Проверка' : 'Проверить' })] }), _jsxs("button", { className: "primary-button secondary-action", type: "button", onClick: runCommit, disabled: !canSubmit || hasErrors, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'commit' ? 'Загрузка' : 'Записать в WMS' })] }), _jsxs("button", { className: "primary-button import-clear-action", type: "button", onClick: clearImport, disabled: isBusy || (!file && !preview && !commitResult && !error), children: [_jsx(RotateCcw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C / \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C" })] })] }), preview ? _jsx(StockPreviewResult, { preview: preview }) : null, commitResult ? _jsx(StockCommitResultBlock, { result: commitResult }) : null] }));
}
