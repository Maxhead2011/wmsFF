import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createUser, fetchBranches, fetchClients, fetchRoles, } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AccessResultCard } from './AccessResultCard';
import { ClientScopePicker, scopeMapToCreatePayload } from './ClientScopePicker';
const emptyUserForm = {
    email: '',
    name: '',
    password: '',
};
export function UserCreateForm({ session }) {
    const [roles, setRoles] = useState([]);
    const [clients, setClients] = useState([]);
    const [branches, setBranches] = useState([]);
    const [form, setForm] = useState(emptyUserForm);
    const [roleCodes, setRoleCodes] = useState(['OPERATOR']);
    const [warehouseId, setWarehouseId] = useState(session.user.activeWarehouseId ?? '');
    const [scopeMode, setScopeMode] = useState('all');
    const [scopeMap, setScopeMap] = useState({});
    const [createdUser, setCreatedUser] = useState(null);
    const [overrideReasons, setOverrideReasons] = useState(null);
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    const [isLoading, setLoading] = useState(false);
    const selectedRoleLabel = useMemo(() => roleCodes.map((code) => roles.find((role) => role.code === code)?.name ?? code).join(', '), [roleCodes, roles]);
    const clientRoleSelected = roleCodes.includes('CLIENT');
    const employeeNeedsBranch = !roleCodes.some((code) => ['ADMIN', 'OWNER', 'CLIENT'].includes(code));
    useEffect(() => {
        let isActive = true;
        async function loadDictionaries() {
            setLoading(true);
            setError('');
            try {
                const [nextRoles, nextClients, nextBranches] = await Promise.all([
                    fetchRoles(session.accessToken),
                    fetchClients(session.accessToken),
                    fetchBranches(session.accessToken),
                ]);
                if (!isActive) {
                    return;
                }
                setRoles(nextRoles);
                setClients(nextClients);
                setBranches(nextBranches);
                setWarehouseId((current) => nextBranches.some((branch) => branch.id === current)
                    ? current
                    : nextBranches[0]?.id ?? '');
                if (!nextRoles.some((role) => role.code === 'OPERATOR')) {
                    setRoleCodes(nextRoles[0] ? [nextRoles[0].code] : []);
                }
            }
            catch (caught) {
                if (isActive) {
                    setError(caught instanceof Error ? caught.message : 'Не удалось загрузить роли и клиентов.');
                }
            }
            finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        }
        void loadDictionaries();
        return () => {
            isActive = false;
        };
    }, [session.accessToken]);
    useEffect(() => {
        if (clientRoleSelected) {
            setScopeMode('limited');
        }
    }, [clientRoleSelected]);
    function toggleRole(code) {
        setRoleCodes((current) => {
            if (current.includes(code)) {
                return current.filter((item) => item !== code);
            }
            return [...current, code];
        });
    }
    async function submit(event) {
        event.preventDefault();
        const reasons = userOverrideReasons(form);
        if (reasons.length > 0) {
            setOverrideReasons(reasons);
            return;
        }
        await createUserFromForm();
    }
    async function createUserFromForm() {
        setSubmitting(true);
        setError('');
        setCreatedUser(null);
        try {
            const scopes = scopeMode === 'limited' ? scopeMapToCreatePayload(scopeMap) : undefined;
            const created = await createUser(session.accessToken, {
                email: form.email.trim(),
                name: form.name.trim(),
                password: form.password,
                roleCodes: roleCodes.length ? roleCodes : undefined,
                clientIds: scopes?.clientIds.length ? scopes.clientIds : undefined,
                writableClientIds: scopes?.writableClientIds.length ? scopes.writableClientIds : undefined,
                warehouseId: employeeNeedsBranch ? warehouseId : undefined,
            });
            setCreatedUser(created);
            setForm(emptyUserForm);
            setScopeMap({});
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать пользователя.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "access-form", onSubmit: submit, children: [_jsxs("div", { className: "access-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041B\u043E\u0433\u0438\u043D / email" }), _jsx("input", { inputMode: "text", type: "text", value: form.email, onChange: (event) => setForm({ ...form, email: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u043C\u044F" }), _jsx("input", { value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0430\u0440\u043E\u043B\u044C" }), _jsx("input", { type: "password", value: form.password, onChange: (event) => setForm({ ...form, password: event.target.value }), required: true })] }), employeeNeedsBranch ? (_jsxs("label", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" }), _jsxs("select", { value: warehouseId, onChange: (event) => setWarehouseId(event.target.value), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043B\u0438\u0430\u043B" }), branches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id)))] })] })) : null] }), _jsx("div", { className: "role-choice-grid", "aria-label": "\u0420\u043E\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F", children: roles.map((role) => (_jsxs("label", { className: "role-choice", children: [_jsx("input", { checked: roleCodes.includes(role.code), type: "checkbox", onChange: () => toggleRole(role.code) }), _jsxs("span", { children: [_jsx("strong", { children: role.code }), role.name] })] }, role.code))) }), _jsxs("div", { className: "access-segments", role: "tablist", "aria-label": "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u0434\u043E\u0441\u0442\u0443\u043F", children: [_jsx("button", { className: scopeMode === 'all' ? 'active' : '', type: "button", onClick: () => setScopeMode('all'), disabled: clientRoleSelected, children: "\u0412\u0441\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), _jsx("button", { className: scopeMode === 'limited' ? 'active' : '', type: "button", onClick: () => setScopeMode('limited'), children: "\u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0438\u0442\u044C" })] }), scopeMode === 'limited' ? _jsx(ClientScopePicker, { clients: clients, value: scopeMap, onChange: setScopeMap }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button access-submit", type: "submit", disabled: isSubmitting ||
                    isLoading ||
                    roleCodes.length === 0 ||
                    (employeeNeedsBranch && !warehouseId), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохранение' : 'Создать пользователя' })] }), createdUser ? (_jsx(AccessResultCard, { title: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0441\u043E\u0437\u0434\u0430\u043D", lines: [`${createdUser.name} · ${createdUser.email}`, selectedRoleLabel || 'роль не выбрана'] })) : null, overrideReasons ? (_jsx(ConfirmDialog, { title: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u043E\u0431\u0445\u043E\u0434 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439", message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0431\u0443\u0434\u0435\u0442 \u0441\u043E\u0437\u0434\u0430\u043D \u0441 \u0434\u0430\u043D\u043D\u044B\u043C\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043E\u0431\u044B\u0447\u043D\u043E \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u043D\u0435 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.", details: overrideReasons, confirmLabel: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C", isBusy: isSubmitting, onCancel: () => setOverrideReasons(null), onConfirm: () => {
                    setOverrideReasons(null);
                    void createUserFromForm();
                } })) : null] }));
}
function userOverrideReasons(form) {
    const reasons = [];
    const login = form.email.trim();
    const name = form.name.trim();
    const password = form.password.trim();
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
        reasons.push('Пароль короче обычного требования 10 символов.');
    }
    return reasons;
}
function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
