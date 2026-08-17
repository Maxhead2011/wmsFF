import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadTurnoverReceiptPeriodXlsx, fetchClients, fetchReceiptBatches, } from '../../lib/api';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function ReceiptBatchesPanel({ fixedClientId, session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id, { fixedClientId });
    const [batches, setBatches] = useState([]);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (fixedClientId)
            return;
        void fetchClients(session.accessToken).then((rows) => {
            setClients(rows);
            setClientId((current) => validRememberedClientId(current, rows));
        }).catch((error) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов.'));
    }, [fixedClientId, session.accessToken]);
    useEffect(() => {
        if (clientId)
            void load();
    }, [clientId]);
    async function load() {
        setLoading(true);
        setMessage('');
        try {
            setBatches(await fetchReceiptBatches(session.accessToken, clientId));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось загрузить файлы приемки.');
        }
        finally {
            setLoading(false);
        }
    }
    async function download(batch) {
        setMessage('');
        try {
            const blob = await downloadTurnoverReceiptPeriodXlsx(session.accessToken, {
                clientId,
                receiptBatchDate: batch.date,
            });
            downloadBlob(blob, `${batch.title}.xlsx`);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Не удалось скачать приемку.');
        }
    }
    return (_jsxs("div", { className: "receipt-batches", children: [_jsxs("div", { className: "warehouse-drafts__toolbar", children: [!fixedClientId ? (_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => _jsx("option", { value: client.id, children: client.name }, client.id))] })] })) : null, _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void load(), disabled: !clientId || loading, children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: loading ? 'Обновление' : 'Обновить' })] })] }), message ? _jsx("p", { className: "form-error", children: message }) : null, _jsxs("div", { className: "receipt-batches__list", children: [batches.map((batch) => (_jsxs("div", { className: "receipt-batches__row", children: [_jsxs("div", { children: [_jsx("strong", { children: batch.title }), _jsxs("span", { children: [batch.boxes, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u00B7 ", batch.quantity, " \u0448\u0442 \u00B7 \u041A\u0418\u0417 ", batch.kizCount] })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: () => void download(batch), children: [_jsx(Download, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "Excel" })] })] }, batch.id))), !loading && clientId && batches.length === 0 ? _jsx("p", { className: "warehouse-inline", children: "\u0424\u0430\u0439\u043B\u043E\u0432 \u043F\u0440\u0438\u0435\u043C\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) : null] })] }));
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}
