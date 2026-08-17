import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeft, CheckCircle2, ChevronRight, CircleAlert, KeyRound, PackageCheck, PlugZap, Save, ShoppingBag, Store, Truck, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { checkDbsIntegration, createDbsIntegration, fetchClients, fetchDbsIntegrations, updateDbsIntegration, } from '../../lib/api';
import './dbs.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
const dbsMarketplaces = [
    {
        id: 'WB',
        apiValue: 'WILDBERRIES',
        eyebrow: 'Wildberries',
        title: 'DBS WB',
        description: 'Заказы DBS Wildberries, самостоятельная доставка, статусы и подтверждение вручения.',
        brand: 'WB',
        accent: 'wb',
    },
    {
        id: 'OZON',
        apiValue: 'OZON',
        eyebrow: 'Ozon Seller',
        title: 'DBS OZON',
        description: 'Отдельная очередь DBS Ozon, сборка, доставка продавцом и контроль статусов.',
        brand: 'OZON',
        accent: 'ozon',
    },
    {
        id: 'YM',
        apiValue: 'YANDEX_MARKET',
        eyebrow: 'Яндекс Маркет',
        title: 'DBS YM',
        description: 'Заказы DBS Яндекс Маркета, подготовка, передача курьеру и завершение доставки.',
        brand: 'Я',
        accent: 'ym',
    },
];
const deliveryProviders = [
    { value: 'CDEK', label: 'СДЭК' },
    { value: 'YANDEX_DELIVERY', label: 'Яндекс Доставка' },
    { value: 'DOSTAVISTA', label: 'Dostavista' },
    { value: 'BOXBERRY', label: 'Boxberry' },
    { value: 'OTHER', label: 'Другая служба' },
];
const emptyForm = {
    id: '',
    clientId: '',
    senderName: '',
    contactName: '',
    phone: '',
    email: '',
    city: '',
    address: '',
    postalCode: '',
    deliveryProvider: 'CDEK',
    deliveryServiceName: '',
    deliveryApiUrl: '',
    deliveryAccountId: '',
    deliveryApiKey: '',
    deliveryApiSecret: '',
    isActive: true,
};
export function DbsPanel({ session }) {
    const [marketplace, setMarketplace] = useState(null);
    const selected = dbsMarketplaces.find((item) => item.id === marketplace);
    if (selected) {
        return (_jsx(DbsMarketplaceWorkspace, { session: session, marketplace: selected, onBack: () => setMarketplace(null) }));
    }
    return (_jsxs("section", { className: "dbs-panel dbs-panel--entry", "aria-label": "\u0412\u044B\u0431\u043E\u0440 DBS-\u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", children: [_jsxs("header", { className: "dbs-panel__hero", children: [_jsx("div", { className: "dbs-panel__hero-icon", children: _jsx(Store, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "DBS" }), _jsx("h2", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("p", { children: "\u0417\u0430\u043A\u0430\u0437\u044B \u0441 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u043E\u0439 \u0441\u0438\u043B\u0430\u043C\u0438 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430 \u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u044B \u043F\u043E \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430\u043C \u0438 \u043D\u0435 \u0441\u043C\u0435\u0448\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0441 FBS." })] }), _jsx("span", { className: "dbs-panel__scope", children: "3 \u0440\u0430\u0431\u043E\u0447\u0438\u0445 \u043A\u043E\u043D\u0442\u0443\u0440\u0430" })] }), _jsx("div", { className: "dbs-marketplace-grid", children: dbsMarketplaces.map((item, index) => (_jsxs("button", { type: "button", className: `dbs-marketplace-card dbs-marketplace-card--${item.accent}`, onClick: () => setMarketplace(item.id), children: [_jsx("span", { className: "dbs-marketplace-card__index", children: index + 1 }), _jsx("span", { className: "dbs-marketplace-card__brand", children: item.brand }), _jsxs("span", { className: "dbs-marketplace-card__content", children: [_jsx("small", { children: item.eyebrow }), _jsx("strong", { children: item.title }), _jsx("span", { children: item.description })] }), _jsx(ChevronRight, { size: 26, "aria-hidden": "true" })] }, item.id))) })] }));
}
function DbsMarketplaceWorkspace({ session, marketplace, onBack, }) {
    const [clients, setClients] = useState([]);
    const [integrations, setIntegrations] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [rememberedClientId, setRememberedClientId] = useRememberedClientId(session.user.id);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const canWrite = session.user.permissionCodes.includes('clients:write');
    const selectedClient = useMemo(() => clients.find((client) => client.id === form.clientId) ?? null, [clients, form.clientId]);
    const currentIntegration = useMemo(() => integrations.find((item) => item.clientId === form.clientId) ?? null, [integrations, form.clientId]);
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        Promise.all([
            fetchClients(session.accessToken),
            fetchDbsIntegrations(session.accessToken, { marketplace: marketplace.apiValue }),
        ])
            .then(([loadedClients, loadedIntegrations]) => {
            if (!active)
                return;
            const activeClients = loadedClients.filter((client) => client.status !== 'ARCHIVED');
            setClients(activeClients);
            setIntegrations(loadedIntegrations);
            const firstClientId = validRememberedClientId(rememberedClientId, activeClients, loadedIntegrations[0]?.clientId);
            setForm(formForClient(firstClientId, activeClients, loadedIntegrations));
        })
            .catch((caught) => {
            if (active)
                setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки DBS.');
        })
            .finally(() => {
            if (active)
                setLoading(false);
        });
        return () => { active = false; };
    }, [marketplace.apiValue, session.accessToken]);
    function selectClient(clientId) {
        setRememberedClientId(clientId);
        setForm(formForClient(clientId, clients, integrations));
        setError('');
        setMessage('');
    }
    async function submit(event) {
        event.preventDefault();
        if (!canWrite)
            return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const payload = {
                clientId: form.clientId,
                marketplace: marketplace.apiValue,
                senderName: form.senderName.trim(),
                contactName: form.contactName?.trim(),
                phone: form.phone.trim(),
                email: form.email?.trim(),
                city: form.city.trim(),
                address: form.address.trim(),
                postalCode: form.postalCode?.trim(),
                deliveryProvider: form.deliveryProvider,
                deliveryServiceName: form.deliveryServiceName?.trim(),
                deliveryApiUrl: form.deliveryApiUrl?.trim(),
                deliveryAccountId: form.deliveryAccountId?.trim(),
                deliveryApiKey: form.deliveryApiKey.trim(),
                deliveryApiSecret: form.deliveryApiSecret.trim(),
                isActive: form.isActive,
            };
            let saved;
            if (form.id) {
                const updatePayload = { ...payload };
                if (!form.deliveryApiKey.trim())
                    delete updatePayload.deliveryApiKey;
                if (!form.deliveryApiSecret.trim())
                    delete updatePayload.deliveryApiSecret;
                saved = await updateDbsIntegration(session.accessToken, form.id, updatePayload);
            }
            else {
                saved = await createDbsIntegration(session.accessToken, payload);
            }
            const checked = await checkDbsIntegration(session.accessToken, saved.id);
            setIntegrations((current) => [checked, ...current.filter((item) => item.id !== checked.id)]);
            setForm(formFromIntegration(checked));
            setMessage(checked.check.message);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройку DBS.');
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("section", { className: "dbs-panel", "aria-label": marketplace.title, children: [_jsxs("header", { className: "dbs-panel__hero", children: [_jsx("div", { className: `dbs-panel__hero-icon dbs-panel__hero-icon--${marketplace.accent}`, children: _jsx(Truck, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("button", { className: "dbs-panel__back", type: "button", onClick: onBack, children: [_jsx(ArrowLeft, { size: 18, "aria-hidden": "true" }), "\u041D\u0430\u0437\u0430\u0434 \u043A DBS"] }), _jsx("p", { className: "eyebrow", children: marketplace.eyebrow }), _jsx("h2", { children: marketplace.title }), _jsx("p", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F \u0438 \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 API \u0441\u043B\u0443\u0436\u0431\u044B \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438." })] }), _jsxs("span", { className: "dbs-panel__scope", children: [integrations.filter((item) => item.ready).length, " \u0433\u043E\u0442\u043E\u0432\u043E"] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, _jsxs("div", { className: "dbs-setup-layout", children: [_jsxs("form", { className: "dbs-setup-form", onSubmit: submit, children: [_jsxs("header", { className: "dbs-setup-form__heading", children: [_jsx("span", { children: _jsx(PlugZap, { size: 20, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0411\u044B\u0441\u0442\u0440\u0430\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430" }), _jsx("h3", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 \u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430" })] })] }), _jsxs("section", { className: "dbs-form-section", children: [_jsxs("div", { className: "dbs-form-section__title", children: [_jsx("span", { children: "1" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("small", { children: "\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u043F\u043E\u0434\u0441\u0442\u0430\u0432\u044F\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] })] }), _jsxs("div", { className: "dbs-form-grid", children: [_jsxs("label", { className: "dbs-form-field dbs-form-field--wide", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: form.clientId, onChange: (event) => selectClient(event.target.value), required: true, disabled: loading, children: [!clients.length ? _jsx("option", { value: "", children: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432" }) : null, clients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))] })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044C" }), _jsx("input", { value: form.senderName, onChange: (event) => setForm({ ...form, senderName: event.target.value }), required: true })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0430\u043A\u0442\u043D\u043E\u0435 \u043B\u0438\u0446\u043E" }), _jsx("input", { value: form.contactName, onChange: (event) => setForm({ ...form, contactName: event.target.value }) })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: form.phone, onChange: (event) => setForm({ ...form, phone: event.target.value }), required: true })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", value: form.email, onChange: (event) => setForm({ ...form, email: event.target.value }) })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438" }), _jsx("input", { value: form.city, onChange: (event) => setForm({ ...form, city: event.target.value }), required: true })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u0418\u043D\u0434\u0435\u043A\u0441" }), _jsx("input", { value: form.postalCode, onChange: (event) => setForm({ ...form, postalCode: event.target.value }) })] }), _jsxs("label", { className: "dbs-form-field dbs-form-field--wide", children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441 \u0437\u0430\u0431\u043E\u0440\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("input", { value: form.address, onChange: (event) => setForm({ ...form, address: event.target.value }), required: true })] })] })] }), _jsxs("section", { className: "dbs-form-section", children: [_jsxs("div", { className: "dbs-form-section__title", children: [_jsx("span", { children: "2" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0421\u043B\u0443\u0436\u0431\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("small", { children: "\u0414\u043E\u0441\u0442\u0443\u043F \u043A API \u043A\u0443\u0440\u044C\u0435\u0440\u0441\u043A\u043E\u0439 \u0441\u043B\u0443\u0436\u0431\u044B" })] })] }), _jsxs("div", { className: "dbs-form-grid", children: [_jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u0421\u043B\u0443\u0436\u0431\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("select", { value: form.deliveryProvider, onChange: (event) => setForm({ ...form, deliveryProvider: event.target.value }), children: deliveryProviders.map((provider) => _jsx("option", { value: provider.value, children: provider.label }, provider.value)) })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "ID \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 / \u043B\u043E\u0433\u0438\u043D" }), _jsx("input", { value: form.deliveryAccountId, onChange: (event) => setForm({ ...form, deliveryAccountId: event.target.value }) })] }), form.deliveryProvider === 'OTHER' ? _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441\u043B\u0443\u0436\u0431\u044B" }), _jsx("input", { value: form.deliveryServiceName, onChange: (event) => setForm({ ...form, deliveryServiceName: event.target.value }), required: true })] }) : null, _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441 API (\u0435\u0441\u043B\u0438 \u0441\u0432\u043E\u0439)" }), _jsx("input", { value: form.deliveryApiUrl, onChange: (event) => setForm({ ...form, deliveryApiUrl: event.target.value }), placeholder: "https://api.delivery.ru" })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: form.id ? 'Новый API-ключ' : 'API-ключ' }), _jsx("input", { type: "password", autoComplete: "new-password", value: form.deliveryApiKey, onChange: (event) => setForm({ ...form, deliveryApiKey: event.target.value }), placeholder: currentIntegration?.deliveryApiKeyMask || '', required: !form.id })] }), _jsxs("label", { className: "dbs-form-field", children: [_jsx("span", { children: form.id ? 'Новый секрет' : 'Секрет API' }), _jsx("input", { type: "password", autoComplete: "new-password", value: form.deliveryApiSecret, onChange: (event) => setForm({ ...form, deliveryApiSecret: event.target.value }), placeholder: currentIntegration?.hasDeliveryApiSecret ? 'Секрет сохранён' : 'Если требуется службой' })] })] })] }), _jsxs("div", { className: "dbs-form-readiness", children: [_jsx(StatusLine, { ok: Boolean(selectedClient), label: "\u041A\u043B\u0438\u0435\u043D\u0442 \u0432\u044B\u0431\u0440\u0430\u043D" }), _jsx(StatusLine, { ok: currentIntegration?.hasMarketplaceApi ?? false, label: `API ${marketplace.eyebrow} в карточке клиента` }), _jsx(StatusLine, { ok: Boolean(form.deliveryApiKey || currentIntegration?.hasDeliveryApiKey), label: "API \u0441\u043B\u0443\u0436\u0431\u044B \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" })] }), _jsxs("footer", { className: "dbs-setup-form__footer", children: [_jsxs("label", { className: "dbs-active-toggle", children: [_jsx("input", { type: "checkbox", checked: form.isActive, onChange: (event) => setForm({ ...form, isActive: event.target.checked }) }), _jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u043E" })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: !canWrite || saving || loading || !form.clientId || (!form.id && form.deliveryApiKey.trim().length < 8), children: [_jsx(Save, { size: 17, "aria-hidden": "true" }), saving ? 'Сохраняю…' : 'Сохранить и проверить'] })] }), !canWrite ? _jsx("p", { className: "dbs-form-note", children: "\u0414\u043B\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043F\u0440\u0430\u0432\u043E \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432." }) : null] }), _jsxs("aside", { className: "dbs-configured", "aria-label": "\u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B DBS", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F" }), _jsx("h3", { children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" })] }), _jsx("strong", { children: integrations.length })] }), _jsxs("div", { className: "dbs-configured__list", children: [integrations.map((integration) => (_jsxs("button", { type: "button", className: integration.id === form.id ? 'is-selected' : '', onClick: () => setForm(formFromIntegration(integration)), children: [_jsx("span", { className: `dbs-configured__status ${integration.ready ? 'is-ready' : 'is-warning'}`, children: integration.ready ? _jsx(CheckCircle2, { size: 18 }) : _jsx(CircleAlert, { size: 18 }) }), _jsxs("span", { children: [_jsx("strong", { children: integration.client.name }), _jsxs("small", { children: [deliveryProviderLabel(integration), " \u00B7 ", integration.city] }), _jsx("em", { children: integration.ready ? 'Готово к работе' : integration.lastCheckMessage || 'Требуется проверка' })] }), _jsx(ChevronRight, { size: 17, "aria-hidden": "true" })] }, integration.id))), !integrations.length && !loading ? _jsxs("div", { className: "dbs-configured__empty", children: [_jsx(KeyRound, { size: 25 }), _jsx("strong", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0444\u043E\u0440\u043C\u0443." })] }) : null] }), _jsxs("div", { className: "dbs-workspace-shell__steps", children: [_jsxs("span", { children: [_jsx(ShoppingBag, { size: 18 }), "\u0417\u0430\u043A\u0430\u0437\u044B"] }), _jsxs("span", { children: [_jsx(PackageCheck, { size: 18 }), "\u0421\u0431\u043E\u0440\u043A\u0430"] }), _jsxs("span", { children: [_jsx(Truck, { size: 18 }), "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430"] })] })] })] })] }));
}
function StatusLine({ ok, label }) {
    return _jsxs("span", { className: ok ? 'is-ok' : 'is-missing', children: [ok ? _jsx(CheckCircle2, { size: 16 }) : _jsx(CircleAlert, { size: 16 }), label] });
}
function formForClient(clientId, clients, integrations) {
    const integration = integrations.find((item) => item.clientId === clientId);
    if (integration)
        return formFromIntegration(integration);
    const client = clients.find((item) => item.id === clientId);
    return {
        ...emptyForm,
        clientId,
        senderName: client?.legalName || client?.name || '',
        contactName: client?.fulfillmentManager?.name || '',
        phone: client?.phone || '',
        email: client?.email || '',
        address: client?.actualAddress || client?.legalAddress || '',
    };
}
function formFromIntegration(integration) {
    return {
        id: integration.id,
        clientId: integration.clientId,
        senderName: integration.senderName,
        contactName: integration.contactName || '',
        phone: integration.phone,
        email: integration.email || '',
        city: integration.city,
        address: integration.address,
        postalCode: integration.postalCode || '',
        deliveryProvider: integration.deliveryProvider,
        deliveryServiceName: integration.deliveryServiceName || '',
        deliveryApiUrl: integration.deliveryApiUrl || '',
        deliveryAccountId: integration.deliveryAccountId || '',
        deliveryApiKey: '',
        deliveryApiSecret: '',
        isActive: integration.isActive,
    };
}
function deliveryProviderLabel(integration) {
    if (integration.deliveryProvider === 'OTHER')
        return integration.deliveryServiceName || 'Другая служба';
    return deliveryProviders.find((item) => item.value === integration.deliveryProvider)?.label || integration.deliveryProvider;
}
