import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link2, RefreshCw, Save, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createClient, createUser, fetchUsers, updateClient, updateUserClientScopes, } from '../../lib/api';
import { DirectoryResultCard } from './DirectoryResultCard';
import { RequisitesDocumentImport } from '../requisites/RequisitesDocumentImport';
const clientKindOptions = [
    { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
    { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'Индивидуальный предприниматель' },
    { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
    { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];
const emptyClientForm = {
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
    fulfillmentManagerUserId: '',
};
const emptyClientManagerForm = {
    email: '',
    name: '',
    password: '',
};
export function ClientCreateForm({ session }) {
    const [form, setForm] = useState(emptyClientForm);
    const [allUsers, setAllUsers] = useState([]);
    const [fulfillmentUsers, setFulfillmentUsers] = useState([]);
    const [clientManagerForm, setClientManagerForm] = useState(emptyClientManagerForm);
    const [clientManagers, setClientManagers] = useState([]);
    const [existingClientUserId, setExistingClientUserId] = useState('');
    const [createdClient, setCreatedClient] = useState(null);
    const [createdManager, setCreatedManager] = useState(null);
    const [error, setError] = useState('');
    const [managerError, setManagerError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    const [isManagerSubmitting, setManagerSubmitting] = useState(false);
    const [isAssigningManager, setAssigningManager] = useState(false);
    const [isLinkingClientUser, setLinkingClientUser] = useState(false);
    const canManageUsers = canUse(session, 'users:write');
    const selectedFulfillmentManager = useMemo(() => fulfillmentUsers.find((user) => user.id === (createdClient?.fulfillmentManagerUserId || form.fulfillmentManagerUserId)) ?? null, [createdClient?.fulfillmentManagerUserId, form.fulfillmentManagerUserId, fulfillmentUsers]);
    const existingClientUserOptions = useMemo(() => allUsers.filter((user) => userHasClientRole(user) &&
        user.status === 'ACTIVE' &&
        (!createdClient || !user.clientScopes.some((scope) => scope.client.id === createdClient.id))), [allUsers, createdClient]);
    useEffect(() => {
        if (canManageUsers) {
            void loadFulfillmentUsers();
        }
    }, [session.accessToken, canManageUsers]);
    async function loadFulfillmentUsers() {
        try {
            const users = await fetchUsers(session.accessToken);
            setAllUsers(users);
            setFulfillmentUsers(users.filter((user) => !isClientOnlyUser(user)));
        }
        catch {
            setAllUsers([]);
            setFulfillmentUsers([]);
        }
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setCreatedClient(null);
        setCreatedManager(null);
        setClientManagers([]);
        try {
            const created = await createClient(session.accessToken, compactPayload(form));
            setCreatedClient(created);
            setForm(emptyClientForm);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать клиента.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function createClientManager(event) {
        event.preventDefault();
        if (!createdClient) {
            return;
        }
        setManagerSubmitting(true);
        setManagerError('');
        setCreatedManager(null);
        try {
            const manager = await createUser(session.accessToken, {
                email: clientManagerForm.email.trim(),
                name: clientManagerForm.name.trim(),
                password: clientManagerForm.password,
                roleCodes: ['CLIENT'],
                clientIds: [createdClient.id],
                writableClientIds: [createdClient.id],
            });
            setCreatedManager(manager);
            setAllUsers((current) => [manager, ...current]);
            setClientManagers((current) => [manager, ...current]);
            setClientManagerForm(emptyClientManagerForm);
        }
        catch (caught) {
            setManagerError(caught instanceof Error ? caught.message : 'Не удалось добавить менеджера клиента.');
        }
        finally {
            setManagerSubmitting(false);
        }
    }
    async function assignFulfillmentManager(userId) {
        if (!createdClient) {
            setForm((current) => ({ ...current, fulfillmentManagerUserId: userId }));
            return;
        }
        setAssigningManager(true);
        setManagerError('');
        try {
            const updated = await updateClient(session.accessToken, createdClient.id, {
                fulfillmentManagerUserId: userId || undefined,
            });
            setCreatedClient(updated);
        }
        catch (caught) {
            setManagerError(caught instanceof Error ? caught.message : 'Не удалось назначить менеджера фулфилмента.');
        }
        finally {
            setAssigningManager(false);
        }
    }
    async function linkExistingClientUser() {
        if (!createdClient || !existingClientUserId) {
            return;
        }
        const selectedUser = allUsers.find((user) => user.id === existingClientUserId);
        if (!selectedUser) {
            return;
        }
        setLinkingClientUser(true);
        setManagerError('');
        try {
            const updated = await updateUserClientScopes(session.accessToken, selectedUser.id, {
                scopes: [
                    ...selectedUser.clientScopes.map((scope) => ({
                        clientId: scope.client.id,
                        canRead: scope.canRead,
                        canWrite: scope.canWrite,
                    })),
                    { clientId: createdClient.id, canRead: true, canWrite: true },
                ],
            });
            const nextUser = { ...selectedUser, clientScopes: updated.clientScopes };
            setAllUsers((current) => current.map((user) => (user.id === nextUser.id ? nextUser : user)));
            setClientManagers((current) => [nextUser, ...current.filter((user) => user.id !== nextUser.id)]);
            setExistingClientUserId('');
        }
        catch (caught) {
            setManagerError(caught instanceof Error ? caught.message : 'Не удалось привязать пользователя к клиенту.');
        }
        finally {
            setLinkingClientUser(false);
        }
    }
    return (_jsxs("div", { className: "directory-form", children: [_jsxs("form", { className: "directory-form", onSubmit: submit, children: [_jsx("div", { className: "directory-subheading directory-subheading--plain", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041D\u043E\u0432\u044B\u0439 \u043A\u043B\u0438\u0435\u043D\u0442" }), _jsx("span", { children: "\u043A\u043E\u0434 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0431\u0443\u0434\u0435\u0442 \u0441\u043E\u0437\u0434\u0430\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] }) }), _jsx(RequisitesDocumentImport, { accessToken: session.accessToken, target: "client", disabled: isSubmitting, onImported: (fields) => {
                            setForm((current) => ({
                                ...current,
                                clientKind: fields.clientKind,
                                name: fields.name || fields.shortName || current.name,
                                legalName: fields.legalName || fields.fullName || current.legalName,
                                inn: fields.inn || current.inn,
                                kpp: fields.kpp || current.kpp,
                                ogrn: fields.ogrn || current.ogrn,
                                legalAddress: fields.legalAddress || current.legalAddress,
                                actualAddress: fields.actualAddress || current.actualAddress,
                                phone: fields.phone || current.phone,
                                email: fields.email || current.email,
                                bankName: fields.bankName || current.bankName,
                                bankBik: fields.bankBik || current.bankBik,
                                bankAccount: fields.bankAccount || current.bankAccount,
                                correspondentAccount: fields.correspondentAccount || current.correspondentAccount,
                            }));
                            setError('');
                        } }), _jsxs("div", { className: "directory-fields directory-fields--client", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("select", { value: form.clientKind, onChange: (event) => setForm({ ...form, clientKind: event.target.value }), required: true, children: clientKindOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440. \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.legalName, onChange: (event) => setForm({ ...form, legalName: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041D\u041D" }), _jsx("input", { value: form.inn, onChange: (event) => setForm({ ...form, inn: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u041F\u041F" }), _jsx("input", { value: form.kpp, onChange: (event) => setForm({ ...form, kpp: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0413\u0420\u041D" }), _jsx("input", { value: form.ogrn, onChange: (event) => setForm({ ...form, ogrn: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: form.phone, onChange: (event) => setForm({ ...form, phone: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0447\u0442\u0430" }), _jsx("input", { inputMode: "email", type: "email", value: form.email, onChange: (event) => setForm({ ...form, email: event.target.value }) })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.onlineReceiptVisibleToClient, type: "checkbox", onChange: (event) => setForm({ ...form, onlineReceiptVisibleToClient: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043E\u043D\u043B\u0430\u0439\u043D-\u043F\u0440\u0438\u0435\u043C\u043A\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0443" })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.fbsCalculatorEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, fbsCalculatorEnabled: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043A\u0430\u043B\u044C\u043A\u0443\u043B\u044F\u0442\u043E\u0440 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u0438 \u0432 FBS" })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.relabelingEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, relabelingEnabled: event.target.checked }) }), _jsx("span", { children: "\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u0438\u0434 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsxs("select", { value: form.storesWithoutBoxes ? 'WITHOUT_BOXES' : 'WITH_BOXES', onChange: (event) => setForm({ ...form, storesWithoutBoxes: event.target.value === 'WITHOUT_BOXES' }), children: [_jsx("option", { value: "WITH_BOXES", children: "\u0421 \u043A\u043E\u0440\u043E\u0431\u0430\u043C\u0438" }), _jsx("option", { value: "WITHOUT_BOXES", children: "\u0411\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432, \u043F\u043E\u0448\u0442\u0443\u0447\u043D\u043E" })] })] }), !form.storesWithoutBoxes ? (_jsxs("fieldset", { className: "client-stock-mode", children: [_jsx("legend", { children: "\u041A\u0430\u043A\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C" }), _jsxs("label", { children: [_jsx("input", { checked: form.stockBalanceMode === 'PALLET_SORT', name: "stockBalanceMode", type: "radio", onChange: () => setForm({ ...form, stockBalanceMode: 'PALLET_SORT' }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430\u0445" }), _jsx("small", { children: "\u0422\u043E\u043B\u044C\u043A\u043E \u0440\u0430\u0437\u043C\u0435\u0449\u0451\u043D\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430 \u2014 \u0432 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0435 \u0438 \u043F\u0440\u0438 \u043E\u0431\u043C\u0435\u043D\u0435 \u0441 WB." })] })] }), _jsxs("label", { children: [_jsx("input", { checked: form.stockBalanceMode === 'BOXES', name: "stockBalanceMode", type: "radio", onChange: () => setForm({ ...form, stockBalanceMode: 'BOXES' }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041F\u043E \u0432\u0441\u0435\u043C \u043A\u043E\u0440\u043E\u0431\u0430\u043C" }), _jsx("small", { children: "\u0412\u0441\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430, \u0434\u0430\u0436\u0435 \u0431\u0435\u0437 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430." })] })] })] })) : null, _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0430" }), _jsxs("select", { value: form.fulfillmentManagerUserId, onChange: (event) => void assignFulfillmentManager(event.target.value), disabled: !canManageUsers || isAssigningManager, children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D" }), fulfillmentUsers.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("label", { className: "directory-checkbox", children: [_jsx("input", { checked: form.storageAccountingEnabled, type: "checkbox", onChange: (event) => setForm({ ...form, storageAccountingEnabled: event.target.checked }) }), _jsx("span", { children: "\u0412\u0435\u0441\u0442\u0438 \u0443\u0447\u0435\u0442 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440. \u0430\u0434\u0440\u0435\u0441" }), _jsx("input", { value: form.legalAddress, onChange: (event) => setForm({ ...form, legalAddress: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u0430\u043A\u0442. \u0430\u0434\u0440\u0435\u0441" }), _jsx("input", { value: form.actualAddress, onChange: (event) => setForm({ ...form, actualAddress: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u043D\u043A" }), _jsx("input", { value: form.bankName, onChange: (event) => setForm({ ...form, bankName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0418\u041A" }), _jsx("input", { value: form.bankBik, onChange: (event) => setForm({ ...form, bankBik: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0441\u0447\u0435\u0442\u043D\u044B\u0439 \u0441\u0447\u0435\u0442" }), _jsx("input", { value: form.bankAccount, onChange: (event) => setForm({ ...form, bankAccount: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u0440. \u0441\u0447\u0435\u0442" }), _jsx("input", { value: form.correspondentAccount, onChange: (event) => setForm({ ...form, correspondentAccount: event.target.value }) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button directory-submit", type: "submit", disabled: isSubmitting, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Создать клиента' })] })] }), createdClient ? (_jsxs("div", { className: "client-after-create", children: [_jsx(DirectoryResultCard, { title: "\u041A\u043B\u0438\u0435\u043D\u0442 \u0441\u043E\u0437\u0434\u0430\u043D", lines: [
                            `${createdClient.code} - ${createdClient.name}`,
                            `${clientKindLabel(createdClient.clientKind)} · ИНН ${createdClient.inn}`,
                            createdClient.storageAccountingEnabled ? 'Учет хранения включен' : 'Учет хранения отключен',
                            selectedFulfillmentManager ? `Менеджер фулфилмента: ${selectedFulfillmentManager.name}` : 'Менеджер фулфилмента не назначен',
                        ] }), canManageUsers ? (_jsxs("div", { className: "client-manager-grid", children: [_jsxs("form", { className: "client-manager-card", onSubmit: createClientManager, children: [_jsx("div", { className: "directory-subheading directory-subheading--plain", children: _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("span", { children: "\u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043E\u0442 \u0438\u043C\u0435\u043D\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0441 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u043C\u0438, \u0437\u0430\u044F\u0432\u043A\u0430\u043C\u0438 \u0438 \u0441\u0447\u0435\u0442\u0430\u043C\u0438" })] }) }), _jsxs("div", { className: "directory-fields directory-fields--manager", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0447\u0442\u0430" }), _jsx("input", { inputMode: "email", type: "email", value: clientManagerForm.email, onChange: (event) => setClientManagerForm({ ...clientManagerForm, email: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u043C\u044F" }), _jsx("input", { value: clientManagerForm.name, onChange: (event) => setClientManagerForm({ ...clientManagerForm, name: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0430\u0440\u043E\u043B\u044C" }), _jsx("input", { minLength: 10, type: "password", value: clientManagerForm.password, onChange: (event) => setClientManagerForm({ ...clientManagerForm, password: event.target.value }), required: true })] })] }), _jsxs("button", { className: "primary-button directory-submit", type: "submit", disabled: isManagerSubmitting, children: [_jsx(UserPlus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isManagerSubmitting ? 'Добавление' : 'Создать пользователя клиента' })] }), createdManager ? (_jsx(DirectoryResultCard, { title: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D", lines: [`${createdManager.name} - ${createdManager.email}`] })) : null, clientManagers.length > 0 ? (_jsx("div", { className: "client-manager-list", children: clientManagers.map((manager) => (_jsxs("span", { children: [manager.name, " \u00B7 ", manager.email] }, manager.id))) })) : null] }), _jsxs("div", { className: "client-manager-card", children: [_jsxs("div", { className: "directory-subheading directory-subheading--plain", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0433\u043E" }), _jsx("span", { children: "\u0434\u0430\u0441\u0442 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0443" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void loadFulfillmentUsers(), children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), _jsxs("label", { className: "directory-select-row", children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsxs("select", { value: existingClientUserId, onChange: (event) => setExistingClientUserId(event.target.value), disabled: isLinkingClientUser || existingClientUserOptions.length === 0, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F" }), existingClientUserOptions.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("button", { className: "primary-button directory-submit", type: "button", onClick: () => void linkExistingClientUser(), disabled: !existingClientUserId || isLinkingClientUser, children: [_jsx(Link2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLinkingClientUser ? 'Привязка' : 'Привязать к клиенту' })] })] }), _jsxs("div", { className: "client-manager-card", children: [_jsxs("div", { className: "directory-subheading directory-subheading--plain", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0430" }), _jsx("span", { children: "\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u043A\u043B\u0430\u0434\u0430" })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void loadFulfillmentUsers(), children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), _jsxs("label", { className: "directory-select-row", children: [_jsx("span", { children: "\u041E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439" }), _jsxs("select", { value: createdClient.fulfillmentManagerUserId ?? '', onChange: (event) => void assignFulfillmentManager(event.target.value), disabled: isAssigningManager, children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D" }), fulfillmentUsers.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] })] })] })) : null, managerError ? _jsx("p", { className: "form-error", children: managerError }) : null] })) : null] }));
}
function compactPayload(form) {
    return {
        clientKind: form.clientKind,
        name: form.name.trim(),
        legalName: form.legalName.trim(),
        inn: form.inn.trim(),
        ...optionalString('kpp', form.kpp),
        ...optionalString('ogrn', form.ogrn),
        ...optionalString('legalAddress', form.legalAddress),
        ...optionalString('actualAddress', form.actualAddress),
        ...optionalString('phone', form.phone),
        ...optionalString('email', form.email),
        ...optionalString('bankName', form.bankName),
        ...optionalString('bankBik', form.bankBik),
        ...optionalString('bankAccount', form.bankAccount),
        ...optionalString('correspondentAccount', form.correspondentAccount),
        storageAccountingEnabled: form.storageAccountingEnabled,
        storesWithoutBoxes: form.storesWithoutBoxes,
        stockBalanceMode: form.stockBalanceMode,
        onlineReceiptVisibleToClient: form.onlineReceiptVisibleToClient,
        fbsCalculatorEnabled: form.fbsCalculatorEnabled,
        relabelingEnabled: form.relabelingEnabled,
        ...optionalString('fulfillmentManagerUserId', form.fulfillmentManagerUserId),
    };
}
function optionalString(key, value) {
    const trimmed = value.trim();
    return trimmed ? { [key]: trimmed } : {};
}
function clientKindLabel(kind) {
    return clientKindOptions.find((option) => option.value === kind)?.label ?? kind;
}
function canUse(session, permission) {
    return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}
function isClientOnlyUser(user) {
    const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'];
    return userHasClientRole(user) && !user.roles.some((item) => internalRoles.includes(item.role.code));
}
function userHasClientRole(user) {
    return user.roles.some((item) => item.role.code === 'CLIENT');
}
