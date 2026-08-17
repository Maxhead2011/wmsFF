import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, FileText, RefreshCw, RotateCcw, Send, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPrintJobFromTemplate, fetchLabelTemplates, fetchPrintJobs, fetchPrintPrinters, processPrintQueue, reprintPrintJob, updatePrintJobStatus, } from '../../lib/api';
import { extractTemplateVariables, sampleVariableValue } from './templateVariables';
const printJobStatusLabels = {
    queued: 'в очереди',
    sent: 'отправлено',
    printed: 'напечатано',
    failed: 'ошибка',
    cancelled: 'отменено',
};
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});
export function PrintJobPanel({ session }) {
    const [templates, setTemplates] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [printers, setPrinters] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [printerCode, setPrinterCode] = useState('');
    const [copies, setCopies] = useState('1');
    const [variableValues, setVariableValues] = useState({});
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedTemplateId) ?? null, [selectedTemplateId, templates]);
    const selectedVariables = useMemo(() => extractTemplateVariables(selectedTemplate?.tspl ?? ''), [selectedTemplate?.tspl]);
    const selectedVariableKey = selectedVariables.join('|');
    useEffect(() => {
        void loadPrintData();
    }, [session.accessToken]);
    useEffect(() => {
        setVariableValues((current) => {
            const nextValues = {};
            selectedVariables.forEach((variable) => {
                nextValues[variable] = current[variable] ?? sampleVariableValue(variable);
            });
            return nextValues;
        });
    }, [selectedVariableKey]);
    async function loadPrintData() {
        setLoading(true);
        setError('');
        try {
            const [templateList, jobList, printerList] = await Promise.all([
                fetchLabelTemplates(session.accessToken),
                fetchPrintJobs(session.accessToken, { limit: '50' }),
                fetchPrintPrinters(session.accessToken),
            ]);
            setTemplates(templateList.filter((template) => template.isActive));
            setJobs(jobList);
            setPrinters(printerList);
            setSelectedTemplateId((current) => current || templateList.find((template) => template.isActive)?.id || '');
            setPrinterCode((current) => current || printerList.find((printer) => printer.isActive)?.code || 'TSC-01');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить очередь печати.');
        }
        finally {
            setLoading(false);
        }
    }
    async function enqueueJob(event) {
        event.preventDefault();
        if (!selectedTemplate) {
            return;
        }
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            const job = await createPrintJobFromTemplate(session.accessToken, selectedTemplate.id, {
                printerCode: printerCode.trim(),
                variables: variableValues,
                copies: parseCopies(copies),
            });
            setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 50));
            setMessage(`Задание ${job.id.slice(0, 8)} поставлено в очередь.`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось поставить задание в очередь.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function changeJobStatus(job, status, messageText) {
        setError('');
        setMessage('');
        try {
            const updated = await updatePrintJobStatus(session.accessToken, job.id, {
                status,
                message: messageText,
            });
            setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось обновить статус задания.');
        }
    }
    async function requeueJob(job) {
        setError('');
        setMessage('');
        try {
            const reprint = await reprintPrintJob(session.accessToken, job.id, {
                reason: 'Повторная печать из web-интерфейса.',
            });
            setJobs((current) => [reprint, ...current.filter((item) => item.id !== reprint.id)].slice(0, 50));
            setMessage(`Задание ${reprint.id.slice(0, 8)} создано как перепечатка ${job.id.slice(0, 8)}.`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось повторить задание печати.');
        }
    }
    async function processQueueNow() {
        setError('');
        setMessage('');
        try {
            const result = await processPrintQueue(session.accessToken, { limit: 50 });
            setMessage(`Очередь обработана: ${result.processed}, напечатано ${result.printed}, отправлено ${result.sent}, ошибок ${result.failed}.`);
            await loadPrintData();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось обработать очередь печати.');
        }
    }
    const canSubmit = Boolean(selectedTemplate && printerCode.trim());
    return (_jsxs("div", { className: "print-job-layout", children: [_jsxs("form", { className: "print-form print-job-create", onSubmit: enqueueJob, children: [_jsxs("div", { className: "print-template-header", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C" }), _jsx("span", { children: "\u0413\u043E\u0442\u043E\u0432\u044B\u0439 TSPL \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u0437\u0430\u0434\u0430\u043D\u0438\u0438 \u043F\u0435\u0447\u0430\u0442\u0438" })] }), _jsx(Send, { size: 18, "aria-hidden": "true" })] }), _jsxs("div", { className: "print-fields print-fields--job", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0428\u0430\u0431\u043B\u043E\u043D" }), _jsxs("select", { value: selectedTemplateId, onChange: (event) => setSelectedTemplateId(event.target.value), disabled: isLoading, children: [templates.length === 0 ? _jsx("option", { value: "", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0448\u0430\u0431\u043B\u043E\u043D\u043E\u0432 \u043D\u0435\u0442" }) : null, templates.map((template) => (_jsxs("option", { value: template.id, children: [template.code, " - ", template.name] }, template.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u043D\u0442\u0435\u0440" }), _jsxs("select", { value: printerCode, onChange: (event) => setPrinterCode(event.target.value), required: true, children: [printers.length === 0 ? _jsx("option", { value: "TSC-01", children: "TSC-01" }) : null, printers
                                                .filter((printer) => printer.isActive)
                                                .map((printer) => (_jsxs("option", { value: printer.code, children: [printer.code, " - ", printer.name] }, printer.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043F\u0438\u0438" }), _jsx("input", { min: "1", max: "100", step: "1", type: "number", value: copies, onChange: (event) => setCopies(event.target.value) })] })] }), selectedVariables.length > 0 ? (_jsx("div", { className: "print-template-vars", children: selectedVariables.map((variable) => (_jsxs("label", { children: [_jsx("span", { children: variable }), _jsx("input", { value: variableValues[variable] ?? '', onChange: (event) => setVariableValues((current) => ({
                                        ...current,
                                        [variable]: event.target.value,
                                    })) })] }, variable))) })) : (_jsx("p", { className: "panel-message", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0448\u0430\u0431\u043B\u043E\u043D, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u044F." })), (error || message) ? _jsx("p", { className: error ? 'form-error' : 'inline-status', children: error || message }) : null, _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(FileText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Ставлю' : 'В очередь' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadPrintData(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void processQueueNow(), disabled: isLoading, children: [_jsx(Send, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C" })] })] })] }), _jsxs("section", { className: "print-job-list", "aria-label": "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u044F \u043F\u0435\u0447\u0430\u0442\u0438", children: [_jsx("div", { className: "print-template-header", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u044F" }), _jsxs("span", { children: [jobs.length, " \u0432 \u0441\u043F\u0438\u0441\u043A\u0435"] })] }) }), jobs.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u0417\u0430\u0434\u0430\u043D\u0438\u0439 \u043F\u0435\u0447\u0430\u0442\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." })) : (_jsx("div", { className: "print-job-items", children: jobs.map((job) => (_jsxs("article", { className: "print-job-card", children: [_jsxs("div", { children: [_jsx("span", { className: `status status--${statusTone(job.status)}`, children: printJobStatusLabels[job.status] ?? job.status }), _jsx("strong", { children: payloadTemplateName(job) }), _jsxs("small", { children: [job.printerCode, " \u00B7 ", job.labelType, " \u00B7 ", formatDate(job.createdAt), " \u00B7 \u043F\u043E\u043F\u044B\u0442\u043E\u043A ", job.attempts] }), reprintSummary(job) ? _jsx("small", { children: reprintSummary(job) }) : null, job.processedAt ? _jsxs("small", { children: ["\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E: ", formatDate(job.processedAt)] }) : null] }), _jsxs("div", { className: "print-job-actions", children: [_jsxs("button", { className: "review-action", type: "button", onClick: () => void requeueJob(job), children: [_jsx(RotateCcw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }), _jsxs("button", { className: "review-action review-action--accept", type: "button", onClick: () => void changeJobStatus(job, 'printed'), disabled: job.status === 'printed', children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0413\u043E\u0442\u043E\u0432\u043E" })] }), _jsxs("button", { className: "review-action review-action--reject", type: "button", onClick: () => void changeJobStatus(job, 'failed', 'Оператор отметил ошибку печати.'), disabled: job.status === 'failed', children: [_jsx(XCircle, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0448\u0438\u0431\u043A\u0430" })] })] })] }, job.id))) }))] })] }));
}
function parseCopies(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), 100) : 1;
}
function formatDate(value) {
    return dateTimeFormatter.format(new Date(value));
}
function payloadTemplateName(job) {
    const payload = job.payload ?? {};
    const code = typeof payload.templateCode === 'string' ? payload.templateCode : job.id.slice(0, 8);
    const name = typeof payload.templateName === 'string' ? payload.templateName : 'TSPL job';
    const copies = typeof payload.copies === 'number' ? payload.copies : 1;
    return `${code} - ${name} · ${copies} экз.`;
}
function reprintSummary(job) {
    const sourceJobId = typeof job.payload.reprintOfJobId === 'string' ? job.payload.reprintOfJobId : '';
    if (!sourceJobId) {
        return '';
    }
    const reason = typeof job.payload.reprintReason === 'string' ? job.payload.reprintReason : 'перепечатка';
    return `Повтор ${sourceJobId.slice(0, 8)} · ${reason}`;
}
function statusTone(status) {
    if (status === 'queued' || status === 'sent') {
        return 'in-progress';
    }
    if (status === 'printed') {
        return 'ready';
    }
    return 'planned';
}
