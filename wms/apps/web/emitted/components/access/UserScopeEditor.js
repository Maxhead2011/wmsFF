import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClients, fetchUsers, updateUserClientScopes, } from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';
import { ClientScopePicker, scopeMapToPayload } from './ClientScopePicker';
export function UserScopeEditor({ session }) {
    const [users, setUsers] = useState([]);
    const [clients, setClients] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [scopeMode, setScopeMode] = useState('all');
    const [scopeMap, setScopeMap] = useState({});
    const [savedUser, setSavedUser] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);
    const selectedUserHasClientRole = selectedUser ? userHasClientRole(selectedUser) : false;
    useEffect(() => {
        void loadDictionaries();
    }, [session.accessToken]);
    useEffect(() => {
        if (selectedUser) {
            applyUserScopes(selectedUser);
        }
    }, [selectedUserId, users]);
    async function loadDictionaries() {
        setLoading(true);
        setError('');
        try {
            const [nextUsers, nextClients] = await Promise.all([
                fetchUsers(session.accessToken),
                fetchClients(session.accessToken),
            ]);
            setUsers(nextUsers);
            setClients(nextClients);
            setSelectedUserId((current) => current || nextUsers[0]?.id || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей и клиентов.');
        }
        finally {
            setLoading(false);
        }
    }
    function applyUserScopes(user) {
        const nextMap = {};
        user.clientScopes.forEach((scope) => {
            nextMap[scope.client.id] = scope.canWrite ? 'write' : 'read';
        });
        setScopeMap(nextMap);
        setScopeMode(user.clientScopes.length === 0 && !userHasClientRole(user) ? 'all' : 'limited');
    }
    function changeUser(userId) {
        setSelectedUserId(userId);
        setSavedUser(null);
    }
    async function saveScopes() {
        if (!selectedUser) {
            return;
        }
        setSubmitting(true);
        setError('');
        setSavedUser(null);
        try {
            const saved = await updateUserClientScopes(session.accessToken, selectedUser.id, {
                allClients: scopeMode === 'all',
                scopes: scopeMode === 'all' ? [] : scopeMapToPayload(scopeMap),
            });
            setSavedUser({
                ...selectedUser,
                clientScopes: saved.clientScopes,
            });
            await loadDictionaries();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить доступы.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "access-form", children: [_jsxs("div", { className: "access-fields access-fields--editor", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsxs("select", { value: selectedUserId, onChange: (event) => changeUser(event.target.value), disabled: isLoading, children: [users.length === 0 ? _jsx("option", { value: "", children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, users.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("div", { className: "access-user-summary", children: [_jsx("span", { children: "\u0420\u043E\u043B\u0438" }), _jsx("strong", { children: selectedUser?.roles.map((item) => item.role.code).join(', ') || '-' })] })] }), _jsxs("div", { className: "access-segments", role: "tablist", "aria-label": "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F", children: [_jsx("button", { className: scopeMode === 'all' ? 'active' : '', type: "button", onClick: () => setScopeMode('all'), disabled: selectedUserHasClientRole, children: "\u0412\u0441\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), _jsx("button", { className: scopeMode === 'limited' ? 'active' : '', type: "button", onClick: () => setScopeMode('limited'), children: "\u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0438\u0442\u044C" })] }), scopeMode === 'limited' ? _jsx(ClientScopePicker, { clients: clients, value: scopeMap, onChange: setScopeMap }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "access-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveScopes(), disabled: !selectedUser || isSubmitting, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Сохранить доступы' })] }), _jsxs("button", { className: "primary-button access-secondary", type: "button", onClick: () => void loadDictionaries(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), savedUser ? (_jsx(AccessResultCard, { title: "\u0414\u043E\u0441\u0442\u0443\u043F\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B", lines: [`${savedUser.name} · ${savedUser.email}`, scopeMode === 'all' ? 'Все клиенты' : `${savedUser.clientScopes.length} scope`] })) : null] }));
}
function userHasClientRole(user) {
    return user.roles.some((item) => item.role.code === 'CLIENT');
}
