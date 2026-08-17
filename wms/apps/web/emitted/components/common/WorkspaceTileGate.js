import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, Grid2X2 } from 'lucide-react';
import { useState } from 'react';
import './workspace-tile-gate.css';
/**
 * A consistent first screen for operational workspaces.  It prevents a user
 * from landing on a wide table or a long form and keeps the actual workspace
 * one deliberate click away.
 */
export function WorkspaceTileGate({ eyebrow, title, description, tiles, children }) {
    const [isOpen, setOpen] = useState(false);
    if (isOpen) {
        return _jsxs("div", { className: "workspace-tile-gate workspace-tile-gate--open", children: [_jsxs("button", { className: "workspace-tile-gate__back", type: "button", onClick: () => setOpen(false), children: [_jsx(Grid2X2, { size: 16 }), "\u0420\u0430\u0437\u0434\u0435\u043B\u044B"] }), children] });
    }
    return _jsxs("section", { className: "workspace-tile-gate", "aria-label": title, children: [_jsxs("header", { className: "workspace-tile-gate__header", children: [_jsx("p", { className: "eyebrow", children: eyebrow }), _jsx("h2", { children: title }), _jsx("p", { children: description })] }), _jsx("div", { className: "workspace-tile-gate__grid", children: tiles.map((tile) => {
                    const Icon = tile.icon;
                    return _jsxs("button", { className: `workspace-tile-gate__tile workspace-tile-gate__tile--${tile.tone ?? 'blue'}`, type: "button", onClick: () => {
                            tile.onOpen?.();
                            setOpen(true);
                        }, children: [_jsx("span", { className: "workspace-tile-gate__icon", children: _jsx(Icon, { size: 23 }) }), _jsxs("span", { className: "workspace-tile-gate__body", children: [_jsx("strong", { children: tile.title }), _jsx("small", { children: tile.description })] }), _jsx(ArrowRight, { size: 19, "aria-hidden": "true" })] }, tile.title);
                }) })] });
}
