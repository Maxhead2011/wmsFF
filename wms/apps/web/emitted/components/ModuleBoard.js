import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ModuleBoard({ modules }) {
    return (_jsxs("section", { className: "module-board", "aria-label": "\u041C\u043E\u0434\u0443\u043B\u0438 WMS", children: [_jsxs("div", { className: "section-heading", children: [_jsx("p", { className: "eyebrow", children: "\u041C\u043E\u0434\u0443\u043B\u0438 MVP" }), _jsx("h2", { children: "\u041F\u0435\u0440\u0432\u044B\u0439 \u0440\u0430\u0431\u043E\u0447\u0438\u0439 \u0441\u0440\u0435\u0437" })] }), _jsx("div", { className: "module-grid", children: modules.map((module) => (_jsxs("article", { className: "module-card", children: [_jsxs("div", { className: "module-card__header", children: [_jsx(module.icon, { size: 22, "aria-hidden": "true" }), _jsx("span", { className: `status status--${module.status}`, children: labelByStatus[module.status] })] }), _jsx("h3", { children: module.title }), _jsx("p", { children: module.description })] }, module.title))) })] }));
}
const labelByStatus = {
    ready: 'заложено',
    'in-progress': 'в работе',
    planned: 'план',
};
