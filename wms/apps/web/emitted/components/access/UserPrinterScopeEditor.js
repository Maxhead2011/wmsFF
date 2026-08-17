import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Printer, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchPrintPrinterGroups, fetchUsers, updateUserPrinterScopes, } from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';
export function UserPrinterScopeEditor({ session }) {
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [scopes, setScopes] = useState([]);
    const [groupCode, setGroupCode] = useState('DEFAULT');
    const [canPrint, setCanPrint] = useState(true);
    const [canManage, setCanManage] = useState(false);
    const [savedUser, setSavedUser] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);
    useEffect(() => {
        void loadDictionaries();
    }, [session.accessToken]);
    useEffect(() => {
        setScopes(selectedUser?.printerScopes ?? []);
        setSavedUser(null);
    }, [selectedUser]);
    async function loadDictionaries() {
        setLoading(true);
        setError('');
        try {
            const [nextUsers, nextGroups] = await Promise.all([
                fetchUsers(session.accessToken),
                fetchPrintPrinterGroups(session.accessToken),
            ]);
            setUsers(nextUsers);
            setGroups(nextGroups);
            setSelectedUserId((current) => current || nextUsers[0]?.id || '');
            setGroupCode((current) => current || nextGroups[0]?.groupCode || 'DEFAULT');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей и группы принтеров.');
        }
        finally {
            setLoading(false);
        }
    }
    function changeUser(userId) {
        setSelectedUserId(userId);
        setSavedUser(null);
    }
    function upsertScope() {
        const normalizedGroupCode = groupCode.trim().toUpperCase();
        if (!normalizedGroupCode) {
            return;
        }
        setSavedUser(null);
        setScopes((current) => [
            {
                groupCode: normalizedGroupCode,
                canPrint: canPrint || canManage,
                canManage,
            },
            ...current.filter((scope) => scope.groupCode !== normalizedGroupCode),
        ]);
    }
    function removeScope(targetGroupCode) {
        setSavedUser(null);
        setScopes((current) => current.filter((scope) => scope.groupCode !== targetGroupCode));
    }
    async function saveScopes() {
        if (!selectedUser) {
            return;
        }
        setSubmitting(true);
        setError('');
        setSavedUser(null);
        try {
            const saved = await updateUserPrinterScopes(session.accessToken, selectedUser.id, { scopes });
            setSavedUser(saved);
            setUsers((current) => current.map((user) => (user.id === saved.id ? saved : user)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить группы принтеров пользователя.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "access-form", children: [_jsxs("div", { className: "access-fields access-fields--editor", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsxs("select", { value: selectedUserId, onChange: (event) => changeUser(event.target.value), disabled: isLoading, children: [users.length === 0 ? _jsx("option", { value: "", children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" }) : null, users.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " - ", user.email] }, user.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u0440\u0443\u043F\u043F\u0430 \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432" }), _jsx("input", { list: "printer-groups", value: groupCode, onChange: (event) => setGroupCode(event.target.value) }), _jsx("datalist", { id: "printer-groups", children: groups.map((group) => (_jsx("option", { value: group.groupCode }, group.groupCode))) })] })] }), _jsxs("div", { className: "access-scope-switches", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: canPrint, onChange: (event) => setCanPrint(event.target.checked) }), _jsx("span", { children: "\u041F\u0435\u0447\u0430\u0442\u044C" })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: canManage, onChange: (event) => setCanManage(event.target.checked) }), _jsx("span", { children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" })] }), _jsxs("button", { className: "primary-button access-secondary", type: "button", onClick: upsertScope, children: [_jsx(ShieldCheck, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443" })] })] }), _jsxs("div", { className: "role-choice-grid", "aria-label": "\u0413\u0440\u0443\u043F\u043F\u044B \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F", children: [scopes.length === 0 ? _jsx("p", { className: "panel-message", children: "\u0413\u0440\u0443\u043F\u043F\u044B \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432 \u043D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u044B." }) : null, scopes.map((scope) => (_jsxs("button", { className: "role-choice role-choice--selected", type: "button", onClick: () => removeScope(scope.groupCode), children: [_jsx(Printer, { size: 16, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: scope.groupCode }), scope.canManage ? 'печать и управление' : scope.canPrint ? 'печать' : 'без печати'] })] }, scope.groupCode)))] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "access-actions", children: [_jsxs("button", { className: "primary-button", type: "button", onClick: () => void saveScopes(), disabled: !selectedUser || isSubmitting, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Сохранить группы' })] }), _jsxs("button", { className: "primary-button access-secondary", type: "button", onClick: () => void loadDictionaries(), disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] }), savedUser ? (_jsx(AccessResultCard, { title: "\u0413\u0440\u0443\u043F\u043F\u044B \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u043E\u0432 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B", lines: [
                    `${savedUser.name} · ${savedUser.email}`,
                    savedUser.printerScopes.map((scope) => `${scope.groupCode}: ${scope.canManage ? 'управление' : 'печать'}`).join(', ') ||
                        'группы не назначены',
                ] })) : null] }));
}
