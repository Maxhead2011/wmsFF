import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ChevronDown, Download, Filter, ReceiptText, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadStorageOverviewXlsx, fetchClients, fetchStorageOverview, generateStorageCharge, updateStorageTariff, } from '../../lib/api';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function StoragePanel({ session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [periodFrom, setPeriodFrom] = useState(monthStart());
    const [periodTo, setPeriodTo] = useState(today());
    const [tariff, setTariff] = useState('0');
    const [overview, setOverview] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [storageCharge, setStorageCharge] = useState(null);
    const [isLoading, setLoading] = useState(false);
    const [isSavingTariff, setSavingTariff] = useState(false);
    const [isCharging, setCharging] = useState(false);
    const [areControlsOpen, setControlsOpen] = useState(false);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
    const storageEnabled = selectedClient?.storageAccountingEnabled === true;
    useEffect(() => {
        let isActive = true;
        async function loadClients() {
            try {
                const list = await fetchClients(session.accessToken);
                if (!isActive) {
                    return;
                }
                setClients(list);
                setClientId((current) => validRememberedClientId(current, list));
            }
            catch (caught) {
                if (isActive) {
                    setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
                }
            }
        }
        void loadClients();
        return () => {
            isActive = false;
        };
    }, [session.accessToken]);
    useEffect(() => {
        if (selectedClient) {
            setTariff(String(numberValue(selectedClient.storagePriceRubPerLiterDay)));
        }
    }, [selectedClient]);
    useEffect(() => {
        setStorageCharge(null);
    }, [clientId, periodFrom, periodTo]);
    useEffect(() => {
        if (clientId) {
            void loadOverview();
        }
    }, [clientId]);
    async function loadOverview(event) {
        event?.preventDefault();
        if (!clientId) {
            return;
        }
        setLoading(true);
        setError('');
        setMessage('');
        try {
            const next = await fetchStorageOverview(session.accessToken, {
                clientId,
                periodFrom,
                periodTo,
            });
            setOverview(next);
            setTariff(String(next.tariffRubPerLiterDay));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать хранение.');
        }
        finally {
            setLoading(false);
        }
    }
    async function saveTariff() {
        if (!clientId) {
            return;
        }
        if (!storageEnabled) {
            setError('У выбранного клиента отключен учет хранения. Включите его в карточке.');
            return;
        }
        const price = Number(tariff);
        if (!Number.isFinite(price) || price < 0) {
            setError('Тариф должен быть числом не меньше 0.');
            return;
        }
        setSavingTariff(true);
        setError('');
        setMessage('');
        try {
            const updated = await updateStorageTariff(session.accessToken, clientId, {
                storagePriceRubPerLiterDay: price,
            });
            setClients((current) => current.map((client) => client.id === updated.id
                ? {
                    ...client,
                    storageAccountingEnabled: updated.storageAccountingEnabled,
                    storagePriceRubPerLiterDay: updated.storagePriceRubPerLiterDay,
                }
                : client));
            setStorageCharge(null);
            await loadOverview();
            setMessage('Тариф хранения сохранен.');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить тариф.');
        }
        finally {
            setSavingTariff(false);
        }
    }
    async function createStorageCharge() {
        if (!clientId) {
            return;
        }
        if (!storageEnabled) {
            setError('У выбранного клиента отключен учет хранения. Включите его в карточке.');
            return;
        }
        const price = Number(tariff);
        if (!Number.isFinite(price) || price < 0) {
            setError('Тариф должен быть числом не меньше 0.');
            return;
        }
        setCharging(true);
        setError('');
        setMessage('');
        try {
            const charge = await generateStorageCharge(session.accessToken, {
                clientId,
                periodFrom,
                periodTo,
                unitPriceRub: price,
                approve: true,
                comment: 'Начисление хранения из раздела Склад и операции.',
            });
            setStorageCharge(charge);
            await loadOverview();
            setMessage(`Начисление хранения создано в биллинге: ${formatMoney(Number(charge.totalRub))}.`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось начислить хранение.');
        }
        finally {
            setCharging(false);
        }
    }
    async function downloadStorageXlsx() {
        if (!clientId) {
            return;
        }
        setError('');
        try {
            const blob = await downloadStorageOverviewXlsx(session.accessToken, {
                clientId,
                periodFrom,
                periodTo,
            });
            const clientCode = selectedClient?.code ?? 'client';
            downloadBlob(blob, `storage-${safeDownloadName(clientCode)}-${periodFrom}-${periodTo}.xlsx`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось скачать XLSX по хранению.');
        }
    }
    return (_jsxs("section", { className: "storage-panel", "aria-label": "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435", children: [_jsxs("div", { className: "warehouse-subheading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435" }), _jsx("span", { children: selectedClient ? `${selectedClient.name} · ${periodFrom} - ${periodTo}` : 'Остатки клиента, литраж и стоимость хранения за период' })] }), _jsxs("button", { className: "icon-text-button storage-controls-toggle", type: "button", onClick: () => setControlsOpen((current) => !current), "aria-expanded": areControlsOpen, title: areControlsOpen ? 'Свернуть параметры' : 'Показать параметры', children: [_jsx(Filter, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: areControlsOpen ? 'Свернуть параметры' : 'Параметры' }), _jsx(ChevronDown, { className: "storage-controls-toggle__chevron", size: 16, "aria-hidden": "true" })] })] }), areControlsOpen ? (_jsxs("form", { className: "storage-controls", onSubmit: (event) => void loadOverview(event), children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name, client.storageAccountingEnabled ? '' : ' · хранение отключено'] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u20BD / \u043B\u0438\u0442\u0440 \u0432 \u0441\u0443\u0442\u043A\u0438" }), _jsx("input", { min: "0", step: "0.0001", type: "number", value: tariff, onChange: (event) => setTariff(event.target.value) })] }), _jsxs("div", { className: "storage-actions", children: [_jsxs("button", { className: "icon-text-button warehouse-secondary", type: "button", onClick: () => void saveTariff(), disabled: !clientId || !storageEnabled || isSavingTariff, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingTariff ? 'Сохраняю' : 'Сохранить тариф' })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !clientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Считаю' : 'Показать' })] }), _jsxs("button", { className: "icon-text-button warehouse-secondary", type: "button", onClick: () => void createStorageCharge(), disabled: !clientId || !storageEnabled || isCharging, children: [_jsx(ReceiptText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isCharging ? 'Начисляю' : 'Начислить хранение' })] }), _jsxs("button", { className: "icon-text-button warehouse-secondary", type: "button", onClick: () => void downloadStorageXlsx(), disabled: !clientId, children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "XLSX" })] })] })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, selectedClient && !storageEnabled ? (_jsx("p", { className: "panel-message", children: "\u0423 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D \u0443\u0447\u0435\u0442 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F. \u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043D\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0438 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u0435\u0442\u0441\u044F." })) : null, overview ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "storage-summary", children: [_jsx(Metric, { label: "SKU", value: formatNumber(overview.totals.skuCount) }), _jsx(Metric, { label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: formatNumber(overview.totals.quantity) }), _jsx(Metric, { label: "\u041B\u0438\u0442\u0440\u043E\u0432 \u0441\u0435\u0439\u0447\u0430\u0441", value: formatNumber(overview.totals.totalLiters) }), _jsx(Metric, { label: "\u041B\u0438\u0442\u0440\u043E-\u0434\u043D\u0435\u0439", value: formatNumber(overview.totals.literDays) }), _jsx(Metric, { label: "\u041A \u043E\u043F\u043B\u0430\u0442\u0435", value: formatMoney(overview.totals.storageCostRub) }), _jsx(Metric, { label: "\u0412 \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u0435", value: storageCharge ? formatMoney(Number(storageCharge.totalRub)) : 'не начислено' })] }), _jsx("div", { className: "storage-table-wrap", children: _jsxs("table", { className: "data-table storage-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0411\u0430\u0440\u043A\u043E\u0434" }), _jsx("th", { children: "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B \u041C\u041F" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B" }), _jsx("th", { children: "\u041B\u0438\u0442\u0440\u043E\u0432 \u0435\u0434." }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("th", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" }), _jsx("th", { children: "\u041B\u0438\u0442\u0440\u043E-\u0434\u043D\u0438" }), _jsx("th", { children: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C" })] }) }), _jsxs("tbody", { children: [overview.rows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.barcode || '-' }), _jsxs("td", { children: [_jsx("strong", { children: row.name }), _jsx("span", { children: row.internalSku })] }), _jsx("td", { children: row.marketplaceArticle || '-' }), _jsx("td", { children: row.size || '-' }), _jsx("td", { children: dimensions(row) }), _jsx("td", { children: formatNumber(row.volumeLiters) }), _jsx("td", { children: formatNumber(row.quantity) }), _jsx("td", { title: row.boxCodes.join(', '), children: row.boxesCount }), _jsx("td", { title: row.palletCodes.join(', '), children: row.palletsCount }), _jsx("td", { children: formatNumber(row.literDays) }), _jsx("td", { children: formatMoney(row.storageCostRub) })] }, row.skuId))), overview.rows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 11, children: "\u041D\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }) })) : null] })] }) })] })) : null] }));
}
function Metric({ label, value }) {
    return (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function dimensions(row) {
    if (!row.lengthCm || !row.widthCm || !row.heightCm) {
        return '-';
    }
    return `${formatNumber(row.lengthCm)} × ${formatNumber(row.widthCm)} × ${formatNumber(row.heightCm)} см`;
}
function numberValue(value) {
    return value == null ? 0 : Number(value);
}
function formatNumber(value) {
    const numeric = numberValue(value);
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(numeric);
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value);
}
function downloadBlob(blob, fileName) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
}
function safeDownloadName(value) {
    return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
function monthStart() {
    const date = new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
