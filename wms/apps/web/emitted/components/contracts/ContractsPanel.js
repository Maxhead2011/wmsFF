import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, CheckCircle2, Download, FilePlus2, FileSignature, FileText, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createClientContract, checkClientContractRequisites, downloadClientContract, downloadContractAdditionalAgreement, fetchContractClients, fetchContracts, refreshClientContractRequisites, uploadContractAdditionalAgreement, uploadSignedClientContract, } from '../../lib/api';
import './contracts.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ContractsPanel({ session }) {
    const canCreate = canUse(session, 'billing:write');
    const [contracts, setContracts] = useState([]);
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [contractDate, setContractDate] = useState(today());
    const [contractNumber, setContractNumber] = useState('');
    const [wmsUrl, setWmsUrl] = useState('https://wms.logoff.pro');
    const [wmsLogin, setWmsLogin] = useState('');
    const [wmsPassword, setWmsPassword] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [requisitesCheck, setRequisitesCheck] = useState(null);
    useEffect(() => {
        void load();
    }, []);
    const selectedClient = useMemo(() => clients.find((client) => client.id === clientId), [clientId, clients]);
    async function load() {
        setBusy('load');
        setError('');
        try {
            const [nextContracts, nextClients] = await Promise.all([
                fetchContracts(session.accessToken),
                fetchContractClients(session.accessToken),
            ]);
            setContracts(nextContracts);
            setClients(nextClients);
            if (!clientId && nextClients.length === 1) {
                selectClient(nextClients[0], false);
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    function selectClient(client, updateId = true) {
        if (updateId) {
            setClientId(client?.id ?? '');
        }
        setWmsLogin(client?.suggestedLogin ?? '');
    }
    async function submit(event) {
        event.preventDefault();
        if (!clientId || !wmsLogin.trim() || !wmsPassword) {
            setError('Выберите клиента и заполните логин и пароль WMS для договора.');
            return;
        }
        setBusy('create');
        setError('');
        setMessage('');
        try {
            const created = await createClientContract(session.accessToken, {
                clientId,
                contractDate,
                contractNumber: contractNumber.trim() || undefined,
                wmsUrl,
                wmsLogin,
                wmsPassword,
            });
            setContracts((current) => [created, ...current]);
            setWmsPassword('');
            setContractNumber('');
            setMessage(`Договор №${created.number} создан. PDF готов к скачиванию.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function download(contract, signed = false) {
        setBusy(`download-${contract.id}-${signed}`);
        setError('');
        try {
            const blob = await downloadClientContract(session.accessToken, contract.id, signed);
            downloadBlob(blob, signed ? contract.signedFileName || `Подписанный ${contract.fileName}` : contract.fileName);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function uploadSigned(contract, event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file)
            return;
        setBusy(`signed-${contract.id}`);
        setError('');
        try {
            const updated = await uploadSignedClientContract(session.accessToken, contract.id, file);
            replaceContract(updated);
            setMessage(`Подписанный договор №${updated.number} загружен.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function uploadAgreement(contract, event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file)
            return;
        setBusy(`agreement-${contract.id}`);
        setError('');
        try {
            const updated = await uploadContractAdditionalAgreement(session.accessToken, contract.id, file);
            replaceContract(updated);
            setMessage(`Дополнительное соглашение добавлено к договору №${updated.number}.`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function downloadAgreement(contract, attachmentId, fileName) {
        setBusy(`attachment-${attachmentId}`);
        setError('');
        try {
            const blob = await downloadContractAdditionalAgreement(session.accessToken, contract.id, attachmentId);
            downloadBlob(blob, fileName);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function checkRequisites(contract) {
        setBusy(`check-${contract.id}`);
        setError('');
        setMessage('');
        try {
            const result = await checkClientContractRequisites(session.accessToken, contract.id);
            if (result.upToDate) {
                setMessage(`Договор №${contract.number} проверен: реквизиты актуальны, замен не требуется.`);
                return;
            }
            setRequisitesCheck({
                contract,
                result,
                wmsPassword: '',
                status: 'ready',
            });
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy('');
        }
    }
    async function applyRequisitesRefresh() {
        if (!requisitesCheck || requisitesCheck.status === 'applying')
            return;
        if (!requisitesCheck.wmsPassword.trim()) {
            setRequisitesCheck((current) => current ? { ...current, error: 'Введите актуальный пароль WMS для нового исходного PDF.' } : current);
            return;
        }
        setRequisitesCheck((current) => current ? { ...current, status: 'applying', error: undefined } : current);
        try {
            const result = await refreshClientContractRequisites(session.accessToken, requisitesCheck.contract.id, {
                expectedFingerprint: requisitesCheck.result.fingerprint,
                wmsPassword: requisitesCheck.wmsPassword,
            });
            replaceContract(result.contract);
            setRequisitesCheck(null);
            setMessage(`В договоре №${result.contract.number} обновлено полей: ${result.appliedChanges.length}. ` +
                (result.signedFilePreserved
                    ? 'Исходный PDF пересоздан, ранее загруженный подписанный экземпляр сохранён без изменений.'
                    : 'Исходный PDF пересоздан.'));
        }
        catch (caught) {
            setRequisitesCheck((current) => current ? { ...current, status: 'ready', error: errorMessage(caught) } : current);
        }
    }
    function replaceContract(updated) {
        setContracts((current) => current.map((contract) => (contract.id === updated.id ? updated : contract)));
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u043E\u0431\u043E\u0440\u043E\u0442", title: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u044B", description: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u2014 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435, \u0440\u0430\u0431\u043E\u0442\u0430 \u0441 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u043C\u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u0438\u043B\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u043E\u0432.", tiles: [
            { title: 'Создать договор', description: 'Сформировать договор с данными клиента и доступом к WMS.', icon: FilePlus2, tone: 'red' },
            { title: 'Подписанные документы', description: 'Загрузить, скачать и хранить оригиналы договоров.', icon: FileSignature, tone: 'violet' },
            { title: 'Проверка реквизитов', description: 'Сверить договор с актуальными данными клиента.', icon: ShieldCheck, tone: 'green' },
        ], children: _jsxs("section", { className: "contracts-panel", "aria-label": "\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u044B", children: [_jsxs("div", { className: "section-heading contracts-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u043E\u0431\u043E\u0440\u043E\u0442" }), _jsx("h2", { children: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u044B \u0441 \u043A\u043B\u0438\u0435\u043D\u0442\u0430\u043C\u0438" }), _jsx("p", { children: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0435, \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0435 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u044B \u0438 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0432 WMS." })] }), _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void load(), disabled: busy === 'load', children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), error ? _jsx("div", { className: "contracts-alert contracts-alert--error", children: error }) : null, message ? _jsx("div", { className: "contracts-alert contracts-alert--success", children: message }) : null, canCreate ? (_jsxs("form", { className: "contract-create-card", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "contract-create-card__title", children: [_jsx(FileSignature, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0434\u043E\u0433\u043E\u0432\u043E\u0440" }), _jsx("span", { children: "\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: \u043E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u0418\u041F \u0413\u043E\u0432\u043E\u0440\u043E\u0432\u0430 \u0415.\u0410." })] })] }), _jsxs("div", { className: "contract-create-grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => selectClient(clients.find((client) => client.id === event.target.value)), required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.legalName || client.name, client.inn ? ` · ИНН ${client.inn}` : ''] }, client.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430" }), _jsx("input", { type: "date", value: contractDate, onChange: (event) => setContractDate(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u043E\u043C\u0435\u0440 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430" }), _jsx("input", { value: contractNumber, onChange: (event) => setContractNumber(event.target.value), placeholder: "\u041E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043F\u0443\u0441\u0442\u044B\u043C \u2014 \u043D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441 WMS" }), _jsx("input", { type: "url", value: wmsUrl, onChange: (event) => setWmsUrl(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041B\u043E\u0433\u0438\u043D WMS" }), _jsx("input", { value: wmsLogin, onChange: (event) => setWmsLogin(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0430\u0440\u043E\u043B\u044C WMS \u0434\u043B\u044F \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430" }), _jsx("input", { type: "text", autoComplete: "off", value: wmsPassword, onChange: (event) => setWmsPassword(event.target.value), required: true })] })] }), _jsxs("div", { className: "contract-create-card__footer", children: [_jsxs("span", { children: [selectedClient ? `Договор будет создан для ${selectedClient.legalName || selectedClient.name}. ` : '', "\u041F\u0430\u0440\u043E\u043B\u044C \u043F\u043E\u043F\u0430\u0434\u0451\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432 PDF \u0438 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u0432 \u0431\u0430\u0437\u0435 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F."] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: busy === 'create', children: [_jsx(FilePlus2, { size: 17, "aria-hidden": "true" }), busy === 'create' ? 'Формирую PDF…' : 'Создать договор'] })] })] })) : null, _jsxs("div", { className: "contracts-list", children: [contracts.length === 0 && busy !== 'load' ? (_jsxs("div", { className: "contracts-empty", children: [_jsx(FileText, { size: 26, "aria-hidden": "true" }), _jsx("strong", { children: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }), _jsx("span", { children: canCreate ? 'Выберите клиента и создайте первый договор.' : 'Когда договор будет создан, он появится здесь.' })] })) : null, contracts.map((contract) => (_jsxs("article", { className: `contract-card ${contract.status === 'SIGNED' ? 'contract-card--signed' : ''}`, children: [_jsxs("div", { className: "contract-card__top", children: [_jsxs("div", { className: "contract-card__identity", children: [_jsx("span", { className: "contract-card__icon", children: _jsx(FileText, { size: 20, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("strong", { children: ["\u0414\u043E\u0433\u043E\u0432\u043E\u0440 \u2116", contract.number] }), _jsxs("span", { children: [contract.client.legalName || contract.client.name, " \u00B7 ", contract.client.code] })] })] }), _jsxs("span", { className: `contract-status contract-status--${contract.status === 'SIGNED' ? 'signed' : 'waiting'}`, children: [contract.status === 'SIGNED' ? _jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }) : _jsx(FileSignature, { size: 15, "aria-hidden": "true" }), contract.status === 'SIGNED' ? 'Подписан' : 'Ожидает подписи'] })] }), _jsxs("div", { className: "contract-card__meta", children: [_jsxs("span", { children: [_jsx("b", { children: "\u0414\u0430\u0442\u0430:" }), " ", formatDate(contract.contractDate)] }), _jsxs("span", { children: [_jsx("b", { children: "\u0421\u043E\u0437\u0434\u0430\u043D:" }), " ", formatDateTime(contract.createdAt)] }), _jsxs("span", { children: [_jsx("b", { children: "\u041B\u043E\u0433\u0438\u043D WMS:" }), " ", contract.wmsLogin] }), _jsxs("span", { children: [_jsx("b", { children: "\u0414\u043E\u043F. \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0439:" }), " ", contract.attachments.length] })] }), _jsxs("div", { className: "contract-card__actions", children: [_jsxs("button", { type: "button", onClick: () => void download(contract), children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), " \u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 PDF"] }), canCreate ? (_jsxs("button", { className: "contract-requisites-check-button", type: "button", onClick: () => void checkRequisites(contract), disabled: busy === `check-${contract.id}`, children: [_jsx(ShieldCheck, { size: 16, "aria-hidden": "true" }), busy === `check-${contract.id}` ? 'Проверяю реквизиты…' : 'Проверить договор'] })) : null, contract.signedUploadedAt ? (_jsxs("button", { type: "button", onClick: () => void download(contract, true), children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), " \u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0439"] })) : null, _jsxs("label", { className: "contract-upload-button", children: [_jsx(Upload, { size: 16, "aria-hidden": "true" }), contract.signedUploadedAt ? 'Заменить подписанный' : 'Загрузить подписанный договор', _jsx("input", { type: "file", accept: "application/pdf,.pdf", onChange: (event) => void uploadSigned(contract, event) })] }), _jsxs("label", { className: "contract-upload-button contract-upload-button--secondary", children: [_jsx(FilePlus2, { size: 16, "aria-hidden": "true" }), "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043F. \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435", _jsx("input", { type: "file", accept: "application/pdf,.pdf", onChange: (event) => void uploadAgreement(contract, event) })] })] }), contract.attachments.length > 0 ? (_jsxs("div", { className: "contract-attachments", children: [_jsx("strong", { children: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F" }), contract.attachments.map((attachment) => (_jsxs("button", { type: "button", onClick: () => void downloadAgreement(contract, attachment.id, attachment.fileName), children: [_jsx(FileText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: attachment.fileName }), _jsxs("small", { children: [formatFileSize(attachment.fileSize), " \u00B7 ", formatDateTime(attachment.createdAt)] }), _jsx(Download, { size: 15, "aria-hidden": "true" })] }, attachment.id)))] })) : null] }, contract.id)))] }), requisitesCheck ? (_jsx("div", { className: "contract-check-backdrop", role: "presentation", children: _jsxs("section", { className: "contract-check-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "contract-check-title", children: [_jsxs("header", { className: "contract-check-dialog__header", children: [_jsxs("div", { children: [_jsx("span", { className: "contract-check-dialog__icon", children: _jsx(ShieldCheck, { size: 21, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("h3", { id: "contract-check-title", children: ["\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0432 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0435 \u2116", requisitesCheck.contract.number] }), _jsx("p", { children: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u0432\u0448\u0438\u0435\u0441\u044F \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B." })] })] }), _jsx("button", { type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430", onClick: () => setRequisitesCheck(null), disabled: requisitesCheck.status === 'applying', children: _jsx(X, { size: 19, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "contract-check-dialog__summary", children: ["\u041D\u0430\u0439\u0434\u0435\u043D\u043E \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439: ", _jsx("strong", { children: requisitesCheck.result.changes.length })] }), _jsx("div", { className: "contract-requisites-changes", children: requisitesCheck.result.changes.map((change) => (_jsxs("article", { children: [_jsxs("div", { className: "contract-requisites-changes__label", children: [_jsx("span", { children: change.party === 'CLIENT' ? 'Заказчик' : 'Исполнитель' }), _jsx("strong", { children: change.label })] }), _jsxs("div", { className: "contract-requisites-changes__values", children: [_jsx("span", { title: change.oldValue ?? 'Не заполнено', children: change.oldValue || 'Не заполнено' }), _jsx(ArrowRight, { size: 16, "aria-hidden": "true" }), _jsx("strong", { title: change.newValue ?? 'Будет очищено', children: change.newValue || 'Будет очищено' })] })] }, `${change.party}-${change.field}`))) }), requisitesCheck.result.signedFilePresent ? (_jsx("div", { className: "contract-check-dialog__signed-warning", children: "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0439 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u043C PDF \u0443\u0436\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D. \u041E\u043D \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0438\u0441\u0430\u043D \u0438\u043B\u0438 \u0443\u0434\u0430\u043B\u0451\u043D; \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 PDF." })) : null, _jsxs("label", { className: "contract-check-dialog__password", children: [_jsx("span", { children: "\u0410\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C WMS \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0433\u043E PDF" }), _jsx("input", { type: "text", autoComplete: "off", value: requisitesCheck.wmsPassword, onChange: (event) => setRequisitesCheck((current) => current ? { ...current, wmsPassword: event.target.value, error: undefined } : current), placeholder: "\u041F\u0430\u0440\u043E\u043B\u044C \u043D\u0435 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0438 \u043D\u0443\u0436\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F PDF", disabled: requisitesCheck.status === 'applying' })] }), requisitesCheck.error ? (_jsx("div", { className: "contracts-alert contracts-alert--error", children: requisitesCheck.error })) : null, _jsxs("footer", { className: "contract-check-dialog__footer", children: [_jsx("button", { type: "button", className: "contract-check-dialog__cancel", onClick: () => setRequisitesCheck(null), disabled: requisitesCheck.status === 'applying', children: "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043C\u0435\u043D\u044F\u0442\u044C" }), _jsxs("button", { type: "button", className: "primary-button", onClick: () => void applyRequisitesRefresh(), disabled: requisitesCheck.status === 'applying', children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), requisitesCheck.status === 'applying' ? 'Обновляю PDF…' : 'Подтвердить замены'] })] })] }) })) : null] }) }));
}
function canUse(session, permission) {
    return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}
function today() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}
function formatDate(value) {
    return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function formatFileSize(value) {
    if (value < 1024 * 1024)
        return `${Math.max(1, Math.round(value / 1024))} КБ`;
    return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию с договором.';
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
