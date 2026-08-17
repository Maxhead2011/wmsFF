import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Boxes, MapPinned, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchBranchStockSummary } from '../../lib/api';
export function ClientBranchStockTiles({ accessToken, clientId, }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    async function load() {
        setLoading(true);
        try {
            setRows(await fetchBranchStockSummary(accessToken, clientId));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void load();
    }, [accessToken, clientId]);
    return (_jsxs("section", { className: "client-branch-stock", children: [_jsxs("div", { className: "client-branch-stock__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0413\u0435\u043E\u0433\u0440\u0430\u0444\u0438\u044F \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("h3", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u0433\u043E\u0440\u043E\u0434\u0430\u043C" }), _jsx("span", { children: "\u0412\u0438\u0434\u043D\u043E, \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432 \u043A\u0430\u0436\u0434\u043E\u043C \u043F\u043E\u0434\u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u0438 \u0424\u0424." })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void load(), "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u0433\u043E\u0440\u043E\u0434\u0430\u043C", children: _jsx(RefreshCw, { size: 17 }) })] }), _jsxs("div", { className: "client-branch-stock__grid", children: [rows.map((row) => (_jsxs("article", { children: [_jsx("span", { className: "client-branch-stock__icon", children: _jsx(MapPinned, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: row.warehouse.city }), _jsx("small", { children: row.warehouse.name })] }), _jsxs("b", { children: [row.totalQuantity.toLocaleString('ru-RU'), " \u0448\u0442."] }), _jsxs("span", { className: "client-branch-stock__detail", children: [_jsx(Boxes, { size: 14 }), " ", row.skuCount, " SKU \u00B7 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E ", row.availableQuantity.toLocaleString('ru-RU')] }), row.incomingInTransitQuantity > 0 ? (_jsxs("span", { className: "client-branch-stock__detail", children: ["\u0412 \u043F\u0443\u0442\u0438 \u0432 \u0433\u043E\u0440\u043E\u0434: ", row.incomingInTransitQuantity.toLocaleString('ru-RU'), " \u0448\u0442."] })) : null, row.outgoingInTransitQuantity > 0 ? (_jsxs("span", { className: "client-branch-stock__detail", children: ["\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0438\u0437 \u0433\u043E\u0440\u043E\u0434\u0430: ", row.outgoingInTransitQuantity.toLocaleString('ru-RU'), " \u0448\u0442."] })) : null] }, row.warehouse.id))), !loading && rows.length === 0 ? _jsx("p", { className: "muted", children: "\u0422\u043E\u0432\u0430\u0440 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0440\u0430\u0437\u043C\u0435\u0449\u0451\u043D \u043D\u0438 \u0432 \u043E\u0434\u043D\u043E\u043C \u0433\u043E\u0440\u043E\u0434\u0435." }) : null, loading && rows.length === 0 ? _jsx("p", { className: "muted", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u043E \u0444\u0438\u043B\u0438\u0430\u043B\u0430\u043C\u2026" }) : null] })] }));
}
