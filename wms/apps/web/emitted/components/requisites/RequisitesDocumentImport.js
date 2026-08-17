import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LoaderCircle, UploadCloud } from 'lucide-react';
import { useId, useState } from 'react';
import { parseRequisitesDocument, } from '../../lib/api';
import './requisites-document-import.css';
export function RequisitesDocumentImport({ accessToken, target, disabled = false, onImported, }) {
    const inputId = useId();
    const [status, setStatus] = useState('idle');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    async function selectFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file)
            return;
        setStatus('loading');
        setResult(null);
        setError('');
        try {
            const parsed = await parseRequisitesDocument(accessToken, target, file);
            onImported(parsed.fields);
            setResult(parsed);
            setStatus('success');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось распознать реквизиты.');
            setStatus('error');
        }
    }
    return (_jsxs("section", { className: `requisites-import requisites-import--${status}`, "aria-label": "\u0418\u043C\u043F\u043E\u0440\u0442 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u043E\u0432 \u0438\u0437 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430", children: [_jsx("div", { className: "requisites-import__icon", "aria-hidden": "true", children: status === 'loading' ? _jsx(LoaderCircle, { className: "requisites-import__spinner", size: 22 }) : _jsx(UploadCloud, { size: 22 }) }), _jsxs("div", { className: "requisites-import__body", children: [_jsx("strong", { children: "\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u0438\u0437 \u0444\u0430\u0439\u043B\u0430" }), _jsx("span", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 PDF, XLS \u0438\u043B\u0438 XLSX \u2014 \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0432 \u043F\u043E\u043B\u044F\u0445 \u043D\u0438\u0436\u0435." }), status === 'success' && result ? (_jsxs("p", { className: "requisites-import__result", children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsxs("span", { children: [result.fileName, ": \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u043F\u043E\u043B\u0435\u0439 \u2014 ", result.recognizedFields.length, ". \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0438\u0445 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443."] })] })) : null, status === 'error' ? (_jsxs("p", { className: "requisites-import__error", children: [_jsx(AlertTriangle, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: error })] })) : null, result?.warnings.length ? (_jsx("p", { className: "requisites-import__warning", children: result.warnings.join(' ') })) : null] }), _jsxs("label", { className: "requisites-import__button", htmlFor: inputId, "aria-disabled": disabled || status === 'loading', children: [_jsx(FileSpreadsheet, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: status === 'loading' ? 'Распознаю…' : 'Выбрать файл' })] }), _jsx("input", { className: "requisites-import__input", id: inputId, type: "file", accept: ".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disabled: disabled || status === 'loading', onChange: (event) => void selectFile(event) })] }));
}
