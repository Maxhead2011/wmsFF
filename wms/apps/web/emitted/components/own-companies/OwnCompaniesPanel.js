import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Building2, Edit3, FileImage, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createOwnCompany, deleteOwnCompanyAsset, fetchClients, fetchOwnCompanies, updateClient, updateOwnCompany, uploadOwnCompanyAsset, } from '../../lib/api';
import { RequisitesDocumentImport } from '../requisites/RequisitesDocumentImport';
import './own-companies.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
function emptyForm() {
    return {
        id: null,
        shortName: '',
        fullName: '',
        inn: '',
        kpp: '',
        ogrn: '',
        legalAddress: '',
        bankAccounts: [],
        paymentCode: '',
        paymentPurposeCode: '',
        isDefault: false,
        isActive: true,
        comment: '',
    };
}
function emptyBankAccount(isDefault = false) {
    return {
        key: `bank-${Date.now()}-${Math.random()}`,
        bankName: '',
        bankBik: '',
        bankInn: '',
        bankKpp: '',
        bankAccount: '',
        correspondentAccount: '',
        isDefault,
        comment: '',
    };
}
export function OwnCompaniesPanel({ session }) {
    const canWrite = canUse(session.user, 'billing:write');
    const [companies, setCompanies] = useState([]);
    const [clients, setClients] = useState([]);
    const [form, setForm] = useState(() => emptyForm());
    const [stampFile, setStampFile] = useState(null);
    const [signatureFile, setSignatureFile] = useState(null);
    const [busyClientId, setBusyClientId] = useState('');
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const defaultCompany = useMemo(() => companies.find((company) => company.isDefault), [companies]);
    useEffect(() => {
        void loadCompanies();
    }, []);
    if (!canUse(session.user, 'billing:read')) {
        return null;
    }
    async function loadCompanies() {
        setStatus('loading');
        setError(null);
        try {
            const [nextCompanies, nextClients] = await Promise.all([
                fetchOwnCompanies(session.accessToken),
                fetchClients(session.accessToken),
            ]);
            setCompanies(nextCompanies);
            setClients(nextClients);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setStatus('idle');
        }
    }
    async function submit(event) {
        event.preventDefault();
        if (!canWrite) {
            return;
        }
        setStatus('saving');
        setError(null);
        setMessage('');
        try {
            const payload = formToPayload(form);
            let saved = form.id
                ? await updateOwnCompany(session.accessToken, form.id, payload)
                : await createOwnCompany(session.accessToken, payload);
            if (stampFile) {
                saved = await uploadOwnCompanyAsset(session.accessToken, saved.id, 'stamp', stampFile);
            }
            if (signatureFile) {
                saved = await uploadOwnCompanyAsset(session.accessToken, saved.id, 'signature', signatureFile);
            }
            setCompanies((current) => [saved, ...current.filter((company) => company.id !== saved.id)].sort(sortCompanies));
            setForm(emptyForm());
            setStampFile(null);
            setSignatureFile(null);
            await loadCompanies();
            setMessage('Реквизиты, печать и факсимиле сохранены.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setStatus('idle');
        }
    }
    function edit(company) {
        setForm({
            id: company.id,
            shortName: company.shortName,
            fullName: company.fullName,
            inn: company.inn,
            kpp: company.kpp ?? '',
            ogrn: company.ogrn ?? '',
            legalAddress: company.legalAddress ?? '',
            bankAccounts: company.bankAccounts.length
                ? company.bankAccounts.map((account) => ({
                    key: account.id,
                    id: account.id,
                    bankName: account.bankName,
                    bankBik: account.bankBik,
                    bankInn: account.bankInn ?? '',
                    bankKpp: account.bankKpp ?? '',
                    bankAccount: account.bankAccount,
                    correspondentAccount: account.correspondentAccount ?? '',
                    isDefault: account.isDefault,
                    comment: account.comment ?? '',
                }))
                : company.bankAccount
                    ? [{
                            ...emptyBankAccount(true),
                            bankName: company.bankName ?? '',
                            bankBik: company.bankBik ?? '',
                            bankAccount: company.bankAccount,
                            correspondentAccount: company.correspondentAccount ?? '',
                        }]
                    : [],
            paymentCode: company.paymentCode ?? '',
            paymentPurposeCode: company.paymentPurposeCode ?? '',
            isDefault: company.isDefault,
            isActive: company.isActive,
            comment: company.comment ?? '',
        });
        setMessage('');
        setStampFile(null);
        setSignatureFile(null);
    }
    async function assignCompany(client, ownCompanyId) {
        setBusyClientId(client.id);
        setError(null);
        try {
            const updated = await updateClient(session.accessToken, client.id, { ownCompanyId });
            setClients((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setMessage(`Для клиента ${client.name} выбрана компания ${updated.ownCompany?.shortName ?? ''}.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusyClientId('');
        }
    }
    async function removeAsset(company, kind) {
        if (!window.confirm(`Удалить ${kind === 'stamp' ? 'печать' : 'факсимиле'} у ${company.shortName}?`)) {
            return;
        }
        try {
            const updated = await deleteOwnCompanyAsset(session.accessToken, company.id, kind);
            setCompanies((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B", title: "\u0421\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438", description: "\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u0439\u0442\u0435 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u0430\u043C\u0438, \u0440\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u043C\u0438 \u0441\u0447\u0435\u0442\u0430\u043C\u0438 \u0438 \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u043E\u0439 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438 \u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u0438\u0437 \u043E\u0434\u043D\u043E\u0433\u043E \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043C\u0435\u0441\u0442\u0430.", tiles: [
            { title: 'Компания и реквизиты', description: 'Создать или изменить юридические данные компании.', icon: Building2, tone: 'blue' },
            { title: 'Расчётные счета', description: 'Добавить счета и выбрать основной для выставления.', icon: Save, tone: 'green' },
            { title: 'Печать и подпись', description: 'Загрузить печать и факсимиле для документов.', icon: FileImage, tone: 'violet' },
        ], children: _jsxs("section", { className: "own-companies-panel", "aria-label": "\u0421\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438", children: [_jsxs("div", { className: "section-heading own-companies-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B" }), _jsx("h2", { children: "\u0421\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadCompanies(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] }), defaultCompany ? (_jsxs("div", { className: "own-companies-default", children: [_jsx(Building2, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u0434\u043B\u044F \u0441\u0447\u0435\u0442\u043E\u0432 \u0438 \u0430\u043A\u0442\u043E\u0432" }), _jsx("strong", { children: defaultCompany.shortName }), _jsxs("small", { children: ["\u0440/\u0441 ", defaultCompany.bankAccount || 'не указан'] })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, _jsxs("form", { className: "own-company-form", onSubmit: (event) => void submit(event), children: [_jsx(RequisitesDocumentImport, { accessToken: session.accessToken, target: "own-company", disabled: !canWrite || status === 'saving', onImported: (fields) => {
                                setForm((current) => ({
                                    ...current,
                                    shortName: fields.shortName || fields.name || current.shortName,
                                    fullName: fields.fullName || fields.legalName || current.fullName,
                                    inn: fields.inn || current.inn,
                                    kpp: fields.kpp || current.kpp,
                                    ogrn: fields.ogrn || current.ogrn,
                                    legalAddress: fields.legalAddress || current.legalAddress,
                                    bankAccounts: mergeImportedBankAccount(current.bankAccounts, fields),
                                }));
                                setError(null);
                                setMessage('Реквизиты распознаны. Проверьте заполненные поля перед сохранением.');
                            } }), _jsxs("div", { className: "own-company-form__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u0440\u0430\u0442\u043A\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: form.shortName, onChange: (event) => setFormValue('shortName', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u043D\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: form.fullName, onChange: (event) => setFormValue('fullName', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041D\u041D" }), _jsx("input", { required: true, value: form.inn, onChange: (event) => setFormValue('inn', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u041F\u041F" }), _jsx("input", { value: form.kpp, onChange: (event) => setFormValue('kpp', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0413\u0420\u041D / \u041E\u0413\u0420\u041D\u0418\u041F" }), _jsx("input", { value: form.ogrn, onChange: (event) => setFormValue('ogrn', event.target.value) })] }), _jsxs("label", { className: "own-company-form__wide", children: [_jsx("span", { children: "\u042E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0430\u0434\u0440\u0435\u0441" }), _jsx("input", { value: form.legalAddress, onChange: (event) => setFormValue('legalAddress', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434" }), _jsx("input", { value: form.paymentCode, onChange: (event) => setFormValue('paymentCode', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437. \u043F\u043B." }), _jsx("input", { value: form.paymentPurposeCode, onChange: (event) => setFormValue('paymentPurposeCode', event.target.value) })] }), _jsxs("label", { className: "own-company-form__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: form.comment, onChange: (event) => setFormValue('comment', event.target.value) })] }), _jsxs("label", { className: "own-company-form__asset", children: [_jsx("span", { children: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u043F\u0435\u0447\u0430\u0442\u0438 (PNG/JPEG)" }), _jsx("input", { type: "file", accept: "image/png,image/jpeg", onChange: (event) => setStampFile(event.target.files?.[0] ?? null) }), _jsx("small", { children: stampFile?.name ||
                                                (form.id ? companies.find((item) => item.id === form.id)?.stampFileName : '') ||
                                                'не загружена' })] }), _jsxs("label", { className: "own-company-form__asset", children: [_jsx("span", { children: "\u0424\u0430\u043A\u0441\u0438\u043C\u0438\u043B\u0435 / \u043F\u043E\u0434\u043F\u0438\u0441\u044C (PNG/JPEG)" }), _jsx("input", { type: "file", accept: "image/png,image/jpeg", onChange: (event) => setSignatureFile(event.target.files?.[0] ?? null) }), _jsx("small", { children: signatureFile?.name ||
                                                (form.id ? companies.find((item) => item.id === form.id)?.signatureFileName : '') ||
                                                'не загружено' })] })] }), _jsxs("section", { className: "own-company-bank-accounts", children: [_jsxs("div", { className: "own-company-bank-accounts__heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438" }), _jsx("small", { children: "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0441\u0447\u0451\u0442 \u0432\u044B\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u043D\u043E\u0432\u043E\u0433\u043E \u0441\u0447\u0451\u0442\u0430 \u043D\u0430 \u043E\u043F\u043B\u0430\u0442\u0443." })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: addBankAccount, children: [_jsx(Plus, { size: 16, "aria-hidden": "true" }), "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0440\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442"] })] }), form.bankAccounts.map((account, index) => (_jsxs("article", { className: "own-company-bank-account", children: [_jsxs("header", { children: [_jsxs("label", { className: "own-company-bank-account__default", children: [_jsx("input", { checked: account.isDefault, name: "default-bank-account", type: "radio", onChange: () => setDefaultBankAccount(account.key) }), _jsx("span", { children: account.isDefault ? 'Основной счёт' : `Счёт ${index + 1}` })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => removeBankAccount(account.key), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0440\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442", "aria-label": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0440\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442", children: _jsx(Trash2, { size: 16, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "own-company-bank-account__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u043D\u043A" }), _jsx("input", { required: true, value: account.bankName, onChange: (event) => updateBankAccount(account.key, { bankName: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0418\u041A \u0431\u0430\u043D\u043A\u0430" }), _jsx("input", { required: true, value: account.bankBik, onChange: (event) => updateBankAccount(account.key, { bankBik: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041D\u041D \u0431\u0430\u043D\u043A\u0430" }), _jsx("input", { value: account.bankInn, onChange: (event) => updateBankAccount(account.key, { bankInn: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u041F\u041F \u0431\u0430\u043D\u043A\u0430" }), _jsx("input", { value: account.bankKpp, onChange: (event) => updateBankAccount(account.key, { bankKpp: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u0441\u0447\u0451\u0442" }), _jsx("input", { required: true, value: account.bankAccount, onChange: (event) => updateBankAccount(account.key, { bankAccount: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u0440\u0435\u0441\u043F\u043E\u043D\u0434\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u0441\u0447\u0451\u0442" }), _jsx("input", { value: account.correspondentAccount, onChange: (event) => updateBankAccount(account.key, { correspondentAccount: event.target.value }) })] }), _jsxs("label", { className: "own-company-bank-account__comment", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 / \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: account.comment, placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0421\u0431\u0435\u0440\u0431\u0430\u043D\u043A, \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439", onChange: (event) => updateBankAccount(account.key, { comment: event.target.value }) })] })] })] }, account.key))), form.bankAccounts.length === 0 ? (_jsx("p", { className: "own-company-bank-accounts__empty", children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B." })) : null] }), _jsxs("div", { className: "own-company-form__checks", children: [_jsxs("label", { children: [_jsx("input", { checked: form.isDefault, type: "checkbox", onChange: (event) => setFormValue('isDefault', event.target.checked) }), _jsx("span", { children: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u0432 \u0441\u0447\u0435\u0442\u0430\u0445 \u0438 \u0430\u043A\u0442\u0430\u0445" })] }), _jsxs("label", { children: [_jsx("input", { checked: form.isActive, type: "checkbox", onChange: (event) => setFormValue('isActive', event.target.checked) }), _jsx("span", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u0430" })] })] }), _jsxs("div", { className: "own-company-form__actions", children: [_jsxs("button", { className: "primary-button", disabled: status === 'saving', type: "submit", children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), form.id ? 'Сохранить изменения' : 'Добавить компанию'] }), form.id ? (_jsx("button", { className: "secondary-button", type: "button", onClick: () => setForm(emptyForm()), children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C" })) : null] })] }), _jsx("div", { className: "own-companies-table-wrap", children: _jsxs("table", { className: "own-companies-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u043C\u043F\u0430\u043D\u0438\u044F" }), _jsx("th", { children: "\u0418\u041D\u041D" }), _jsx("th", { children: "\u0411\u0430\u043D\u043A" }), _jsx("th", { children: "\u0420\u0430\u0441\u0447\u0435\u0442\u043D\u044B\u0435 \u0441\u0447\u0435\u0442\u0430" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041F\u0435\u0447\u0430\u0442\u044C \u0438 \u043F\u043E\u0434\u043F\u0438\u0441\u044C" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsxs("tbody", { children: [companies.map((company) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: company.shortName }), _jsx("span", { children: company.fullName })] }), _jsx("td", { children: company.inn }), _jsxs("td", { children: [_jsx("span", { children: company.bankName || '-' }), _jsxs("small", { children: ["\u0411\u0418\u041A ", company.bankBik || '-'] })] }), _jsx("td", { children: (company.bankAccounts.length ? company.bankAccounts : [null]).map((account, index) => account ? (_jsxs("small", { children: [account.isDefault ? 'Основной: ' : '', account.bankAccount, " \u00B7 ", account.bankName] }, account.id)) : (_jsx("small", { children: company.bankAccount || 'не указан' }, index))) }), _jsxs("td", { children: [_jsx("span", { className: `status status--${company.isActive ? 'ready' : 'planned'}`, children: company.isActive ? 'активна' : 'выключена' }), company.isDefault ? _jsx("span", { className: "status status--in-progress", children: "\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E" }) : null] }), _jsxs("td", { className: "own-company-assets", children: [_jsx("span", { children: company.hasStamp ? `✓ Печать: ${company.stampFileName}` : '— Печать не загружена' }), _jsx("span", { children: company.hasSignature ? `✓ Факсимиле: ${company.signatureFileName}` : '— Факсимиле не загружено' }), company.hasStamp ? (_jsx("button", { type: "button", className: "link-button", onClick: () => void removeAsset(company, 'stamp'), children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u0435\u0447\u0430\u0442\u044C" })) : null, company.hasSignature ? (_jsx("button", { type: "button", className: "link-button", onClick: () => void removeAsset(company, 'signature'), children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0444\u0430\u043A\u0441\u0438\u043C\u0438\u043B\u0435" })) : null] }), _jsx("td", { children: _jsx("button", { className: "icon-button", disabled: !canWrite, type: "button", onClick: () => edit(company), title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "aria-label": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", children: _jsx(Edit3, { size: 16, "aria-hidden": "true" }) }) })] }, company.id))), companies.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: status === 'loading' ? 'Загрузка...' : 'Компаний пока нет.' }) })) : null] })] }) }), companies.length > 0 ? (_jsxs("section", { className: "own-company-clients", children: [_jsxs("div", { children: [_jsx(FileImage, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041A\u0430\u043A\u0430\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0441 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u043C" }), _jsxs("p", { children: ["\u042D\u0442\u0430 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u0441\u0447\u0435\u0442\u0430\u0445, \u0430\u043A\u0442\u0430\u0445 \u0438 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430\u0445.", companies.filter((company) => company.isActive).length === 1
                                                    ? ' Единственная активная компания назначается автоматически.'
                                                    : ' Выберите компанию для каждого клиента.'] })] })] }), _jsx("div", { className: "own-company-clients__list", children: clients.map((client) => (_jsxs("label", { children: [_jsxs("span", { children: [client.name, _jsx("small", { children: client.legalName })] }), _jsxs("select", { value: client.ownCompanyId ?? '', disabled: !canWrite || busyClientId === client.id, onChange: (event) => void assignCompany(client, event.target.value), children: [_jsx("option", { value: "", disabled: true, children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044E" }), companies.filter((company) => company.isActive).map((company) => (_jsxs("option", { value: company.id, children: [company.shortName, " \u00B7 \u0418\u041D\u041D ", company.inn] }, company.id)))] })] }, client.id))) })] })) : null] }) }));
    function setFormValue(key, value) {
        setForm((current) => ({ ...current, [key]: value }));
    }
    function addBankAccount() {
        setForm((current) => ({
            ...current,
            bankAccounts: [
                ...current.bankAccounts,
                emptyBankAccount(current.bankAccounts.length === 0),
            ],
        }));
    }
    function updateBankAccount(key, patch) {
        setForm((current) => ({
            ...current,
            bankAccounts: current.bankAccounts.map((account) => account.key === key ? { ...account, ...patch } : account),
        }));
    }
    function setDefaultBankAccount(key) {
        setForm((current) => ({
            ...current,
            bankAccounts: current.bankAccounts.map((account) => ({
                ...account,
                isDefault: account.key === key,
            })),
        }));
    }
    function removeBankAccount(key) {
        setForm((current) => {
            const removed = current.bankAccounts.find((account) => account.key === key);
            const bankAccounts = current.bankAccounts.filter((account) => account.key !== key);
            if (removed?.isDefault && bankAccounts.length > 0) {
                bankAccounts[0] = { ...bankAccounts[0], isDefault: true };
            }
            return { ...current, bankAccounts };
        });
    }
}
function formToPayload(form) {
    const bankAccounts = form.bankAccounts.map((account) => ({
        id: account.id,
        bankName: account.bankName,
        bankBik: account.bankBik,
        bankInn: account.bankInn || undefined,
        bankKpp: account.bankKpp || undefined,
        bankAccount: account.bankAccount,
        correspondentAccount: account.correspondentAccount || undefined,
        isDefault: account.isDefault,
        comment: account.comment || undefined,
    }));
    const defaultAccount = bankAccounts.find((account) => account.isDefault) ?? bankAccounts[0];
    return {
        shortName: form.shortName,
        fullName: form.fullName,
        inn: form.inn,
        kpp: form.kpp || undefined,
        ogrn: form.ogrn || undefined,
        legalAddress: form.legalAddress || undefined,
        bankName: defaultAccount?.bankName || undefined,
        bankBik: defaultAccount?.bankBik || undefined,
        bankAccount: defaultAccount?.bankAccount || undefined,
        correspondentAccount: defaultAccount?.correspondentAccount || undefined,
        paymentCode: form.paymentCode || undefined,
        paymentPurposeCode: form.paymentPurposeCode || undefined,
        isDefault: form.isDefault,
        isActive: form.isActive,
        comment: form.comment || undefined,
        bankAccounts,
    };
}
function mergeImportedBankAccount(accounts, fields) {
    if (!fields.bankName && !fields.bankBik && !fields.bankAccount && !fields.correspondentAccount) {
        return accounts;
    }
    const currentDefault = accounts.find((account) => account.isDefault) ?? accounts[0];
    const imported = {
        ...(currentDefault ?? emptyBankAccount(true)),
        bankName: fields.bankName || currentDefault?.bankName || '',
        bankBik: fields.bankBik || currentDefault?.bankBik || '',
        bankAccount: fields.bankAccount || currentDefault?.bankAccount || '',
        correspondentAccount: fields.correspondentAccount || currentDefault?.correspondentAccount || '',
    };
    if (!currentDefault) {
        return [imported];
    }
    return accounts.map((account) => (account.key === currentDefault.key ? imported : account));
}
function sortCompanies(left, right) {
    if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
    }
    return left.shortName.localeCompare(right.shortName, 'ru');
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить действие.';
}
