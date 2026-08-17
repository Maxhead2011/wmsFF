import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PlusCircle } from 'lucide-react';
import { useState } from 'react';
import { createBillingService, } from '../../lib/api';
import { billingUnitOptions } from './billingMeta';
export function BillingServiceForm({ session, onCreated }) {
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('SERVICE');
    const [defaultPriceRub, setDefaultPriceRub] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const service = await createBillingService(session.accessToken, {
                code,
                name,
                unit,
                defaultPriceRub: defaultPriceRub ? Number(defaultPriceRub) : undefined,
            });
            onCreated(service);
            setCode('');
            setName('');
            setDefaultPriceRub('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать услугу.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "billing-form", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "billing-fields billing-fields--service", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434" }), _jsx("input", { required: true, value: code, onChange: (event) => setCode(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430" }), _jsx("select", { value: unit, onChange: (event) => setUnit(event.target.value), children: billingUnitOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: defaultPriceRub, onChange: (event) => setDefaultPriceRub(event.target.value) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button billing-submit", disabled: isSubmitting, type: "submit", children: [_jsx(PlusCircle, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Создаю' : 'Создать услугу' })] })] }));
}
