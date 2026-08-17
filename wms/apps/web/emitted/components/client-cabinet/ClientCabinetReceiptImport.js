import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, FileSearch, RotateCcw, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { commitReceiptImport, previewReceiptImport, } from '../../lib/api';
import { formatCabinetNumber } from './clientCabinetFormat';
export function ClientCabinetReceiptImport({ accessToken, client, onImported }) {
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
            setPreview(await previewReceiptImport(accessToken, { file, clientId: client.id }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл приемки.');
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
            setCommitResult(await commitReceiptImport(accessToken, {
                file,
                clientId: client.id,
                sourceDocument: sourceDocument.trim() || file.name,
            }));
            await onImported();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось записать приемку.');
        }
        finally {
            setBusyAction(null);
        }
    }
    const hasErrors = Boolean(preview?.issues.some((issue) => issue.severity === 'error'));
    const isBusy = busyAction != null;
    const canSubmit = Boolean(file && !isBusy);
    return (_jsxs("div", { className: "client-cabinet-stock-import client-cabinet-receipt-import", children: [_jsx("div", { className: "client-cabinet-stock-import__heading", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0438\u0435\u043C\u043A\u0430 \u0438\u0437 Excel" }), _jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431, \u0431\u0430\u0440\u043A\u043E\u0434, \u041A\u0418\u0417, \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0446\u0432\u0435\u0442 \u0438 \u0440\u0430\u0437\u043C\u0435\u0440 \u0431\u0443\u0434\u0443\u0442 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }) }), _jsxs("div", { className: "client-cabinet-stock-import__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442-\u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A" }), _jsx("input", { value: sourceDocument, onChange: (event) => setSourceDocument(event.target.value) })] }), _jsxs("label", { className: "client-cabinet-file-field", children: [_jsx(UploadCloud, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: file?.name ?? 'Выберите XLSX-файл приемки' }), _jsx("input", { ref: fileInputRef, accept: ".xlsx,.xls", type: "file", onChange: changeFile })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "client-cabinet-stock-import__actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: runPreview, disabled: !canSubmit, children: [_jsx(FileSearch, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'preview' ? 'Проверка' : 'Проверить приемку' })] }), _jsxs("button", { className: "primary-button secondary-action", type: "button", onClick: runCommit, disabled: !canSubmit || hasErrors, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'commit' ? 'Запись' : 'Записать приемку' })] }), _jsxs("button", { className: "primary-button import-clear-action", type: "button", onClick: clearImport, disabled: isBusy || (!file && !preview && !commitResult && !error), children: [_jsx(RotateCcw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C / \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C" })] })] }), preview ? _jsx(ReceiptPreview, { preview: preview }) : null, commitResult ? _jsx(ReceiptCommitResult, { result: commitResult }) : null] }));
}
function ReceiptPreview({ preview }) {
    return (_jsxs("div", { className: "client-cabinet-import-result", children: [_jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsxs("span", { children: ["\u041A\u043E\u0440\u043E\u0431\u043E\u0432: ", formatCabinetNumber(preview.summary.boxes), " \u00B7 \u0442\u043E\u0432\u0430\u0440\u043E\u0432: ", formatCabinetNumber(preview.summary.rows), " \u00B7 \u041A\u0418\u0417:", ' ', formatCabinetNumber(preview.summary.kiz)] }), preview.issues.length > 0 ? (_jsxs("div", { className: "client-cabinet-import-issues", children: [preview.issues.slice(0, 10).map((issue) => (_jsxs("span", { className: `client-cabinet-import-issue client-cabinet-import-issue--${issue.severity}`, children: ["\u0421\u0442\u0440\u043E\u043A\u0430 ", issue.row, ": ", issue.message] }, `${issue.row}-${issue.message}`))), preview.issues.length > 10 ? _jsxs("small", { children: ["\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u043F\u0435\u0440\u0432\u044B\u0435 10 \u0437\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u0438\u0437 ", preview.issues.length, "."] }) : null] })) : (_jsx("small", { children: "\u041E\u0448\u0438\u0431\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E, \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u043F\u0440\u0438\u0435\u043C\u043A\u0443." }))] }));
}
function ReceiptCommitResult({ result }) {
    return (_jsxs("div", { className: "client-cabinet-import-result", children: [_jsx("strong", { children: "\u041F\u0440\u0438\u0435\u043C\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430" }), _jsxs("span", { children: ["\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0439: ", formatCabinetNumber(result.result.movementsCreated), " \u00B7 \u041A\u0418\u0417: ", formatCabinetNumber(result.result.kizCreated), " \u00B7 \u043A\u043E\u0440\u043E\u0431\u043E\u0432:", ' ', formatCabinetNumber(result.summary.boxes)] })] }));
}
