import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileText, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClients, fetchPallets, previewPalletLabel, } from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function PalletLabelForm({ session }) {
    const [clients, setClients] = useState([]);
    const [pallets, setPallets] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [palletCode, setPalletCode] = useState('');
    const [boxesCount, setBoxesCount] = useState('0');
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    const selectedPallet = useMemo(() => pallets.find((pallet) => pallet.code === palletCode) ?? null, [palletCode, pallets]);
    useEffect(() => {
        void loadClients();
    }, [session.accessToken]);
    useEffect(() => {
        if (clientId) {
            void loadPallets(clientId);
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
    async function loadPallets(nextClientId = clientId) {
        if (!nextClientId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const list = await fetchPallets(session.accessToken, { clientId: nextClientId });
            setPallets(list);
            setPalletCode((current) => current || list[0]?.code || '');
            setBoxesCount((current) => (current === '0' && list[0] ? String(list[0].boxes.length) : current));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить паллеты.');
        }
        finally {
            setLoading(false);
        }
    }
    function changeClient(nextClientId) {
        setClientId(nextClientId);
        setPalletCode('');
        setBoxesCount('0');
        setPreview(null);
    }
    function changePallet(nextPalletCode) {
        setPalletCode(nextPalletCode);
        const pallet = pallets.find((item) => item.code === nextPalletCode);
        if (pallet) {
            setBoxesCount(String(pallet.boxes.length));
        }
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
            const parsedBoxes = Number(boxesCount);
            const nextPreview = await previewPalletLabel(session.accessToken, {
                palletCode: palletCode.trim(),
                clientName: selectedClient.name,
                zoneCode: selectedPallet?.zone?.code,
                boxesCount: Number.isFinite(parsedBoxes) && parsedBoxes >= 0 ? parsedBoxes : 0,
            });
            setPreview(nextPreview);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось подготовить паллетную этикетку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    const canSubmit = Boolean(selectedClient && palletCode.trim());
    const safeFileName = `${palletCode.trim() || 'pallet'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');
    return (_jsxs("form", { className: "print-form", onSubmit: submit, children: [_jsxs("div", { className: "print-fields print-fields--pallet", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), disabled: isLoading, children: [clients.length === 0 ? _jsx("option", { value: "", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u0430" }), _jsx("input", { list: "print-pallets", value: palletCode, onChange: (event) => changePallet(event.target.value), required: true }), _jsx("datalist", { id: "print-pallets", children: pallets.map((pallet) => (_jsx("option", { value: pallet.code }, pallet.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("input", { min: "0", step: "1", type: "number", value: boxesCount, onChange: (event) => setBoxesCount(event.target.value) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "print-actions", children: [_jsxs("button", { className: "primary-button", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(FileText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL' })] }), _jsxs("button", { className: "primary-button print-secondary", type: "button", onClick: () => void loadPallets(), disabled: !clientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0430\u043B\u043B\u0435\u0442\u044B" })] })] }), preview ? _jsx(TsplPreviewCard, { preview: preview, fileName: safeFileName }) : null] }));
}
