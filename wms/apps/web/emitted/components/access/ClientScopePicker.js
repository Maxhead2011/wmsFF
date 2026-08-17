import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ClientScopePicker({ clients, value, onChange }) {
    function changeScope(clientId, level) {
        onChange({
            ...value,
            [clientId]: level,
        });
    }
    if (clients.length === 0) {
        return _jsx("p", { className: "access-empty", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." });
    }
    return (_jsx("div", { className: "scope-picker", children: clients.map((client) => (_jsxs("label", { className: "scope-row", children: [_jsxs("span", { children: [_jsx("strong", { children: client.code }), client.name] }), _jsxs("select", { value: value[client.id] ?? 'none', onChange: (event) => changeScope(client.id, event.target.value), children: [_jsx("option", { value: "none", children: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }), _jsx("option", { value: "read", children: "\u0427\u0442\u0435\u043D\u0438\u0435" }), _jsx("option", { value: "write", children: "\u0417\u0430\u043F\u0438\u0441\u044C" })] })] }, client.id))) }));
}
export function scopeMapToPayload(scopeMap) {
    // Русский комментарий: запись всегда включает чтение, потому что backend хранит write как расширение read-scope.
    return Object.entries(scopeMap)
        .filter(([, level]) => level !== 'none')
        .map(([clientId, level]) => ({
        clientId,
        canRead: true,
        canWrite: level === 'write',
    }));
}
export function scopeMapToCreatePayload(scopeMap) {
    const scopes = scopeMapToPayload(scopeMap);
    // Русский комментарий: CreateUserDto принимает два массива, поэтому разворачиваем карту доступа в read/write списки.
    return {
        clientIds: scopes.map((scope) => scope.clientId),
        writableClientIds: scopes.filter((scope) => scope.canWrite).map((scope) => scope.clientId),
    };
}
