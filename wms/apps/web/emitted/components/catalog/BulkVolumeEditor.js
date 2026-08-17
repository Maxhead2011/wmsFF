import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCheck, Gauge, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchBulkSkuVolume, updateBulkSkuVolume, } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
const emptyData = {
    client: { id: '', code: '', name: '' },
    volumes: [],
    items: [],
    total: 0,
};
export function BulkVolumeEditor({ clients, defaultClientId, onApplied, session }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: defaultClientId,
    });
    const [sourceVolumeFrom, setSourceVolumeFrom] = useState('');
    const [sourceVolumeTo, setSourceVolumeTo] = useState('');
    const [targetVolume, setTargetVolume] = useState('');
    const [data, setData] = useState(emptyData);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        if (defaultClientId) {
            setClientId(defaultClientId);
        }
        else if (!clientId && clients.length === 1) {
            setClientId(clients[0].id);
        }
    }, [clientId, clients, defaultClientId]);
    useEffect(() => {
        if (!clientId) {
            setData(emptyData);
            setSourceVolumeFrom('');
            setSourceVolumeTo('');
            setSelectedIds(new Set());
            return;
        }
        const rangeFrom = parseVolume(sourceVolumeFrom);
        const rangeTo = parseVolume(sourceVolumeTo);
        const rangeReady = rangeFrom !== null && rangeTo !== null && rangeFrom <= rangeTo;
        let active = true;
        setLoading(true);
        setError('');
        fetchBulkSkuVolume(session.accessToken, {
            clientId,
            sourceVolumeFrom: rangeReady ? rangeFrom : undefined,
            sourceVolumeTo: rangeReady ? rangeTo : undefined,
        })
            .then((result) => {
            if (!active)
                return;
            setData(result);
            setSelectedIds(new Set(result.items.map((item) => item.id)));
        })
            .catch((caught) => {
            if (!active)
                return;
            setError(readableError(caught, 'Не удалось загрузить товары по литражу.'));
            setData(emptyData);
            setSelectedIds(new Set());
        })
            .finally(() => {
            if (active)
                setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [clientId, reloadKey, session.accessToken, sourceVolumeFrom, sourceVolumeTo]);
    const sourceLabel = useMemo(() => {
        const from = parseVolume(sourceVolumeFrom);
        const to = parseVolume(sourceVolumeTo);
        if (from === null || to === null)
            return '';
        return from === to
            ? `${formatVolume(from)} л`
            : `от ${formatVolume(from)} до ${formatVolume(to)} л`;
    }, [sourceVolumeFrom, sourceVolumeTo]);
    const rangeReady = useMemo(() => {
        const from = parseVolume(sourceVolumeFrom);
        const to = parseVolume(sourceVolumeTo);
        return from !== null && to !== null && from <= to;
    }, [sourceVolumeFrom, sourceVolumeTo]);
    function changeClient(nextClientId) {
        setClientId(nextClientId);
        setSourceVolumeFrom('');
        setSourceVolumeTo('');
        setTargetVolume('');
        setMessage('');
        setError('');
    }
    function toggleAll(checked) {
        setSelectedIds(checked ? new Set(data.items.map((item) => item.id)) : new Set());
    }
    function toggleOne(id, checked) {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (checked)
                next.add(id);
            else
                next.delete(id);
            return next;
        });
    }
    async function apply(event) {
        event.preventDefault();
        const normalizedTarget = Number(targetVolume.replace(',', '.'));
        const normalizedFrom = parseVolume(sourceVolumeFrom);
        const normalizedTo = parseVolume(sourceVolumeTo);
        if (!clientId || normalizedFrom === null || normalizedTo === null || normalizedFrom > normalizedTo
            || selectedIds.size === 0 || !Number.isFinite(normalizedTarget) || normalizedTarget <= 0) {
            setError('Выберите клиента, корректный диапазон, товары и укажите новый литраж больше нуля.');
            return;
        }
        const confirmed = window.confirm(`Изменить литраж у ${selectedIds.size} товаров: ${sourceLabel} → ${formatVolume(normalizedTarget)} л?\n\nГабариты карточек останутся без изменений.`);
        if (!confirmed)
            return;
        setSaving(true);
        setMessage('');
        setError('');
        try {
            const result = await updateBulkSkuVolume(session.accessToken, {
                clientId,
                sourceVolumeFrom: normalizedFrom,
                sourceVolumeTo: normalizedTo,
                skuIds: [...selectedIds],
                newVolumeLiters: normalizedTarget,
            });
            setMessage(`Готово: литраж изменён у ${result.updated} товаров. Габариты карточек не изменялись.`);
            setSourceVolumeFrom(String(result.newVolumeLiters));
            setSourceVolumeTo(String(result.newVolumeLiters));
            setTargetVolume('');
            setReloadKey((current) => current + 1);
            onApplied();
        }
        catch (caught) {
            setError(readableError(caught, 'Не удалось массово изменить литраж.'));
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("section", { className: "catalog-volume-editor", "aria-label": "\u041C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043B\u0438\u0442\u0440\u0430\u0436\u0430", children: [_jsxs("div", { className: "catalog-volume-editor__heading", children: [_jsxs("div", { className: "catalog-volume-editor__title", children: [_jsx("span", { className: "catalog-volume-editor__icon", children: _jsx(Gauge, { size: 20, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("strong", { children: "\u041C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043B\u0438\u0442\u0440\u0430\u0436\u0430" }), _jsx("span", { children: "\u0420\u0443\u0447\u043D\u043E\u0439 \u043B\u0438\u0442\u0440\u0430\u0436 \u0438\u043C\u0435\u0435\u0442 \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442 \u043D\u0430\u0434 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430\u043C\u0438 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0438 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u0440\u0430\u0441\u0447\u0451\u0442\u0435 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" })] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setReloadKey((current) => current + 1), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435", children: _jsx(RefreshCw, { size: 17, "aria-hidden": "true" }) })] }), _jsxs("form", { className: "catalog-volume-editor__form", onSubmit: (event) => void apply(event), children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041B\u0438\u0442\u0440\u0430\u0436 \u043E\u0442, \u043B" }), _jsx("input", { type: "number", inputMode: "decimal", min: "0.001", max: "1000000", step: "0.001", value: sourceVolumeFrom, onChange: (event) => {
                                    setSourceVolumeFrom(event.target.value);
                                    setMessage('');
                                    setError('');
                                }, disabled: !clientId, placeholder: "\u041E\u0442", required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041B\u0438\u0442\u0440\u0430\u0436 \u0434\u043E, \u043B" }), _jsx("input", { type: "number", inputMode: "decimal", min: "0.001", max: "1000000", step: "0.001", value: sourceVolumeTo, onChange: (event) => {
                                    setSourceVolumeTo(event.target.value);
                                    setMessage('');
                                    setError('');
                                }, disabled: !clientId, placeholder: "\u0414\u043E", required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u0432\u044B\u0439 \u043B\u0438\u0442\u0440\u0430\u0436, \u043B" }), _jsx("input", { type: "number", inputMode: "decimal", min: "0.001", max: "1000000", step: "0.001", value: targetVolume, onChange: (event) => setTargetVolume(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, 3.5", required: true })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: saving || loading || selectedIds.size === 0, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: saving ? 'Изменяю…' : `Изменить у ${selectedIds.size}` })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, rangeReady ? (_jsxs("div", { className: "catalog-volume-editor__results", children: [_jsxs("div", { className: "catalog-volume-editor__summary", children: [_jsxs("span", { children: [_jsx(CheckCheck, { size: 16, "aria-hidden": "true" }), " \u041D\u0430\u0439\u0434\u0435\u043D\u043E: ", data.total, " \u00B7 \u0432\u044B\u0431\u0440\u0430\u043D\u043E: ", selectedIds.size] }), _jsx("button", { className: "text-button", type: "button", onClick: () => toggleAll(selectedIds.size !== data.items.length), children: selectedIds.size === data.items.length && data.items.length > 0 ? 'Снять выбор' : 'Выбрать все' })] }), _jsx("div", { className: "catalog-volume-editor__table-wrap", children: _jsxs("table", { className: "catalog-volume-editor__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: _jsx("input", { "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u0442\u043E\u0432\u0430\u0440\u044B", type: "checkbox", checked: data.items.length > 0 && selectedIds.size === data.items.length, onChange: (event) => toggleAll(event.target.checked) }) }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B / \u0428\u041A" }), _jsx("th", { children: "\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B" }), _jsx("th", { children: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043B\u0438\u0442\u0440\u0430\u0436" })] }) }), _jsxs("tbody", { children: [data.items.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("input", { "aria-label": `Выбрать ${item.name}`, type: "checkbox", checked: selectedIds.has(item.id), onChange: (event) => toggleOne(item.id, event.target.checked) }) }), _jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: item.internalSku })] }), _jsxs("td", { children: [_jsx("strong", { children: item.article || item.clientSku || '—' }), _jsx("span", { children: item.barcodes.find((barcode) => barcode.isPrimary)?.value || item.barcodes[0]?.value || '—' })] }), _jsx("td", { children: formatDimensions(item) }), _jsxs("td", { children: [_jsx("strong", { children: item.volumeLiters == null ? 'Не задан' : `${formatVolume(item.volumeLiters)} л` }), _jsx("span", { children: item.volumeSource === 'MANUAL' ? 'ручной' : 'по габаритам' })] })] }, item.id))), data.items.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: loading ? 'Загрузка товаров…' : 'Товаров в выбранном диапазоне нет' }) })) : null] })] }) })] })) : null] }));
}
function formatVolume(value) {
    const number = Number(value);
    return Number.isFinite(number)
        ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(number)
        : String(value);
}
function parseVolume(value) {
    if (!value.trim())
        return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function formatDimensions(item) {
    const dimensions = [item.lengthCm, item.widthCm, item.heightCm].map((value) => Number(value));
    if (dimensions.some((value) => !Number.isFinite(value) || value <= 0))
        return 'Не указаны';
    return `${dimensions.map((value) => formatVolume(value)).join(' × ')} см`;
}
function readableError(caught, fallback) {
    return caught instanceof Error && caught.message ? caught.message : fallback;
}
