import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { fetchGoodsArrivalEstimate } from '../../lib/api';
export function ClientCabinetPprWidget({ accessToken, clientId }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void fetchGoodsArrivalEstimate(accessToken, clientId)
            .then((value) => { if (active) {
            setData(value);
            setError('');
        } })
            .catch((caught) => { if (active)
            setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать ППР.'); });
        return () => { active = false; };
    }, [accessToken, clientId]);
    return (_jsxs("section", { className: "client-cabinet-storage-widget", "aria-label": "\u041E\u0440\u0438\u0435\u043D\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u041F\u041F\u0420", children: [_jsxs("div", { className: "client-cabinet-storage-widget__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u041F\u0420" }), _jsx("h3", { children: "\u041E\u0440\u0438\u0435\u043D\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C" })] }), _jsxs("strong", { children: [money(data?.estimatedRub ?? 0), " \u20BD"] })] }), data ? _jsxs("p", { children: ["\u0421 ", date(data.periodFrom), " \u043F\u043E ", date(data.periodTo), " \u00B7 ", data.bagCount, " \u043C\u0435\u0448\u043A\u043E\u0432 \u00B7 ", data.boxCount, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] }) : null, data && !data.pricesConfigured ? _jsx("p", { className: "form-error", children: "\u0414\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u044B \u0446\u0435\u043D\u044B \u041F\u041F\u0420." }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null] }));
}
function date(value) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function money(value) { return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
