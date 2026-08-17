import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Ban, Boxes, FileDown, FileText, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cancelPickWave, createPickWave, downloadPickWaveDocumentXlsx, fetchClientRequests, fetchPickWaveDocument, fetchPickWaves, fetchUsers, runPickWave, } from '../../lib/api';
import { requestPriorityLabel, requestStatusLabel } from '../client-requests/clientRequestMeta';
import { HtmlDocumentPreview } from '../documents/HtmlDocumentPreview';
const eligibleStatuses = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'];
export function PickWavePanel({ session }) {
    const [requests, setRequests] = useState({ status: 'idle', data: [] });
    const [waves, setWaves] = useState({ status: 'idle', data: [] });
    const [users, setUsers] = useState([]);
    const [selectedRequestIds, setSelectedRequestIds] = useState([]);
    const [assignedPickerUserId, setAssignedPickerUserId] = useState(session.user.id);
    const [comment, setComment] = useState('');
    const [message, setMessage] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    const [isLoadingDocumentId, setLoadingDocumentId] = useState('');
    const [isDownloadingXlsxId, setDownloadingXlsxId] = useState('');
    const [isCancellingWaveId, setCancellingWaveId] = useState('');
    const [documentPreview, setDocumentPreview] = useState(null);
    const eligibleRequests = useMemo(() => requests.data.filter((request) => request.type === 'OUTBOUND' && eligibleStatuses.includes(request.status)), [requests.data]);
    useEffect(() => {
        void loadData();
    }, []);
    async function loadData() {
        setMessage(null);
        setRequests((current) => ({ ...current, status: 'loading', error: undefined }));
        setWaves((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            const [nextRequests, nextWaves] = await Promise.all([
                fetchClientRequests(session.accessToken, { type: 'OUTBOUND' }),
                fetchPickWaves(session.accessToken),
            ]);
            const nextUsers = canReadUsers(session)
                ? await fetchUsers(session.accessToken).catch(() => [])
                : [];
            setRequests({ status: 'ready', data: nextRequests });
            setWaves({ status: 'ready', data: nextWaves });
            setUsers(nextUsers);
            setSelectedRequestIds((current) => current.filter((id) => nextRequests.some((request) => request.id === id)));
            setAssignedPickerUserId((current) => current || session.user.id);
        }
        catch (caught) {
            const error = errorMessage(caught);
            setRequests((current) => ({ ...current, status: 'error', error }));
            setWaves((current) => ({ ...current, status: 'error', error }));
        }
    }
    async function submitWave() {
        if (selectedRequestIds.length === 0) {
            return;
        }
        setSubmitting(true);
        setMessage(null);
        try {
            const wave = await createPickWave(session.accessToken, {
                requestIds: selectedRequestIds,
                comment: comment.trim() || undefined,
                assignedPickerUserId: assignedPickerUserId || undefined,
            });
            setWaves((current) => ({ status: 'ready', data: [wave, ...current.data] }));
            setSelectedRequestIds([]);
            setAssignedPickerUserId(session.user.id);
            setComment('');
            setMessage(`Волна ${wave.waveNumber} создана${wave.assignedPicker ? `, сборщик ${wave.assignedPicker.name}` : ''}.`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setSubmitting(false);
        }
    }
    async function startWave(wave) {
        setSubmitting(true);
        setMessage(null);
        try {
            const result = await runPickWave(session.accessToken, wave.id, {
                idempotencyKey: `web-wave:${wave.id}`,
                comment: `Сборка волны ${wave.waveNumber} из web-интерфейса.`,
            });
            setWaves((current) => ({
                status: 'ready',
                data: current.data.map((item) => (item.id === wave.id ? result.wave : item)),
            }));
            await loadData();
            setMessage(`Волна ${result.wave.waveNumber}: обработано ${result.results.length}.`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setSubmitting(false);
        }
    }
    async function openWaveDocument(wave) {
        setLoadingDocumentId(wave.id);
        setMessage(null);
        try {
            const document = await fetchPickWaveDocument(session.accessToken, wave.id);
            setDocumentPreview(document);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setLoadingDocumentId('');
        }
    }
    async function cancelWave(wave) {
        if (!window.confirm(`Отменить волну ${wave.waveNumber}? Заявки снова станут доступны для новой волны.`)) {
            return;
        }
        setCancellingWaveId(wave.id);
        setMessage(null);
        try {
            const cancelled = await cancelPickWave(session.accessToken, wave.id);
            setWaves((current) => ({
                status: 'ready',
                data: current.data.map((item) => (item.id === wave.id ? cancelled : item)),
            }));
            await loadData();
            setMessage(`Волна ${cancelled.waveNumber} отменена. Заявки освобождены.`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setCancellingWaveId('');
        }
    }
    async function downloadWaveDocument(wave) {
        setDownloadingXlsxId(wave.id);
        setMessage(null);
        try {
            const blob = await downloadPickWaveDocumentXlsx(session.accessToken, wave.id);
            downloadBlob(blob, `pick-wave-${safeDownloadName(wave.waveNumber)}.xlsx`);
        }
        catch (caught) {
            setMessage(errorMessage(caught));
        }
        finally {
            setDownloadingXlsxId('');
        }
    }
    function toggleRequest(requestId) {
        setSelectedRequestIds((current) => current.includes(requestId) ? current.filter((id) => id !== requestId) : [...current, requestId]);
    }
    return (_jsxs("section", { className: "pick-wave-panel", "aria-label": "\u0412\u043E\u043B\u043D\u044B \u0441\u0431\u043E\u0440\u043A\u0438", children: [_jsxs("div", { className: "warehouse-subheading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0412\u043E\u043B\u043D\u044B \u0441\u0431\u043E\u0440\u043A\u0438" }), _jsx("h3", { children: "\u0412\u043E\u043B\u043D\u044B \u0441\u0431\u043E\u0440\u043A\u0438" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadData(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u043E\u043B\u043D\u044B", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u043E\u043B\u043D\u044B", children: _jsx(RefreshCw, { size: 17, "aria-hidden": "true" }) })] }), message ? _jsx("p", { className: "warehouse-inline", children: message }) : null, requests.status === 'error' || waves.status === 'error' ? (_jsx("p", { className: "form-error", children: requests.error ?? waves.error })) : null, _jsxs("div", { className: "pick-wave-layout", children: [_jsxs("div", { className: "pick-wave-candidates", children: [_jsx("strong", { children: "\u041A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u044B" }), eligibleRequests.length ? (_jsx("div", { className: "pick-wave-list", children: eligibleRequests.slice(0, 12).map((request) => (_jsxs("label", { className: "pick-wave-request", children: [_jsx("input", { type: "checkbox", checked: selectedRequestIds.includes(request.id), onChange: () => toggleRequest(request.id) }), _jsxs("span", { children: [_jsx("b", { children: request.title }), _jsxs("small", { children: [request.client.code, " \u00B7 ", requestStatusLabel(request.status), " \u00B7 ", requestPriorityLabel(request.priority), " \u00B7", ' ', requestItemsQuantity(request), " \u0448\u0442."] })] })] }, request.id))) })) : (_jsx("p", { className: "warehouse-inline", children: "\u041D\u0435\u0442 \u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u0437\u0430\u044F\u0432\u043E\u043A \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0439 \u0432\u043E\u043B\u043D\u044B." })), _jsxs("label", { className: "warehouse-comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u043F\u0435\u0440\u0432\u0430\u044F \u0432\u043E\u043B\u043D\u0430 WB" })] }), _jsxs("label", { className: "warehouse-comment", children: [_jsx("span", { children: "\u0421\u0431\u043E\u0440\u0449\u0438\u043A" }), _jsxs("select", { value: assignedPickerUserId, onChange: (event) => setAssignedPickerUserId(event.target.value), children: [pickerOptions(session, users).map((user) => (_jsx("option", { value: user.id, children: userLabel(user) }, user.id))), _jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0430\u0442\u044C" })] })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void submitWave(), disabled: selectedRequestIds.length === 0 || isSubmitting, children: [_jsx(Boxes, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0432\u043E\u043B\u043D\u0443" })] })] }), _jsxs("div", { className: "pick-wave-history", children: [_jsx("strong", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0432\u043E\u043B\u043D\u044B" }), waves.data.length ? (_jsx("div", { className: "pick-wave-list", children: waves.data.slice(0, 8).map((wave) => (_jsxs("article", { className: "pick-wave-card", children: [_jsxs("div", { children: [_jsx("b", { children: wave.waveNumber }), _jsx("span", { className: `status status--${waveStatusTone(wave.status)}`, children: waveStatusLabel(wave.status) })] }), _jsxs("p", { children: [wave.requests.length, " \u0437\u0430\u044F\u0432\u043E\u043A \u00B7 ", wavePickedCount(wave), " \u0441\u043E\u0431\u0440\u0430\u043D\u043E \u00B7 ", waveFailedCount(wave), " \u043E\u0448\u0438\u0431\u043E\u043A"] }), _jsxs("p", { children: ["\u0421\u0431\u043E\u0440\u0449\u0438\u043A: ", wave.assignedPicker ? userLabel(wave.assignedPicker) : 'не назначен'] }), _jsxs("div", { className: "pick-wave-actions", children: [_jsxs("button", { className: "review-action", type: "button", onClick: () => void openWaveDocument(wave), disabled: isLoadingDocumentId === wave.id, children: [_jsx(FileText, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: isLoadingDocumentId === wave.id ? 'Готовлю' : 'Лист' })] }), _jsxs("button", { className: "review-action review-action--xlsx", type: "button", onClick: () => void downloadWaveDocument(wave), disabled: isDownloadingXlsxId === wave.id, children: [_jsx(FileDown, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: isDownloadingXlsxId === wave.id ? 'Готовлю' : 'Скачать Excel' })] }), canRunWave(wave) ? (_jsxs("button", { className: "review-action review-action--accept", type: "button", onClick: () => void startWave(wave), disabled: isSubmitting, children: [_jsx(Play, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C" })] })) : null, canCancelWave(wave) ? (_jsxs("button", { className: "review-action review-action--reject", type: "button", onClick: () => void cancelWave(wave), disabled: isCancellingWaveId === wave.id || isSubmitting, children: [_jsx(Ban, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: isCancellingWaveId === wave.id ? 'Отменяю' : 'Отменить волну' })] })) : null] })] }, wave.id))) })) : (_jsx("p", { className: "warehouse-inline", children: "\u0412\u043E\u043B\u043D \u0441\u0431\u043E\u0440\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }))] })] }), documentPreview ? (_jsx(HtmlDocumentPreview, { title: documentPreview.title, fileName: documentPreview.fileName, html: documentPreview.html, onClose: () => setDocumentPreview(null) })) : null] }));
}
function requestItemsQuantity(request) {
    return request.items.reduce((sum, item) => sum + item.quantity, 0);
}
function wavePickedCount(wave) {
    return wave.requests.filter((request) => request.status === 'PICKED').length;
}
function waveFailedCount(wave) {
    return wave.requests.filter((request) => request.status === 'FAILED').length;
}
function canRunWave(wave) {
    return wave.status === 'FROZEN' || wave.status === 'FAILED' || wave.status === 'PICKING';
}
function canCancelWave(wave) {
    return ['PLANNED', 'BALANCE_REVIEW', 'FROZEN', 'FAILED'].includes(wave.status);
}
function waveStatusLabel(status) {
    const labels = {
        PLANNED: 'план',
        BALANCE_REVIEW: 'проверка балансов',
        FROZEN: 'план зафиксирован',
        PICKING: 'сборка',
        DONE: 'готово',
        FAILED: 'ошибка',
        CANCELLED: 'отмена',
    };
    return labels[status];
}
function waveStatusTone(status) {
    if (status === 'DONE') {
        return 'ready';
    }
    if (status === 'FAILED' || status === 'CANCELLED') {
        return 'planned';
    }
    return 'in-progress';
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function safeDownloadName(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'wave';
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию с волной.';
}
function canReadUsers(session) {
    return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes('users:read');
}
function pickerOptions(session, users) {
    const currentUser = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        status: 'ACTIVE',
    };
    const activeUsers = users.filter((user) => user.status === 'ACTIVE' && user.id !== session.user.id);
    return [currentUser, ...activeUsers];
}
function userLabel(user) {
    return `${user.name} · ${user.email}`;
}
