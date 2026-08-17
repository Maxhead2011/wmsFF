import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileText, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchBoxes, fetchClients, previewBoxLabel, } from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function BoxLabelForm({ session }) {
    const [clients, setClients] = useState([]);
    const [boxes, setBoxes] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [boxCode, setBoxCode] = useState('');
    const [quantity, setQuantity] = useState('0');
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    useEffect(() => {
        void loadClients();
    }, [session.accessToken]);
    useEffect(() => {
        if (clientId) {
            void loadBoxes(clientId);
        }
    }, [clientId]);
    async function loadClients() {
        setLoading(true);
        setError('');
        try {
            const list = await fetchClients(session.accessToken);
            setClients(list);
            setClientId((current) => current || list[0]?.id || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
        finally {
            setLoading(false);
        }
    }
    async function loadBoxes(nextClientId = clientId) {
        if (!nextClientId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const list = await fetchBoxes(session.accessToken, { clientId: nextClientId });
            setBoxes(list);
            setBoxCode((current) => current || list[0]?.code || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить короба.');
        }
        finally {
            setLoading(false);
        }
    }
    function changeClient(nextClientId) {
        setClientId(nextClientId);
        setBoxCode('');
        setPreview(null);
    }
    async function submit(event) {
        event.preventDefault();
        if (!selectedClient) {
            return;
        }
        setSubmitting(true);
        setError('');
        setPreview(null);
        try {
            const parsedQuantity = Number(quantity);
            const nextPreview = await previewBoxLabel(session.accessToken, {
                boxCode: boxCode.trim(),
                clientName: selectedClient.name,
                // Русский комментарий: quantity в шаблоне означает количество строк внутри короба, а не остаток SKU.
                quantity: Number.isFinite(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : 0,
            });
            setPreview(nextPreview);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось подготовить этикетку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    const canSubmit = Boolean(selectedClient && boxCode.trim());
    const safeFileName = `${boxCode.trim() || 'box'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');
    return (_jsxs("form", { className: "print-form", onSubmit: submit, children: [_jsxs("div", { className: "print-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), disabled: isLoading, children: [clients.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("input", { list: "print-boxes", value: boxCode, onChange: (event) => setBoxCode(event.target.value), required: true }), _jsx("datalist", { id: "print-boxes", children: boxes.map((box) => (_jsx("option", { value: box.code }, box.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B-\u0432\u043E \u0441\u0442\u0440\u043E\u043A" }), _jsx("input", { min: "0", step: "1", type: "number", value: quantity, onChange: (event) => setQuantity(event.target.value) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(FileText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadBoxes(), disabled: !clientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430" })] })] }), preview ? _jsx(TsplPreviewCard, { preview: preview, fileName: safeFileName }) : null] }));
}
