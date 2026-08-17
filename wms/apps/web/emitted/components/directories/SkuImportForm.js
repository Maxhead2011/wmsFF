import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { importNomenclatureXlsx, } from '../../lib/api';
import { DirectoryResultCard } from './DirectoryResultCard';
export function SkuImportForm({ session, onImported }) {
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    async function submit(event) {
        event.preventDefault();
        if (!file) {
            setError('Выберите Excel-файл.');
            return;
        }
        setSubmitting(true);
        setError('');
        setResult(null);
        try {
            const imported = await importNomenclatureXlsx(session.accessToken, { file });
            setResult(imported);
            setFile(null);
            onImported?.();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить номенклатуру.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "directory-form client-import-form", onSubmit: submit, children: [_jsx("div", { className: "directory-subheading directory-subheading--plain", children: _jsxs("div", { children: [_jsx("h3", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B \u0438\u0437 Excel" }), _jsx("span", { children: "\u041A\u043E\u043B\u043E\u043D\u043A\u0438: \u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435, \u0410\u0440\u0442\u0438\u043A\u0443\u043B, \u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u043F\u0435\u0447\u0430\u0442\u0438, \u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434/\u0411\u0430\u0440\u043A\u043E\u0434 \u043F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438" })] }) }), _jsxs("div", { className: "directory-import-row", children: [_jsxs("label", { className: "directory-file-input", children: [_jsx(FileSpreadsheet, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: file ? file.name : 'Выбрать Excel-файл' }), _jsx("input", { accept: ".xlsx,.xls", type: "file", onChange: (event) => {
                                    setFile(event.target.files?.[0] ?? null);
                                    setResult(null);
                                    setError('');
                                } })] }), _jsxs("button", { className: "directory-submit", disabled: isSubmitting || !file, type: "submit", children: [_jsx(Upload, { size: 16, "aria-hidden": "true" }), isSubmitting ? 'Загружаем...' : 'Загрузить номенклатуру'] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, result ? (_jsxs(_Fragment, { children: [_jsx(DirectoryResultCard, { title: "\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430", lines: [
                            `Создано: ${result.summary.created}`,
                            `Обновлено: ${result.summary.updated}`,
                            `Пропущено: ${result.summary.skipped}`,
                            `Ошибки: ${result.summary.errors}, предупреждения: ${result.summary.warnings}`,
                        ] }), result.issues.length > 0 ? (_jsxs("div", { className: "directory-issues", children: [result.issues.slice(0, 8).map((issue) => (_jsxs("div", { className: `directory-issue directory-issue--${issue.severity}`, children: [_jsx(AlertTriangle, { size: 15, "aria-hidden": "true" }), _jsxs("span", { children: ["\u0421\u0442\u0440\u043E\u043A\u0430 ", issue.row, ": ", issue.message] })] }, `${issue.row}-${issue.message}`))), result.issues.length > 8 ? _jsxs("span", { children: ["\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u043F\u0435\u0440\u0432\u044B\u0435 8 \u0437\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u0438\u0437 ", result.issues.length, "."] }) : null] })) : null] })) : null] }));
}
