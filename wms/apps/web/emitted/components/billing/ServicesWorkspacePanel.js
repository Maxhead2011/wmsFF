import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchClients } from '../../lib/api';
import { ClientBillingServicesPanel } from './ClientBillingServicesPanel';
import './billing.css';
export function ServicesWorkspacePanel({ session }) {
    const [clients, setClients] = useState([]);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState(null);
    useEffect(() => {
        void loadClients();
    }, [session.accessToken]);
    async function loadClients() {
        setStatus('loading');
        setError(null);
        try {
            setClients(await fetchClients(session.accessToken));
            setStatus('ready');
        }
        catch (caught) {
            setStatus('error');
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
    }
    return (_jsxs("section", { className: "billing-panel", "aria-label": "\u0423\u0441\u043B\u0443\u0433\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" }), _jsx("h2", { children: "\u0423\u0441\u043B\u0443\u0433\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432" }), _jsx("p", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u043B\u0443\u0433, \u0438\u043D\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043B\u044C\u043D\u044B\u0435 \u0446\u0435\u043D\u044B \u0438 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0443\u0447\u0435\u0442\u0430 \u043D\u0430\u043B\u043E\u0433\u0430 \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadClients(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] }), status === 'loading' && clients.length === 0 ? _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432..." }) : null, status === 'error' ? _jsx("p", { className: "form-error", children: error }) : null, clients.length > 0 ? _jsx(ClientBillingServicesPanel, { clients: clients, session: session }) : null] }));
}
