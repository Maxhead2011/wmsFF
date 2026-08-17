import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Network, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPrintPrinters, upsertPrintPrinter, } from '../../lib/api';
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});
export function PrintPrinterPanel({ session }) {
    const [printers, setPrinters] = useState([]);
    const [code, setCode] = useState('TSC-01');
    const [groupCode, setGroupCode] = useState('DEFAULT');
    const [name, setName] = useState('TSC тестовый');
    const [connectionType, setConnectionType] = useState('dry_run');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('9100');
    const [isActive, setActive] = useState(true);
    const [autoProcess, setAutoProcess] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSaving, setSaving] = useState(false);
    useEffect(() => {
        void loadPrinters();
    }, [session.accessToken]);
    async function loadPrinters() {
        setLoading(true);
        setError('');
        try {
            const list = await fetchPrintPrinters(session.accessToken);
            setPrinters(list);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить принтеры.');
        }
        finally {
            setLoading(false);
        }
    }
    async function savePrinter(event) {
        event.preventDefault();
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const saved = await upsertPrintPrinter(session.accessToken, {
                code,
                groupCode,
                name,
                connectionType,
                host: connectionType === 'tcp' ? host.trim() : undefined,
                port: connectionType === 'tcp' ? parsePort(port) : undefined,
                isActive,
                autoProcess,
            });
            setPrinters((current) => [saved, ...current.filter((printer) => printer.id !== saved.id)]);
            setMessage(`Принтер ${saved.code} сохранен.`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить принтер.');
        }
        finally {
            setSaving(false);
        }
    }
    function editPrinter(printer) {
        setCode(printer.code);
        setGroupCode(printer.groupCode);
        setName(printer.name);
        setConnectionType(printer.connectionType);
        setHost(printer.host ?? '');
        setPort(printer.port ? String(printer.port) : '9100');
        setActive(printer.isActive);
        setAutoProcess(printer.autoProcess);
        setMessage('');
        setError('');
    }
    return (_jsxs("div", { className: "print-printer-layout", children: [_jsxs("form", { className: "print-form print-printer-form", onSubmit: savePrinter, children: [_jsxs("div", { className: "print-template-header", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0438\u043D\u0442\u0435\u0440" }), _jsx("span", { children: "\u0422\u0435\u0441\u0442\u043E\u0432\u044B\u0439 \u0440\u0435\u0436\u0438\u043C \u0434\u043B\u044F \u043F\u0438\u043B\u043E\u0442\u0430, TCP \u0434\u043B\u044F \u0441\u0435\u0442\u0435\u0432\u043E\u0433\u043E TSC" })] }), _jsx(Network, { size: 18, "aria-hidden": "true" })] }), _jsxs("div", { className: "print-fields print-fields--printer", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434" }), _jsx("input", { value: code, onChange: (event) => setCode(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u0440\u0443\u043F\u043F\u0430" }), _jsx("input", { value: groupCode, onChange: (event) => setGroupCode(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }), _jsxs("select", { value: connectionType, onChange: (event) => setConnectionType(event.target.value), children: [_jsx("option", { value: "dry_run", children: "\u0422\u0435\u0441\u0442\u043E\u0432\u044B\u0439 \u0440\u0435\u0436\u0438\u043C" }), _jsx("option", { value: "tcp", children: "TCP" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0425\u043E\u0441\u0442" }), _jsx("input", { value: host, onChange: (event) => setHost(event.target.value), disabled: connectionType !== 'tcp' })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0440\u0442" }), _jsx("input", { min: "1", max: "65535", type: "number", value: port, onChange: (event) => setPort(event.target.value), disabled: connectionType !== 'tcp' })] })] }), _jsxs("div", { className: "print-switches", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: isActive, onChange: (event) => setActive(event.target.checked) }), _jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D" })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: autoProcess, onChange: (event) => setAutoProcess(event.target.checked) }), _jsx("span", { children: "\u0410\u0432\u0442\u043E\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u0438" })] })] }), (error || message) ? _jsx("p", { className: error ? 'form-error' : 'inline-status', children: error || message }) : null, _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: isSaving, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSaving ? 'Сохраняю' : 'Сохранить принтер' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadPrinters(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] })] }), _jsxs("section", { className: "print-printer-list", "aria-label": "\u0421\u043F\u0438\u0441\u043E\u043A \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432", children: [_jsx("div", { className: "print-template-header", children: _jsxs("div", { children: [_jsx("h3", { children: "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A" }), _jsxs("span", { children: [printers.length, " \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432"] })] }) }), printers.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u041F\u0440\u0438\u043D\u0442\u0435\u0440\u044B \u0435\u0449\u0435 \u043D\u0435 \u0437\u0430\u0432\u0435\u0434\u0435\u043D\u044B." })) : (_jsx("div", { className: "print-job-items", children: printers.map((printer) => (_jsxs("button", { className: "print-printer-card", type: "button", onClick: () => editPrinter(printer), children: [_jsx("span", { className: `status status--${printer.isActive ? 'ready' : 'planned'}`, children: printer.isActive ? 'активен' : 'отключен' }), _jsx("strong", { children: printer.code }), _jsxs("small", { children: ["\u0413\u0440\u0443\u043F\u043F\u0430 ", printer.groupCode] }), _jsxs("small", { children: [printer.name, " \u00B7 ", printerConnectionLabel(printer.connectionType), printer.host ? ` · ${printer.host}:${printer.port}` : ''] }), _jsxs("small", { children: [printer.autoProcess ? 'автоочередь' : 'ручной режим', " \u00B7 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0432\u044F\u0437\u044C ", formatLastSeen(printer.lastSeenAt)] })] }, printer.id))) }))] })] }));
}
function parsePort(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 65535) : 9100;
}
function printerConnectionLabel(value) {
    return value === 'dry_run' ? 'тестовый режим' : 'TCP';
}
function formatLastSeen(value) {
    return value ? dateTimeFormatter.format(new Date(value)) : '-';
}
