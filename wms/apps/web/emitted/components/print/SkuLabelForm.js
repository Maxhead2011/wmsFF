import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileText, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClients, fetchSkus, previewSkuLabel, } from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function SkuLabelForm({ session }) {
    const [clients, setClients] = useState([]);
    const [skus, setSkus] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [skuCode, setSkuCode] = useState('');
    const [name, setName] = useState('');
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    const selectedSku = useMemo(() => skus.find((sku) => sku.internalSku === skuCode) ?? null, [skuCode, skus]);
    useEffect(() => {
        void loadClients();
    }, [session.accessToken]);
    useEffect(() => {
        if (clientId) {
            void loadSkus(clientId);
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
    async function loadSkus(nextClientId = clientId) {
        if (!nextClientId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const list = await fetchSkus(session.accessToken, { clientId: nextClientId });
            setSkus(list);
            setSkuCode((current) => current || list[0]?.internalSku || '');
            setName((current) => current || list[0]?.name || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить SKU.');
        }
        finally {
            setLoading(false);
        }
    }
    function changeClient(nextClientId) {
        setClientId(nextClientId);
        setSkuCode('');
        setName('');
        setPreview(null);
    }
    function changeSku(nextSkuCode) {
        setSkuCode(nextSkuCode);
        const sku = skus.find((item) => item.internalSku === nextSkuCode);
        if (sku) {
            setName(sku.name);
        }
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setPreview(null);
        try {
            const nextPreview = await previewSkuLabel(session.accessToken, {
                skuCode: skuCode.trim(),
                name: (selectedSku?.name ?? name).trim(),
                barcode: selectedSku?.barcodes.find((barcode) => barcode.isPrimary)?.value ?? selectedSku?.barcodes[0]?.value,
                clientName: selectedClient?.name,
                article: selectedSku?.article ?? undefined,
                color: selectedSku?.color ?? undefined,
                size: selectedSku?.size ?? undefined,
            });
            setPreview(nextPreview);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось подготовить SKU-этикетку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    const canSubmit = Boolean(skuCode.trim() && (selectedSku?.name || name.trim()));
    const safeFileName = `${skuCode.trim() || 'sku'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');
    return (_jsxs("form", { className: "print-form", onSubmit: submit, children: [_jsxs("div", { className: "print-fields print-fields--sku", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), disabled: isLoading, children: [clients.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "SKU" }), _jsx("input", { list: "print-skus", value: skuCode, onChange: (event) => changeSku(event.target.value), required: true }), _jsx("datalist", { id: "print-skus", children: skus.map((sku) => (_jsx("option", { value: sku.internalSku, children: sku.name }, sku.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: selectedSku?.name ?? name, onChange: (event) => setName(event.target.value), required: true })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(FileText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadSkus(), disabled: !clientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C SKU" })] })] }), preview ? _jsx(TsplPreviewCard, { preview: preview, fileName: safeFileName }) : null] }));
}
