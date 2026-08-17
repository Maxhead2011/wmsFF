import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive, Ban, CheckCircle2, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { deleteClient, fetchClients, fetchUsers, updateClient, updateClientStatus, } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DirectoryResultCard } from './DirectoryResultCard';
import { useRememberedClientId } from '../../lib/rememberedClient';
const emptyForm = {
    clientKind: 'LEGAL_ENTITY',
    name: '',
    legalName: '',
    inn: '',
    kpp: '',
    ogrn: '',
    legalAddress: '',
    actualAddress: '',
    phone: '',
    email: '',
    bankName: '',
    bankBik: '',
    bankAccount: '',
    correspondentAccount: '',
    storageAccountingEnabled: false,
    storesWithoutBoxes: false,
    stockBalanceMode: 'PALLET_SORT',
    onlineReceiptVisibleToClient: false,
    fbsCalculatorEnabled: false,
    relabelingEnabled: false,
    logisticsInvoiceMode: 'SEPARATE',
    storageBillingMode: 'MONTHLY',
    fulfillmentManagerUserId: '',
};
const clientKindOptions = [
    { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
    { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'Индивидуальный предприниматель' },
    { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
    { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];
const logisticsInvoiceModeOptions = [
    { value: 'SEPARATE', label: 'Логистика отдельным счетом' },
    { value: 'SAME_INVOICE', label: 'Логистика в общем счете' },
    { value: 'DISABLED', label: 'Не выставлять автоматически' },
];
const storageBillingModeOptions = [
    { value: 'MONTHLY', label: 'Хранение раз в месяц' },
    { value: 'ON_SHIPMENT', label: 'Хранение по отгрузке' },
];
export function ClientRequisitesForm({ session }) {
    const [clients, setClients] = useState([]);
    const [users, setUsers] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [form, setForm] = useState(emptyForm);
    const [savedClient, setSavedClient] = useState(null);
    const [error, setError] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [isStatusSubmitting, setStatusSubmitting] = useState(false);
    const [isDeleting, setDeleting] = useState(false);
    const [pendingArchiveClient, setPendingArchiveClient] = useState(null);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    useEffect(() => {
        void loadClients();
    }, []);
    useEffect(() => {
        void loadUsers();
    }, [session.accessToken]);
    useEffect(() => {
        setForm(selectedClient ? formFromClient(selectedClient) : emptyForm);
    }, [selectedClient]);
    async function loadClients() {
        setLoading(true);
        setError('');
        try {
            const nextClients = await fetchClients(session.accessToken);
            setClients(nextClients);
            setClientId((current) => (nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id ?? ''));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
        finally {
            setLoading(false);
        }
    }
    async function loadUsers() {
        try {
            const nextUsers = await fetchUsers(session.accessToken);
            setUsers(nextUsers.filter((user) => !isClientOnlyUser(user)));
        }
        catch {
            setUsers([]);
        }
    }
    async function submit(event) {
        event.preventDefault();
        if (!selectedClient) {
            return;
        }
        setSubmitting(true);
        setError('');
        setActionMessage('');
        setSavedClient(null);
        try {
            const updated = await updateClient(session.accessToken, selectedClient.id, compactPayload(form));
            setSavedClient(updated);
            setClients((current) => current.map((client) => (client.id === updated.id ? updated : client)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить реквизиты.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function changeStatus(status) {
        if (!selectedClient) {
            return;
        }
        setStatusSubmitting(true);
        setError('');
        setActionMessage('');
        try {
            const updated = await updateClientStatus(session.accessToken, selectedClient.id, status);
            const nextClients = status === 'ARCHIVED'
                ? clients.filter((client) => client.id !== updated.id)
                : clients.map((client) => (client.id === updated.id ? updated : client));
            setClients(nextClients);
            if (status === 'ARCHIVED') {
                setClientId(nextClients[0]?.id ?? '');
            }
            setActionMessage(clientStatusActionMessage(status));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус клиента.');
        }
        finally {
            setStatusSubmitting(false);
        }
    }
    async function archiveClientConfirmed() {
        setPendingArchiveClient(null);
        await changeStatus('ARCHIVED');
    }
    async function removeClient() {
        if (!selectedClient) {
            return;
        }
        const confirmed = window.confirm(`Удалить клиента ${selectedClient.code} - ${selectedClient.name}? Если есть связанные данные, WMS не даст удалить его.`);
        if (!confirmed) {
            return;
        }
        setDeleting(true);
        setError('');
        setActionMessage('');
        setSavedClient(null);
        try {
            const deleted = await deleteClient(session.accessToken, selectedClient.id);
            const nextClients = clients.filter((client) => client.id !== deleted.id);
            setClients(nextClients);
            setClientId(nextClients[0]?.id ?? '');
            setActionMessage(`Клиент ${deleted.code} - ${deleted.name} удален.`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось удалить клиента.');
        }
        finally {
            setDeleting(false);
        }
    }
    return (_jsxs("form", { className: "directory-form client-requisites-form", onSubmit: submit, children: [_jsxs("div", { className: "directory-subheading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("span", { children: "\u0442\u0438\u043F \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u044E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0438 \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void loadClients(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить' })] })] }), _jsx("div", { className: "client-table-block", children: _jsx("div", { className: "client-table-scroll", children: _jsxs("table", { className: "client-directory-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0434" }), _jsx("th", { children: "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0418\u041D\u041D" }), _jsx("th", { children: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsxs("tbody", { children: [clients.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) })) : null, clients.map((client) => (_jsxs("tr", { className: client.id === clientId ? 'selected' : '', onClick: () => setClientId(client.id), children: [_jsx("td", { children: client.code }), _jsx("td", { children: client.name }), _jsx("td", { children: _jsx("span", { className: `client-status client-status--${client.status.toLowerCase()}`, children: clientStatusLabel(client.status) }) }), _jsx("td", { children: client.inn || 'не задан' }), _jsx("td", { children: client.fulfillmentManager?.name || 'не назначен' }), _jsx("td", { children: _jsxs("button", { className: "icon-text-button client-table-select", type: "button", onClick: () => setClientId(client.id), children: [_jsx(Pencil, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] }) })] }, client.id)))] })] }) }) }), selectedClient ? (_jsxs("div", { className: "client-control-panel", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("strong", { className: `client-status client-status--${selectedClient.status.toLowerCase()}`, children: clientStatusLabel(selectedClient.status) })] }), _jsxs("div", { className: "client-control-actions", children: [selectedClient.status === 'ACTIVE' ? (_jsxs("button", { className: "icon-text-button client-action-button", disabled: isStatusSubmitting || isDeleting, onClick: () => void changeStatus('PAUSED'), type: "button", children: [_jsx(Ban, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] })) : (_jsxs("button", { className: "icon-text-button client-action-button", disabled: isStatusSubmitting || isDeleting, onClick: () => void changeStatus('ACTIVE'), type: "button", children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C" })] })), selectedClient.status !== 'ARCHIVED' ? (_jsxs("button", { className: "icon-text-button client-action-button", disabled: isStatusSubmitting || isDeleting, onClick: () => setPendingArchiveClient(selectedClient), type: "button", children: [_jsx(Archive, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0412 \u0430\u0440\u0445\u0438\u0432" })] })) : null, _jsxs("button", { className: "icon-text-button client-action-button client-action-button--danger", disabled: isDeleting || isStatusSubmitting, onClick: () => void removeClient(), type: "button", children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: isDeleting ? 'Удаление' : 'Удалить' })] })] })] })) : null, _jsxs("section", { className: "client-requisites-card", children: [_jsx("div", { className: "client-requisites-card__heading", children: _jsxs("div", { children: [_jsx("h4", { children: "\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0438 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B" }), _jsx("span", { children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0440\u0430\u0431\u043E\u0442\u044B, \u044E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0435, \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043D\u044B\u0435 \u0438 \u0431\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }) }), _jsxs("div", { className: "directory-fields directory-fields--client", children: [_jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.onlineReceiptVisibleToClient, type: "checkbox", onChange: (event) => setForm({ ...form, onlineReceiptVisibleToClient: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043E\u043D\u043B\u0430\u0439\u043D-\u043F\u0440\u0438\u0435\u043C\u043A\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0443" })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.fbsCalculatorEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, fbsCalculatorEnabled: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043A\u0430\u043B\u044C\u043A\u0443\u043B\u044F\u0442\u043E\u0440 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u0438 \u0432 FBS" })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.relabelingEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, relabelingEnabled: event.target.checked }) }), _jsx("span", { children: "\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u0438\u0434 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsxs("select", { value: form.storesWithoutBoxes ? 'WITHOUT_BOXES' : 'WITH_BOXES', onChange: (event) => setForm({ ...form, storesWithoutBoxes: event.target.value === 'WITHOUT_BOXES' }), children: [_jsx("option", { value: "WITH_BOXES", children: "\u0421 \u043A\u043E\u0440\u043E\u0431\u0430\u043C\u0438" }), _jsx("option", { value: "WITHOUT_BOXES", children: "\u0411\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432, \u043F\u043E\u0448\u0442\u0443\u0447\u043D\u043E" })] })] }), !form.storesWithoutBoxes ? (_jsxs("fieldset", { className: "client-stock-mode", children: [_jsx("legend", { children: "\u041A\u0430\u043A\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C" }), _jsxs("label", { children: [_jsx("input", { checked: form.stockBalanceMode === 'PALLET_SORT', name: "stockBalanceMode", type: "radio", onChange: () => setForm({ ...form, stockBalanceMode: 'PALLET_SORT' }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430\u0445" }), _jsx("small", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u044C \u0432 WB \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0440\u043E\u0431\u0430, \u0440\u0430\u0437\u043C\u0435\u0449\u0451\u043D\u043D\u044B\u0435 \u043D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430\u0445." })] })] }), _jsxs("label", { children: [_jsx("input", { checked: form.stockBalanceMode === 'BOXES', name: "stockBalanceMode", type: "radio", onChange: () => setForm({ ...form, stockBalanceMode: 'BOXES' }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041F\u043E \u0432\u0441\u0435\u043C \u043A\u043E\u0440\u043E\u0431\u0430\u043C" }), _jsx("small", { children: "\u0423\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C \u0432\u0441\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430, \u0434\u0430\u0436\u0435 \u0435\u0441\u043B\u0438 \u043E\u043D\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u044B \u043D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430\u0445." })] })] })] })) : null, _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("select", { value: form.clientKind, onChange: (event) => setForm({ ...form, clientKind: event.target.value }), children: clientKindOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440. \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.legalName, onChange: (event) => setForm({ ...form, legalName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041D\u041D" }), _jsx("input", { value: form.inn, onChange: (event) => setForm({ ...form, inn: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0430" }), _jsxs("select", { value: form.fulfillmentManagerUserId, onChange: (event) => setForm({ ...form, fulfillmentManagerUserId: event.target.value }), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D" }), users.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.storageAccountingEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, storageAccountingEnabled: event.target.checked }) }), _jsx("span", { children: "\u0412\u0435\u0441\u0442\u0438 \u0443\u0447\u0435\u0442 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0447\u0435\u0442\u0430 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438" }), _jsx("select", { value: form.logisticsInvoiceMode, onChange: (event) => setForm({ ...form, logisticsInvoiceMode: event.target.value }), children: logisticsInvoiceModeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("select", { value: form.storageBillingMode, onChange: (event) => setForm({ ...form, storageBillingMode: event.target.value }), children: storageBillingModeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u041F\u041F" }), _jsx("input", { value: form.kpp, onChange: (event) => setForm({ ...form, kpp: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0413\u0420\u041D" }), _jsx("input", { value: form.ogrn, onChange: (event) => setForm({ ...form, ogrn: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: form.phone, onChange: (event) => setForm({ ...form, phone: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0447\u0442\u0430" }), _jsx("input", { inputMode: "email", type: "email", value: form.email, onChange: (event) => setForm({ ...form, email: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440. \u0430\u0434\u0440\u0435\u0441" }), _jsx("input", { value: form.legalAddress, onChange: (event) => setForm({ ...form, legalAddress: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u0430\u043A\u0442. \u0430\u0434\u0440\u0435\u0441" }), _jsx("input", { value: form.actualAddress, onChange: (event) => setForm({ ...form, actualAddress: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u043D\u043A" }), _jsx("input", { value: form.bankName, onChange: (event) => setForm({ ...form, bankName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0418\u041A" }), _jsx("input", { value: form.bankBik, onChange: (event) => setForm({ ...form, bankBik: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0441\u0447\u0435\u0442\u043D\u044B\u0439 \u0441\u0447\u0435\u0442" }), _jsx("input", { value: form.bankAccount, onChange: (event) => setForm({ ...form, bankAccount: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u0440. \u0441\u0447\u0435\u0442" }), _jsx("input", { value: form.correspondentAccount, onChange: (event) => setForm({ ...form, correspondentAccount: event.target.value }) })] })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, actionMessage ? _jsx("p", { className: "form-success", children: actionMessage }) : null, _jsxs("button", { className: "primary-button directory-submit", type: "submit", disabled: isSubmitting || !selectedClient, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Сохранить реквизиты' })] }), pendingArchiveClient ? (_jsx(ConfirmDialog, { title: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0432 \u0430\u0440\u0445\u0438\u0432", message: "\u041A\u043B\u0438\u0435\u043D\u0442 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u0432 \u0431\u0430\u0437\u0435, \u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043C\u0435\u0447\u0435\u043D \u0430\u0440\u0445\u0438\u0432\u043D\u044B\u043C \u0438 \u0443\u0431\u0440\u0430\u043D \u0438\u0437 \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043A\u043E\u043D\u0442\u0443\u0440\u0430.", details: [`${pendingArchiveClient.code} · ${pendingArchiveClient.name}`], confirmLabel: "\u0412 \u0430\u0440\u0445\u0438\u0432", isBusy: isStatusSubmitting, onCancel: () => setPendingArchiveClient(null), onConfirm: () => void archiveClientConfirmed() })) : null, savedClient ? (_jsx(DirectoryResultCard, { title: "\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B", lines: [
                    `${savedClient.code} - ${savedClient.name}`,
                    `${clientKindLabel(savedClient.clientKind)} · ИНН ${savedClient.inn ?? 'не задан'}`,
                    savedClient.storageAccountingEnabled ? 'Учет хранения включен' : 'Учет хранения отключен',
                    logisticsInvoiceModeLabel(savedClient.logisticsInvoiceMode),
                    storageBillingModeLabel(savedClient.storageBillingMode),
                ] })) : null] }));
}
function formFromClient(client) {
    return {
        clientKind: client.clientKind,
        name: client.name,
        legalName: client.legalName ?? '',
        inn: client.inn ?? '',
        kpp: client.kpp ?? '',
        ogrn: client.ogrn ?? '',
        legalAddress: client.legalAddress ?? '',
        actualAddress: client.actualAddress ?? '',
        phone: client.phone ?? '',
        email: client.email ?? '',
        bankName: client.bankName ?? '',
        bankBik: client.bankBik ?? '',
        bankAccount: client.bankAccount ?? '',
        correspondentAccount: client.correspondentAccount ?? '',
        storageAccountingEnabled: client.storageAccountingEnabled,
        storesWithoutBoxes: Boolean(client.storesWithoutBoxes),
        stockBalanceMode: client.stockBalanceMode ?? 'PALLET_SORT',
        onlineReceiptVisibleToClient: Boolean(client.onlineReceiptVisibleToClient),
        fbsCalculatorEnabled: Boolean(client.fbsCalculatorEnabled),
        relabelingEnabled: Boolean(client.relabelingEnabled),
        logisticsInvoiceMode: client.logisticsInvoiceMode,
        storageBillingMode: client.storageBillingMode,
        fulfillmentManagerUserId: client.fulfillmentManagerUserId ?? '',
    };
}
function compactPayload(form) {
    return {
        clientKind: form.clientKind,
        name: form.name.trim(),
        legalName: form.legalName,
        inn: form.inn,
        kpp: form.kpp,
        ogrn: form.ogrn,
        legalAddress: form.legalAddress,
        actualAddress: form.actualAddress,
        phone: form.phone,
        email: form.email,
        bankName: form.bankName,
        bankBik: form.bankBik,
        bankAccount: form.bankAccount,
        correspondentAccount: form.correspondentAccount,
        storageAccountingEnabled: form.storageAccountingEnabled,
        storesWithoutBoxes: form.storesWithoutBoxes,
        stockBalanceMode: form.stockBalanceMode,
        onlineReceiptVisibleToClient: form.onlineReceiptVisibleToClient,
        fbsCalculatorEnabled: form.fbsCalculatorEnabled,
        relabelingEnabled: form.relabelingEnabled,
        logisticsInvoiceMode: form.logisticsInvoiceMode,
        storageBillingMode: form.storageBillingMode,
        fulfillmentManagerUserId: form.fulfillmentManagerUserId,
    };
}
function clientKindLabel(kind) {
    return clientKindOptions.find((option) => option.value === kind)?.label ?? kind;
}
function logisticsInvoiceModeLabel(mode) {
    return logisticsInvoiceModeOptions.find((option) => option.value === mode)?.label ?? mode;
}
function storageBillingModeLabel(mode) {
    return storageBillingModeOptions.find((option) => option.value === mode)?.label ?? mode;
}
function clientStatusLabel(status) {
    const labels = {
        ACTIVE: 'Активен',
        PAUSED: 'Заблокирован',
        ARCHIVED: 'В архиве',
    };
    return labels[status];
}
function clientStatusActionMessage(status) {
    const labels = {
        ACTIVE: 'Клиент активирован.',
        PAUSED: 'Клиент заблокирован.',
        ARCHIVED: 'Клиент отправлен в архив.',
    };
    return labels[status];
}
function isClientOnlyUser(user) {
    const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR', 'TSD'];
    return user.roles.some((item) => item.role.code === 'CLIENT') && !user.roles.some((item) => internalRoles.includes(item.role.code));
}
