import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeftRight, Boxes, ChevronDown, ChevronRight, ExternalLink, MapPin, PackagePlus, RefreshCw, Search, Trash2, Warehouse, X, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addStoragePalletBox, createStoragePallet, createStorageZone, deleteStoragePallet, fetchClients, fetchStorageLayout, removeStoragePalletBox, relocateStoragePalletBox, syncStorageLayout, updateStoragePallet, } from '../../lib/api';
import './warehouse.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function StorageZonesPanel({ session }) {
    const [state, setState] = useState({ loading: true, data: null, error: '' });
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [query, setQuery] = useState('');
    const [zoneName, setZoneName] = useState('');
    const [palletCode, setPalletCode] = useState('');
    const [palletZoneId, setPalletZoneId] = useState('');
    const [boxDrafts, setBoxDrafts] = useState({});
    const [expanded, setExpanded] = useState(new Set());
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState('');
    const [relocateBox, setRelocateBox] = useState(null);
    async function load(sync = true) {
        setState((current) => ({ ...current, loading: true, error: '' }));
        try {
            const data = await fetchStorageLayout(session.accessToken, {
                warehouseId: session.user.activeWarehouseId || undefined,
                sync,
            });
            setState({ loading: false, data, error: '' });
        }
        catch (error) {
            setState((current) => ({ ...current, loading: false, error: errorText(error) }));
        }
    }
    useEffect(() => {
        void Promise.all([load(), fetchClients(session.accessToken)])
            .then(([, loadedClients]) => {
            const active = loadedClients.filter((client) => client.status === 'ACTIVE');
            setClients(active);
            const lukin = active.find((client) => /лукин/i.test(`${client.name} ${client.legalName ?? ''}`));
            setClientId((current) => validRememberedClientId(current, active, lukin?.id));
        })
            .catch((error) => setState((current) => ({ ...current, error: errorText(error), loading: false })));
    }, [session.accessToken]);
    const visiblePallets = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        const pallets = state.data?.pallets ?? [];
        if (!normalized) {
            return pallets;
        }
        return pallets.filter((pallet) => pallet.code.toLocaleLowerCase('ru-RU').includes(normalized) ||
            pallet.client.name.toLocaleLowerCase('ru-RU').includes(normalized) ||
            pallet.zone?.name.toLocaleLowerCase('ru-RU').includes(normalized) ||
            pallet.boxes.some((box) => box.boxCode.toLocaleLowerCase('ru-RU').includes(normalized)));
    }, [query, state.data?.pallets]);
    async function run(key, action, success) {
        setBusy(key);
        setNotice('');
        try {
            await action();
            setNotice(success);
            await load(false);
        }
        catch (error) {
            setState((current) => ({ ...current, error: errorText(error) }));
        }
        finally {
            setBusy('');
        }
    }
    async function submitZone(event) {
        event.preventDefault();
        const warehouseId = state.data?.warehouse.id;
        if (!warehouseId || !zoneName.trim())
            return;
        await run('zone', () => createStorageZone(session.accessToken, { warehouseId, name: zoneName.trim() }), `Зона «${zoneName.trim()}» создана.`);
        setZoneName('');
    }
    async function submitPallet(event) {
        event.preventDefault();
        const warehouseId = state.data?.warehouse.id;
        if (!warehouseId || !clientId || !palletCode.trim())
            return;
        const code = palletCode.trim();
        await run('pallet', () => createStoragePallet(session.accessToken, {
            warehouseId,
            clientId,
            code,
            zoneId: palletZoneId || undefined,
        }), `Паллета ${code} добавлена.`);
        setPalletCode('');
    }
    async function submitBox(palletId) {
        const code = boxDrafts[palletId]?.trim();
        if (!code)
            return;
        await run(`box:${palletId}`, () => addStoragePalletBox(session.accessToken, palletId, code), `Короб ${code.toUpperCase()} размещён.`);
        setBoxDrafts((current) => ({ ...current, [palletId]: '' }));
    }
    async function deletePallet(pallet) {
        if (pallet.boxes.length > 0) {
            setState((current) => ({
                ...current,
                error: `На паллете ${pallet.code} находится ${pallet.boxes.length} коробов. Сначала перенесите их или уберите из палет-сорта.`,
            }));
            return;
        }
        if (!window.confirm(`Удалить пустую паллету ${pallet.code} из зоны хранения?`)) {
            return;
        }
        await run(`delete-pallet:${pallet.id}`, () => deleteStoragePallet(session.accessToken, pallet.id), `Паллета ${pallet.code} удалена.`);
        setExpanded((current) => {
            const next = new Set(current);
            next.delete(pallet.id);
            return next;
        });
    }
    function togglePallet(id) {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    async function submitRelocateBox(event) {
        event.preventDefault();
        if (!relocateBox?.targetPalletId)
            return;
        const busyKey = `relocate:${relocateBox.placementId}`;
        setBusy(busyKey);
        setNotice('');
        try {
            const result = await relocateStoragePalletBox(session.accessToken, {
                boxCode: relocateBox.boxCode,
                targetPalletId: relocateBox.targetPalletId,
                swapBoxCode: relocateBox.swapBoxCode || undefined,
            });
            setNotice(result.message);
            setRelocateBox(null);
            await load(false);
        }
        catch (error) {
            setState((current) => ({ ...current, error: errorText(error) }));
        }
        finally {
            setBusy('');
        }
    }
    const data = state.data;
    const sourceLabel = (source) => source === 'TSD' ? 'ТСД' : source === 'GOOGLE_SHEETS' ? 'Google' : 'Вручную';
    return (_jsxs("div", { className: "storage-zones", children: [_jsxs("header", { className: "storage-zones__hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u043A\u043B\u0430\u0434 \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" }), _jsx("h2", { children: "\u0417\u043E\u043D\u044B \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsx("p", { children: "\u0417\u043E\u043D\u0430 \u2192 \u043F\u0430\u043B\u043B\u0435\u0442\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u2192 \u043A\u043E\u0440\u043E\u0431\u0430. \u0422\u0435\u043A\u0443\u0449\u0435\u0435 \u043C\u0435\u0441\u0442\u043E \u043A\u043E\u0440\u043E\u0431\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u043F\u043E\u0438\u0441\u043A\u0435 \u0438 \u0441\u0431\u043E\u0440\u043A\u0435 FBS/FBO." })] }), _jsx("div", { className: "storage-zones__hero-icon", children: _jsx(MapPin, { size: 30, "aria-hidden": "true" }) })] }), data ? (_jsxs("div", { className: "storage-zones__metrics", children: [_jsx(Metric, { icon: _jsx(Warehouse, { size: 18 }), label: "\u0417\u043E\u043D", value: data.summary.zones }), _jsx(Metric, { icon: _jsx(PackagePlus, { size: 18 }), label: "\u041F\u0430\u043B\u043B\u0435\u0442", value: data.summary.pallets }), _jsx(Metric, { icon: _jsx(Boxes, { size: 18 }), label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432", value: data.summary.boxes }), _jsx(Metric, { icon: _jsx(MapPin, { size: 18 }), label: "\u0411\u0435\u0437 \u0437\u043E\u043D\u044B", value: data.summary.unassignedPallets })] })) : null, data ? (_jsxs("section", { className: "storage-zones__zone-statistics", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0417\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u043F\u043E \u0437\u043E\u043D\u0430\u043C" }), _jsx("span", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043F\u0430\u043B\u043B\u0435\u0442\u043E\u0432 \u0438 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0432 \u043A\u0430\u0436\u0434\u043E\u0439 \u0437\u043E\u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430" })] }), _jsx("small", { children: data.warehouse.name })] }), _jsxs("div", { className: "storage-zones__zone-statistics-grid", children: [data.zones.map((zone) => (_jsxs("article", { children: [_jsx("span", { className: "storage-zones__zone-marker", children: _jsx(MapPin, { size: 16 }) }), _jsxs("div", { children: [_jsx("strong", { children: zone.name }), _jsx("small", { children: zone.code })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" }), _jsx("dd", { children: zone.palletCount.toLocaleString('ru-RU') })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("dd", { children: zone.boxCount.toLocaleString('ru-RU') })] })] })] }, zone.id))), data.summary.unassignedPallets > 0 ? (_jsxs("article", { className: "is-unassigned", children: [_jsx("span", { className: "storage-zones__zone-marker", children: _jsx(MapPin, { size: 16 }) }), _jsxs("div", { children: [_jsx("strong", { children: "\u0411\u0435\u0437 \u0437\u043E\u043D\u044B" }), _jsx("small", { children: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F" })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" }), _jsx("dd", { children: data.summary.unassignedPallets.toLocaleString('ru-RU') })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("dd", { children: data.pallets.filter((pallet) => !pallet.zoneId).reduce((sum, pallet) => sum + pallet.boxes.length, 0).toLocaleString('ru-RU') })] })] })] })) : null] })] })) : null, data ? (_jsxs("div", { className: "storage-zones__prefixes", "aria-label": "\u041F\u0440\u0435\u0444\u0438\u043A\u0441\u044B \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0445 \u043A\u043E\u0434\u043E\u0432", children: [_jsx("strong", { children: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441\u044B \u043A\u043E\u0434\u043E\u0432:" }), _jsxs("span", { children: ["\u043F\u0430\u043B\u043B\u0435\u0442\u0430 ", _jsx("b", { children: data.codePrefixes.pallet })] }), _jsxs("span", { children: ["\u044F\u0447\u0435\u0439\u043A\u0430 ", _jsx("b", { children: data.codePrefixes.storageCell })] }), _jsxs("span", { children: ["\u043C\u0435\u0441\u0442\u043E ", _jsx("b", { children: data.codePrefixes.rackSlot })] }), _jsxs("span", { children: ["\u0441\u0442\u0435\u043B\u043B\u0430\u0436 ", _jsx("b", { children: data.codePrefixes.rack })] }), _jsxs("span", { children: ["\u0431\u043E\u043A\u0441 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F ", _jsx("b", { children: data.codePrefixes.storageBox })] })] })) : null, _jsxs("section", { className: "storage-zones__toolbar", children: [_jsxs("label", { className: "storage-zones__search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u041F\u0430\u043B\u043B\u0435\u0442\u0430, \u043A\u043E\u0440\u043E\u0431, \u043A\u043B\u0438\u0435\u043D\u0442 \u0438\u043B\u0438 \u0437\u043E\u043D\u0430" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 \u043F\u0430\u043B\u043B\u0435\u0442-\u0441\u043E\u0440\u0442\u0430" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => _jsx("option", { value: client.id, children: client.name }, client.id))] })] }), data?.warehouse.code === 'MSK' ? (_jsxs("button", { className: "secondary-button", type: "button", disabled: !data || busy === 'sync', onClick: () => void run('sync', () => syncStorageLayout(session.accessToken, data?.warehouse.id), 'Размещение ИП Лукина обновлено из Google-таблицы.'), children: [_jsx(RefreshCw, { size: 16, className: busy === 'sync' ? 'spin' : '' }), "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C"] })) : null, data?.warehouse.code === 'MSK' && data.googleSync.sourceUrl ? (_jsxs("a", { className: "storage-zones__sheet-link", href: data.googleSync.sourceUrl.replace('/export?format=csv&gid=0', '/edit?gid=0'), target: "_blank", rel: "noreferrer", children: ["\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0442\u0430\u0431\u043B\u0438\u0446\u0443 ", _jsx(ExternalLink, { size: 14 })] })) : null] }), state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, notice ? _jsx("p", { className: "form-success", children: notice }) : null, data?.googleSync.error ? _jsxs("p", { className: "form-warning", children: ["Google: ", data.googleSync.error, ". \u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B."] }) : null, data && data.zones.length === 0 ? (_jsxs("section", { className: "storage-zones__empty-zones", children: [_jsx(MapPin, { size: 22 }), _jsxs("div", { children: [_jsx("strong", { children: "\u0420\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("p", { children: "\u0417\u043E\u043D\u044B \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u044B. \u041F\u0430\u043B\u043B\u0435\u0442\u044B \u0438\u0437 \u0444\u0430\u0439\u043B\u0430 \u0418\u041F \u041B\u0443\u043A\u0438\u043D\u0430 \u0443\u0436\u0435 \u043C\u043E\u0436\u043D\u043E \u0438\u0441\u043A\u0430\u0442\u044C \u0438 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C; \u0437\u0430\u0442\u0435\u043C \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u0435 \u0438\u0445 \u043F\u043E \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u043C \u0437\u043E\u043D\u0430\u043C." })] })] })) : null, data ? (_jsxs("div", { className: "storage-zones__forms", children: [_jsxs("form", { onSubmit: submitZone, children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041D\u043E\u0432\u0430\u044F \u0437\u043E\u043D\u0430" }), _jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043B\u044E\u0431\u044B\u043C" })] }), _jsx("input", { value: zoneName, onChange: (event) => setZoneName(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: 2 \u044D\u0442\u0430\u0436, \u0441\u0435\u043A\u0442\u043E\u0440 B" }), _jsx("button", { className: "primary-button", disabled: !zoneName.trim() || busy === 'zone', children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0437\u043E\u043D\u0443" })] }), _jsxs("form", { onSubmit: submitPallet, children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041D\u043E\u0432\u0430\u044F \u043F\u0430\u043B\u043B\u0435\u0442\u0430" }), _jsx("span", { children: "\u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }), _jsx("input", { value: palletCode, onChange: (event) => setPalletCode(event.target.value), placeholder: `Например: ${data.codePrefixes.pallet}001` }), _jsxs("select", { value: palletZoneId, onChange: (event) => setPalletZoneId(event.target.value), children: [_jsx("option", { value: "", children: "\u041F\u043E\u043A\u0430 \u0431\u0435\u0437 \u0437\u043E\u043D\u044B" }), data.zones.map((zone) => _jsx("option", { value: zone.id, children: zone.name }, zone.id))] }), _jsx("button", { className: "primary-button", disabled: !palletCode.trim() || !clientId || busy === 'pallet', children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C" })] })] })) : null, state.loading && !data ? _jsx("p", { className: "warehouse-inline", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435\u2026" }) : null, data ? (_jsxs("section", { className: "storage-zones__list", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435" }), _jsx("h3", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B \u0438 \u043A\u043E\u0440\u043E\u0431\u0430" })] }), _jsxs("span", { children: [visiblePallets.length, " \u043F\u0430\u043B\u043B\u0435\u0442"] })] }), visiblePallets.length === 0 ? _jsx("p", { className: "storage-zones__empty", children: "\u041F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }) : null, visiblePallets.map((pallet) => {
                        const isOpen = expanded.has(pallet.id) || Boolean(query.trim());
                        return (_jsxs("article", { className: "storage-pallet", children: [_jsxs("button", { className: "storage-pallet__summary", type: "button", onClick: () => togglePallet(pallet.id), children: [isOpen ? _jsx(ChevronDown, { size: 18 }) : _jsx(ChevronRight, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: pallet.code }), _jsxs("small", { children: [pallet.client.name, " \u00B7 ", pallet.zone?.name ?? 'Без зоны'] })] }), _jsxs("em", { children: [pallet.boxes.length, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] }), _jsx("i", { "data-source": pallet.source, children: sourceLabel(pallet.source) })] }), isOpen ? (_jsxs("div", { className: "storage-pallet__body", children: [_jsxs("div", { className: "storage-pallet__controls", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0417\u043E\u043D\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsxs("select", { value: pallet.zoneId ?? '', disabled: busy === `zone:${pallet.id}`, onChange: (event) => void run(`zone:${pallet.id}`, () => updateStoragePallet(session.accessToken, pallet.id, { zoneId: event.target.value || null }), `Паллета ${pallet.code} перемещена.`), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u0437\u043E\u043D\u044B" }), data.zones.map((zone) => _jsx("option", { value: zone.id, children: zone.name }, zone.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043A\u043E\u0440\u043E\u0431" }), _jsxs("div", { children: [_jsx("input", { value: boxDrafts[pallet.id] ?? '', onChange: (event) => setBoxDrafts((current) => ({ ...current, [pallet.id]: event.target.value })), onKeyDown: (event) => {
                                                                        if (event.key === 'Enter') {
                                                                            event.preventDefault();
                                                                            void submitBox(pallet.id);
                                                                        }
                                                                    }, placeholder: "FFL_..." }), _jsxs("button", { type: "button", onClick: () => void submitBox(pallet.id), disabled: !boxDrafts[pallet.id]?.trim(), children: [_jsx(PackagePlus, { size: 16 }), " \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C"] })] })] })] }), _jsx("div", { className: "storage-pallet__pallet-actions", children: _jsxs("button", { className: "storage-pallet__delete-button", type: "button", disabled: busy === `delete-pallet:${pallet.id}`, title: pallet.boxes.length > 0
                                                    ? 'Сначала перенесите или уберите все короба с паллеты'
                                                    : 'Удалить ошибочно созданную паллету', onClick: () => void deletePallet(pallet), children: [_jsx(Trash2, { size: 15 }), busy === `delete-pallet:${pallet.id}` ? 'Удаляю…' : 'Удалить паллету'] }) }), _jsxs("div", { className: "storage-pallet__boxes", children: [pallet.boxes.length === 0 ? _jsx("p", { children: "\u041D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043A\u043E\u0440\u043E\u0431\u043E\u0432." }) : null, pallet.boxes.map((placement) => (_jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: placement.boxCode }), _jsxs("small", { children: [placement.box?.client.name ?? 'Короб пока не найден в WMS', " \u00B7 ", sourceLabel(placement.source)] })] }), _jsxs("div", { className: "storage-pallet__box-actions", children: [_jsx("button", { className: "is-move", type: "button", title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0438\u043B\u0438 \u043F\u043E\u043C\u0435\u043D\u044F\u0442\u044C \u043A\u043E\u0440\u043E\u0431 \u043C\u0435\u0441\u0442\u0430\u043C\u0438", onClick: () => {
                                                                        setState((current) => ({ ...current, error: '' }));
                                                                        setRelocateBox({
                                                                            placementId: placement.id,
                                                                            boxCode: placement.boxCode,
                                                                            sourcePalletId: pallet.id,
                                                                            sourcePalletCode: pallet.code,
                                                                            clientId: pallet.clientId,
                                                                            targetPalletId: '',
                                                                            swapBoxCode: '',
                                                                        });
                                                                    }, children: _jsx(ArrowLeftRight, { size: 15 }) }), _jsx("button", { type: "button", title: "\u0423\u0431\u0440\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431 \u0441 \u043F\u0430\u043B\u043B\u0435\u0442\u044B", onClick: () => void run(`remove:${placement.id}`, () => removeStoragePalletBox(session.accessToken, pallet.id, placement.boxCode), `Короб ${placement.boxCode} убран с паллеты.`), children: _jsx(Trash2, { size: 15 }) })] })] }, placement.id)))] })] })) : null] }, pallet.id));
                    })] })) : null, relocateBox && data ? (_jsx("div", { className: "storage-pallet-move-backdrop", role: "presentation", onMouseDown: () => busy !== `relocate:${relocateBox.placementId}` && setRelocateBox(null), children: _jsxs("form", { className: "storage-pallet-move-dialog", role: "dialog", "aria-modal": "true", "aria-label": "\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u0430\u043B\u043B\u0435\u0442\u0441\u043E\u0440\u0442\u0430", onSubmit: submitRelocateBox, onMouseDown: (event) => event.stopPropagation(), children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F" }), _jsx("h3", { children: relocateBox.boxCode }), _jsxs("small", { children: ["\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u043D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0435 ", relocateBox.sourcePalletCode] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setRelocateBox(null), "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18 }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0430\u044F \u043F\u0430\u043B\u043B\u0435\u0442\u0430" }), _jsxs("select", { value: relocateBox.targetPalletId, onChange: (event) => setRelocateBox((current) => current ? { ...current, targetPalletId: event.target.value, swapBoxCode: '' } : current), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0430\u043B\u043B\u0435\u0442\u0443" }), data.pallets
                                            .filter((pallet) => pallet.clientId === relocateBox.clientId && pallet.id !== relocateBox.sourcePalletId)
                                            .map((pallet) => (_jsxs("option", { value: pallet.id, children: [pallet.code, " \u00B7 ", pallet.zone?.name ?? 'без зоны', " \u00B7 ", pallet.boxes.length, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] }, pallet.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431 \u0434\u043B\u044F \u043E\u0431\u043C\u0435\u043D\u0430 \u043C\u0435\u0441\u0442\u0430\u043C\u0438 \u2014 \u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E" }), _jsxs("select", { value: relocateBox.swapBoxCode, disabled: !relocateBox.targetPalletId, onChange: (event) => setRelocateBox((current) => (current ? { ...current, swapBoxCode: event.target.value } : current)), children: [_jsx("option", { value: "", children: "\u041F\u0440\u043E\u0441\u0442\u043E \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u043D\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u0443\u044E \u043F\u0430\u043B\u043B\u0435\u0442\u0443" }), (data.pallets.find((pallet) => pallet.id === relocateBox.targetPalletId)?.boxes ?? []).map((placement) => (_jsxs("option", { value: placement.boxCode, children: ["\u041F\u043E\u043C\u0435\u043D\u044F\u0442\u044C \u043C\u0435\u0441\u0442\u0430\u043C\u0438 \u0441 ", placement.boxCode] }, placement.id)))] }), _jsxs("small", { children: ["\u0415\u0441\u043B\u0438 \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0442\u043E\u0440\u043E\u0439 \u043A\u043E\u0440\u043E\u0431, \u043E\u043D \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043F\u0435\u0440\u0435\u0439\u0434\u0451\u0442 \u043D\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0443 ", relocateBox.sourcePalletCode, "."] })] }), _jsxs("div", { className: "storage-pallet-move-dialog__preview", children: [_jsx(ArrowLeftRight, { size: 19 }), _jsx("span", { children: relocateBox.swapBoxCode
                                        ? `${relocateBox.boxCode} ↔ ${relocateBox.swapBoxCode}`
                                        : relocateBox.targetPalletId
                                            ? `${relocateBox.boxCode} будет перенесён без обмена`
                                            : 'Выберите правильную паллету' })] }), _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", onClick: () => setRelocateBox(null), children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !relocateBox.targetPalletId || busy === `relocate:${relocateBox.placementId}`, children: [_jsx(ArrowLeftRight, { size: 16 }), busy === `relocate:${relocateBox.placementId}`
                                            ? 'Исправляю'
                                            : relocateBox.swapBoxCode
                                                ? 'Поменять местами'
                                                : 'Перенести короб'] })] })] }) })) : null] }));
}
function Metric({ icon, label, value }) {
    return _jsxs("div", { children: [icon, _jsxs("span", { children: [_jsx("strong", { children: value.toLocaleString('ru-RU') }), _jsx("small", { children: label })] })] });
}
function errorText(error) {
    return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}
