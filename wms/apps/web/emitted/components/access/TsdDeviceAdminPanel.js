import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createTsdDevice, fetchTsdDevices, fetchUsers, } from '../../lib/api';
import { AccessResultCard } from './AccessResultCard';
const emptyForm = {
    code: '',
    name: '',
    userId: '',
};
export function TsdDeviceAdminPanel({ session }) {
    const [devices, setDevices] = useState([]);
    const [users, setUsers] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [createdDevice, setCreatedDevice] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const operators = useMemo(() => users.filter((user) => user.roles.some((item) => item.role.code !== 'CLIENT')), [users]);
    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.accessToken]);
    async function loadData() {
        setLoading(true);
        setError('');
        try {
            const [nextDevices, nextUsers] = await Promise.all([
                fetchTsdDevices(session.accessToken),
                fetchUsers(session.accessToken),
            ]);
            setDevices(nextDevices);
            setUsers(nextUsers);
            const nextOperators = nextUsers.filter((user) => user.roles.some((item) => item.role.code !== 'CLIENT'));
            setForm((current) => ({ ...current, userId: current.userId || nextOperators[0]?.id || '' }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить ТСД.');
        }
        finally {
            setLoading(false);
        }
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setCreatedDevice(null);
        try {
            const created = await createTsdDevice(session.accessToken, {
                code: form.code.trim(),
                name: form.name.trim(),
                userId: form.userId,
            });
            setCreatedDevice(created);
            setForm({ ...emptyForm, userId: form.userId });
            await loadData();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать ТСД.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "access-form", children: [_jsxs("form", { className: "access-form", onSubmit: submit, children: [_jsxs("div", { className: "access-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434 \u0422\u0421\u0414" }), _jsx("input", { value: form.code, onChange: (event) => setForm({ ...form, code: event.target.value }), placeholder: "TSD-01", required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }), placeholder: "\u0422\u0435\u0440\u043C\u0438\u043D\u0430\u043B \u043F\u0440\u0438\u0435\u043C\u043A\u0438", required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsx("select", { value: form.userId, onChange: (event) => setForm({ ...form, userId: event.target.value }), required: true, children: operators.map((user) => (_jsxs("option", { value: user.id, children: [user.name, " \u00B7 ", user.email] }, user.id))) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "access-actions", children: [_jsxs("button", { className: "primary-button access-submit", type: "submit", disabled: isSubmitting || isLoading || !form.userId, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Создание' : 'Создать ТСД' })] }), _jsxs("button", { className: "primary-button access-secondary", type: "button", onClick: loadData, disabled: isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" })] })] })] }), createdDevice ? (_jsx(AccessResultCard, { title: "\u0422\u0421\u0414 \u0441\u043E\u0437\u0434\u0430\u043D", lines: [
                    `${createdDevice.name} · ${createdDevice.code}`,
                    `Секрет: ${createdDevice.deviceSecret}`,
                    'Секрет показывается один раз.',
                ] })) : null, _jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0434" }), _jsx("th", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0432\u0445\u043E\u0434" })] }) }), _jsx("tbody", { children: devices.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "\u0422\u0421\u0414 \u0435\u0449\u0435 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u044B" }) })) : (devices.map((device) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("strong", { children: device.code }) }), _jsx("td", { children: device.name }), _jsx("td", { children: device.user.name }), _jsx("td", { children: device.status }), _jsx("td", { children: device.lastLoginAt ? new Date(device.lastLoginAt).toLocaleString('ru-RU') : '-' })] }, device.id)))) })] }) })] }));
}
