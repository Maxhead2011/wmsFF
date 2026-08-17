import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Send, Trash2, Upload, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createClientRequest, previewOutboundRequestXlsx, uploadClientRequestFile, } from '../../lib/api';
import { requestPriorityOptions } from './clientRequestMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ClientRequestXlsxImportForm({ clients, session, onCreated }) {
    const writableClientIds = useMemo(() => {
        if (session.user.permissionCodes.includes('system:admin') || session.user.clientScopeMode === 'ALL') {
            return new Set(clients.map((client) => client.id));
        }
        return new Set(session.user.writableClientIds);
    }, [clients, session.user]);
    const writableClients = clients.filter((client) => writableClientIds.has(client.id));
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: writableClients[0]?.id ?? '',
    });
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState('NORMAL');
    const [desiredDate, setDesiredDate] = useState('');
    const [destinationCity, setDestinationCity] = useState('');
    const [file, setFile] = useState(null);
    const [fileInputKey, setFileInputKey] = useState(0);
    const [preview, setPreview] = useState(null);
    const [editableLines, setEditableLines] = useState([]);
    const [confirmedRelabels, setConfirmedRelabels] = useState({});
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [isPreviewing, setPreviewing] = useState(false);
    const [isCommitting, setCommitting] = useState(false);
    if (writableClients.length === 0) {
        return null;
    }
    async function previewFile(event) {
        event.preventDefault();
        if (!file) {
            setError('Выберите Excel-файл.');
            return;
        }
        setPreviewing(true);
        setError(null);
        setMessage('');
        try {
            const nextPreview = await previewOutboundRequestXlsx(session.accessToken, {
                file,
                clientId,
                title: title || undefined,
                priority,
                destinationCity,
                desiredDate: desiredDate || undefined,
            });
            setPreview(nextPreview);
            setEditableLines(nextPreview.lines.map((line, index) => ({
                ...line,
                needsRelabel: Boolean(line.needsRelabel || line.relabelTargetBarcode),
                key: `${line.barcode ?? line.originalName ?? line.internalSku ?? index}-${index}`,
                relabelSourceSelected: Boolean(line.relabelTargetBarcode),
                relabelSourceSearch: line.relabelTargetBarcode ? relabelSourceOptionLabel(nextPreview.relabelSourceOptions.find((option) => option.skuId === line.skuId)) : '',
                relabelTargetSkuId: line.relabelTargetBarcode ? null : line.skuId,
                relabelTargetName: line.relabelTargetBarcode ? null : line.name,
                relabelTargetInternalSku: line.relabelTargetBarcode ? null : line.internalSku,
                relabelTargetOriginalBarcode: line.relabelTargetBarcode ?? line.barcode,
            })));
            setConfirmedRelabels({});
            setMessage(nextPreview.canCommit ? 'Файл готов к созданию заявки.' : 'Файл требует исправлений.');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл.');
        }
        finally {
            setPreviewing(false);
        }
    }
    async function createRequest() {
        const validLines = editableLines.filter((line) => line.skuId && adjustedCanFulfill(line));
        if (!destinationCity.trim()) {
            setError('Укажите город поставки.');
            return;
        }
        if (!file || !preview || validLines.length === 0) {
            setError('Исправьте позиции перед созданием заявки.');
            return;
        }
        if (!relabelConfirmed) {
            setError('Подтвердите все позиции перемаркировки галочками.');
            return;
        }
        setCommitting(true);
        setError(null);
        setMessage('');
        let createdRequest = null;
        try {
            createdRequest = await createClientRequest(session.accessToken, {
                clientId,
                type: 'OUTBOUND',
                priority,
                title: title || preview.title,
                comment: `Создано из Excel: ${file.name}. Позиций: ${validLines.length}, количество: ${validLines.reduce((sum, line) => sum + line.requestedQuantity, 0)}.`,
                destinationCity,
                desiredDate: desiredDate || undefined,
                items: validLines.flatMap((line) => requestItemsFromLine(line)),
            });
            const sourceFile = await uploadClientRequestFile(session.accessToken, createdRequest.id, file);
            onCreated({ ...createdRequest, files: [sourceFile, ...createdRequest.files] });
            resetImportForm();
            setMessage(`Заявка ${createdRequest.title} создана. Исходный Excel сохранен.`);
        }
        catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Не удалось создать заявку из файла.';
            if (createdRequest) {
                onCreated(createdRequest);
                resetImportForm();
                setError(`Заявка ${createdRequest.title} создана, но исходный Excel не сохранился: ${message}`);
            }
            else {
                setError(message);
            }
        }
        finally {
            setCommitting(false);
        }
    }
    function resetImportForm() {
        setTitle('');
        setDesiredDate('');
        setDestinationCity('');
        setFile(null);
        setPreview(null);
        setEditableLines([]);
        setConfirmedRelabels({});
        setFileInputKey((current) => current + 1);
    }
    const issues = preview?.issues ?? [];
    const hasBlockingLines = editableLines.some((line) => !adjustedCanFulfill(line));
    const relabelLines = editableLines.filter((line) => hasRelabel(line));
    const relabelConfirmed = relabelLines.every((line) => confirmedRelabels[line.key]);
    const totalShipmentQuantity = editableLines.reduce((sum, line) => sum + line.requestedQuantity, 0);
    const estimatedBoxes = Math.ceil(totalShipmentQuantity / 15);
    const estimatedPallets = Math.ceil(estimatedBoxes / 16);
    return (_jsxs("form", { className: "client-request-xlsx-form", onSubmit: (event) => void previewFile(event), children: [_jsxs("div", { className: "client-request-xlsx-form__header", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0421\u0431\u043E\u0440\u043A\u0430 \u0438\u0437 Excel" }), _jsx("span", { children: "\u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434 + \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" })] }), _jsx(FileSpreadsheet, { size: 20, "aria-hidden": "true" })] }), _jsxs("div", { className: "client-request-fields client-request-fields--xlsx", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: writableClients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442" }), _jsx("select", { value: priority, onChange: (event) => setPriority(event.target.value), children: requestPriorityOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0416\u0435\u043B\u0430\u0435\u043C\u0430\u044F \u0434\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: desiredDate, onChange: (event) => setDesiredDate(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("input", { required: true, value: destinationCity, onChange: (event) => setDestinationCity(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: title, onChange: (event) => setTitle(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u0424\u0430\u0439\u043B Excel" }), _jsx("input", { accept: ".xlsx,.xls", type: "file", onChange: (event) => {
                                    setFile(event.target.files?.[0] ?? null);
                                    setPreview(null);
                                    setEditableLines([]);
                                    setMessage('');
                                } }, fileInputKey)] })] }), preview ? (_jsxs("div", { className: "client-request-xlsx-preview", children: [_jsxs("div", { className: "client-request-xlsx-summary", children: [_jsxs("span", { children: [editableLines.length, " SKU"] }), _jsxs("span", { children: [totalShipmentQuantity, " \u0448\u0442. \u043A \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0435"] }), _jsxs("span", { children: ["~", estimatedBoxes, " \u043A\u043E\u0440. / ~", estimatedPallets, " \u043F\u0430\u043B."] }), _jsxs("span", { children: [editableLines.reduce((sum, line) => sum + Math.min(line.availableQuantity, line.requestedQuantity), 0), " \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E"] }), _jsxs("span", { children: [editableLines.reduce((sum, line) => sum + adjustedShortage(line), 0), " \u0434\u0435\u0444\u0438\u0446\u0438\u0442"] })] }), relabelLines.length ? (_jsx("div", { className: "client-request-relabel-confirm", children: relabelLines.map((line) => (_jsxs("label", { className: "client-request-relabel-pill", children: [_jsx("input", { checked: Boolean(confirmedRelabels[line.key]), type: "checkbox", onChange: (event) => setConfirmedRelabels((current) => ({ ...current, [line.key]: event.target.checked })) }), _jsxs("span", { children: ["\u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430: ", line.barcode, " ", '->', " ", line.relabelTargetBarcode, ", ", line.relabelQuantity, " \u0448\u0442."] })] }, line.key))) })) : null, issues.length ? (_jsx("div", { className: "client-request-xlsx-issues", children: issues.slice(0, 6).map((issue, index) => (_jsxs("span", { className: `status status--${issue.severity === 'error' ? 'planned' : 'in-progress'}`, children: ["\u0441\u0442\u0440\u043E\u043A\u0430 ", issue.row, ": ", issue.message] }, `${issue.row}-${issue.message}-${index}`))) })) : null, _jsx("div", { className: "client-request-xlsx-lines", children: editableLines.map((line, index) => (_jsxs("div", { className: `client-request-xlsx-line ${xlsxLineClassName(line)}`, children: [_jsx("strong", { children: xlsxLineLabel(line) }), _jsx("span", { children: line.name ?? line.originalName ?? line.barcode }), _jsx("input", { min: "1", type: "number", value: line.requestedQuantity, onChange: (event) => updateEditableLine(index, Number(event.target.value)), "aria-label": `Количество ${xlsxLineLabel(line)}` }), _jsx("small", { children: xlsxLineText(line) }), line.actionSuggestions?.length ? (_jsx("div", { className: "client-request-xlsx-suggestions", children: line.actionSuggestions.map((suggestion, suggestionIndex) => (_jsxs("div", { className: "client-request-xlsx-suggestion", children: [_jsxs("div", { children: [_jsx("strong", { children: suggestion.title }), _jsx("span", { children: suggestion.message })] }), suggestion.type === 'RELABEL' && suggestion.sourceSkuId && suggestion.targetBarcode ? (_jsxs("button", { className: "primary-button client-request-suggestion-action", type: "button", onClick: () => applyRelabelSuggestion(index, suggestion), children: [_jsx(Wand2, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C" })] })) : null] }, `${suggestion.type}-${suggestion.targetBarcode ?? suggestionIndex}`))) })) : null, _jsxs("label", { className: "client-request-xlsx-relabel", children: [_jsx("input", { checked: line.needsRelabel, type: "checkbox", onChange: (event) => updateEditableLineRelabel(index, event.target.checked) }), _jsx("span", { children: "\u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] }), line.needsRelabel ? (_jsxs("div", { className: "client-request-xlsx-relabel-source", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0418\u0437 \u043A\u0430\u043A\u043E\u0433\u043E \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0438\u0442\u044C" }), _jsx("input", { value: line.relabelSourceSearch ?? '', onChange: (event) => updateRelabelSourceSearch(index, event.target.value), placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0428\u041A, \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438\u043B\u0438 \u0440\u0430\u0437\u043C\u0435\u0440" })] }), _jsx("div", { className: "client-request-xlsx-source-options", children: filteredRelabelSourceOptions(preview.relabelSourceOptions ?? [], line.relabelSourceSearch).length ? (filteredRelabelSourceOptions(preview.relabelSourceOptions ?? [], line.relabelSourceSearch).map((option) => (_jsxs("button", { className: line.relabelSourceSelected && line.skuId === option.skuId ? 'active' : '', type: "button", onClick: () => selectRelabelSource(index, option.skuId), children: [_jsx("strong", { children: option.internalSku }), _jsx("span", { children: [option.article, option.name, option.size, option.barcode ? `ШК ${option.barcode}` : null].filter(Boolean).join(' / ') }), _jsxs("em", { children: [option.availableQuantity, " \u0448\u0442."] })] }, option.skuId)))) : (_jsx("p", { children: "\u041F\u043E \u044D\u0442\u043E\u043C\u0443 \u0442\u0435\u043A\u0441\u0442\u0443 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." })) }), _jsxs("small", { children: ["\u0426\u0435\u043B\u044C \u043F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0438: ", relabelTargetLabel(line)] })] })) : null, _jsx("button", { className: "icon-button client-request-row-remove", type: "button", onClick: () => removeEditableLine(index), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", "aria-label": `Удалить ${xlsxLineLabel(line)}`, children: _jsx(Trash2, { size: 15, "aria-hidden": "true" }) })] }, line.key))) })] })) : null, (error || message) ? (_jsxs("p", { className: error ? 'form-error' : 'inline-status', children: [error ? _jsx(AlertTriangle, { size: 15, "aria-hidden": "true" }) : _jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: error || message })] })) : null, _jsxs("div", { className: "client-request-xlsx-actions", children: [_jsxs("button", { className: "primary-button client-request-secondary-button", disabled: isPreviewing || !file, type: "submit", children: [_jsx(Upload, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isPreviewing ? 'Проверяю' : 'Проверить файл' })] }), _jsxs("button", { className: "primary-button", disabled: isCommitting || !destinationCity.trim() || !file || !preview || hasBlockingLines || !relabelConfirmed || editableLines.length === 0, type: "button", onClick: () => void createRequest(), children: [_jsx(Send, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isCommitting ? 'Создаю' : 'Создать заявку' })] })] })] }));
    function updateEditableLine(index, quantity) {
        const normalized = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
        setEditableLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, requestedQuantity: normalized } : line)));
    }
    function updateEditableLineRelabel(index, needsRelabel) {
        const targetLine = editableLines[index];
        if (targetLine) {
            setConfirmedRelabels((confirmed) => ({ ...confirmed, [targetLine.key]: false }));
        }
        setEditableLines((current) => current.map((line, lineIndex) => {
            if (lineIndex !== index) {
                return line;
            }
            if (!needsRelabel) {
                return {
                    ...line,
                    needsRelabel: false,
                    relabelTargetBarcode: undefined,
                    relabelQuantity: undefined,
                    relabelSourceSelected: false,
                    relabelSourceSearch: '',
                };
            }
            return {
                ...line,
                needsRelabel: true,
                relabelTargetSkuId: line.relabelTargetSkuId ?? line.skuId,
                relabelTargetName: line.relabelTargetName ?? line.name,
                relabelTargetInternalSku: line.relabelTargetInternalSku ?? line.internalSku,
                relabelTargetOriginalBarcode: line.relabelTargetOriginalBarcode ?? line.relabelTargetBarcode ?? line.barcode,
                relabelSourceSelected: false,
                relabelSourceSearch: '',
            };
        }));
    }
    function removeEditableLine(index) {
        setEditableLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
    }
    function applyRelabelSuggestion(index, suggestion) {
        if (!suggestion.sourceSkuId || !suggestion.targetBarcode) {
            return;
        }
        const targetLine = editableLines[index];
        if (targetLine) {
            setConfirmedRelabels((confirmed) => ({ ...confirmed, [targetLine.key]: false }));
        }
        setEditableLines((current) => current.map((line, lineIndex) => {
            if (lineIndex !== index) {
                return line;
            }
            const availableQuantity = suggestion.availableQuantity ?? line.availableQuantity;
            const relabelQuantity = Math.min(line.requestedQuantity, suggestion.quantity ?? line.requestedQuantity);
            return {
                ...line,
                skuId: suggestion.sourceSkuId,
                internalSku: suggestion.sourceInternalSku ?? line.internalSku,
                name: suggestion.sourceName ?? line.name,
                barcode: suggestion.sourceBarcode ?? undefined,
                relabelTargetBarcode: suggestion.targetBarcode,
                relabelQuantity,
                needsRelabel: true,
                relabelSourceSelected: true,
                relabelSourceSearch: relabelSourceSuggestionLabel(suggestion),
                relabelTargetOriginalBarcode: suggestion.targetBarcode,
                stockQuantity: Math.max(line.stockQuantity, availableQuantity),
                availableQuantity,
                shortageQuantity: Math.max(0, line.requestedQuantity - availableQuantity),
                canFulfill: line.requestedQuantity <= availableQuantity,
                actionSuggestions: [],
            };
        }));
    }
    function selectRelabelSource(index, skuId) {
        const option = preview?.relabelSourceOptions.find((item) => item.skuId === skuId);
        const targetLine = editableLines[index];
        if (targetLine) {
            setConfirmedRelabels((confirmed) => ({ ...confirmed, [targetLine.key]: false }));
        }
        setEditableLines((current) => current.map((line, lineIndex) => {
            if (lineIndex !== index) {
                return line;
            }
            if (!option) {
                return {
                    ...line,
                    relabelSourceSelected: false,
                    relabelTargetBarcode: undefined,
                    relabelQuantity: undefined,
                    relabelSourceSearch: line.relabelSourceSearch ?? '',
                };
            }
            const targetBarcode = line.relabelTargetOriginalBarcode ?? line.relabelTargetBarcode ?? line.barcode;
            const availableQuantity = option.availableQuantity;
            return {
                ...line,
                skuId: option.skuId,
                internalSku: option.internalSku,
                name: option.name,
                barcode: option.barcode ?? undefined,
                relabelTargetBarcode: targetBarcode,
                relabelQuantity: Math.min(line.requestedQuantity, availableQuantity),
                needsRelabel: true,
                relabelSourceSelected: true,
                relabelSourceSearch: relabelSourceOptionLabel(option),
                stockQuantity: Math.max(line.stockQuantity, availableQuantity),
                availableQuantity,
                shortageQuantity: Math.max(0, line.requestedQuantity - availableQuantity),
                canFulfill: line.requestedQuantity <= availableQuantity,
                actionSuggestions: [],
            };
        }));
    }
    function updateRelabelSourceSearch(index, value) {
        const targetLine = editableLines[index];
        if (targetLine) {
            setConfirmedRelabels((confirmed) => ({ ...confirmed, [targetLine.key]: false }));
        }
        setEditableLines((current) => current.map((line, lineIndex) => lineIndex === index
            ? {
                ...line,
                relabelSourceSearch: value,
                relabelSourceSelected: false,
            }
            : line));
    }
}
function adjustedShortage(line) {
    return Math.max(0, line.requestedQuantity - line.availableQuantity);
}
function adjustedCanFulfill(line) {
    if (line.needsRelabel && (!hasRelabel(line) || !line.relabelSourceSelected)) {
        return false;
    }
    return Boolean(line.skuId) && adjustedShortage(line) === 0;
}
function xlsxLineClassName(line) {
    if (!adjustedCanFulfill(line)) {
        return 'client-request-xlsx-line--shortage';
    }
    return line.conflicts.length > 0 ? 'client-request-xlsx-line--reserved' : 'client-request-xlsx-line--ok';
}
function xlsxLineText(line) {
    const conflictText = line.conflicts.length
        ? ` Участвует в заявке: ${line.conflicts
            .slice(0, 2)
            .map((conflict) => `${conflict.title} от ${new Date(conflict.createdAt).toLocaleDateString('ru-RU')} (${conflict.type})`)
            .join('; ')}.`
        : '';
    const relabelText = hasRelabel(line) ? ` Перемаркировка: ${line.barcode} -> ${line.relabelTargetBarcode}, ${line.relabelQuantity} шт.` : '';
    if (!line.skuId) {
        if (line.actionSuggestions?.length) {
            return 'Товар не найден в остатках, но WMS нашла варианты в каталоге. Выберите действие ниже.';
        }
        return 'Товар не найден. Удалите строку или проверьте справочник SKU.';
    }
    if (!adjustedCanFulfill(line)) {
        return `Нужно ${line.requestedQuantity}, доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${relabelText}${conflictText}`;
    }
    return `Доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${relabelText}${conflictText}`;
}
function xlsxLineLabel(line) {
    return line.internalSku ?? line.originalName ?? line.barcode ?? line.name ?? 'товар';
}
function relabelTargetLabel(line) {
    return [line.relabelTargetInternalSku, line.relabelTargetName, line.relabelTargetOriginalBarcode ?? line.relabelTargetBarcode]
        .filter(Boolean)
        .join(' / ') || 'не определена';
}
function relabelSourceOptionLabel(option) {
    if (!option) {
        return '';
    }
    return [
        option.internalSku,
        option.article,
        option.name,
        option.size,
        option.barcode ? `ШК ${option.barcode}` : null,
        `${option.availableQuantity} шт.`,
    ]
        .filter(Boolean)
        .join(' / ');
}
function relabelSourceSuggestionLabel(suggestion) {
    return [
        suggestion.sourceInternalSku,
        suggestion.sourceName,
        suggestion.sourceBarcode ? `ШК ${suggestion.sourceBarcode}` : null,
        suggestion.availableQuantity ? `${suggestion.availableQuantity} шт.` : null,
    ]
        .filter(Boolean)
        .join(' / ');
}
function filteredRelabelSourceOptions(options, search = '') {
    const query = search.trim().toLowerCase();
    const scored = options
        .map((option) => ({ option, haystack: relabelSourceOptionLabel(option).toLowerCase() }))
        .filter(({ haystack }) => !query || haystack.includes(query))
        .slice(0, 8)
        .map(({ option }) => option);
    return scored;
}
function xlsxLineComment(line) {
    return [
        line.city ? `Город: ${line.city}` : null,
        line.artSeller ? `Артикул продавца: ${line.artSeller}` : null,
        line.size ? `Размер: ${line.size}` : null,
        line.relabelTargetBarcode && line.relabelQuantity ? `Перемаркировка из: ${line.barcode ?? ''}` : null,
        line.relabelTargetBarcode && line.relabelQuantity ? `Перемаркировка в: ${line.relabelTargetBarcode}` : null,
        line.relabelTargetBarcode && line.relabelQuantity ? `Количество перемаркировки: ${line.relabelQuantity}` : null,
        line.needsRelabel ? 'Перемаркировка: да' : null,
        `Excel rows: ${line.sourceRows.join(', ')}`,
    ]
        .filter(Boolean)
        .join('; ');
}
function hasRelabel(line) {
    return Boolean(line.relabelTargetBarcode && line.relabelQuantity && line.relabelQuantity > 0);
}
function requestItemsFromLine(line) {
    const relabelQuantity = hasRelabel(line) ? Math.min(line.relabelQuantity ?? 0, line.requestedQuantity) : 0;
    const normalQuantity = line.requestedQuantity - relabelQuantity;
    const base = {
        skuId: line.skuId ?? undefined,
        barcode: line.barcode ?? undefined,
        name: line.name ?? undefined,
    };
    const items = [];
    if (normalQuantity > 0) {
        items.push({
            ...base,
            quantity: normalQuantity,
            comment: xlsxLineComment({ ...line, relabelTargetBarcode: undefined, relabelQuantity: undefined }),
        });
    }
    if (relabelQuantity > 0) {
        items.push({
            ...base,
            quantity: relabelQuantity,
            comment: xlsxLineComment({ ...line, requestedQuantity: relabelQuantity, needsRelabel: true }),
        });
    }
    return items;
}
