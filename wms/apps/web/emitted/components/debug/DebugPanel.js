import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive, Building2, CheckCircle2, Database, KeyRound, Link as LinkIcon, RefreshCw, Save, Settings2, ShieldCheck, UserCog, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clearUserTsdActivationCode, fetchBranches, fetchClients, fetchRoles, fetchUsers, setUserTsdActivationCode, updateClient, updateClientStatus, updateStorageTariff, updateUserProfile, updateUserRoles, } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import './debug.css';
import { useRememberedClientId } from '../../lib/rememberedClient';
const tabs = [
    { id: 'clients', label: 'Клиенты', icon: Building2 },
    { id: 'archive', label: 'Архив', icon: Archive },
    { id: 'users', label: 'Пользователи', icon: UserCog },
    { id: 'data', label: 'Данные и режимы', icon: Database },
];
const clientKinds = [
    { value: 'LEGAL_ENTITY', label: 'Юридическое лицо' },
    { value: 'INDIVIDUAL_ENTREPRENEUR', label: 'ИП' },
    { value: 'SELF_EMPLOYED', label: 'Самозанятый' },
    { value: 'INDIVIDUAL', label: 'Физическое лицо' },
];
const clientStatuses = [
    { value: 'ACTIVE', label: 'Активен' },
    { value: 'PAUSED', label: 'Заблокирован' },
    { value: 'ARCHIVED', label: 'Архив' },
];
const userStatuses = [
    { value: 'ACTIVE', label: 'Активен' },
    { value: 'BLOCKED', label: 'Заблокирован' },
];
const workspaceShortcuts = [
    {
        id: 'service',
        title: 'Сервис',
        text: 'Режим обслуживания, сессии, КИЗ, очистка остатков и заявок по клиенту.',
        icon: Settings2,
    },
    {
        id: 'data',
        title: 'Данные',
        text: 'Быстрый просмотр таблиц остатков, клиентов, SKU и очередей разбора.',
        icon: Database,
    },
    {
        id: 'directories',
        title: 'Справочники',
        text: 'Создание клиентов, загрузка номенклатуры, карточки товаров и соответствия.',
        icon: Building2,
    },
    {
        id: 'access',
        title: 'Доступы',
        text: 'Роли, клиентские доступы, принтеры и пользователи, работающие с ТСД.',
        icon: ShieldCheck,
    },
];
const emptyClientDraft = {
    name: '',
    legalName: '',
    inn: '',
    clientKind: 'LEGAL_ENTITY',
    status: 'ACTIVE',
    kpp: '',
    ogrn: '',
    legalAddress: '',
    actualAddress: '',
    phone: '',
    telegramChatId: '',
    email: '',
    bankName: '',
    bankBik: '',
    bankAccount: '',
    correspondentAccount: '',
    storageAccountingEnabled: false,
    storesWithoutBoxes: false,
    storagePriceRubPerLiterDay: '',
    fulfillmentManagerUserId: '',
};
const emptyUserDraft = {
    email: '',
    name: '',
    password: '',
    status: 'ACTIVE',
    analyticsEnabled: false,
    warehouseId: '',
};
export function DebugPanel({ session, onOpenWorkspace }) {
    const [activeTab, setActiveTab] = useState('clients');
    const [clients, setClients] = useState([]);
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [branches, setBranches] = useState([]);
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [archiveSearch, setArchiveSearch] = useState('');
    const [userSearch, setUserSearch] = useState('');
    const [clientDraft, setClientDraft] = useState(emptyClientDraft);
    const [userDraft, setUserDraft] = useState(emptyUserDraft);
    const [roleCodes, setRoleCodes] = useState([]);
    const [tsdCode, setTsdCode] = useState('');
    const [pendingUserOverrideReasons, setPendingUserOverrideReasons] = useState(null);
    const [pendingArchiveClient, setPendingArchiveClient] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSavingClient, setSavingClient] = useState(false);
    const [isSavingUser, setSavingUser] = useState(false);
    const [isSavingCode, setSavingCode] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === selectedClientId) ?? null, [clients, selectedClientId]);
    const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);
    const workingClients = useMemo(() => clients.filter((client) => client.status !== 'ARCHIVED'), [clients]);
    const archivedClients = useMemo(() => clients.filter((client) => client.status === 'ARCHIVED'), [clients]);
    const activeClientItems = activeTab === 'archive' ? archivedClients : workingClients;
    const filteredClients = useMemo(() => filterClients(workingClients, clientSearch), [workingClients, clientSearch]);
    const filteredArchivedClients = useMemo(() => filterClients(archivedClients, archiveSearch), [archivedClients, archiveSearch]);
    const isArchiveTab = activeTab === 'archive';
    const clientListForTab = isArchiveTab ? filteredArchivedClients : filteredClients;
    const filteredUsers = useMemo(() => filterUsers(users, userSearch), [users, userSearch]);
    const managerOptions = useMemo(() => users.filter((user) => user.roles.some((item) => ['OWNER', 'ADMIN', 'MANAGER'].includes(item.role.code))), [users]);
    useEffect(() => {
        void loadAll();
    }, [session.accessToken]);
    useEffect(() => {
        if (activeTab !== 'clients' && activeTab !== 'archive') {
            return;
        }
        if (!activeClientItems.some((client) => client.id === selectedClientId)) {
            setSelectedClientId(activeClientItems[0]?.id ?? '');
        }
    }, [activeTab, activeClientItems, selectedClientId]);
    useEffect(() => {
        if (!selectedUser && users[0]) {
            setSelectedUserId(users[0].id);
        }
    }, [users, selectedUser]);
    useEffect(() => {
        setClientDraft(selectedClient ? clientToDraft(selectedClient) : emptyClientDraft);
    }, [selectedClient]);
    useEffect(() => {
        setUserDraft(selectedUser ? userToDraft(selectedUser) : emptyUserDraft);
        setRoleCodes(selectedUser?.roles.map((item) => item.role.code) ?? []);
        setTsdCode('');
    }, [selectedUser]);
    async function loadAll() {
        setLoading(true);
        setError('');
        setMessage('');
        try {
            const [nextClients, nextUsers, nextRoles, nextBranches] = await Promise.all([
                fetchClients(session.accessToken, { includeArchived: true }),
                fetchUsers(session.accessToken),
                fetchRoles(session.accessToken),
                fetchBranches(session.accessToken),
            ]);
            setClients(nextClients);
            setUsers(nextUsers);
            setRoles(nextRoles);
            setBranches(nextBranches);
            setSelectedClientId((current) => current || nextClients.find((client) => client.status !== 'ARCHIVED')?.id || nextClients[0]?.id || '');
            setSelectedUserId((current) => current || nextUsers[0]?.id || '');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function saveClient() {
        if (!selectedClient) {
            return;
        }
        setSavingClient(true);
        setError('');
        setMessage('');
        try {
            let saved = await updateClient(session.accessToken, selectedClient.id, {
                clientKind: clientDraft.clientKind,
                name: clientDraft.name,
                legalName: clientDraft.legalName,
                inn: clientDraft.inn,
                kpp: clientDraft.kpp,
                ogrn: clientDraft.ogrn,
                legalAddress: clientDraft.legalAddress,
                actualAddress: clientDraft.actualAddress,
                phone: clientDraft.phone,
                telegramChatId: clientDraft.telegramChatId,
                email: clientDraft.email,
                bankName: clientDraft.bankName,
                bankBik: clientDraft.bankBik,
                bankAccount: clientDraft.bankAccount,
                correspondentAccount: clientDraft.correspondentAccount,
                storageAccountingEnabled: clientDraft.storageAccountingEnabled,
                storesWithoutBoxes: clientDraft.storesWithoutBoxes,
                fulfillmentManagerUserId: clientDraft.fulfillmentManagerUserId,
            });
            if (clientDraft.status !== selectedClient.status) {
                saved = await updateClientStatus(session.accessToken, selectedClient.id, clientDraft.status);
            }
            const tariffText = clientDraft.storagePriceRubPerLiterDay.trim();
            if (tariffText) {
                const tariff = Number(tariffText.replace(',', '.'));
                if (!Number.isNaN(tariff) && tariff >= 0 && String(selectedClient.storagePriceRubPerLiterDay ?? '') !== String(tariff)) {
                    saved = {
                        ...saved,
                        ...(await updateStorageTariff(session.accessToken, selectedClient.id, {
                            storagePriceRubPerLiterDay: tariff,
                        })),
                    };
                }
            }
            setClients((current) => current.map((client) => (client.id === saved.id ? saved : client)));
            setClientDraft(clientToDraft(saved));
            setSelectedClientId(saved.id);
            if (saved.status === 'ARCHIVED') {
                setActiveTab('archive');
            }
            else if (activeTab === 'archive') {
                setActiveTab('clients');
            }
            setMessage('Данные клиента сохранены.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingClient(false);
        }
    }
    async function archiveClientConfirmed() {
        if (!pendingArchiveClient) {
            return;
        }
        setSavingClient(true);
        setError('');
        setMessage('');
        try {
            const archived = await updateClientStatus(session.accessToken, pendingArchiveClient.id, 'ARCHIVED');
            setClients((current) => current.map((client) => (client.id === archived.id ? archived : client)));
            if (archived.id === selectedClientId) {
                setClientDraft(clientToDraft(archived));
            }
            setSelectedClientId(archived.id);
            setActiveTab('archive');
            setMessage('Клиент отправлен в архив.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setPendingArchiveClient(null);
            setSavingClient(false);
        }
    }
    async function restoreArchivedClient() {
        if (!selectedClient || selectedClient.status !== 'ARCHIVED') {
            return;
        }
        setSavingClient(true);
        setError('');
        setMessage('');
        try {
            const restored = await updateClientStatus(session.accessToken, selectedClient.id, 'ACTIVE');
            setClients((current) => current.map((client) => (client.id === restored.id ? restored : client)));
            setClientDraft(clientToDraft(restored));
            setSelectedClientId(restored.id);
            setActiveTab('clients');
            setMessage('Клиент возвращен в рабочий список.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingClient(false);
        }
    }
    async function saveUser() {
        if (!selectedUser) {
            return;
        }
        if (roleCodes.length === 0) {
            setError('Нужно оставить хотя бы одну роль пользователя.');
            return;
        }
        const reasons = userOverrideReasons(userDraft);
        if (reasons.length > 0) {
            setPendingUserOverrideReasons(reasons);
            return;
        }
        await saveUserConfirmed();
    }
    async function saveUserConfirmed() {
        if (!selectedUser) {
            return;
        }
        setSavingUser(true);
        setError('');
        setMessage('');
        try {
            let saved = await updateUserProfile(session.accessToken, selectedUser.id, {
                email: userDraft.email,
                name: userDraft.name,
                status: userDraft.status,
                analyticsEnabled: userDraft.analyticsEnabled,
                warehouseId: userDraft.warehouseId || null,
                ...(userDraft.password.trim() ? { password: userDraft.password.trim() } : {}),
            });
            const currentRoleCodes = selectedUser.roles.map((item) => item.role.code).sort().join('|');
            const nextRoleCodes = [...roleCodes].sort().join('|');
            if (currentRoleCodes !== nextRoleCodes) {
                saved = await updateUserRoles(session.accessToken, selectedUser.id, { roleCodes });
            }
            setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
            setUserDraft(userToDraft(saved));
            setMessage('Данные пользователя сохранены.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingUser(false);
        }
    }
    async function saveTsdCode() {
        if (!selectedUser) {
            return;
        }
        if (!/^\d{4}$/.test(tsdCode)) {
            setError('Супер код должен состоять ровно из 4 цифр.');
            return;
        }
        setSavingCode(true);
        setError('');
        setMessage('');
        try {
            const saved = await setUserTsdActivationCode(session.accessToken, selectedUser.id, tsdCode);
            setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
            setTsdCode('');
            setMessage('4-значный код подтверждения сохранён.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingCode(false);
        }
    }
    async function clearTsdCode() {
        if (!selectedUser) {
            return;
        }
        setSavingCode(true);
        setError('');
        setMessage('');
        try {
            const saved = await clearUserTsdActivationCode(session.accessToken, selectedUser.id);
            setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
            setTsdCode('');
            setMessage('Код подтверждения сброшен.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingCode(false);
        }
    }
    function toggleRole(code) {
        setRoleCodes((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
    }
    return (_jsxs("section", { className: "debug-panel", "aria-label": "\u041E\u0442\u043B\u0430\u0434\u043A\u0430", children: [_jsxs("div", { className: "debug-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C" }), _jsx("h2", { children: "\u041E\u0442\u043B\u0430\u0434\u043A\u0430" }), _jsx("p", { children: "\u0411\u044B\u0441\u0442\u0440\u0430\u044F \u043F\u0440\u0430\u0432\u043A\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432, \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439, \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432 \u0438 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432." })] }), _jsxs("button", { className: "primary-button debug-secondary", type: "button", onClick: () => void loadAll(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновление' : 'Обновить' })] })] }), _jsx("div", { className: "debug-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u043E\u0442\u043B\u0430\u0434\u043A\u0438", children: tabs.map((tab) => (_jsxs("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), role: "tab", type: "button", children: [_jsx(tab.icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id))) }), message ? (_jsxs("div", { className: "debug-message", children: [_jsx(CheckCircle2, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: message })] })) : null, error ? _jsx("p", { className: "debug-message debug-message--error", children: error }) : null, activeTab === 'clients' || activeTab === 'archive' ? (_jsxs("div", { className: "debug-split", children: [_jsx(DebugList, { count: clientListForTab.length, emptyText: isArchiveTab ? 'В архиве пока нет клиентов' : 'Клиенты не найдены', onSearch: isArchiveTab ? setArchiveSearch : setClientSearch, search: isArchiveTab ? archiveSearch : clientSearch, searchPlaceholder: isArchiveTab ? 'Поиск в архиве' : 'Поиск клиента, ИНН, кода', title: isArchiveTab ? 'Архив клиентов' : 'Клиенты', children: clientListForTab.map((client) => (_jsxs("button", { className: [
                                'debug-list-item',
                                client.id === selectedClientId ? 'active' : '',
                                client.status === 'ARCHIVED' ? 'archived' : '',
                            ]
                                .filter(Boolean)
                                .join(' '), type: "button", onClick: () => setSelectedClientId(client.id), children: [_jsx("strong", { children: client.name }), _jsx("span", { children: client.legalName || client.inn || client.code }), _jsx("small", { children: clientStatusLabel(client.status) })] }, client.id))) }), _jsxs("div", { className: "debug-editor", children: [_jsxs("div", { className: "debug-editor__title", children: [_jsx(Building2, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h3", { children: selectedClient?.name || 'Выберите клиента' }), _jsx("span", { children: selectedClient ? `${selectedClient.code} · ${clientKindLabel(selectedClient.clientKind)}` : 'Карточка клиента' })] })] }), _jsxs("div", { className: "debug-fields debug-fields--three", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: clientDraft.name, onChange: (event) => setClientField('name', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440. \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: clientDraft.legalName, onChange: (event) => setClientField('legalName', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041D\u041D" }), _jsx("input", { value: clientDraft.inn, onChange: (event) => setClientField('inn', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("select", { value: clientDraft.clientKind, onChange: (event) => setClientField('clientKind', event.target.value), children: clientKinds.map((kind) => (_jsx("option", { value: kind.value, children: kind.label }, kind.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("select", { value: clientDraft.status, onChange: (event) => setClientField('status', event.target.value), children: clientStatuses.map((status) => (_jsx("option", { value: status.value, children: status.label }, status.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0424\u0424" }), _jsxs("select", { value: clientDraft.fulfillmentManagerUserId, onChange: (event) => setClientField('fulfillmentManagerUserId', event.target.value), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D" }), managerOptions.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " \u00B7 ", user.email] }, user.id)))] })] })] }), _jsxs("div", { className: "debug-fields debug-fields--three", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: clientDraft.phone, onChange: (event) => setClientField('phone', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "Email" }), _jsx("input", { value: clientDraft.email, onChange: (event) => setClientField('email', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "Telegram chat_id" }), _jsx("input", { value: clientDraft.telegramChatId, onChange: (event) => setClientField('telegramChatId', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u041F\u041F" }), _jsx("input", { value: clientDraft.kpp, onChange: (event) => setClientField('kpp', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0413\u0420\u041D" }), _jsx("input", { value: clientDraft.ogrn, onChange: (event) => setClientField('ogrn', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0430\u0440\u0438\u0444 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F, \u20BD/\u043B/\u0441\u0443\u0442\u043A\u0438" }), _jsx("input", { inputMode: "decimal", value: clientDraft.storagePriceRubPerLiterDay, onChange: (event) => setClientField('storagePriceRubPerLiterDay', event.target.value) })] })] }), _jsxs("div", { className: "debug-fields debug-fields--two", children: [_jsxs("label", { children: [_jsx("span", { children: "\u042E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0430\u0434\u0440\u0435\u0441" }), _jsx("textarea", { value: clientDraft.legalAddress, onChange: (event) => setClientField('legalAddress', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0430\u0434\u0440\u0435\u0441" }), _jsx("textarea", { value: clientDraft.actualAddress, onChange: (event) => setClientField('actualAddress', event.target.value) })] })] }), _jsxs("div", { className: "debug-fields debug-fields--four", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u043D\u043A" }), _jsx("input", { value: clientDraft.bankName, onChange: (event) => setClientField('bankName', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0418\u041A" }), _jsx("input", { value: clientDraft.bankBik, onChange: (event) => setClientField('bankBik', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442" }), _jsx("input", { value: clientDraft.bankAccount, onChange: (event) => setClientField('bankAccount', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u0440. \u0441\u0447\u0451\u0442" }), _jsx("input", { value: clientDraft.correspondentAccount, onChange: (event) => setClientField('correspondentAccount', event.target.value) })] })] }), _jsxs("div", { className: "debug-switches", children: [_jsxs("label", { children: [_jsx("input", { checked: clientDraft.storageAccountingEnabled, type: "checkbox", onChange: (event) => setClientField('storageAccountingEnabled', event.target.checked) }), _jsx("span", { children: "\u0421\u0447\u0438\u0442\u0430\u0442\u044C \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u0438\u0434 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsxs("select", { value: clientDraft.storesWithoutBoxes ? 'WITHOUT_BOXES' : 'WITH_BOXES', onChange: (event) => setClientField('storesWithoutBoxes', event.target.value === 'WITHOUT_BOXES'), children: [_jsx("option", { value: "WITH_BOXES", children: "\u0421 \u043A\u043E\u0440\u043E\u0431\u0430\u043C\u0438" }), _jsx("option", { value: "WITHOUT_BOXES", children: "\u0411\u0435\u0437 \u043A\u043E\u0440\u043E\u0431\u043E\u0432, \u043F\u043E\u0448\u0442\u0443\u0447\u043D\u043E" })] })] })] }), _jsxs("div", { className: "debug-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveClient(), disabled: !selectedClient || isSavingClient, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingClient ? 'Сохранение' : 'Сохранить клиента' })] }), selectedClient?.status === 'ARCHIVED' ? (_jsxs("button", { className: "primary-button debug-secondary", type: "button", onClick: () => void restoreArchivedClient(), disabled: isSavingClient, children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0432 \u0440\u0430\u0431\u043E\u0442\u0443" })] })) : (_jsxs("button", { className: "primary-button debug-secondary", type: "button", onClick: () => selectedClient && setPendingArchiveClient(selectedClient), disabled: !selectedClient || isSavingClient, children: [_jsx(Archive, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0412 \u0430\u0440\u0445\u0438\u0432" })] }))] })] })] })) : null, activeTab === 'users' ? (_jsxs("div", { className: "debug-split", children: [_jsx(DebugList, { count: filteredUsers.length, emptyText: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B", onSearch: setUserSearch, search: userSearch, searchPlaceholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F, \u043B\u043E\u0433\u0438\u043D\u0430, \u0440\u043E\u043B\u0438", title: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0438 \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440\u044B", children: filteredUsers.map((user) => (_jsxs("button", { className: user.id === selectedUserId ? 'debug-list-item active' : 'debug-list-item', type: "button", onClick: () => setSelectedUserId(user.id), children: [_jsx("strong", { children: user.name }), _jsx("span", { children: user.email }), _jsx("small", { children: user.roles.map((item) => item.role.code).join(', ') || 'Без роли' })] }, user.id))) }), _jsxs("div", { className: "debug-editor", children: [_jsxs("div", { className: "debug-editor__title", children: [_jsx(UserCog, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h3", { children: selectedUser?.name || 'Выберите пользователя' }), _jsx("span", { children: selectedUser ? `${selectedUser.email} · ${selectedUser.status}` : 'Карточка пользователя' })] })] }), _jsxs("div", { className: "debug-fields debug-fields--three", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0418\u043C\u044F" }), _jsx("input", { value: userDraft.name, onChange: (event) => setUserField('name', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041B\u043E\u0433\u0438\u043D / email" }), _jsx("input", { value: userDraft.email, onChange: (event) => setUserField('email', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("select", { value: userDraft.status, onChange: (event) => setUserField('status', event.target.value), children: userStatuses.map((status) => (_jsx("option", { value: status.value, children: status.label }, status.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C" }), _jsx("input", { autoComplete: "new-password", placeholder: "\u041E\u0441\u0442\u0430\u0432\u044C \u043F\u0443\u0441\u0442\u044B\u043C, \u0435\u0441\u043B\u0438 \u043D\u0435 \u043C\u0435\u043D\u044F\u0442\u044C", type: "password", value: userDraft.password, onChange: (event) => setUserField('password', event.target.value) })] }), _jsxs("label", { className: "debug-access-toggle", children: [_jsx("span", { children: "\u0414\u043E\u0441\u0442\u0443\u043F \u043A \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0435" }), _jsxs("span", { className: "debug-access-toggle__control", children: [_jsx("input", { checked: userDraft.analyticsEnabled, type: "checkbox", onChange: (event) => setUserField('analyticsEnabled', event.target.checked) }), _jsx("strong", { children: userDraft.analyticsEnabled ? 'Плитка видна' : 'Плитка скрыта' })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0439 \u0444\u0438\u043B\u0438\u0430\u043B" }), _jsxs("select", { value: userDraft.warehouseId, onChange: (event) => setUserField('warehouseId', event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0444\u0438\u043B\u0438\u0430\u043B\u044B (\u0442\u043E\u043B\u044C\u043A\u043E \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440/\u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446)" }), branches.filter((branch) => branch.isActive).map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id)))] })] })] }), _jsx("div", { className: "debug-role-grid", children: roles.map((role) => {
                                    const isSelected = roleCodes.includes(role.code);
                                    return (_jsxs("label", { className: isSelected ? 'debug-role active' : 'debug-role', children: [_jsx("input", { checked: isSelected, type: "checkbox", onChange: () => toggleRole(role.code) }), _jsxs("span", { children: [_jsx("strong", { children: role.code }), role.name] })] }, role.code));
                                }) }), _jsx("div", { className: "debug-actions", children: _jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveUser(), disabled: !selectedUser || isSavingUser, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingUser ? 'Сохранение' : 'Сохранить пользователя' })] }) }), _jsxs("div", { className: "debug-code-box", children: [_jsxs("div", { children: [_jsx(KeyRound, { size: 18, "aria-hidden": "true" }), _jsx("strong", { children: "4-\u0437\u043D\u0430\u0447\u043D\u044B\u0439 \u0441\u0443\u043F\u0435\u0440 \u043A\u043E\u0434 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430" }), _jsxs("span", { children: ["\u041D\u0443\u0436\u0435\u043D \u0434\u043B\u044F \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438 \u0448\u0430\u0433\u043E\u0432 \u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0439 \u043D\u0430 \u0422\u0421\u0414. \u0421\u0435\u0439\u0447\u0430\u0441:", ' ', selectedUser?.hasTsdActivationCode ? 'код задан' : 'код не задан', "."] })] }), _jsxs("div", { className: "debug-code-actions", children: [_jsx("input", { inputMode: "numeric", maxLength: 4, placeholder: "0000", value: tsdCode, onChange: (event) => setTsdCode(event.target.value.replace(/\D/g, '').slice(0, 4)) }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveTsdCode(), disabled: !selectedUser || isSavingCode, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u044C" })] }), _jsx("button", { className: "primary-button debug-secondary", type: "button", onClick: () => void clearTsdCode(), disabled: !selectedUser || isSavingCode || !selectedUser.hasTsdActivationCode, children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C" })] })] })] })] })) : null, activeTab === 'data' ? (_jsx("div", { className: "debug-shortcuts", children: workspaceShortcuts.map((item) => (_jsxs("button", { className: "debug-shortcut", type: "button", onClick: () => onOpenWorkspace?.(item.id), children: [_jsx(item.icon, { size: 20, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: item.title }), _jsx("small", { children: item.text })] }), _jsx(LinkIcon, { size: 16, "aria-hidden": "true" })] }, item.id))) })) : null, pendingUserOverrideReasons ? (_jsx(ConfirmDialog, { title: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u043E\u0431\u0445\u043E\u0434 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439", message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0431\u0443\u0434\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u0441 \u0434\u0430\u043D\u043D\u044B\u043C\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043E\u0431\u044B\u0447\u043D\u043E \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u043D\u0435 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.", details: pendingUserOverrideReasons, confirmLabel: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", isBusy: isSavingUser, onCancel: () => setPendingUserOverrideReasons(null), onConfirm: () => {
                    setPendingUserOverrideReasons(null);
                    void saveUserConfirmed();
                } })) : null, pendingArchiveClient ? (_jsx(ConfirmDialog, { title: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0432 \u0430\u0440\u0445\u0438\u0432", message: "\u041A\u043B\u0438\u0435\u043D\u0442 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u0432 \u0431\u0430\u0437\u0435, \u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043C\u0435\u0447\u0435\u043D \u0430\u0440\u0445\u0438\u0432\u043D\u044B\u043C \u0438 \u0443\u0431\u0440\u0430\u043D \u0438\u0437 \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043A\u043E\u043D\u0442\u0443\u0440\u0430.", details: [`${pendingArchiveClient.code} · ${pendingArchiveClient.name}`], confirmLabel: "\u0412 \u0430\u0440\u0445\u0438\u0432", isBusy: isSavingClient, onCancel: () => setPendingArchiveClient(null), onConfirm: () => void archiveClientConfirmed() })) : null] }));
    function setClientField(field, value) {
        setClientDraft((current) => ({ ...current, [field]: value }));
    }
    function setUserField(field, value) {
        setUserDraft((current) => ({ ...current, [field]: value }));
    }
}
function DebugList({ children, count, emptyText, onSearch, search, searchPlaceholder, title, }) {
    return (_jsxs("aside", { className: "debug-list", children: [_jsxs("div", { className: "debug-list__head", children: [_jsx("strong", { children: title }), _jsx("span", { children: count })] }), _jsx("input", { placeholder: searchPlaceholder, value: search, onChange: (event) => onSearch(event.target.value) }), _jsx("div", { className: "debug-list__items", children: count > 0 ? children : _jsx("p", { className: "debug-empty", children: emptyText }) })] }));
}
function clientToDraft(client) {
    return {
        name: client.name ?? '',
        legalName: client.legalName ?? '',
        inn: client.inn ?? '',
        clientKind: client.clientKind,
        status: client.status,
        kpp: client.kpp ?? '',
        ogrn: client.ogrn ?? '',
        legalAddress: client.legalAddress ?? '',
        actualAddress: client.actualAddress ?? '',
        phone: client.phone ?? '',
        telegramChatId: client.telegramChatId ?? '',
        email: client.email ?? '',
        bankName: client.bankName ?? '',
        bankBik: client.bankBik ?? '',
        bankAccount: client.bankAccount ?? '',
        correspondentAccount: client.correspondentAccount ?? '',
        storageAccountingEnabled: client.storageAccountingEnabled,
        storesWithoutBoxes: Boolean(client.storesWithoutBoxes),
        storagePriceRubPerLiterDay: client.storagePriceRubPerLiterDay === null ? '' : String(client.storagePriceRubPerLiterDay),
        fulfillmentManagerUserId: client.fulfillmentManagerUserId ?? '',
    };
}
function userToDraft(user) {
    return {
        email: user.email,
        name: user.name,
        password: '',
        status: user.status,
        analyticsEnabled: user.analyticsEnabled,
        warehouseId: user.activeWarehouseId ?? user.warehouseScopes?.find((scope) => scope.canRead)?.warehouse.id ?? '',
    };
}
function filterClients(clients, search) {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (!query) {
        return clients;
    }
    return clients.filter((client) => [client.name, client.legalName, client.inn, client.code, client.email, client.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query)));
}
function filterUsers(users, search) {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (!query) {
        return users;
    }
    return users.filter((user) => [user.name, user.email, user.status, ...user.roles.map((item) => item.role.code)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query)));
}
function userOverrideReasons(user) {
    const reasons = [];
    const login = user.email.trim();
    const name = user.name.trim();
    const password = user.password.trim();
    if (!login) {
        reasons.push('Логин / email пустой.');
    }
    else if (!isLikelyEmail(login)) {
        reasons.push('Логин указан не в формате email.');
    }
    if (!name) {
        reasons.push('Имя пользователя пустое.');
    }
    if (password && password.length < 10) {
        reasons.push('Новый пароль короче обычного требования 10 символов.');
    }
    return reasons;
}
function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function clientKindLabel(kind) {
    return clientKinds.find((item) => item.value === kind)?.label ?? kind;
}
function clientStatusLabel(status) {
    return clientStatuses.find((item) => item.value === status)?.label ?? status;
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить действие.';
}
