import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowRight, ArrowRightLeft, Building2, FileSpreadsheet, MapPinned, MoreVertical, PackageCheck, Plus, RefreshCw, Save, ScanLine, Truck, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assignBranchManager, createBranch, createInterBranchTransfer, fetchBranches, fetchClients, fetchInterBranchTransfers, fetchOwnCompanies, fetchSkus, fetchUsers, previewInterBranchTransferBoxesFile, receiveInterBranchTransferBox, updateBranch, } from '../../lib/api';
import './branches.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function BranchesPanel({ session }) {
    const boxFileInputRef = useRef(null);
    const [branches, setBranches] = useState([]);
    const [clients, setClients] = useState([]);
    const [users, setUsers] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [skus, setSkus] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [targetWarehouseId, setTargetWarehouseId] = useState('');
    const [skuId, setSkuId] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [transferMode, setTransferMode] = useState('ITEMS');
    const [sourceBoxCodes, setSourceBoxCodes] = useState('');
    const [boxFilePreview, setBoxFilePreview] = useState(null);
    const [boxFileBusy, setBoxFileBusy] = useState(false);
    const [receiptBoxCodes, setReceiptBoxCodes] = useState({});
    const [comment, setComment] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [createForm, setCreateForm] = useState({ code: '', city: '', name: '', address: '', ownCompanyId: '' });
    const [settingsBranchId, setSettingsBranchId] = useState(null);
    const [settingsForm, setSettingsForm] = useState({
        name: '',
        city: '',
        address: '',
        ownCompanyId: '',
        managerUserId: '',
        sortOrder: '100',
        isActive: true,
    });
    const isAdmin = session.user.permissionCodes.includes('system:admin');
    const activeBranch = branches.find((branch) => branch.id === session.user.activeWarehouseId) ?? null;
    const settingsBranch = branches.find((branch) => branch.id === settingsBranchId) ?? null;
    async function loadBase() {
        setError('');
        try {
            const [nextBranches, nextClients, nextUsers, nextCompanies, nextTransfers] = await Promise.all([
                fetchBranches(session.accessToken),
                fetchClients(session.accessToken),
                isAdmin ? fetchUsers(session.accessToken) : Promise.resolve([]),
                isAdmin ? fetchOwnCompanies(session.accessToken) : Promise.resolve([]),
                fetchInterBranchTransfers(session.accessToken),
            ]);
            setBranches(nextBranches);
            setClients(nextClients);
            setUsers(nextUsers.filter((user) => user.status === 'ACTIVE' && !user.roles.some((role) => ['ADMIN', 'OWNER'].includes(role.role.code))));
            setCompanies(nextCompanies);
            setTransfers(nextTransfers);
            const nextClientId = clientId || nextClients[0]?.id || '';
            setClientId(nextClientId);
            if (!targetWarehouseId) {
                setTargetWarehouseId(nextBranches.find((branch) => branch.id !== session.user.activeWarehouseId)?.id ?? '');
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function loadClientData(nextClientId) {
        if (!nextClientId) {
            setSkus([]);
            return;
        }
        try {
            const nextSkus = await fetchSkus(session.accessToken, { clientId: nextClientId });
            setSkus(nextSkus);
            setSkuId((current) => nextSkus.some((sku) => sku.id === current) ? current : nextSkus[0]?.id ?? '');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    useEffect(() => {
        void loadBase();
    }, [session.accessToken]);
    useEffect(() => {
        void loadClientData(clientId);
    }, [clientId, session.accessToken]);
    useEffect(() => {
        setSourceBoxCodes('');
        setBoxFilePreview(null);
    }, [clientId, session.user.activeWarehouseId]);
    const inboundTransfers = useMemo(() => transfers.filter((transfer) => transfer.toWarehouse.id === activeBranch?.id &&
        ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED'].includes(transfer.status)), [activeBranch?.id, transfers]);
    async function previewBoxesFile(file) {
        if (!file || !activeBranch || !clientId)
            return;
        setTransferMode('BOXES');
        setBoxFileBusy(true);
        setBoxFilePreview(null);
        setSourceBoxCodes('');
        setError('');
        setMessage('');
        try {
            const preview = await previewInterBranchTransferBoxesFile(session.accessToken, {
                clientId,
                fromWarehouseId: activeBranch.id,
                file,
            });
            setBoxFilePreview(preview);
            setSourceBoxCodes(preview.validCodes.join('\n'));
            setMessage(preview.summary.readyBoxes
                ? `Файл проверен: готово к перемещению ${preview.summary.readyBoxes} коробов, ${preview.summary.totalQuantity} шт. товара.`
                : 'Файл проверен, но доступных для перемещения коробов не найдено.');
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBoxFileBusy(false);
            if (boxFileInputRef.current)
                boxFileInputRef.current.value = '';
        }
    }
    async function submitTransfer(event) {
        event.preventDefault();
        if (!activeBranch) {
            setError('Сначала выберите активный город в верхней панели.');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const transfer = await createInterBranchTransfer(session.accessToken, {
                clientId,
                fromWarehouseId: activeBranch.id,
                toWarehouseId: targetWarehouseId,
                ...(transferMode === 'BOXES'
                    ? {
                        sourceBoxCodes: sourceBoxCodes
                            .split(/[\s,;]+/)
                            .map((code) => code.trim())
                            .filter(Boolean),
                    }
                    : { items: [{ skuId, quantity: Number(quantity) }] }),
                comment,
            });
            setMessage(`Перемещение №${transfer.number} отправлено: ${transfer.fromWarehouse.city} → ${transfer.toWarehouse.city}. Остаток в городе назначения появится после сканирования коробов.`);
            setComment('');
            setSourceBoxCodes('');
            setBoxFilePreview(null);
            await Promise.all([loadBase(), loadClientData(clientId)]);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function receiveBox(transfer) {
        const boxCode = receiptBoxCodes[transfer.id]?.trim();
        if (!boxCode) {
            setError('Отсканируйте короб для приёмки.');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const received = await receiveInterBranchTransferBox(session.accessToken, transfer.id, boxCode);
            setReceiptBoxCodes((current) => ({ ...current, [transfer.id]: '' }));
            setMessage(received.status === 'RECEIVED'
                ? `Перемещение №${received.number} полностью принято в ${received.toWarehouse.city}.`
                : `Короб ${boxCode} принят. Ожидаются остальные короба перемещения №${received.number}.`);
            await Promise.all([loadBase(), loadClientData(clientId)]);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    async function submitBranch(event) {
        event.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await createBranch(session.accessToken, createForm);
            setCreateForm({ code: '', city: '', name: '', address: '', ownCompanyId: '' });
            setMessage('Новый филиал создан.');
            await loadBase();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    function openBranchSettings(branch) {
        const responsible = branch.userScopes?.find((scope) => scope.isResponsible)?.user;
        setSettingsBranchId(branch.id);
        setSettingsForm({
            name: branch.name,
            city: branch.city,
            address: branch.address || '',
            ownCompanyId: branch.ownCompanyId || '',
            managerUserId: responsible?.id || '',
            sortOrder: String(branch.sortOrder),
            isActive: branch.isActive,
        });
    }
    async function saveBranchSettings(event) {
        event.preventDefault();
        if (!settingsBranch)
            return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await updateBranch(session.accessToken, settingsBranch.id, {
                name: settingsForm.name,
                city: settingsForm.city,
                address: settingsForm.address,
                ownCompanyId: settingsForm.ownCompanyId || null,
                sortOrder: Number(settingsForm.sortOrder),
                isActive: settingsForm.isActive,
            });
            const previousManagerId = settingsBranch.userScopes?.find((scope) => scope.isResponsible)?.user.id || null;
            const nextManagerId = settingsForm.managerUserId || null;
            if (previousManagerId !== nextManagerId) {
                await assignBranchManager(session.accessToken, settingsBranch.id, nextManagerId);
            }
            setMessage(`Настройки филиала «${settingsForm.city}» сохранены.`);
            setSettingsBranchId(null);
            await loadBase();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u041E\u0431\u043E\u0441\u043E\u0431\u043B\u0435\u043D\u043D\u044B\u0435 \u043F\u043E\u0434\u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u044F", title: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B", description: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0430\u0431\u043E\u0442\u0443 \u0441 \u0444\u0438\u043B\u0438\u0430\u043B\u043E\u043C, \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435\u043C \u0442\u043E\u0432\u0430\u0440\u0430 \u0438\u043B\u0438 \u043F\u0440\u0438\u0451\u043C\u043A\u043E\u0439 \u043C\u0435\u0436\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u043E\u0439 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438.", tiles: [
            { title: 'Филиалы и настройки', description: 'Состав сети, ответственные, собственные компании и остатки.', icon: Building2, tone: 'blue' },
            { title: 'Перемещение между городами', description: 'Переместить товар или целые короба, включая загрузку Excel.', icon: ArrowRightLeft, tone: 'violet' },
            { title: 'Приёмка перемещения', description: 'Пропикать приехавшие короба и поставить остатки филиала.', icon: ScanLine, tone: 'green' },
        ], children: _jsxs("section", { className: "branches-panel", children: [_jsxs("div", { className: "branches-hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041E\u0431\u043E\u0441\u043E\u0431\u043B\u0435\u043D\u043D\u044B\u0435 \u043F\u043E\u0434\u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u044F" }), _jsx("h2", { children: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B \u0438 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u043C\u0435\u0436\u0434\u0443 \u0433\u043E\u0440\u043E\u0434\u0430\u043C\u0438" }), _jsx("p", { children: "\u041A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043E \u0441\u0432\u043E\u0438\u043C \u0424\u0424. \u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u0433\u043E\u0440\u043E\u0434 \u0441\u0432\u0435\u0440\u0445\u0443 \u0438 \u0432\u0438\u0434\u0438\u0442 \u0432\u0441\u044E \u0441\u0435\u0442\u044C \u0447\u0435\u0440\u0435\u0437 \u043E\u0434\u0438\u043D \u043B\u043E\u0433\u0438\u043D." })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void Promise.all([loadBase(), loadClientData(clientId)]), children: [_jsx(RefreshCw, { size: 16 }), " \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), message ? _jsx("p", { className: "branches-message branches-message--ok", children: message }) : null, error ? _jsx("p", { className: "branches-message branches-message--error", children: error }) : null, _jsx("div", { className: "branches-grid", children: branches.map((branch) => {
                        const stock = branch._stock;
                        const isActive = branch.id === session.user.activeWarehouseId;
                        const responsible = branch.userScopes?.find((scope) => scope.isResponsible)?.user ?? null;
                        return (_jsxs("article", { className: `branch-card ${isActive ? 'branch-card--active' : ''}`, children: [_jsxs("div", { className: "branch-card__head", children: [_jsx("span", { children: _jsx(MapPinned, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: branch.city }), _jsxs("small", { children: [branch.code, " \u00B7 ", branch.name] })] }), isActive ? _jsx("em", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439" }) : null, isAdmin ? (_jsx("button", { className: "branch-card__menu", type: "button", title: `Настройки филиала ${branch.city}`, "aria-label": `Настройки филиала ${branch.city}`, onClick: () => openBranchSettings(branch), children: _jsx(MoreVertical, { size: 18, "aria-hidden": "true" }) })) : null] }), _jsx("p", { children: branch.address || 'Адрес пока не указан' }), _jsxs("div", { className: "branch-card__metrics", children: [_jsxs("span", { title: "\u041E\u0431\u0449\u0438\u0439 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432\u0441\u0435\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432 \u0444\u0438\u043B\u0438\u0430\u043B\u0430", children: [_jsx("b", { children: stock?.totalQuantity ?? 0 }), _jsx("small", { children: "\u0442\u043E\u0432\u0430\u0440\u043E\u0432" })] }), _jsxs("span", { title: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E SKU \u0441 \u043F\u043E\u043B\u043E\u0436\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u043C \u0432\u043E \u0432\u0441\u0451\u043C \u0444\u0438\u043B\u0438\u0430\u043B\u0435", children: [_jsx("b", { children: stock?.skuCount ?? 0 }), _jsx("small", { children: "SKU" })] }), _jsxs("span", { children: [_jsx("b", { children: branch._count?.clients ?? 0 }), _jsx("small", { children: "\u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432" })] })] }), _jsxs("div", { className: "branch-card__company", children: [_jsx(Building2, { size: 16 }), _jsxs("span", { children: [_jsx("small", { children: "\u0418\u041F / \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F" }), _jsx("strong", { children: branch.ownCompany?.shortName || 'Не привязано' })] })] }), _jsxs("div", { className: "branch-card__responsible", children: [_jsx(UsersRound, { size: 16 }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439" }), _jsx("strong", { children: responsible?.name || 'Не назначен' })] })] })] }, branch.id));
                    }) }), isAdmin && settingsBranch ? (_jsx("div", { className: "branch-settings-backdrop", role: "dialog", "aria-modal": "true", "aria-label": `Настройки филиала ${settingsBranch.city}`, onMouseDown: (event) => {
                        if (event.target === event.currentTarget && !busy)
                            setSettingsBranchId(null);
                    }, children: _jsxs("section", { className: "branch-settings-dialog", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0444\u0438\u043B\u0438\u0430\u043B\u0430" }), _jsxs("h3", { children: [settingsBranch.city, " \u00B7 ", settingsBranch.code] })] }), _jsx("button", { className: "branch-settings-dialog__close", type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0444\u0438\u043B\u0438\u0430\u043B\u0430", disabled: busy, onClick: () => setSettingsBranchId(null), children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("form", { onSubmit: saveBranchSettings, children: [_jsxs("div", { className: "branch-settings-grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434 \u0444\u0438\u043B\u0438\u0430\u043B\u0430" }), _jsx("input", { value: settingsBranch.code, readOnly: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434" }), _jsx("input", { value: settingsForm.city, required: true, onChange: (event) => setSettingsForm((current) => ({ ...current, city: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0444\u0438\u043B\u0438\u0430\u043B\u0430" }), _jsx("input", { value: settingsForm.name, required: true, onChange: (event) => setSettingsForm((current) => ({ ...current, name: event.target.value })) })] }), _jsxs("label", { className: "branch-settings-grid__wide", children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441" }), _jsx("input", { value: settingsForm.address, onChange: (event) => setSettingsForm((current) => ({ ...current, address: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u041F / \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F" }), _jsxs("select", { value: settingsForm.ownCompanyId, onChange: (event) => setSettingsForm((current) => ({ ...current, ownCompanyId: event.target.value })), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D\u043E" }), companies.map((company) => _jsxs("option", { value: company.id, children: [company.shortName, " \u00B7 \u0418\u041D\u041D ", company.inn] }, company.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439" }), _jsxs("select", { value: settingsForm.managerUserId, onChange: (event) => setSettingsForm((current) => ({ ...current, managerUserId: event.target.value })), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D" }), users.map((user) => _jsxs("option", { value: user.id, children: [user.name, " \u00B7 ", user.email] }, user.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F" }), _jsx("input", { min: "0", step: "1", type: "number", value: settingsForm.sortOrder, onChange: (event) => setSettingsForm((current) => ({ ...current, sortOrder: event.target.value })) })] }), _jsxs("label", { className: "branch-settings-toggle", children: [_jsx("input", { type: "checkbox", checked: settingsForm.isActive, onChange: (event) => setSettingsForm((current) => ({ ...current, isActive: event.target.checked })) }), _jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B \u0430\u043A\u0442\u0438\u0432\u0435\u043D" })] })] }), _jsxs("footer", { children: [_jsx("button", { className: "secondary-button", type: "button", disabled: busy, onClick: () => setSettingsBranchId(null), children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", type: "submit", disabled: busy, children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), busy ? 'Сохраняю…' : 'Сохранить настройки'] })] })] })] }) })) : null, _jsxs("section", { className: "branch-workspace", children: [_jsxs("div", { className: "branch-workspace__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041C\u0435\u0436\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0430\u044F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430" }), _jsx("h3", { children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)) })] })] }), _jsxs("form", { className: "branch-transfer-form", onSubmit: submitTransfer, children: [_jsxs("div", { className: "branch-transfer-route", children: [_jsxs("span", { children: [_jsx("small", { children: "\u041E\u0442\u043A\u0443\u0434\u0430" }), _jsx("strong", { children: activeBranch?.city || 'Выберите город сверху' })] }), _jsx(ArrowRight, { size: 24 }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0443\u0434\u0430" }), _jsx("select", { value: targetWarehouseId, onChange: (event) => setTargetWarehouseId(event.target.value), required: true, children: branches.filter((branch) => branch.id !== activeBranch?.id).map((branch) => _jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id)) })] })] }), _jsxs("div", { className: "branch-transfer-mode", children: [_jsx("button", { className: transferMode === 'ITEMS' ? 'active' : '', type: "button", onClick: () => setTransferMode('ITEMS'), children: "\u0422\u043E\u0432\u0430\u0440 \u043F\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443" }), _jsx("button", { className: transferMode === 'BOXES' ? 'active' : '', type: "button", onClick: () => setTransferMode('BOXES'), children: "\u0426\u0435\u043B\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430" })] }), transferMode === 'ITEMS' ? (_jsxs(_Fragment, { children: [_jsxs("label", { children: [_jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("select", { value: skuId, onChange: (event) => setSkuId(event.target.value), required: true, children: skus.map((sku) => _jsxs("option", { value: sku.id, children: [sku.internalSku, " \u00B7 ", sku.name] }, sku.id)) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { type: "number", min: "1", value: quantity, onChange: (event) => setQuantity(event.target.value), required: true })] })] })) : (_jsxs("div", { className: "branch-transfer-boxes", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434\u044B \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("textarea", { rows: 4, value: sourceBoxCodes, onChange: (event) => {
                                                        setSourceBoxCodes(event.target.value);
                                                        setBoxFilePreview(null);
                                                    }, placeholder: "\u0421\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u043A\u043E\u0440\u043E\u0431\u0430 \u0447\u0435\u0440\u0435\u0437 Enter, \u043F\u0440\u043E\u0431\u0435\u043B \u0438\u043B\u0438 \u0437\u0430\u043F\u044F\u0442\u0443\u044E", required: true })] }), _jsxs("div", { className: "branch-transfer-file", children: [_jsx("input", { ref: boxFileInputRef, accept: ".xlsx,.xls,.csv", hidden: true, type: "file", onChange: (event) => void previewBoxesFile(event.target.files?.[0] ?? null) }), _jsxs("button", { className: "secondary-button", type: "button", disabled: boxFileBusy || busy || !clientId || !activeBranch, onClick: () => boxFileInputRef.current?.click(), children: [_jsx(FileSpreadsheet, { size: 17, "aria-hidden": "true" }), boxFileBusy ? 'Проверяю файл…' : 'Загрузить Excel с коробами'] }), _jsx("small", { children: "\u041F\u043E\u0434\u043E\u0439\u0434\u0451\u0442 XLSX, XLS \u0438\u043B\u0438 CSV \u0441 \u043A\u043E\u043B\u043E\u043D\u043A\u043E\u0439 \u00AB\u041A\u043E\u0434 \u043A\u043E\u0440\u043E\u0431\u0430\u00BB, \u00AB\u041A\u043E\u0440\u043E\u0431\u00BB, \u00AB\u0428\u041A \u043A\u043E\u0440\u043E\u0431\u0430\u00BB \u043B\u0438\u0431\u043E \u043F\u0440\u043E\u0441\u0442\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u0432 \u043E\u0434\u043D\u043E\u0439 \u043A\u043E\u043B\u043E\u043D\u043A\u0435." })] }), boxFilePreview ? (_jsx(BranchTransferFilePreview, { preview: boxFilePreview })) : null] })), _jsxs("label", { className: "branch-transfer-form__comment", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0435 \u0444\u0438\u043B\u0438\u0430\u043B\u0430 \u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440" })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: busy ||
                                        !clientId ||
                                        !targetWarehouseId ||
                                        (transferMode === 'ITEMS' ? !skuId : !sourceBoxCodes.trim()), children: [_jsx(ArrowRightLeft, { size: 17 }), " ", busy ? 'Перемещаю…' : 'Оформить перемещение'] })] })] }), _jsxs("section", { className: "branch-receiving", children: [_jsxs("h3", { children: [_jsx(Truck, { size: 20 }), " \u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u0438\u0451\u043C\u043A\u0430 \u0432 ", activeBranch?.city || 'выбранном филиале'] }), inboundTransfers.length ? inboundTransfers.map((transfer) => (_jsxs("article", { children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u2116", transfer.number] }), _jsxs("span", { children: [transfer.client.code, " \u00B7 ", transfer.client.name] }), _jsxs("small", { children: [transfer.fromWarehouse.city, " \u2192 ", transfer.toWarehouse.city, " \u00B7 \u043F\u0440\u0438\u043D\u044F\u0442\u043E ", transfer.receivedQuantity, " \u0438\u0437 ", transfer.totalQuantity, " \u0448\u0442."] })] }), _jsx("div", { className: "branch-receiving__boxes", children: (transfer.manifest?.boxes ?? []).map((box) => {
                                        const received = (transfer.receivedBoxCodes ?? []).includes(box.code.toUpperCase());
                                        return _jsxs("span", { className: received ? 'received' : '', children: [box.code, " \u00B7 ", box.quantity, " \u0448\u0442."] }, box.boxId);
                                    }) }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0440\u0438\u0435\u0445\u0430\u0432\u0448\u0435\u0433\u043E \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("input", { autoComplete: "off", value: receiptBoxCodes[transfer.id] ?? '', onChange: (event) => setReceiptBoxCodes((current) => ({ ...current, [transfer.id]: event.target.value })), placeholder: "\u041A\u043E\u0434 \u043A\u043E\u0440\u043E\u0431\u0430" })] }), _jsxs("button", { className: "primary-button", type: "button", disabled: busy, onClick: () => void receiveBox(transfer), children: [_jsx(ScanLine, { size: 17 }), " \u041F\u0440\u0438\u043D\u044F\u0442\u044C \u043A\u043E\u0440\u043E\u0431"] }), transfer.issues?.length ? (_jsx("div", { className: "branch-receiving__issues", children: transfer.issues.map((issue) => _jsx("span", { children: issue.message }, issue.id)) })) : null] }, transfer.id))) : _jsx("p", { className: "muted", children: "\u0414\u043B\u044F \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043E\u0436\u0438\u0434\u0430\u0435\u043C\u044B\u0445 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439 \u043D\u0435\u0442." })] }), _jsxs("section", { className: "branch-history", children: [_jsxs("h3", { children: [_jsx(PackageCheck, { size: 20 }), " \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043C\u0435\u0436\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0438\u0445 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439"] }), transfers.length ? transfers.map((transfer) => (_jsxs("article", { children: [_jsxs("strong", { children: ["\u2116", transfer.number] }), _jsxs("span", { children: [transfer.fromWarehouse.city, " ", _jsx(ArrowRight, { size: 14 }), " ", transfer.toWarehouse.city] }), _jsx("span", { children: transfer.client.name }), _jsxs("b", { children: [transfer.totalQuantity, " \u0448\u0442."] }), _jsxs("small", { children: [transferStatusLabel(transfer.status), " \u00B7 ", new Date(transfer.createdAt).toLocaleString('ru-RU'), " \u00B7 ", transfer.createdByName] })] }, transfer.id))) : _jsx("p", { className: "muted", children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0439 \u043F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." })] }), isAdmin ? (_jsxs("form", { className: "branch-create", onSubmit: submitBranch, children: [_jsxs("div", { children: [_jsx(Plus, { size: 20 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u0424\u0424" }), _jsx("small", { children: "\u041F\u043E\u0441\u043B\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u043F\u0440\u0438\u0432\u044F\u0436\u0438\u0442\u0435 \u0418\u041F \u0438 \u043D\u0430\u0437\u043D\u0430\u0447\u044C\u0442\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430." })] })] }), _jsx("input", { placeholder: "\u041A\u043E\u0434, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 SPB", value: createForm.code, onChange: (event) => setCreateForm({ ...createForm, code: event.target.value }), required: true }), _jsx("input", { placeholder: "\u0413\u043E\u0440\u043E\u0434", value: createForm.city, onChange: (event) => setCreateForm({ ...createForm, city: event.target.value }), required: true }), _jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0444\u0438\u043B\u0438\u0430\u043B\u0430", value: createForm.name, onChange: (event) => setCreateForm({ ...createForm, name: event.target.value }) }), _jsx("input", { placeholder: "\u0410\u0434\u0440\u0435\u0441", value: createForm.address, onChange: (event) => setCreateForm({ ...createForm, address: event.target.value }) }), _jsxs("select", { value: createForm.ownCompanyId, onChange: (event) => setCreateForm({ ...createForm, ownCompanyId: event.target.value }), children: [_jsx("option", { value: "", children: "\u0418\u041F / \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u044B" }), companies.map((company) => _jsxs("option", { value: company.id, children: [company.shortName, " \u00B7 ", company.inn] }, company.id))] }), _jsxs("button", { className: "secondary-button", type: "submit", disabled: busy, children: [_jsx(Plus, { size: 16 }), " \u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0444\u0438\u043B\u0438\u0430\u043B"] })] })) : null] }) }));
}
function BranchTransferFilePreview({ preview, }) {
    const errorRows = preview.rows.filter((row) => row.status === 'ERROR');
    return (_jsxs("section", { className: "branch-transfer-file-preview", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0444\u0430\u0439\u043B\u0430 \u0441 \u043A\u043E\u0440\u043E\u0431\u0430\u043C\u0438", children: [_jsxs("div", { className: "branch-transfer-file-preview__head", children: [_jsxs("span", { children: [_jsx(FileSpreadsheet, { size: 18, "aria-hidden": "true" }), _jsx("strong", { children: preview.fileName })] }), _jsxs("small", { children: ["\u041B\u0438\u0441\u0442: ", preview.sheetName] })] }), _jsxs("div", { className: "branch-transfer-file-preview__metrics", children: [_jsxs("span", { children: [_jsx("b", { children: preview.summary.readyBoxes }), _jsx("small", { children: "\u0433\u043E\u0442\u043E\u0432\u043E" })] }), _jsxs("span", { children: [_jsx("b", { children: preview.summary.totalQuantity }), _jsx("small", { children: "\u0435\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430" })] }), _jsxs("span", { className: preview.summary.errorBoxes ? 'has-error' : '', children: [_jsx("b", { children: preview.summary.errorBoxes }), _jsx("small", { children: "\u043E\u0448\u0438\u0431\u043E\u043A" })] }), _jsxs("span", { children: [_jsx("b", { children: preview.summary.duplicateBoxes }), _jsx("small", { children: "\u0434\u0443\u0431\u043B\u0438\u043A\u0430\u0442\u043E\u0432 \u0443\u0431\u0440\u0430\u043D\u043E" })] })] }), errorRows.length ? (_jsxs("div", { className: "branch-transfer-file-preview__errors", children: [_jsx("strong", { children: "\u041D\u0435 \u0431\u0443\u0434\u0443\u0442 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u0432 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435:" }), errorRows.slice(0, 50).map((row) => (_jsxs("span", { children: ["\u0421\u0442\u0440\u043E\u043A\u0430 ", row.row, ": ", row.code, " \u2014 ", row.reason] }, `${row.row}:${row.code}`))), errorRows.length > 50 ? (_jsxs("small", { children: ["\u0418 \u0435\u0449\u0451 ", errorRows.length - 50, " \u043E\u0448\u0438\u0431\u043E\u043A."] })) : null] })) : null, preview.duplicateCodes.length ? (_jsxs("small", { children: ["\u041F\u043E\u0432\u0442\u043E\u0440\u044F\u044E\u0449\u0438\u0435\u0441\u044F \u043A\u043E\u0434\u044B \u0443\u0434\u0430\u043B\u0435\u043D\u044B: ", preview.duplicateCodes.slice(0, 20).join(', '), preview.duplicateCodes.length > 20
                        ? ` и ещё ${preview.duplicateCodes.length - 20}`
                        : '', "."] })) : null] }));
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
function transferStatusLabel(status) {
    if (status === 'PENDING_RECEIPT')
        return 'В пути';
    if (status === 'PARTIALLY_RECEIVED')
        return 'Принято частично';
    if (status === 'RECEIVED')
        return 'Принято';
    if (status === 'CANCELLED')
        return 'Отменено';
    return status;
}
