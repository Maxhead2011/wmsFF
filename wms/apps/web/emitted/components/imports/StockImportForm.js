import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, FileSearch, RotateCcw, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { commitStockImport, fetchClients, previewStockImport, } from '../../lib/api';
import { StockCommitResultBlock, StockPreviewResult } from './ImportResultBlocks';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function StockImportForm({ session }) {
    const [clients, setClients] = useState([]);
    const [clientsError, setClientsError] = useState('');
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [file, setFile] = useState(null);
    const [sourceDocument, setSourceDocument] = useState('');
    const [preview, setPreview] = useState(null);
    const [commitResult, setCommitResult] = useState(null);
    const [error, setError] = useState('');
    const [busyAction, setBusyAction] = useState(null);
    const fileInputRef = useRef(null);
    useEffect(() => {
        let isActive = true;
        async function loadClients() {
            try {
                const list = await fetchClients(session.accessToken);
                if (!isActive) {
                    return;
                }
                setClients(list);
                setSelectedClientId((current) => current || list[0]?.id || '');
            }
            catch (caught) {
                if (isActive) {
                    setClientsError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
                }
            }
        }
        void loadClients();
        return () => {
            isActive = false;
        };
    }, [session.accessToken]);
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
    function changeClient(clientId) {
        setSelectedClientId(clientId);
        setPreview(null);
        setCommitResult(null);
        setError('');
    }
    async function runPreview() {
        if (!file || !selectedClientId) {
            return;
        }
        setBusyAction('preview');
        setError('');
        setCommitResult(null);
        try {
            setPreview(await previewStockImport(session.accessToken, { file, clientId: selectedClientId }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл остатков.');
        }
        finally {
            setBusyAction(null);
        }
    }
    async function runCommit() {
        if (!file || !selectedClientId) {
            return;
        }
        setBusyAction('commit');
        setError('');
        try {
            setCommitResult(await commitStockImport(session.accessToken, {
                file,
                clientId: selectedClientId,
                sourceDocument: sourceDocument.trim() || file.name,
            }));
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
    const canSubmit = Boolean(file && selectedClientId && !isBusy);
    return (_jsxs("div", { className: "import-form", children: [_jsxs("div", { className: "import-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => changeClient(event.target.value), children: [clients.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442-\u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A" }), _jsx("input", { value: sourceDocument, onChange: (event) => setSourceDocument(event.target.value) })] }), _jsxs("label", { className: "file-field", children: [_jsx(UploadCloud, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: file?.name ?? 'Выберите XLSX-файл остатков' }), _jsx("input", { ref: fileInputRef, accept: ".xlsx,.xls", type: "file", onChange: changeFile })] })] }), clientsError ? _jsx("p", { className: "form-error", children: clientsError }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "import-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: runPreview, disabled: !canSubmit, children: [_jsx(FileSearch, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'preview' ? 'Проверка' : 'Проверить' })] }), _jsxs("button", { className: "primary-button secondary-action", type: "button", onClick: runCommit, disabled: !canSubmit || hasErrors, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'commit' ? 'Загрузка' : 'Записать в WMS' })] }), _jsxs("button", { className: "primary-button import-clear-action", type: "button", onClick: clearImport, disabled: isBusy || (!file && !preview && !commitResult && !error), children: [_jsx(RotateCcw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C / \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C" })] })] }), preview ? _jsx(StockPreviewResult, { preview: preview }) : null, commitResult ? _jsx(StockCommitResultBlock, { result: commitResult }) : null] }));
}
