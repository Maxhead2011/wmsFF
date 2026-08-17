import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchRoles, fetchUsers, updateUserRoles, } from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';
export function UserRoleEditor({ session }) {
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [roleCodes, setRoleCodes] = useState([]);
    const [savedUser, setSavedUser] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);
    const selectedRoleLabel = useMemo(() => roleCodes.map((code) => roles.find((role) => role.code === code)?.name ?? code).join(', '), [roleCodes, roles]);
    useEffect(() => {
        void loadDictionaries();
    }, [session.accessToken]);
    useEffect(() => {
        if (!selectedUser) {
            setRoleCodes([]);
            return;
        }
        setRoleCodes(selectedUser.roles.map((item) => item.role.code));
    }, [selectedUser]);
    async function loadDictionaries() {
        setLoading(true);
        setError('');
        try {
            const [nextUsers, nextRoles] = await Promise.all([
                fetchUsers(session.accessToken),
                fetchRoles(session.accessToken),
            ]);
            setUsers(nextUsers);
            setRoles(nextRoles);
            setSelectedUserId((current) => current || nextUsers[0]?.id || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей и роли.');
        }
        finally {
            setLoading(false);
        }
    }
    function changeUser(userId) {
        setSelectedUserId(userId);
        setSavedUser(null);
    }
    function toggleRole(code) {
        setSavedUser(null);
        setRoleCodes((current) => {
            if (current.includes(code)) {
                return current.filter((item) => item !== code);
            }
            return [...current, code];
        });
    }
    async function saveRoles() {
        if (!selectedUser || roleCodes.length === 0) {
            return;
        }
        setSubmitting(true);
        setError('');
        setSavedUser(null);
        try {
            const saved = await updateUserRoles(session.accessToken, selectedUser.id, { roleCodes });
            setSavedUser(saved);
            setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить роли пользователя.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "access-form", children: [_jsxs("div", { className: "access-fields access-fields--editor", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsxs("select", { value: selectedUserId, onChange: (event) => changeUser(event.target.value), disabled: isLoading, children: [users.length === 0 ? _jsx("option", { value: "", children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, users.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("div", { className: "access-user-summary", children: [_jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0440\u043E\u043B\u0435\u0439" }), _jsx("strong", { children: roleCodes.length })] })] }), _jsx("div", { className: "role-choice-grid", "aria-label": "\u0420\u043E\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F", children: roles.map((role) => {
                    const isSelected = roleCodes.includes(role.code);
                    return (_jsxs("label", { className: isSelected ? 'role-choice role-choice--selected' : 'role-choice', children: [_jsx("input", { checked: isSelected, type: "checkbox", onChange: () => toggleRole(role.code) }), _jsxs("span", { children: [_jsx("strong", { children: role.code }), role.name] })] }, role.code));
                }) }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "access-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveRoles(), disabled: !selectedUser || isSubmitting || roleCodes.length === 0, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Сохранить роли' })] }), _jsxs("button", { className: "primary-button access-secondary", type: "button", onClick: () => void loadDictionaries(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), savedUser ? (_jsx(AccessResultCard, { title: "\u0420\u043E\u043B\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B", lines: [`${savedUser.name} · ${savedUser.email}`, selectedRoleLabel || 'роль не выбрана'] })) : null] }));
}
