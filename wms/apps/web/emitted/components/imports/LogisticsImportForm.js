import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CalendarDays, CheckCircle2, FileSearch, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { commitLogisticsImport, previewLogisticsImport, } from '../../lib/api';
import { LogisticsCommitResultBlock, LogisticsPreviewResult } from './ImportResultBlocks';
export function LogisticsImportForm({ session }) {
    const [file, setFile] = useState(null);
    const [name, setName] = useState('');
    const [activeFrom, setActiveFrom] = useState('');
    const [activeTo, setActiveTo] = useState('');
    const [preview, setPreview] = useState(null);
    const [commitResult, setCommitResult] = useState(null);
    const [error, setError] = useState('');
    const [busyAction, setBusyAction] = useState(null);
    function changeFile(event) {
        const nextFile = event.target.files?.[0] ?? null;
        setFile(nextFile);
        setPreview(null);
        setCommitResult(null);
        setError('');
        if (nextFile && !name) {
            setName(nextFile.name.replace(/\.(xlsx|xls)$/i, ''));
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
            setPreview(await previewLogisticsImport(session.accessToken, { file }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить тарифы.');
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
            setCommitResult(await commitLogisticsImport(session.accessToken, {
                file,
                name: name.trim() || file.name,
                activeFrom: activeFrom || undefined,
                activeTo: activeTo || undefined,
            }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить тарифы.');
        }
        finally {
            setBusyAction(null);
        }
    }
    const isBusy = busyAction != null;
    const hasIssues = Boolean(preview?.issues.length);
    const canSubmit = Boolean(file && !isBusy);
    return (_jsxs("div", { className: "import-form", children: [_jsxs("div", { className: "import-fields import-fields--logistics", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u0430\u0431\u043E\u0440\u0430" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D \u0441" }), _jsxs("span", { className: "date-input", children: [_jsx(CalendarDays, { size: 16, "aria-hidden": "true" }), _jsx("input", { type: "date", value: activeFrom, onChange: (event) => setActiveFrom(event.target.value) })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D \u0434\u043E" }), _jsxs("span", { className: "date-input", children: [_jsx(CalendarDays, { size: 16, "aria-hidden": "true" }), _jsx("input", { type: "date", value: activeTo, onChange: (event) => setActiveTo(event.target.value) })] })] }), _jsxs("label", { className: "file-field", children: [_jsx(UploadCloud, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: file?.name ?? 'Выберите XLSX-файл тарифов' }), _jsx("input", { accept: ".xlsx,.xls", type: "file", onChange: changeFile })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "import-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: runPreview, disabled: !canSubmit, children: [_jsx(FileSearch, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'preview' ? 'Проверка' : 'Проверить' })] }), _jsxs("button", { className: "primary-button secondary-action", type: "button", onClick: runCommit, disabled: !canSubmit || hasIssues, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: busyAction === 'commit' ? 'Загрузка' : 'Записать тарифы' })] })] }), preview ? _jsx(LogisticsPreviewResult, { preview: preview }) : null, commitResult ? _jsx(LogisticsCommitResultBlock, { result: commitResult }) : null] }));
}
