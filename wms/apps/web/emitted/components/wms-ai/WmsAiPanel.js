import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bot, BrainCircuit, CheckCircle2, Download, ExternalLink, Globe2, LoaderCircle, Send, ShieldCheck, Sparkles, } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { askWmsAi, downloadWmsAiExport, teachWmsAi, } from '../../lib/wms-ai-api';
import './wms-ai.css';
const starterPrompts = [
    'Покажи мне короба, которые не попали в палет-сорт',
    'Выведи неопознанные WMS короба в палет-сорте',
    'Покажи открытые проблемы КИЗ в выбранном городе',
    'Покажи межфилиальные перемещения за последние 30 дней',
    'Покажи товар «Корея_2голубой» по размерам с остатком до 30 штук и короба',
];
export function WmsAiPanel({ session }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isSending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [downloadingId, setDownloadingId] = useState('');
    const bottomRef = useRef(null);
    const city = session.user.activeWarehouseId ? 'выбранный город' : 'город не выбран';
    const canTeach = useMemo(() => session.user.permissionCodes.includes('system:admin') ||
        session.user.permissionCodes.includes('warehouse:write') ||
        session.user.permissionCodes.includes('stock:write'), [session.user.permissionCodes]);
    async function send(text) {
        const message = text.trim();
        if (!message || isSending)
            return;
        const userMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            text: message,
        };
        setMessages((current) => [...current, userMessage]);
        setInput('');
        setError('');
        setSending(true);
        try {
            const response = await askWmsAi(session.accessToken, message);
            setMessages((current) => [
                ...current,
                { id: response.id, role: 'assistant', response },
            ]);
            window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'ИИ не смог обработать запрос.');
        }
        finally {
            setSending(false);
        }
    }
    function submit(event) {
        event.preventDefault();
        void send(input);
    }
    async function download(response) {
        if (!response.export)
            return;
        setDownloadingId(response.id);
        setError('');
        try {
            const blob = await downloadWmsAiExport(session.accessToken, response.export.tool, response.export.params);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = response.export.fileName;
            anchor.click();
            URL.revokeObjectURL(url);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось скачать Excel.');
        }
        finally {
            setDownloadingId('');
        }
    }
    return (_jsxs("div", { className: "wms-ai-panel", children: [_jsxs("header", { className: "wms-ai-hero", children: [_jsx("span", { className: "wms-ai-hero__icon", children: _jsx(BrainCircuit, { size: 28, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 WMS-\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442" }), _jsx("h2", { children: "\u0418\u0418" }), _jsx("p", { children: "\u0410\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430, \u0433\u043E\u0442\u043E\u0432\u0438\u0442 \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0438 \u0437\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u0435\u0442 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u044B\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u044F." })] }), _jsxs("div", { className: "wms-ai-hero__badges", children: [_jsxs("span", { children: [_jsx(ShieldCheck, { size: 15 }), " \u0414\u0430\u043D\u043D\u044B\u0435 WMS \u043D\u0435 \u0443\u0445\u043E\u0434\u044F\u0442 \u043D\u0430\u0440\u0443\u0436\u0443"] }), _jsxs("span", { children: [_jsx(Globe2, { size: 15 }), " \u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0445 \u043F\u0440\u043E\u0431\u043B\u0435\u043C"] })] })] }), _jsxs("section", { className: "wms-ai-chat", "aria-label": "\u0427\u0430\u0442 \u0441 \u0418\u0418", children: [_jsxs("div", { className: "wms-ai-chat__status", children: [_jsx("span", { className: "wms-ai-online-dot" }), _jsx("strong", { children: "\u0410\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u0433\u043E\u0442\u043E\u0432" }), _jsxs("span", { children: ["\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442: ", city, ". \u0417\u0430\u043F\u0440\u043E\u0441\u044B \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u044B \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u043C \u0441\u043A\u043B\u0430\u0434\u043E\u043C."] })] }), _jsxs("div", { className: "wms-ai-messages", "aria-live": "polite", children: [messages.length === 0 ? (_jsxs("div", { className: "wms-ai-welcome", children: [_jsx(Bot, { size: 34, "aria-hidden": "true" }), _jsx("h3", { children: "\u0427\u0442\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432 WMS?" }), _jsx("p", { children: "\u041C\u043E\u0436\u043D\u043E \u043F\u0438\u0441\u0430\u0442\u044C \u043E\u0431\u044B\u0447\u043D\u044B\u043C\u0438 \u0441\u043B\u043E\u0432\u0430\u043C\u0438. \u0414\u043B\u044F \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0445 \u0441\u043F\u0438\u0441\u043A\u043E\u0432 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438 Excel." }), _jsx("div", { className: "wms-ai-prompts", children: starterPrompts.map((prompt) => (_jsxs("button", { type: "button", onClick: () => void send(prompt), children: [_jsx(Sparkles, { size: 15, "aria-hidden": "true" }), prompt] }, prompt))) })] })) : null, messages.map((message, index) => message.role === 'user' ? (_jsxs("article", { className: "wms-ai-message wms-ai-message--user", children: [_jsx("strong", { children: "\u0412\u044B" }), _jsx("p", { children: message.text })] }, message.id)) : (_jsx(AssistantMessage, { response: message.response, question: findQuestion(messages, index), canTeach: canTeach, isDownloading: downloadingId === message.id, accessToken: session.accessToken, onDownload: () => void download(message.response), onError: setError }, message.id))), isSending ? (_jsxs("article", { className: "wms-ai-message wms-ai-message--assistant wms-ai-thinking", children: [_jsx(LoaderCircle, { className: "spin", size: 19 }), _jsx("span", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E WMS \u0438 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u0431\u0430\u0437\u0443 \u0437\u043D\u0430\u043D\u0438\u0439\u2026" })] })) : null, _jsx("div", { ref: bottomRef })] }), error ? _jsx("div", { className: "wms-ai-error", children: error }) : null, _jsxs("form", { className: "wms-ai-composer", onSubmit: submit, children: [_jsx("textarea", { value: input, onChange: (event) => setInput(event.target.value), onKeyDown: (event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        void send(input);
                                    }
                                }, placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u043F\u043E\u043A\u0430\u0436\u0438 \u043A\u043E\u0440\u043E\u0431\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u0438 \u0432 \u043F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442", rows: 2, maxLength: 1000, disabled: isSending }), _jsxs("button", { type: "submit", disabled: isSending || input.trim().length < 2, children: [isSending ? _jsx(LoaderCircle, { className: "spin", size: 18 }) : _jsx(Send, { size: 18 }), "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"] })] }), _jsx("p", { className: "wms-ai-safety", children: "\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0434\u0430\u043D\u043D\u044B\u0445 \u0438 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u043D\u044B\u0445 \u0431\u043B\u043E\u043A\u043E\u0432 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u043C \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u043E\u043C \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430." })] })] }));
}
function AssistantMessage({ response, question, canTeach, isDownloading, accessToken, onDownload, onError, }) {
    const [showTeach, setShowTeach] = useState(false);
    const [solution, setSolution] = useState('');
    const [isSaving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    async function saveKnowledge() {
        if (solution.trim().length < 3)
            return;
        setSaving(true);
        onError('');
        try {
            await teachWmsAi(accessToken, {
                question,
                solution: solution.trim(),
                sourceUrls: response.sources?.map((source) => source.url),
            });
            setSaved(true);
            setShowTeach(false);
        }
        catch (caught) {
            onError(caught instanceof Error ? caught.message : 'Не удалось сохранить решение.');
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("article", { className: "wms-ai-message wms-ai-message--assistant", children: [_jsxs("header", { children: [_jsxs("span", { children: [_jsx(Bot, { size: 17 }), " \u0418\u0418"] }), _jsx("small", { children: engineLabel(response.engine) })] }), _jsx("h3", { children: response.title }), _jsx("p", { className: "wms-ai-answer", children: response.answer }), response.summary ? (_jsxs("div", { className: "wms-ai-summary", children: [_jsx(Summary, { label: "\u0421\u0442\u0440\u043E\u043A", value: response.summary.rows }), response.summary.boxes !== undefined ? _jsx(Summary, { label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432", value: response.summary.boxes }) : null, response.summary.pallets !== undefined ? _jsx(Summary, { label: "\u041F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442\u043E\u0432", value: response.summary.pallets }) : null, response.summary.skus !== undefined ? _jsx(Summary, { label: "SKU", value: response.summary.skus }) : null, response.summary.clients !== undefined ? _jsx(Summary, { label: "\u041A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", value: response.summary.clients }) : null, response.summary.requests !== undefined ? _jsx(Summary, { label: "\u0417\u0430\u044F\u0432\u043E\u043A", value: response.summary.requests }) : null, response.summary.issues !== undefined ? _jsx(Summary, { label: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C", value: response.summary.issues }) : null, response.summary.transfers !== undefined ? _jsx(Summary, { label: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439", value: response.summary.transfers }) : null, response.summary.totalQuantity !== undefined ? _jsx(Summary, { label: "\u0415\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430", value: response.summary.totalQuantity }) : null] })) : null, response.columns?.length && response.rows?.length ? (_jsx("div", { className: "wms-ai-table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsx("tr", { children: response.columns.map((column) => _jsx("th", { children: column.label }, column.key)) }) }), _jsx("tbody", { children: response.rows.map((row, rowIndex) => (_jsx("tr", { children: response.columns?.map((column) => _jsx("td", { children: String(row[column.key] ?? '—') }, column.key)) }, `${response.id}-${rowIndex}`))) })] }) })) : null, response.sources?.length ? (_jsxs("div", { className: "wms-ai-sources", children: [_jsxs("strong", { children: [_jsx(Globe2, { size: 16 }), " \u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0438 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442-\u043F\u043E\u0438\u0441\u043A\u0430"] }), response.sources.map((source) => (_jsxs("a", { href: source.url, target: "_blank", rel: "noreferrer", children: [_jsx("span", { children: source.title }), _jsx("small", { children: source.snippet }), _jsx(ExternalLink, { size: 14 })] }, source.url)))] })) : null, _jsxs("div", { className: "wms-ai-actions", children: [response.export?.available ? (_jsxs("button", { type: "button", className: "wms-ai-primary", onClick: onDownload, disabled: isDownloading, children: [isDownloading ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(Download, { size: 17 }), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C Excel"] })) : null, response.canTeach && canTeach && !saved ? (_jsxs("button", { type: "button", className: "wms-ai-secondary", onClick: () => setShowTeach((value) => !value), children: [_jsx(BrainCircuit, { size: 17 }), "\u041D\u0430\u0443\u0447\u0438\u0442\u044C \u0418\u0418 \u0440\u0435\u0448\u0435\u043D\u0438\u044E"] })) : null, saved ? _jsxs("span", { className: "wms-ai-saved", children: [_jsx(CheckCircle2, { size: 16 }), " \u0420\u0435\u0448\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u043E\u043C\u043D\u0435\u043D\u043E"] }) : null] }), showTeach ? (_jsxs("div", { className: "wms-ai-teach", children: [_jsxs("label", { children: ["\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u043E\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0435", _jsx("textarea", { rows: 4, value: solution, maxLength: 5000, onChange: (event) => setSolution(event.target.value), placeholder: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435, \u0447\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u043F\u043E\u043C\u043E\u0433\u043B\u043E. \u0420\u0435\u0448\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430." })] }), _jsxs("button", { type: "button", onClick: () => void saveKnowledge(), disabled: isSaving || solution.trim().length < 3, children: [isSaving ? _jsx(LoaderCircle, { className: "spin", size: 16 }) : _jsx(CheckCircle2, { size: 16 }), "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432 \u0431\u0430\u0437\u0443 \u0437\u043D\u0430\u043D\u0438\u0439"] })] })) : null] }));
}
function Summary({ label, value }) {
    return _jsxs("span", { children: [_jsx("small", { children: label }), _jsx("strong", { children: value.toLocaleString('ru-RU') })] });
}
function findQuestion(messages, assistantIndex) {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role === 'user')
            return message.text;
    }
    return '';
}
function engineLabel(engine) {
    if (engine === 'WMS_TOOL')
        return 'данные WMS';
    if (engine === 'LOCAL_KNOWLEDGE')
        return 'локальная база знаний';
    if (engine === 'LOCAL_MODEL')
        return 'локальная модель';
    return 'безопасный режим';
}
