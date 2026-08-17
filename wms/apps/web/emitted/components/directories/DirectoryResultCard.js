import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2 } from 'lucide-react';
export function DirectoryResultCard({ title, lines }) {
    return (_jsxs("div", { className: "directory-result", children: [_jsx(CheckCircle2, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: title }), lines.map((line) => (_jsx("span", { children: line }, line)))] })] }));
}
