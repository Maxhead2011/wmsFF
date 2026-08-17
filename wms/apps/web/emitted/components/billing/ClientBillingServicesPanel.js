import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Calculator, PackageCheck, RefreshCw, Save, Search, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClientBillingServices, fetchClientFbsTurnkeyPricing, fetchFbsCalculatorDestinations, updateClientFbsTurnkeyPricing, upsertClientBillingService, } from '../../lib/api';
import { billingUnitLabel } from './billingMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ClientBillingServicesPanel({ clients, session, fixedClientId, section = 'all', embedded = false, }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id, { fixedClientId });
    const [rows, setRows] = useState([]);
    const [query, setQuery] = useState('');
    const [visibility, setVisibility] = useState('all');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [isLoading, setLoading] = useState(false);
    const [isSavingAll, setSavingAll] = useState(false);
    const [fbsTurnkey, setFbsTurnkey] = useState(null);
    const [fbsDestinations, setFbsDestinations] = useState([]);
    const [isSavingFbsTurnkey, setSavingFbsTurnkey] = useState(false);
    const [error, setError] = useState('');
    const [fbsPricingNotice, setFbsPricingNotice] = useState('');
    const selectedClient = clients.find((client) => client.id === clientId) ?? null;
    const requiresDetailedPrimaryRates = isLukinClient(selectedClient);
    const connectedCount = rows.filter((row) => row.isActive).length;
    const dirtyCount = rows.filter((row) => row.dirty).length;
    const primaryServiceRows = rows.filter((row) => {
        const searchable = `${row.service.code} ${row.service.name}`.toLocaleLowerCase('ru-RU');
        return (row.isActive &&
            row.service.unit === 'PIECE' &&
            Number(row.priceRub ?? 0) > 0 &&
            row.service.code !== 'FBS_PROCESSING' &&
            !['перемарк', 'перекле', 'relabel'].some((marker) => searchable.includes(marker)));
    });
    const filteredRows = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        return rows.filter((row) => {
            if (visibility === 'connected' && !row.isActive) {
                return false;
            }
            if (!normalized) {
                return true;
            }
            return [
                row.service.code,
                row.service.name,
                billingUnitLabel(row.service.unit),
                row.commentInput,
            ]
                .join(' ')
                .toLocaleLowerCase('ru-RU')
                .includes(normalized);
        });
    }, [query, rows, visibility]);
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    useEffect(() => {
        if (fixedClientId) {
            changeClient(fixedClientId);
        }
    }, [fixedClientId]);
    async function loadServices(nextClientId = clientId) {
        if (!nextClientId) {
            setRows([]);
            return;
        }
        setLoading(true);
        setError('');
        setFbsPricingNotice('');
        try {
            const [services, turnkeyPricing, destinationOptions] = await Promise.all([
                fetchClientBillingServices(session.accessToken, nextClientId),
                fetchClientFbsTurnkeyPricing(session.accessToken, nextClientId),
                fetchFbsCalculatorDestinations(session.accessToken),
            ]);
            setRows(services.map(editableRow));
            setFbsDestinations(destinationOptions.destinations);
            setFbsTurnkey({
                enabled: turnkeyPricing.enabled,
                unitPriceInput: String(turnkeyPricing.unitPriceRub),
                fixedPlusLogisticsEnabled: turnkeyPricing.fixedPlusLogisticsEnabled,
                fixedPlusLogisticsUnitPriceInput: String(turnkeyPricing.fixedPlusLogisticsUnitPriceRub),
                fixedPlusLogisticsDestination: turnkeyPricing.fixedPlusLogisticsDestination ||
                    destinationOptions.destinations[0] ||
                    'Внуково',
                tieredLogisticsEnabled: turnkeyPricing.tieredLogisticsEnabled,
                logisticsFreeItemsLimitInput: String(turnkeyPricing.logisticsFreeItemsLimit),
                logisticsCubicMeterLitersInput: String(turnkeyPricing.logisticsCubicMeterLiters),
                logisticsCubicMeterPriceInput: String(turnkeyPricing.logisticsCubicMeterPriceRub),
                logisticsPalletPriceInput: String(turnkeyPricing.logisticsPalletPriceRub),
                primaryProcessingEnabled: turnkeyPricing.primaryProcessingEnabled,
                primaryWhiteUnitPriceInput: String(turnkeyPricing.primaryWhiteUnitPriceRub),
                primaryGrayUnitPriceInput: String(turnkeyPricing.primaryGrayUnitPriceRub),
                primaryReturnUnitPriceInput: String(turnkeyPricing.primaryReturnUnitPriceRub),
                primaryServices: turnkeyPricing.primaryServices,
                dirty: false,
            });
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    function changeClient(nextClientId) {
        setClientId(nextClientId);
        setRows([]);
        setFbsTurnkey(null);
        setFbsDestinations([]);
        setQuery('');
        setPage(1);
        setError('');
        setFbsPricingNotice('');
        void loadServices(nextClientId);
    }
    function updateRow(serviceId, patch) {
        setRows((current) => current.map((row) => (row.service.id === serviceId ? { ...row, ...patch, dirty: true } : row)));
    }
    async function saveRow(serviceId) {
        const row = rows.find((candidate) => candidate.service.id === serviceId);
        if (!clientId || !row) {
            return;
        }
        setError('');
        setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? { ...candidate, saving: true } : candidate)));
        try {
            const saved = await saveService(session, clientId, row);
            setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? editableRow(saved) : candidate)));
        }
        catch (caught) {
            setError(errorMessage(caught));
            setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? { ...candidate, saving: false } : candidate)));
        }
    }
    async function saveAll() {
        const changed = rows.filter((row) => row.dirty);
        if (!clientId || changed.length === 0) {
            return;
        }
        setSavingAll(true);
        setError('');
        try {
            const saved = await Promise.all(changed.map((row) => saveService(session, clientId, row)));
            const byServiceId = new Map(saved.map((row) => [row.service.id, editableRow(row)]));
            setRows((current) => current.map((row) => byServiceId.get(row.service.id) ?? row));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingAll(false);
        }
    }
    async function saveFbsTurnkey() {
        if (!clientId || !fbsTurnkey) {
            return;
        }
        const unitPriceRub = Math.max(0, Number(fbsTurnkey.unitPriceInput) || 0);
        const fixedPlusLogisticsUnitPriceRub = Math.max(0, Number(fbsTurnkey.fixedPlusLogisticsUnitPriceInput) || 0);
        const primaryWhiteUnitPriceRub = Math.max(0, Number(fbsTurnkey.primaryWhiteUnitPriceInput) || 0);
        const primaryGrayUnitPriceRub = Math.max(0, Number(fbsTurnkey.primaryGrayUnitPriceInput) || 0);
        const primaryReturnUnitPriceRub = Math.max(0, Number(fbsTurnkey.primaryReturnUnitPriceInput) || 0);
        const logisticsFreeItemsLimit = Math.max(0, Math.trunc(Number(fbsTurnkey.logisticsFreeItemsLimitInput) || 0));
        const logisticsCubicMeterLiters = Math.max(1, Math.trunc(Number(fbsTurnkey.logisticsCubicMeterLitersInput) || 0));
        const logisticsCubicMeterPriceRub = Math.max(0, Number(fbsTurnkey.logisticsCubicMeterPriceInput) || 0);
        const logisticsPalletPriceRub = Math.max(0, Number(fbsTurnkey.logisticsPalletPriceInput) || 0);
        if (fbsTurnkey.enabled && fbsTurnkey.fixedPlusLogisticsEnabled) {
            setError('Выберите только один фиксированный режим расчёта FBS.');
            return;
        }
        if (fbsTurnkey.enabled && fbsTurnkey.tieredLogisticsEnabled) {
            setError('Ступенчатую логистику нельзя включить одновременно с тарифом «FBS под ключ».');
            return;
        }
        if (fbsTurnkey.tieredLogisticsEnabled &&
            (logisticsCubicMeterPriceRub <= 0 || logisticsPalletPriceRub <= 0)) {
            setError('Укажите положительные цены за 1 м³ и за каждую паллету.');
            return;
        }
        if (fbsTurnkey.enabled && unitPriceRub <= 0) {
            setError('Укажите стоимость обработки одной единицы для тарифа «FBS под ключ».');
            return;
        }
        if (fbsTurnkey.fixedPlusLogisticsEnabled &&
            fixedPlusLogisticsUnitPriceRub <= 0) {
            setError('Укажите фиксированную стоимость обработки одной единицы для тарифа «Фикс + логистика».');
            return;
        }
        if (fbsTurnkey.primaryProcessingEnabled &&
            requiresDetailedPrimaryRates &&
            (primaryWhiteUnitPriceRub <= 0 ||
                primaryGrayUnitPriceRub <= 0 ||
                primaryReturnUnitPriceRub <= 0)) {
            setError('Для первичной обработки укажите три положительные цены: «в белую», «в серую» и «возврат».');
            return;
        }
        if (fbsTurnkey.primaryProcessingEnabled &&
            !requiresDetailedPrimaryRates &&
            (primaryWhiteUnitPriceRub <= 0 ||
                primaryGrayUnitPriceRub <= 0 ||
                primaryReturnUnitPriceRub <= 0) &&
            !window.confirm('У клиента заполнены не все раздельные цены первичной обработки. Сохранить настройки без обязательных тарифов «в белую», «в серую» и «возврат»?')) {
            return;
        }
        const fixedPlusLogisticsDestination = fbsTurnkey.fixedPlusLogisticsDestination.trim();
        if (fbsTurnkey.fixedPlusLogisticsEnabled &&
            !fixedPlusLogisticsDestination) {
            setError('Выберите город доставки для тарифа «Фикс + логистика».');
            return;
        }
        setSavingFbsTurnkey(true);
        setError('');
        setFbsPricingNotice('');
        try {
            const saved = await updateClientFbsTurnkeyPricing(session.accessToken, clientId, {
                enabled: fbsTurnkey.enabled,
                unitPriceRub,
                fixedPlusLogisticsEnabled: fbsTurnkey.fixedPlusLogisticsEnabled,
                fixedPlusLogisticsUnitPriceRub,
                fixedPlusLogisticsDestination,
                tieredLogisticsEnabled: fbsTurnkey.tieredLogisticsEnabled,
                logisticsFreeItemsLimit,
                logisticsCubicMeterLiters,
                logisticsCubicMeterPriceRub,
                logisticsPalletPriceRub,
                primaryProcessingEnabled: fbsTurnkey.primaryProcessingEnabled,
                primaryWhiteUnitPriceRub,
                primaryGrayUnitPriceRub,
                primaryReturnUnitPriceRub,
                primaryServices: fbsTurnkey.primaryServices,
            });
            setFbsTurnkey({
                enabled: saved.enabled,
                unitPriceInput: String(saved.unitPriceRub),
                fixedPlusLogisticsEnabled: saved.fixedPlusLogisticsEnabled,
                fixedPlusLogisticsUnitPriceInput: String(saved.fixedPlusLogisticsUnitPriceRub),
                fixedPlusLogisticsDestination: saved.fixedPlusLogisticsDestination,
                tieredLogisticsEnabled: saved.tieredLogisticsEnabled,
                logisticsFreeItemsLimitInput: String(saved.logisticsFreeItemsLimit),
                logisticsCubicMeterLitersInput: String(saved.logisticsCubicMeterLiters),
                logisticsCubicMeterPriceInput: String(saved.logisticsCubicMeterPriceRub),
                logisticsPalletPriceInput: String(saved.logisticsPalletPriceRub),
                primaryProcessingEnabled: saved.primaryProcessingEnabled,
                primaryWhiteUnitPriceInput: String(saved.primaryWhiteUnitPriceRub),
                primaryGrayUnitPriceInput: String(saved.primaryGrayUnitPriceRub),
                primaryReturnUnitPriceInput: String(saved.primaryReturnUnitPriceRub),
                primaryServices: saved.primaryServices,
                dirty: false,
            });
            const recalculation = saved.recalculation;
            setFbsPricingNotice(recalculation
                ? `Режим сохранён. Пересчитано черновых начислений: ${recalculation.recalculatedCharges}, черновых счетов: ${recalculation.recalculatedInvoices}.`
                : 'Режим сохранён. Черновые начисления FBS пересчитаны.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingFbsTurnkey(false);
        }
    }
    return (_jsxs("section", { className: `client-services-panel${embedded ? ' client-services-panel--embedded' : ''}`, "aria-label": "\u0423\u0441\u043B\u0443\u0433\u0438 \u0438 \u0446\u0435\u043D\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("header", { className: "client-services-panel__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("h3", { children: section === 'fbo' ? 'Услуги FBO' : section === 'fbs' ? 'Режимы FBS' : 'Услуги и цены' }), _jsx("p", { children: section === 'fbo'
                                    ? 'Стандартные и дополнительные услуги FBO с индивидуальной ценой клиента.'
                                    : section === 'fbs'
                                        ? 'Фиксированные режимы FBS и первичная обработка клиента.'
                                        : 'Индивидуальные тарифы выбранного клиента.' })] }), _jsx("button", { className: "icon-button", disabled: !clientId || isLoading, type: "button", onClick: () => void loadServices(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: _jsx(RefreshCw, { size: 17, "aria-hidden": "true" }) })] }), section !== 'fbs' ? _jsxs("div", { className: "client-services-toolbar", children: [!fixedClientId ? (_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] })) : null, _jsxs("label", { className: "client-services-toolbar__search-field", children: [_jsx("span", { children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0443\u0441\u043B\u0443\u0433" }), _jsxs("div", { className: "client-services-search", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { "aria-label": "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0443\u0441\u043B\u0443\u0433", type: "search", value: query, onChange: (event) => {
                                            setQuery(event.target.value);
                                            setPage(1);
                                        }, placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435, \u043A\u043E\u0434, \u0435\u0434\u0438\u043D\u0438\u0446\u0430 \u0438\u043B\u0438 \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), query ? (_jsx("button", { type: "button", title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0431\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0443\u0441\u043B\u0443\u0433", onClick: () => {
                                            setQuery('');
                                            setPage(1);
                                        }, children: _jsx(X, { size: 15, "aria-hidden": "true" }) })) : null] }), _jsxs("small", { children: ["\u041D\u0430\u0439\u0434\u0435\u043D\u043E: ", filteredRows.length] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C" }), _jsxs("select", { value: visibility, onChange: (event) => {
                                    setVisibility(event.target.value);
                                    setPage(1);
                                }, children: [_jsx("option", { value: "all", children: "\u0412\u0441\u0435 \u0443\u0441\u043B\u0443\u0433\u0438" }), _jsx("option", { value: "connected", children: "\u0422\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u044B\u0435" })] })] }), _jsxs("div", { className: "client-services-toolbar__summary", children: [_jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }), _jsx("strong", { children: connectedCount })] })] }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, fbsPricingNotice ? _jsx("p", { className: "form-success", children: fbsPricingNotice }) : null, !clientId ? _jsx("p", { className: "panel-message", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0435\u0433\u043E \u0443\u0441\u043B\u0443\u0433\u0438." }) : null, clientId ? (_jsxs(_Fragment, { children: [section !== 'fbo' ? _jsxs("section", { className: "fbs-pricing-modes", children: [_jsxs("div", { className: `fbs-pricing-default${!fbsTurnkey?.enabled && !fbsTurnkey?.fixedPlusLogisticsEnabled ? ' is-active' : ''}`, children: [_jsx(Calculator, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041A\u0430\u043B\u044C\u043A\u0443\u043B\u044F\u0442\u043E\u0440 FBS" }), _jsx("span", { children: "\u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438, \u043A\u043E\u0433\u0434\u0430 \u043E\u0431\u0430 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0440\u0435\u0436\u0438\u043C\u0430 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B." })] }), _jsx("em", { children: !fbsTurnkey?.enabled && !fbsTurnkey?.fixedPlusLogisticsEnabled ? 'Активен' : 'Не выбран' })] }), _jsxs("section", { className: `fbs-turnkey-card${fbsTurnkey?.enabled ? ' is-enabled' : ''}`, children: [_jsx("div", { className: "fbs-turnkey-card__icon", "aria-hidden": "true", children: _jsx(PackageCheck, { size: 22 }) }), _jsxs("div", { className: "fbs-turnkey-card__copy", children: [_jsx("strong", { children: "FBS \u043F\u043E\u0434 \u043A\u043B\u044E\u0447" }), _jsx("span", { children: "\u0418\u0442\u043E\u0433: \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u0435\u0434\u0438\u043D\u0438\u0446 \u00D7 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u0430\u044F \u0446\u0435\u043D\u0430. \u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0438 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F." })] }), _jsxs("label", { className: "fbs-turnkey-card__toggle", children: [_jsx("input", { checked: fbsTurnkey?.enabled ?? false, disabled: !fbsTurnkey || isLoading, type: "checkbox", onChange: (event) => setFbsTurnkey((current) => current
                                                    ? {
                                                        ...current,
                                                        enabled: event.target.checked,
                                                        fixedPlusLogisticsEnabled: event.target.checked
                                                            ? false
                                                            : current.fixedPlusLogisticsEnabled,
                                                        tieredLogisticsEnabled: event.target.checked
                                                            ? false
                                                            : current.tieredLogisticsEnabled,
                                                        dirty: true,
                                                    }
                                                    : current) }), _jsx("span", { children: fbsTurnkey?.enabled ? 'Включено' : 'Выключено' })] }), _jsxs("label", { className: "fbs-turnkey-card__price", children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430 \u0437\u0430 1 \u0435\u0434\u0438\u043D\u0438\u0446\u0443, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: fbsTurnkey?.unitPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (event) => setFbsTurnkey((current) => current
                                                    ? { ...current, unitPriceInput: event.target.value, dirty: true }
                                                    : current) }), _jsx("small", { children: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: 100 \u0435\u0434. \u00D7 50 \u20BD = 5 000 \u20BD" })] })] }), _jsxs("section", { className: `fbs-turnkey-card fbs-turnkey-card--logistics${fbsTurnkey?.fixedPlusLogisticsEnabled ? ' is-enabled' : ''}`, children: [_jsx("div", { className: "fbs-turnkey-card__icon", "aria-hidden": "true", children: _jsx(Truck, { size: 22 }) }), _jsxs("div", { className: "fbs-turnkey-card__copy", children: [_jsx("strong", { children: "\u0424\u0438\u043A\u0441 + \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430" }), _jsx("span", { children: "\u0418\u0442\u043E\u0433: \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u00D7 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u0430\u044F \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 + \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u043D\u0430\u044F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0433\u043E\u0440\u043E\u0434 \u0441 \u043D\u0430\u043B\u043E\u0433\u043E\u043C." })] }), _jsxs("label", { className: "fbs-turnkey-card__toggle", children: [_jsx("input", { checked: fbsTurnkey?.fixedPlusLogisticsEnabled ?? false, disabled: !fbsTurnkey || isLoading, type: "checkbox", onChange: (event) => setFbsTurnkey((current) => current
                                                    ? {
                                                        ...current,
                                                        fixedPlusLogisticsEnabled: event.target.checked,
                                                        enabled: event.target.checked ? false : current.enabled,
                                                        dirty: true,
                                                    }
                                                    : current) }), _jsx("span", { children: fbsTurnkey?.fixedPlusLogisticsEnabled ? 'Включено' : 'Выключено' })] }), _jsxs("div", { className: "fbs-turnkey-card__settings", children: [_jsxs("label", { className: "fbs-turnkey-card__price", children: [_jsx("span", { children: "\u0424\u0438\u043A\u0441 \u0437\u0430 1 \u0435\u0434\u0438\u043D\u0438\u0446\u0443, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: fbsTurnkey?.fixedPlusLogisticsUnitPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (event) => setFbsTurnkey((current) => current
                                                            ? {
                                                                ...current,
                                                                fixedPlusLogisticsUnitPriceInput: event.target.value,
                                                                dirty: true,
                                                            }
                                                            : current) }), _jsx("small", { children: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: 100 \u0435\u0434. \u00D7 50 \u20BD + \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430" })] }), _jsxs("label", { className: "fbs-turnkey-card__destination", children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438" }), _jsx("input", { list: "fbs-fixed-logistics-destinations", placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0433\u043E\u0440\u043E\u0434", value: fbsTurnkey?.fixedPlusLogisticsDestination ?? '', disabled: !fbsTurnkey || isLoading, onChange: (event) => setFbsTurnkey((current) => current
                                                            ? {
                                                                ...current,
                                                                fixedPlusLogisticsDestination: event.target.value,
                                                                dirty: true,
                                                            }
                                                            : current) }), _jsx("datalist", { id: "fbs-fixed-logistics-destinations", children: fbsDestinations.map((destination) => (_jsx("option", { value: destination }, destination))) }), _jsx("small", { children: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444 WMS \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0433\u043E\u0440\u043E\u0434\u0430." })] })] })] }), _jsxs("section", { className: `fbs-turnkey-card fbs-turnkey-card--logistics${fbsTurnkey?.tieredLogisticsEnabled ? ' is-enabled' : ''}`, children: [_jsx("div", { className: "fbs-turnkey-card__icon", "aria-hidden": "true", children: _jsx(Truck, { size: 22 }) }), _jsxs("div", { className: "fbs-turnkey-card__copy", children: [_jsx("strong", { children: "\u0421\u0442\u0443\u043F\u0435\u043D\u0447\u0430\u0442\u0430\u044F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 FBS" }), _jsx("span", { children: "\u0414\u043E \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u0430. \u0417\u0430\u0442\u0435\u043C WMS \u0441\u0447\u0438\u0442\u0430\u0435\u0442 \u043E\u0431\u0449\u0438\u0439 \u043E\u0431\u044A\u0451\u043C \u043E\u0442\u043F\u0440\u0430\u0432\u043E\u043A \u0437\u0430 \u0434\u0435\u043D\u044C: \u0434\u043E 1 \u043C\u00B3 \u2014 \u0446\u0435\u043D\u0430 \u0437\u0430 \u043A\u0443\u0431, \u0441\u0432\u044B\u0448\u0435 \u2014 \u0446\u0435\u043D\u0430 \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u043F\u0430\u043B\u043B\u0435\u0442\u0443." })] }), _jsxs("label", { className: "fbs-turnkey-card__toggle", children: [_jsx("input", { checked: fbsTurnkey?.tieredLogisticsEnabled ?? false, disabled: !fbsTurnkey || isLoading, type: "checkbox", onChange: (event) => setFbsTurnkey((current) => current
                                                    ? {
                                                        ...current,
                                                        tieredLogisticsEnabled: event.target.checked,
                                                        enabled: event.target.checked ? false : current.enabled,
                                                        dirty: true,
                                                    }
                                                    : current) }), _jsx("span", { children: fbsTurnkey?.tieredLogisticsEnabled ? 'Включено' : 'Выключено' })] }), _jsxs("div", { className: "fbs-turnkey-card__settings", children: [_jsx(PrimaryProcessingPriceField, { label: "\u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E \u0434\u043E, \u0448\u0442.", value: fbsTurnkey?.logisticsFreeItemsLimitInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, logisticsFreeItemsLimitInput: value, dirty: true }
                                                    : current) }), _jsx(PrimaryProcessingPriceField, { label: "\u041E\u0431\u044A\u0451\u043C \u043E\u0434\u043D\u043E\u0433\u043E \u043A\u0443\u0431\u0430, \u043B", value: fbsTurnkey?.logisticsCubicMeterLitersInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, logisticsCubicMeterLitersInput: value, dirty: true }
                                                    : current) }), _jsx(PrimaryProcessingPriceField, { label: "\u0426\u0435\u043D\u0430 \u0434\u043E 1 \u043C\u00B3, \u20BD", value: fbsTurnkey?.logisticsCubicMeterPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, logisticsCubicMeterPriceInput: value, dirty: true }
                                                    : current) }), _jsx(PrimaryProcessingPriceField, { label: "\u0426\u0435\u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u0439 \u043F\u0430\u043B\u043B\u0435\u0442\u044B, \u20BD", value: fbsTurnkey?.logisticsPalletPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, logisticsPalletPriceInput: value, dirty: true }
                                                    : current) })] }), _jsx("small", { className: "fbs-turnkey-card__hint", children: "\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: \u0434\u043E 20 \u0448\u0442. \u2014 0 \u20BD; \u0434\u043E 1 \u043C\u00B3 \u2014 1 500 \u20BD; \u0431\u043E\u043B\u044C\u0448\u0435 1 \u043C\u00B3 \u2014 2 500 \u20BD \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u043F\u0430\u043B\u043B\u0435\u0442\u0443. \u041E\u0431\u044A\u0451\u043C \u0431\u0435\u0440\u0451\u0442\u0441\u044F \u0438\u0437 \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] }), _jsxs("section", { className: `fbs-turnkey-card fbs-turnkey-card--primary${fbsTurnkey?.primaryProcessingEnabled ? ' is-enabled' : ''}`, children: [_jsx("div", { className: "fbs-turnkey-card__icon", "aria-hidden": "true", children: _jsx(PackageCheck, { size: 22 }) }), _jsxs("div", { className: "fbs-turnkey-card__copy", children: [_jsx("strong", { children: "\u0421\u0447\u0438\u0442\u0430\u0442\u044C \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u0443\u044E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 \u0437\u0430\u043A\u0430\u0437\u0430" }), _jsx("span", { children: "\u0412\u0438\u0434 \u043F\u0440\u0438\u0445\u043E\u0434\u0430 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u0435\u0442\u0441\u044F \u043F\u043E \u043F\u0440\u0435\u0444\u0438\u043A\u0441\u0443 \u043A\u043E\u0440\u043E\u0431\u0430 \u0438\u0437 \u043E\u0431\u0449\u0438\u0445 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A WMS: \u00AB\u0431\u0435\u043B\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434\u00BB \u0438\u043B\u0438 \u00AB\u0441\u0435\u0440\u044B\u0439 \u043F\u0440\u0438\u0445\u043E\u0434\u00BB. \u0412\u043E\u0437\u0432\u0440\u0430\u0442\u044B \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u044E\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E. \u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u043D\u0430\u0447\u0438\u0441\u043B\u044F\u0435\u0442\u0441\u044F \u043F\u043E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u043C \u0437\u0430\u0434\u0430\u043D\u0438\u044F\u043C FBS." })] }), _jsxs("label", { className: "fbs-turnkey-card__toggle", children: [_jsx("input", { checked: fbsTurnkey?.primaryProcessingEnabled ?? false, disabled: !fbsTurnkey || isLoading, type: "checkbox", onChange: (event) => setFbsTurnkey((current) => current
                                                    ? {
                                                        ...current,
                                                        primaryProcessingEnabled: event.target.checked,
                                                        dirty: true,
                                                    }
                                                    : current) }), _jsx("span", { children: fbsTurnkey?.primaryProcessingEnabled ? 'Включено' : 'Выключено' })] }), _jsxs("div", { className: "fbs-turnkey-card__settings", children: [_jsx(PrimaryProcessingPriceField, { label: "\u0412 \u0431\u0435\u043B\u0443\u044E, \u20BD/\u0448\u0442.", value: fbsTurnkey?.primaryWhiteUnitPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, primaryWhiteUnitPriceInput: value, dirty: true }
                                                    : current) }), _jsx(PrimaryProcessingPriceField, { label: "\u0412 \u0441\u0435\u0440\u0443\u044E, \u20BD/\u0448\u0442.", value: fbsTurnkey?.primaryGrayUnitPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, primaryGrayUnitPriceInput: value, dirty: true }
                                                    : current) }), _jsx(PrimaryProcessingPriceField, { label: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442, \u20BD/\u0448\u0442.", value: fbsTurnkey?.primaryReturnUnitPriceInput ?? '', disabled: !fbsTurnkey || isLoading, onChange: (value) => setFbsTurnkey((current) => current
                                                    ? { ...current, primaryReturnUnitPriceInput: value, dirty: true }
                                                    : current) })] }), _jsxs("div", { className: "fbs-pricing__service-picker", children: [_jsx("span", { children: "\u0427\u0442\u043E \u0432\u0445\u043E\u0434\u0438\u0442 \u0432 \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u0443\u044E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443. \u0414\u043B\u044F \u0440\u0430\u0437\u043D\u044B\u0445 \u043E\u0442\u0440\u0435\u0437\u043E\u0432 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0440\u0438\u0437\u043D\u0430\u043A\u0438 \u0438\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F, \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0430 \u0438\u043B\u0438 \u0440\u0430\u0437\u043C\u0435\u0440\u0430 \u0442\u043E\u0432\u0430\u0440\u0430 \u0447\u0435\u0440\u0435\u0437 \u0442\u043E\u0447\u043A\u0443 \u0441 \u0437\u0430\u043F\u044F\u0442\u043E\u0439; \u043F\u0443\u0441\u0442\u043E\u0435 \u043F\u043E\u043B\u0435 \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u00AB\u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432\u00BB." }), _jsxs("div", { children: [primaryServiceRows.map((row) => {
                                                        const selected = fbsTurnkey?.primaryServices.find((selection) => selection.serviceId === row.service.id);
                                                        return (_jsxs("label", { className: selected ? 'is-selected' : undefined, children: [_jsx("input", { checked: Boolean(selected), type: "checkbox", onChange: (event) => setFbsTurnkey((current) => current
                                                                        ? {
                                                                            ...current,
                                                                            primaryServices: event.target.checked
                                                                                ? [...current.primaryServices, {
                                                                                        serviceId: row.service.id,
                                                                                        quantityMultiplier: 1,
                                                                                        matchKeywords: '',
                                                                                    }]
                                                                                : current.primaryServices.filter((item) => item.serviceId !== row.service.id),
                                                                            dirty: true,
                                                                        }
                                                                        : current) }), _jsxs("span", { children: [_jsx("strong", { children: row.service.name }), _jsxs("small", { children: [row.service.code, " \u00B7 ", Number(row.priceRub ?? 0).toLocaleString('ru-RU'), " \u20BD \u0437\u0430 \u043E\u0442\u0440\u0435\u0437/\u0448\u0442."] }), selected ? (_jsx("input", { className: "fbs-pricing__match", placeholder: "\u041A\u0430\u043A \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0442\u044C: 3 \u043C; \u043E\u0442\u0440\u0435\u0437 3\u043C", type: "text", value: selected.matchKeywords, onChange: (event) => setFbsTurnkey((current) => current
                                                                                ? {
                                                                                    ...current,
                                                                                    primaryServices: current.primaryServices.map((item) => item.serviceId === row.service.id
                                                                                        ? { ...item, matchKeywords: event.target.value }
                                                                                        : item),
                                                                                    dirty: true,
                                                                                }
                                                                                : current) })) : null] }), selected ? (_jsx("input", { "aria-label": `Количество услуги ${row.service.name} на одну единицу товара`, min: "0.001", step: "0.001", type: "number", value: selected.quantityMultiplier, onChange: (event) => setFbsTurnkey((current) => current
                                                                        ? {
                                                                            ...current,
                                                                            primaryServices: current.primaryServices.map((item) => item.serviceId === row.service.id
                                                                                ? { ...item, quantityMultiplier: Math.max(0.001, Number(event.target.value) || 1) }
                                                                                : item),
                                                                            dirty: true,
                                                                        }
                                                                        : current) })) : null] }, row.service.id));
                                                    }), primaryServiceRows.length === 0 ? (_jsx("p", { children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u0443\u0441\u043B\u0443\u0433\u0443 \u0438 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 \u0446\u0435\u043D\u0443 \u0437\u0430 \u043E\u0434\u0438\u043D \u043E\u0442\u0440\u0435\u0437/\u0448\u0442\u0443\u043A\u0443." })) : null] })] }), _jsxs("small", { className: "fbs-turnkey-card__hint", children: [requiresDetailedPrimaryRates
                                                ? 'Для ИП Лукина обязательны три раздельные положительные цены: «в белую», «в серую» и «возврат». '
                                                : 'Для этого клиента три раздельные цены необязательны; если они не заполнены, WMS попросит подтверждение при сохранении. ', "\u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430: \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0431\u0435\u0440\u0451\u0442\u0441\u044F \u0438\u0437 \u043E\u0431\u0449\u0438\u0445 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432, \u0446\u0435\u043D\u0430 \u2014 \u0438\u0437 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u043E\u0439 \u0443\u0441\u043B\u0443\u0433\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u00AB\u041F\u0435\u0440\u0435\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043A\u0430\u00BB."] })] }), _jsxs("div", { className: "fbs-pricing-modes__footer", children: [_jsx("span", { children: "\u0420\u0435\u0436\u0438\u043C\u044B \u00AB\u041F\u043E\u0434 \u043A\u043B\u044E\u0447\u00BB \u0438 \u00AB\u0424\u0438\u043A\u0441 + \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430\u00BB \u0432\u0437\u0430\u0438\u043C\u043E\u0438\u0441\u043A\u043B\u044E\u0447\u0430\u044E\u0449\u0438\u0435." }), _jsxs("button", { className: "primary-button", disabled: !fbsTurnkey?.dirty || isSavingFbsTurnkey, type: "button", onClick: () => void saveFbsTurnkey(), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingFbsTurnkey ? 'Сохраняю' : 'Сохранить режим расчёта' })] })] })] }) : null, section !== 'fbs' ? _jsxs(_Fragment, { children: [_jsx("div", { className: "billing-table-wrap", children: _jsxs("table", { className: "billing-table client-services-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430" }), _jsx("th", { children: "\u0423\u0441\u043B\u0443\u0433\u0430" }), _jsx("th", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430" }), _jsx("th", { children: "\u0426\u0435\u043D\u0430, \u20BD" }), _jsx("th", { children: "\u041D\u0430\u043B\u043E\u0433" }), _jsx("th", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("th", { "aria-label": "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" })] }) }), _jsxs("tbody", { children: [visibleRows.map((row) => (_jsxs("tr", { className: row.isActive ? 'is-connected' : undefined, children: [_jsx("td", { children: _jsxs("label", { className: "client-service-toggle", children: [_jsx("input", { checked: row.isActive, type: "checkbox", onChange: (event) => updateRow(row.service.id, { isActive: event.target.checked }) }), _jsx("span", { children: row.isActive ? 'Да' : 'Нет' })] }) }), _jsxs("td", { children: [_jsx("strong", { children: row.service.name }), _jsx("small", { children: row.service.code })] }), _jsx("td", { children: billingUnitLabel(row.service.unit) }), _jsxs("td", { children: [_jsx("input", { min: "0", step: "0.01", type: "number", value: row.priceInput, onChange: (event) => updateRow(row.service.id, { priceInput: event.target.value }) }), row.taxMode === 'ADD_6_PERCENT' ? _jsxs("small", { children: ["\u0418\u0442\u043E\u0433\u043E: ", formatMoney(withTax(row.priceInput)), " \u20BD"] }) : null] }), _jsx("td", { children: _jsxs("select", { value: row.taxMode, onChange: (event) => updateRow(row.service.id, { taxMode: event.target.value }), children: [_jsx("option", { value: "INCLUDED", children: "\u0426\u0435\u043D\u0430 \u0443\u0436\u0435 \u0441 \u043D\u0430\u043B\u043E\u0433\u043E\u043C" }), _jsx("option", { value: "ADD_6_PERCENT", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C 6%" })] }) }), _jsx("td", { children: _jsx("input", { value: row.commentInput, onChange: (event) => updateRow(row.service.id, { commentInput: event.target.value }), placeholder: "\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E" }) }), _jsx("td", { children: _jsx("button", { className: "icon-button", disabled: !row.dirty || row.saving, type: "button", onClick: () => void saveRow(row.service.id), title: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443", "aria-label": `Сохранить ${row.service.name}`, children: _jsx(Save, { size: 16, "aria-hidden": "true" }) }) })] }, row.service.id))), filteredRows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: isLoading ? 'Загружаю услуги...' : 'Услуги не найдены.' }) })) : null] })] }) }), _jsxs("footer", { className: "client-services-panel__footer", children: [_jsxs("span", { children: [selectedClient?.name, " \u00B7 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A: ", dirtyCount] }), _jsxs("div", { className: "client-services-pagination", children: [_jsx("button", { className: "secondary-button", disabled: currentPage <= 1, type: "button", onClick: () => setPage(currentPage - 1), children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("span", { children: ["\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ", currentPage, " \u0438\u0437 ", pageCount, " \u00B7 \u0443\u0441\u043B\u0443\u0433: ", filteredRows.length] }), _jsx("button", { className: "secondary-button", disabled: currentPage >= pageCount, type: "button", onClick: () => setPage(currentPage + 1), children: "\u0414\u0430\u043B\u0435\u0435" }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435" }), _jsxs("select", { value: pageSize, onChange: (event) => {
                                                            setPageSize(Number(event.target.value));
                                                            setPage(1);
                                                        }, children: [_jsx("option", { value: 20, children: "20" }), _jsx("option", { value: 50, children: "50" }), _jsx("option", { value: 100, children: "100" })] })] })] }), _jsxs("button", { className: "primary-button", disabled: dirtyCount === 0 || isSavingAll, type: "button", onClick: () => void saveAll(), children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingAll ? 'Сохраняю' : 'Сохранить изменения' })] })] })] }) : null] })) : null] }));
}
function isLukinClient(client) {
    if (!client)
        return false;
    return `${client.code} ${client.name}`
        .toLocaleLowerCase('ru-RU')
        .replaceAll('ё', 'е')
        .includes('лукин');
}
function PrimaryProcessingPriceField({ label, value, disabled, onChange, }) {
    return (_jsxs("label", { className: "fbs-turnkey-card__price", children: [_jsx("span", { children: label }), _jsx("input", { min: "0", step: "0.01", type: "number", value: value, disabled: disabled, onChange: (event) => onChange(event.target.value) })] }));
}
function editableRow(row) {
    return {
        ...row,
        priceInput: String(row.priceRub ?? row.service.defaultPriceRub ?? 0),
        commentInput: row.comment ?? '',
        dirty: false,
        saving: false,
    };
}
function saveService(session, clientId, row) {
    return upsertClientBillingService(session.accessToken, clientId, {
        serviceId: row.service.id,
        priceRub: Math.max(0, Number(row.priceInput) || 0),
        taxMode: row.taxMode,
        isActive: row.isActive,
        comment: row.commentInput.trim() || undefined,
    });
}
function withTax(value) {
    return ((Number(value) || 0) / 94) * 100;
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось сохранить услуги клиента.';
}
