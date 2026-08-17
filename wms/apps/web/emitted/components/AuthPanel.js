import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Crown, Download, Eye, KeyRound, LogIn, ScanBarcode, ShieldPlus, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { bootstrapAdmin, login } from '../lib/api';
export function AuthPanel({ onSession, onBack }) {
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [bootstrapSecret, setBootstrapSecret] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    async function submit(event) {
        event.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const session = mode === 'login'
                ? await login({ email, password })
                : await bootstrapAdmin({
                    email,
                    name,
                    password,
                    bootstrapSecret,
                });
            onSession(session);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось выполнить вход.');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function enterDemo(kind) {
        setError('');
        setSubmitting(true);
        try {
            const credentials = kind === 'plus'
                ? { email: 'demo-plus', password: 'demo-plus' }
                : { email: 'demo', password: 'demo' };
            onSession(await login(credentials));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось открыть демонстрационный режим.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx("main", { className: "auth-shell", children: _jsxs("section", { className: "auth-panel", "aria-label": "\u0412\u0445\u043E\u0434 \u0432 LOGOFF WMS", children: [_jsxs("div", { className: "auth-panel__brand", children: [_jsx("p", { className: "eyebrow", children: "LOGOff WMS" }), _jsx("h1", { children: "\u0424\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442 LOGOff" }), onBack ? _jsx("button", { className: "auth-panel__back", type: "button", onClick: onBack, children: "\u2190 \u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E" }) : null] }), _jsxs("div", { className: "segmented-control", role: "tablist", "aria-label": "\u0420\u0435\u0436\u0438\u043C \u0432\u0445\u043E\u0434\u0430", children: [_jsxs("button", { className: mode === 'login' ? 'active' : '', type: "button", onClick: () => setMode('login'), children: [_jsx(LogIn, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0412\u0445\u043E\u0434" })] }), _jsxs("button", { className: mode === 'bootstrap' ? 'active' : '', type: "button", onClick: () => setMode('bootstrap'), children: [_jsx(ShieldPlus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0435\u0440\u0432\u044B\u0439 \u0430\u0434\u043C\u0438\u043D" })] })] }), _jsxs("form", { className: "auth-form", onSubmit: submit, children: [mode === 'bootstrap' ? (_jsxs("label", { children: [_jsx("span", { children: "\u0418\u043C\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }), _jsx("input", { autoComplete: "name", value: name, onChange: (event) => setName(event.target.value), required: true })] })) : null, _jsxs("label", { children: [_jsx("span", { children: mode === 'login' ? 'Логин или email' : 'Email' }), _jsx("input", { autoComplete: mode === 'login' ? 'username' : 'email', inputMode: mode === 'login' ? 'text' : 'email', type: mode === 'login' ? 'text' : 'email', value: email, onChange: (event) => setEmail(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0430\u0440\u043E\u043B\u044C" }), _jsx("input", { autoComplete: mode === 'login' ? 'current-password' : 'new-password', type: "password", value: password, onChange: (event) => setPassword(event.target.value), minLength: mode === 'bootstrap' ? 10 : 1, required: true })] }), mode === 'bootstrap' ? (_jsxs("label", { children: [_jsx("span", { children: "\u0421\u0435\u043A\u0440\u0435\u0442 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438" }), _jsx("input", { autoComplete: "off", type: "password", value: bootstrapSecret, onChange: (event) => setBootstrapSecret(event.target.value), minLength: 16, required: true })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button auth-submit", type: "submit", disabled: isSubmitting, children: [_jsx(KeyRound, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Проверка' : mode === 'login' ? 'Войти' : 'Создать администратора' })] })] }), mode === 'login' ? (_jsxs("div", { className: "demo-login-actions", children: [_jsxs("button", { className: "demo-login-button", type: "button", disabled: isSubmitting, onClick: () => void enterDemo('standard'), children: [_jsx(Eye, { size: 18, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0434\u0435\u043C\u043E-\u043A\u0430\u0431\u0438\u043D\u0435\u0442" }), _jsx("small", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u0440\u0435\u0436\u0438\u043C \u00B7 \u0434\u0435\u043C\u043E\u043D\u0441\u0442\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0438\u0437\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u043E\u0442 \u0440\u0430\u0431\u043E\u0447\u0438\u0445" })] })] }), _jsxs("button", { className: "demo-login-button demo-login-button--plus", type: "button", disabled: isSubmitting, onClick: () => void enterDemo('plus'), children: [_jsx(Crown, { size: 18, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u0414\u0435\u043C\u043E \u043F\u043B\u044E\u0441" }), _jsx("small", { children: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u043E\u0435 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u00B7 \u0432\u0441\u0435 \u0432\u0438\u0434\u044B \u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u044B \u0437\u0430\u043A\u0430\u0437\u043E\u0432" })] })] })] })) : null, _jsxs("div", { className: "auth-downloads", children: [_jsxs("a", { className: "mobile-app-download", href: "/downloads/logoff-tsd.apk", download: true, children: [_jsx(ScanBarcode, { size: 20, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C LOGOff \u0422\u0421\u0414" }), _jsx("small", { children: "\u041F\u0440\u0438\u0451\u043C\u043A\u0430, \u0441\u0431\u043E\u0440\u043A\u0430, \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0438 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u043A\u043E\u0440\u043E\u0431\u043E\u0432" })] }), _jsx(Download, { size: 18, "aria-hidden": "true" })] }), _jsxs("a", { className: "mobile-app-download", href: "/downloads/logoff-wms-mobile.apk", download: true, children: [_jsx(Smartphone, { size: 20, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "LOGOff WMS \u0434\u043B\u044F Android" }), _jsx("small", { children: "\u041A\u0430\u0431\u0438\u043D\u0435\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0435 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" })] }), _jsx(Download, { size: 18, "aria-hidden": "true" })] })] })] }) }));
}
