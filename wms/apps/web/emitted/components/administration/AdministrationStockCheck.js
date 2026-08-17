import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LoaderCircle, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { compareAdministrationWbStockFile, compareAdministrationWbStockApi, fetchBranches, fetchClients, fetchFbsWarehouseRoutes, fetchMarketplaceConnections, reconcileFbsStockItem, } from '../../lib/api';
const ALL_WB_WAREHOUSES = 'ALL';
export function AdministrationStockCheck({ session }) {
    const [clients, setClients] = useState([]);
    const [branches, setBranches] = useState([]);
    const [connections, setConnections] = useState([]);
    const [warehouseTargets, setWarehouseTargets] = useState([]);
    const [loadingWarehouses, setLoadingWarehouses] = useState(false);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [warehouseId, setWarehouseId] = useState(session.user.activeWarehouseId ?? '');
    const [warehouseScope, setWarehouseScope] = useState('ALL');
    const [warehouseTargetKey, setWarehouseTargetKey] = useState('');
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [search, setSearch] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [hideZeroWb, setHideZeroWb] = useState(true);
    const [loading, setLoading] = useState(false);
    const [loadingSource, setLoadingSource] = useState(null);
    const [fixingSkuId, setFixingSkuId] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        void Promise.all([fetchClients(session.accessToken), fetchBranches(session.accessToken)])
            .then(([nextClients, nextBranches]) => {
            setClients(nextClients);
            setBranches(nextBranches.filter((branch) => branch.isActive));
            setClientId((current) => current || nextClients[0]?.id || '');
            setWarehouseId((current) => current || nextBranches.find((branch) => branch.code === 'MSK')?.id || nextBranches[0]?.id || '');
        })
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось загрузить клиентов и филиалы.'));
    }, [session.accessToken]);
    useEffect(() => {
        if (!clientId) {
            setConnections([]);
            setWarehouseTargets([]);
            setWarehouseTargetKey('');
            return;
        }
        void fetchMarketplaceConnections(session.accessToken, { clientId })
            .then((items) => {
            const next = items.filter((item) => item.marketplace === 'WILDBERRIES' && item.isActive);
            setConnections(next);
        })
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось загрузить кабинеты WB.'));
    }, [clientId, session.accessToken]);
    useEffect(() => {
        let cancelled = false;
        if (!connections.length) {
            setWarehouseTargets([]);
            setWarehouseTargetKey('');
            setLoadingWarehouses(false);
            return () => { cancelled = true; };
        }
        setLoadingWarehouses(true);
        void Promise.all(connections.map(async (connection) => {
            try {
                const routes = await fetchFbsWarehouseRoutes(session.accessToken, connection.id);
                return routes.warehouses
                    .filter((item) => item.mode !== 'EXCLUDED')
                    .map((item) => ({
                    key: `${connection.id}::${item.marketplaceWarehouseId}`,
                    connectionId: connection.id,
                    marketplaceWarehouseId: item.marketplaceWarehouseId,
                    marketplaceWarehouseName: item.marketplaceWarehouseName,
                    accountName: connection.accountName || 'Wildberries',
                    effectiveExecutionWarehouseId: item.effectiveExecutionWarehouseId
                        ?? (item.marketplaceWarehouseId === connection.fbsWarehouseId ? connection.fbsExecutionWarehouseId : null),
                    legacyMoscowFallback: item.marketplaceWarehouseId === connection.fbsWarehouseId
                        && !item.effectiveExecutionWarehouseId
                        && !connection.fbsExecutionWarehouseId,
                }));
            }
            catch {
                return connection.fbsWarehouseId ? [{
                        key: `${connection.id}::${connection.fbsWarehouseId}`,
                        connectionId: connection.id,
                        marketplaceWarehouseId: connection.fbsWarehouseId,
                        marketplaceWarehouseName: connection.fbsWarehouseName || `Склад WB ${connection.fbsWarehouseId}`,
                        accountName: connection.accountName || 'Wildberries',
                        effectiveExecutionWarehouseId: connection.fbsExecutionWarehouseId,
                        legacyMoscowFallback: !connection.fbsExecutionWarehouseId,
                    }] : [];
            }
        })).then((groups) => {
            if (cancelled)
                return;
            const unique = new Map();
            groups.flat().forEach((item) => unique.set(item.key, item));
            setWarehouseTargets([...unique.values()].sort((left, right) => left.marketplaceWarehouseName.localeCompare(right.marketplaceWarehouseName, 'ru-RU')));
        }).finally(() => {
            if (!cancelled)
                setLoadingWarehouses(false);
        });
        return () => { cancelled = true; };
    }, [connections, session.accessToken]);
    const eligibleWarehouseTargets = useMemo(() => {
        const branch = branches.find((item) => item.id === warehouseId);
        if (!branch)
            return [];
        const isMoscow = branch.code === 'MSK' || /москв/iu.test(`${branch.city} ${branch.name}`);
        return warehouseTargets.filter((target) => target.effectiveExecutionWarehouseId
            ? target.effectiveExecutionWarehouseId === branch.id
            : target.legacyMoscowFallback && isMoscow);
    }, [branches, warehouseId, warehouseTargets]);
    useEffect(() => {
        setWarehouseTargetKey((current) => eligibleWarehouseTargets.some((item) => item.key === current)
            ? current
            : eligibleWarehouseTargets[0]?.key || '');
    }, [eligibleWarehouseTargets]);
    const selectedWarehouseTarget = eligibleWarehouseTargets.find((item) => item.key === warehouseTargetKey) ?? null;
    const selectedConnectionId = warehouseScope === 'ALL' ? ALL_WB_WAREHOUSES : selectedWarehouseTarget?.connectionId || '';
    const selectedMarketplaceWarehouseId = warehouseScope === 'ONE'
        ? selectedWarehouseTarget?.marketplaceWarehouseId
        : undefined;
    useEffect(() => {
        setResult(null);
        setError('');
    }, [clientId, warehouseId, warehouseScope, warehouseTargetKey]);
    const visibleRows = useMemo(() => {
        const normalized = search.trim().toLocaleLowerCase('ru-RU');
        return (result?.rows ?? []).filter((row) => {
            if (!showAll && row.status === 'MATCH')
                return false;
            if (hideZeroWb && row.quantity === 0 && row.status !== 'WB_EXCESS')
                return false;
            if (!normalized)
                return true;
            return [row.barcode, row.sellerArticle, row.name, row.size, row.sku?.internalSku, row.sku?.name]
                .some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized));
        });
    }, [result, search, showAll, hideZeroWb]);
    async function compare() {
        if (!clientId || !warehouseId || !selectedConnectionId || !file) {
            setError('Выберите клиента, филиал WMS, склады Wildberries и файл XLSX.');
            return;
        }
        setLoading(true);
        setLoadingSource('FILE');
        setError('');
        try {
            setResult(await compareAdministrationWbStockFile(session.accessToken, {
                clientId,
                warehouseId,
                connectionId: selectedConnectionId,
                marketplaceWarehouseId: selectedMarketplaceWarehouseId,
                file,
            }));
            setShowAll(false);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Проверка остатков завершилась ошибкой.');
        }
        finally {
            setLoading(false);
            setLoadingSource(null);
        }
    }
    async function compareFromWb() {
        if (!clientId || !warehouseId || !selectedConnectionId) {
            setError('Выберите клиента, филиал WMS и склады Wildberries.');
            return;
        }
        setLoading(true);
        setLoadingSource('API');
        setError('');
        try {
            setResult(await compareAdministrationWbStockApi(session.accessToken, {
                clientId,
                warehouseId,
                connectionId: selectedConnectionId,
                marketplaceWarehouseId: selectedMarketplaceWarehouseId,
            }));
            setShowAll(false);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Не удалось получить остатки из Wildberries.');
        }
        finally {
            setLoading(false);
            setLoadingSource(null);
        }
    }
    async function fixRow(row) {
        if (!result || !row.sku || row.status !== 'WB_EXCESS')
            return;
        if (!result.fixContext.connectionId || !result.fixContext.warehouseId) {
            setError('Для исправления выберите один конкретный склад WB. Режим «Все склады WB» предназначен для общей сверки.');
            return;
        }
        setFixingSkuId(row.sku.id);
        setError('');
        try {
            await reconcileFbsStockItem(session.accessToken, {
                clientId: result.client.id,
                connectionId: result.fixContext.connectionId,
                warehouseId: result.fixContext.warehouseId,
                skuId: row.sku.id,
            });
            await compareFromWb();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Не удалось исправить остаток WB.');
        }
        finally {
            setFixingSkuId('');
        }
    }
    return (_jsxs("div", { className: "admin-stack admin-stock-check", children: [_jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C WB \u2194 WMS" }), _jsx("h3", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043F\u043E \u0444\u0430\u0439\u043B\u0443 Wildberries" })] }), _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0439 \u0444\u0430\u0439\u043B stocks.xlsx. \u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0435\u0442: \u043E\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u043F\u043E \u0431\u0430\u0440\u043A\u043E\u0434\u0443 \u0441 \u0443\u0447\u0451\u0442\u043E\u043C \u0440\u0435\u0437\u0435\u0440\u0432\u0430 FBS." })] }), _jsxs("div", { className: "admin-stock-check__form", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B WMS" }), _jsxs("select", { value: warehouseId, onChange: (event) => setWarehouseId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043B\u0438\u0430\u043B" }), branches.map((branch) => _jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id))] })] }), _jsxs("fieldset", { className: "admin-stock-check__scope", children: [_jsx("legend", { children: "\u041A\u0430\u043A\u0438\u0435 \u0441\u043A\u043B\u0430\u0434\u044B WB \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C" }), _jsxs("label", { className: warehouseScope === 'ALL' ? 'is-selected' : '', children: [_jsx("input", { type: "radio", name: "wb-stock-warehouse-scope", value: "ALL", checked: warehouseScope === 'ALL', onChange: () => setWarehouseScope('ALL') }), _jsxs("span", { children: [_jsx("strong", { children: "\u0412\u0441\u0435 \u0441\u043A\u043B\u0430\u0434\u044B \u0441\u0440\u0430\u0437\u0443" }), _jsx("small", { children: loadingWarehouses ? 'загружаю склады…' : `${eligibleWarehouseTargets.length || 0} для филиала` })] })] }), _jsxs("label", { className: warehouseScope === 'ONE' ? 'is-selected' : '', children: [_jsx("input", { type: "radio", name: "wb-stock-warehouse-scope", value: "ONE", checked: warehouseScope === 'ONE', onChange: () => setWarehouseScope('ONE') }), _jsxs("span", { children: [_jsx("strong", { children: "\u041E\u0434\u0438\u043D \u0441\u043A\u043B\u0430\u0434" }), _jsx("small", { children: "\u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E" })] })] })] }), warehouseScope === 'ONE' ? _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043A\u043B\u0430\u0434 Wildberries" }), _jsxs("select", { value: warehouseTargetKey, disabled: loadingWarehouses, onChange: (event) => setWarehouseTargetKey(event.target.value), children: [_jsx("option", { value: "", children: loadingWarehouses ? 'Загружаю склады WB…' : 'Выберите склад WB' }), eligibleWarehouseTargets.map((target) => _jsxs("option", { value: target.key, children: [target.marketplaceWarehouseName, " \u00B7 ", target.accountName] }, target.key))] })] }) : _jsxs("div", { className: "admin-stock-check__all-warehouses", "aria-live": "polite", children: [_jsx("span", { children: "\u0412 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0432\u043E\u0439\u0434\u0443\u0442" }), _jsx("strong", { children: loadingWarehouses
                                            ? 'Загружаю маршруты складов…'
                                            : eligibleWarehouseTargets.length ? `Все склады WB · ${eligibleWarehouseTargets.length}` : 'Для филиала склады не настроены' })] }), _jsxs("label", { className: "admin-stock-check__file", children: [_jsx("span", { children: "\u0424\u0430\u0439\u043B \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 WB" }), _jsx("input", { type: "file", accept: ".xlsx,.xls", onChange: (event) => setFile(event.target.files?.[0] ?? null) }), _jsxs("em", { children: [_jsx(FileSpreadsheet, { size: 18 }), file?.name || 'Выберите stocks.xlsx'] })] }), _jsxs("button", { type: "button", className: "admin-button", onClick: () => void compare(), disabled: loading || loadingWarehouses || !eligibleWarehouseTargets.length, children: [loadingSource === 'FILE' ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(Upload, { size: 17 }), "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0444\u0430\u0439\u043B"] }), _jsxs("button", { type: "button", className: "admin-button admin-stock-check__wb-button", onClick: () => void compareFromWb(), disabled: loading || loadingWarehouses || !eligibleWarehouseTargets.length, children: [loadingSource === 'API' ? _jsx(LoaderCircle, { className: "spin", size: 17 }) : _jsx(FileSpreadsheet, { size: 17 }), "\u0412\u0437\u044F\u0442\u044C \u0441 WB"] })] }), error ? _jsxs("div", { className: "admin-message admin-message--error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null] }), result ? _jsxs(_Fragment, { children: [_jsxs("section", { className: `admin-stock-health ${result.health === 'OK' ? 'is-ok' : 'is-danger'}`, children: [result.health === 'OK' ? _jsx(CheckCircle2, { size: 28 }) : _jsx(AlertTriangle, { size: 28 }), _jsxs("div", { children: [_jsx("strong", { children: result.health === 'OK' ? 'Остатки WB в норме' : 'На WB есть завышенные остатки' }), _jsxs("span", { children: [result.health === 'OK'
                                                ? 'Количество на WB нигде не превышает свободный остаток WMS.'
                                                : `${result.summary.excessProducts} товар(ов) · нужно уменьшить суммарно на ${result.summary.excessUnits} шт.`, " \u00B7 \u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ", result.source === 'API' ? 'WB API' : result.file.name, result.wildberriesWarehouses && result.wildberriesWarehouses.length > 1
                                                ? ` · складов WB: ${result.wildberriesWarehouses.length}`
                                                : ''] })] })] }), _jsxs("section", { className: "admin-metrics admin-metrics--stock", children: [_jsxs("article", { children: [_jsx("span", { children: "\u0421\u0442\u0440\u043E\u043A \u0442\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("strong", { children: result.summary.products })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041D\u0430\u0439\u0434\u0435\u043D\u044B \u0432 WMS" }), _jsx("strong", { children: result.summary.matched })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u043D\u043E\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0435" }), _jsx("strong", { children: result.summary.exact })] }), _jsxs("article", { children: [_jsx("span", { children: "WB \u0431\u043E\u043B\u044C\u0448\u0435 WMS" }), _jsx("strong", { className: result.summary.excessProducts ? 'is-danger' : 'is-ok', children: result.summary.excessProducts })] }), _jsxs("article", { children: [_jsx("span", { children: "WMS \u0431\u043E\u043B\u044C\u0448\u0435 WB" }), _jsx("strong", { children: result.summary.wmsGreaterProducts })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0411\u0430\u0440\u043A\u043E\u0434 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" }), _jsx("strong", { children: result.summary.notFound })] })] }), _jsxs("section", { className: "admin-section", children: [_jsxs("div", { className: "admin-stock-check__toolbar", children: [_jsxs("label", { children: [_jsx(Search, { size: 16 }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u0411\u0430\u0440\u043A\u043E\u0434, \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0442\u043E\u0432\u0430\u0440 \u0438\u043B\u0438 \u0440\u0430\u0437\u043C\u0435\u0440" })] }), _jsxs("label", { className: "admin-stock-check__toggle", children: [_jsx("input", { type: "checkbox", checked: showAll, onChange: (event) => setShowAll(event.target.checked) }), "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u043E\u0432\u043F\u0430\u0432\u0448\u0438\u0435"] }), _jsxs("label", { className: "admin-stock-check__toggle", children: [_jsx("input", { type: "checkbox", checked: hideZeroWb, onChange: (event) => setHideZeroWb(event.target.checked) }), "\u0421\u043A\u0440\u044B\u0442\u044C \u043D\u0443\u043B\u0435\u0432\u044B\u0435 WB"] }), _jsxs("span", { children: ["\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E: ", visibleRows.length] })] }), _jsx("div", { className: "admin-stock-check__table-wrap", children: _jsxs("table", { className: "admin-stock-check__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0411\u0430\u0440\u043A\u043E\u0434" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440 WB" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "WB" }), _jsx("th", { children: "WMS \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E" }), _jsx("th", { children: "\u0420\u0430\u0437\u043D\u0438\u0446\u0430 WB \u2212 WMS" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: visibleRows.map((row) => _jsxs("tr", { className: `is-${row.status.toLocaleLowerCase()}`, children: [_jsx("td", { children: _jsx("span", { className: "admin-stock-check__status", children: statusLabel(row.status) }) }), _jsx("td", { children: row.barcode }), _jsxs("td", { children: [_jsx("strong", { children: row.sellerArticle || row.name || '—' }), _jsx("small", { children: row.sku ? `${row.sku.internalSku} · ${row.sku.name}` : 'В WMS не найден' })] }), _jsx("td", { children: row.size || row.sku?.size || '—' }), _jsx("td", { children: row.quantity }), _jsxs("td", { children: [row.wmsQuantity, _jsxs("small", { children: ["\u0412\u0441\u0435\u0433\u043E ", row.wmsAvailable, ", \u0440\u0435\u0437\u0435\u0440\u0432 ", row.wmsReserved] })] }), _jsx("td", { children: _jsx("strong", { children: row.difference > 0 ? `+${row.difference}` : row.difference }) }), _jsx("td", { children: row.status === 'WB_EXCESS' && row.sku && result.fixContext.connectionId ? _jsxs("button", { type: "button", className: "admin-stock-check__fix", disabled: Boolean(fixingSkuId), onClick: () => void fixRow(row), children: [fixingSkuId === row.sku.id ? _jsx(LoaderCircle, { className: "spin", size: 13 }) : _jsx(CheckCircle2, { size: 13 }), "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C"] })
                                                            : _jsx("small", { children: row.status === 'WB_EXCESS' && !result.fixContext.connectionId
                                                                    ? 'Для исправления выберите один склад'
                                                                    : row.status === 'WMS_GREATER' ? 'WB не повышаем' : row.status === 'NOT_FOUND' ? 'Сопоставьте баркод' : '—' }) })] }, row.barcode)) })] }) }), !visibleRows.length ? _jsxs("div", { className: "admin-empty", children: [_jsx(CheckCircle2, { size: 24 }), "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439 \u043F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u0444\u0438\u043B\u044C\u0442\u0440\u0443 \u043D\u0435\u0442."] }) : null] })] }) : null] }));
}
function statusLabel(status) {
    if (status === 'WB_EXCESS')
        return 'WB превышен';
    if (status === 'WMS_GREATER')
        return 'WMS больше';
    if (status === 'NOT_FOUND')
        return 'Не найден';
    return 'Совпадает';
}
