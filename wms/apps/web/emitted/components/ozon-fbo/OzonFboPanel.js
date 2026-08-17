import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, ArrowLeft, Boxes, CalendarClock, CheckCircle2, ChevronRight, CircleDot, CloudUpload, Download, FileSpreadsheet, LoaderCircle, MapPin, PackageCheck, RefreshCw, ScanLine, Send, Sparkles, Trash2, Warehouse, } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bookOzonFboSlot, closeOzonFboBox, createOzonFboDraft, deleteOzonFboPlan, downloadOzonFboAssembly, downloadOzonFboBoxLabels, fetchClients, fetchOzonFboClusters, fetchOzonFboDropoffs, fetchOzonFboOverview, fetchOzonFboPlan, fetchOzonFboTimeslots, generateOzonFboBoxes, importOzonFboPlan, mapOzonFboCluster, refreshOzonFboCargoes, refreshOzonFboDraft, refreshOzonFboSupply, reportOzonFboBoxShortage, resolveOzonFboBoxShortage, scanOzonFboBox, setOzonFboDropoff, syncOzonFboSkus, uploadOzonFboCargoes, } from '../../lib/api';
import './ozon-fbo.css';
import './ozon-fbo-actions.css';
import { useRememberedClientId } from '../../lib/rememberedClient';
const steps = [
    { icon: FileSpreadsheet, title: 'Распределение', text: 'Excel по кластерам' },
    { icon: MapPin, title: 'Склады и слот', text: 'Черновик Ozon' },
    { icon: Boxes, title: 'Короба WMS', text: 'Задание на сборку' },
    { icon: ScanLine, title: 'Сборка', text: 'Контроль каждого товара' },
    { icon: Send, title: 'Передача', text: 'Грузоместа в Ozon' },
];
export function OzonFboPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id);
    const [overview, setOverview] = useState({ connections: [], plans: [] });
    const [plan, setPlan] = useState(null);
    const [clusters, setClusters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState(null);
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [connectionId, setConnectionId] = useState('');
    const [dropoffSearch, setDropoffSearch] = useState('');
    const [dropoffs, setDropoffs] = useState([]);
    const [slots, setSlots] = useState([]);
    const [slotFrom, setSlotFrom] = useState('');
    const [slotTo, setSlotTo] = useState('');
    const [slotDateFrom, setSlotDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
    const [slotDateTo, setSlotDateTo] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
    const [boxCapacity, setBoxCapacity] = useState(100);
    const [supplyMode, setSupplyMode] = useState('BY_CITY');
    const [packingMode, setPackingMode] = useState('MONO_WITH_SMALL_MIXED');
    const [openBoxId, setOpenBoxId] = useState('');
    const [scanCode, setScanCode] = useState('');
    const writableClients = useMemo(() => clients.filter((client) => client.status !== 'ARCHIVED'), [clients]);
    const show = (type, text) => {
        setNotice({ type, text });
        window.setTimeout(() => setNotice(null), 6000);
    };
    const loadOverview = useCallback(async (selectedClientId, keepPlan = true) => {
        if (!selectedClientId)
            return;
        setLoading(true);
        try {
            const data = await fetchOzonFboOverview(session.accessToken, selectedClientId);
            setOverview(data);
            setConnectionId((current) => current || data.connections[0]?.id || '');
            if (!keepPlan)
                setPlan(null);
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setLoading(false);
        }
    }, [session.accessToken]);
    useEffect(() => {
        void fetchClients(session.accessToken)
            .then((data) => {
            setClients(data);
            const first = data.find((client) => session.user.clientIds.includes(client.id)) ?? data[0];
            if (first)
                setClientId(first.id);
        })
            .catch((error) => show('error', messageOf(error)));
    }, [session.accessToken, session.user.clientIds]);
    useEffect(() => {
        if (clientId)
            void loadOverview(clientId, false);
    }, [clientId, loadOverview]);
    const loadPlan = async (id) => {
        setBusy('plan');
        try {
            const data = await fetchOzonFboPlan(session.accessToken, id);
            setPlan(data);
            const preferences = data.importSummary ?? {};
            setSupplyMode(preferences.supplyMode === 'ONE' ? 'ONE' : 'BY_CITY');
            setPackingMode(preferences.packingMode === 'MONO' ? 'MONO' : 'MONO_WITH_SMALL_MIXED');
            setConnectionId(data.connectionId);
            if (!clusters.length)
                setClusters(await fetchOzonFboClusters(session.accessToken, data.connectionId));
            setSlots(extractSlots(data.availableTimeslots));
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const run = async (key, action, success) => {
        setBusy(key);
        try {
            const data = await action();
            setPlan(data);
            await loadOverview(data.clientId);
            show('success', success);
            return data;
        }
        catch (error) {
            show('error', messageOf(error));
            return null;
        }
        finally {
            setBusy('');
        }
    };
    const submitImport = async (event) => {
        event.preventDefault();
        if (!clientId || !connectionId || !file) {
            show('error', 'Выберите клиента, подключение Ozon и Excel-файл.');
            return;
        }
        setBusy('import');
        try {
            const data = await importOzonFboPlan(session.accessToken, { clientId, connectionId, title, file });
            setPlan(data);
            setFile(null);
            setTitle('');
            setClusters(await fetchOzonFboClusters(session.accessToken, connectionId));
            await loadOverview(clientId);
            show('success', 'Распределение импортировано. Проверьте сопоставления перед созданием черновика.');
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const searchDropoffs = async () => {
        if (!plan)
            return;
        setBusy('dropoffs');
        try {
            setDropoffs(await fetchOzonFboDropoffs(session.accessToken, plan.connectionId, dropoffSearch));
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const loadTimeslots = async () => {
        if (!plan)
            return;
        if (!slotDateFrom || !slotDateTo || slotDateFrom > slotDateTo) {
            show('error', 'Укажите корректный период поиска: дата «с» не должна быть позже даты «по».');
            return;
        }
        setBusy('slots');
        try {
            const response = await fetchOzonFboTimeslots(session.accessToken, plan.id, slotDateFrom, slotDateTo);
            const found = extractSlots(response).filter((slot) => {
                const slotDate = slot.from.slice(0, 10);
                return slotDate >= slotDateFrom && slotDate <= slotDateTo;
            });
            setSlots(found);
            if (found[0]) {
                setSlotFrom(found[0].from);
                setSlotTo(found[0].to);
            }
            const cityPlans = cityPlanCount(plan);
            const responseInfo = response;
            if (responseInfo.recreation?.processing) {
                show('success', responseInfo.message || 'Просроченные черновики Ozon создаются заново. Повторите поиск слотов после завершения.');
                return;
            }
            show(found.length ? 'success' : 'error', found.length
                ? cityPlans
                    ? `Найдено общих слотов для всех ${cityPlans} городов: ${found.length}.`
                    : `Получено слотов: ${found.length}.`
                : cityPlans
                    ? `Нет единого слота, доступного одновременно для всех ${cityPlans} городов.`
                    : 'Ozon пока не вернул свободных слотов.');
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const bookSlot = async () => {
        if (!plan || !slotFrom || !slotTo)
            return;
        const cityPlans = cityPlanCount(plan);
        const confirmation = cityPlans
            ? `Забронировать выбранный общий слот во всех ${cityPlans} городских черновиках Ozon? Для каждого города будет создана отдельная поставка.`
            : 'Создать реальную поставку в Ozon и забронировать выбранный слот?';
        if (!window.confirm(confirmation))
            return;
        await run('book', () => bookOzonFboSlot(session.accessToken, plan.id, slotFrom, slotTo), cityPlans ? `Бронирование общего слота запущено для ${cityPlans} городов.` : 'Запрос на поставку и слот отправлен в Ozon.');
    };
    const createDraft = async () => {
        if (!plan)
            return;
        if (plan.draftId) {
            await run('draft', () => refreshOzonFboDraft(session.accessToken, plan.id), 'Черновик обновлён.');
            return;
        }
        if (supplyMode === 'BY_CITY' && !window.confirm(`Будет создано ${plan.clusters.length} отдельных черновиков Ozon — по одному на каждый город. Продолжить?`))
            return;
        setBusy('draft');
        try {
            const data = await createOzonFboDraft(session.accessToken, plan.id, { supplyMode, packingMode, mixedThreshold: 20 });
            setPlan(data);
            await loadOverview(data.clientId);
            const summary = data.creationSummary;
            if (summary) {
                if (summary.processing) {
                    show('success', `Создание ${summary.requested} городских черновиков запущено в фоне. Уже готово: ${summary.created}. Статусы обновляются в списке поставок.`);
                }
                else {
                    const failed = summary.failed.length ? ` Не создано: ${summary.failed.length}.` : '';
                    show(summary.failed.length ? 'error' : 'success', `Создано отдельных городских черновиков: ${summary.created} из ${summary.requested}.${failed}`);
                }
            }
            else {
                show('success', 'Черновик создан в Ozon.');
            }
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const scan = async (event, boxId) => {
        event.preventDefault();
        if (!scanCode.trim() || !plan)
            return;
        setBusy(`scan:${boxId}`);
        try {
            await scanOzonFboBox(session.accessToken, boxId, scanCode.trim());
            setScanCode('');
            setPlan(await fetchOzonFboPlan(session.accessToken, plan.id));
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const downloadAssembly = async () => {
        if (!plan)
            return;
        setBusy('excel');
        try {
            const blob = await downloadOzonFboAssembly(session.accessToken, plan.id);
            saveBlob(blob, `FBO-Ozon-${plan.title}.xlsx`);
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const downloadBoxLabels = async () => {
        if (!plan)
            return;
        setBusy('labels');
        try {
            const blob = await downloadOzonFboBoxLabels(session.accessToken, plan.id);
            saveBlob(blob, `FBO-Ozon-${plan.title}-ШК-коробов-58x40.pdf`);
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const reportShortage = async (boxId) => {
        if (!plan)
            return;
        const reason = window.prompt('Почему в короб положено меньше товара? Причина обязательна:');
        if (reason === null)
            return;
        if (reason.trim().length < 5) {
            show('error', 'Укажите понятную причину — минимум 5 символов.');
            return;
        }
        await run(`shortage:${boxId}`, () => reportOzonFboBoxShortage(session.accessToken, boxId, reason.trim()), 'Недовложение отправлено менеджеру на согласование.');
    };
    const resolveShortage = async (boxId, decision) => {
        if (!plan)
            return;
        const action = decision === 'APPROVE' ? 'согласовать недовложение' : 'вернуть короб на исправление';
        if (!window.confirm(`Подтвердить действие: ${action}?`))
            return;
        const comment = window.prompt('Комментарий к решению (необязательно):') ?? '';
        await run(`shortage:${boxId}`, () => resolveOzonFboBoxShortage(session.accessToken, boxId, decision, comment.trim()), decision === 'APPROVE' ? 'Недовложение согласовано и зафиксировано.' : 'Короб возвращён на исправление.');
    };
    const syncSkus = async () => {
        if (!connectionId) {
            show('error', 'Выберите подключение кабинета Ozon.');
            return;
        }
        setBusy('skus');
        try {
            const result = await syncOzonFboSkus(session.accessToken, connectionId);
            if (plan)
                setPlan(await fetchOzonFboPlan(session.accessToken, plan.id));
            await loadOverview(clientId);
            show(result.skipped ? 'error' : 'success', `SKU Ozon обновлены: ${result.productsReceived}. Создано: ${result.created}, обновлено: ${result.updated}, опознано неизвестных товаров: ${result.mergedDrafts}.${result.skipped ? ` Ошибок: ${result.skipped}.` : ''}`);
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    const deletePlan = async () => {
        if (!plan)
            return;
        if (!window.confirm(`Удалить загруженный Excel «${plan.sourceFileName}» и все связанные с ним планы из WMS? Уже созданные черновики и поставки в кабинете Ozon останутся без изменений. После удаления можно загрузить другой файл.`))
            return;
        setBusy('delete');
        try {
            await deleteOzonFboPlan(session.accessToken, plan.id);
            setPlan(null);
            setFile(null);
            setDropoffs([]);
            setSlots([]);
            await loadOverview(clientId, false);
            show('success', 'Excel и связанные планы удалены из WMS. Черновики и поставки в кабинете Ozon сохранены. Можно загрузить другой файл.');
        }
        catch (error) {
            show('error', messageOf(error));
        }
        finally {
            setBusy('');
        }
    };
    return (_jsxs("section", { className: "ozfbo-shell", children: [notice && _jsxs("div", { className: `ozfbo-toast ${notice.type}`, children: [notice.type === 'success' ? _jsx(CheckCircle2, {}) : _jsx(AlertTriangle, {}), _jsx("span", { children: notice.text })] }), _jsxs("header", { className: "ozfbo-hero", children: [_jsxs("div", { children: [_jsxs("span", { className: "ozfbo-kicker", children: [_jsx(Sparkles, { size: 15 }), " FFULLHAB WMS \u00D7 OZON"] }), _jsx("h1", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBO \u0431\u0435\u0437 \u0440\u0443\u0447\u043D\u043E\u0439 \u0440\u0443\u0442\u0438\u043D\u044B" }), _jsx("p", { children: "\u041E\u0442 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F \u043F\u043E \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u0430\u043C \u0434\u043E \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0441\u043E\u0441\u0442\u0430\u0432\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 Ozon." })] }), _jsxs("div", { className: "ozfbo-hero-tools", children: [_jsxs("label", { className: "ozfbo-client-picker", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: writableClients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)) })] }), _jsxs("button", { className: "ozfbo-hero-action", type: "button", disabled: !connectionId || busy === 'skus', onClick: () => void syncSkus(), children: [busy === 'skus' ? _jsx(LoaderCircle, { className: "spin" }) : _jsx(RefreshCw, {}), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C SKU Ozon"] })] })] }), _jsx("div", { className: "ozfbo-flow", children: steps.map((step, index) => {
                    const Icon = step.icon;
                    return _jsxs("div", { className: "ozfbo-flow-step", children: [_jsx("b", { children: index + 1 }), _jsx(Icon, {}), _jsxs("span", { children: [_jsx("strong", { children: step.title }), _jsx("small", { children: step.text })] })] }, step.title);
                }) }), !plan ? (_jsxs("div", { className: "ozfbo-home-grid", children: [_jsxs("form", { className: "ozfbo-card ozfbo-import", onSubmit: submitImport, children: [_jsxs("div", { className: "ozfbo-card-title", children: [_jsx(FileSpreadsheet, {}), _jsxs("div", { children: [_jsx("h2", { children: "\u041D\u043E\u0432\u0430\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430" }), _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435, \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043B\u0435\u043D\u043D\u043E\u0435 \u0434\u043B\u044F Ozon FBO." })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u0422\u0440\u0443\u0441\u044B \u041F\u043E\u043F\u043E\u0432\u0430 \u00B7 5 \u0430\u0432\u0433\u0443\u0441\u0442\u0430" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0430\u0431\u0438\u043D\u0435\u0442 Ozon" }), _jsxs("select", { value: connectionId, onChange: (event) => setConnectionId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }), overview.connections.map((connection) => _jsx("option", { value: connection.id, children: connection.accountName || `Client ID ${connection.sellerId}` }, connection.id))] })] }), _jsxs("label", { className: `ozfbo-file ${file ? 'selected' : ''}`, children: [_jsx(CloudUpload, {}), _jsxs("span", { children: [_jsx("strong", { children: file ? file.name : 'Выберите Excel-файл' }), _jsx("small", { children: "XLSX \u0438\u043B\u0438 XLS, \u0434\u043E 20 \u041C\u0411" })] }), _jsx("input", { type: "file", accept: ".xlsx,.xls", onChange: (event) => setFile(event.target.files?.[0] ?? null) })] }), !overview.connections.length && _jsxs("div", { className: "ozfbo-inline-warning", children: [_jsx(AlertTriangle, {}), "\u0423 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F Ozon. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0435\u0433\u043E \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 FBS \u2192 \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F."] }), _jsxs("button", { className: "ozfbo-primary", disabled: busy === 'import' || !overview.connections.length, children: [busy === 'import' ? _jsx(LoaderCircle, { className: "spin" }) : _jsx(Sparkles, {}), "\u0420\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435"] })] }), _jsxs("div", { className: "ozfbo-card ozfbo-plans", children: [_jsxs("div", { className: "ozfbo-card-title", children: [_jsx(CalendarClock, {}), _jsxs("div", { children: [_jsx("h2", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBO" }), _jsx("p", { children: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438, \u0441\u0431\u043E\u0440\u043A\u0430 \u0438 \u0433\u043E\u0442\u043E\u0432\u044B\u0435 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438." })] }), _jsx("button", { className: "ozfbo-icon-button", onClick: () => void loadOverview(clientId), children: _jsx(RefreshCw, {}) })] }), loading ? _jsxs("div", { className: "ozfbo-empty", children: [_jsx(LoaderCircle, { className: "spin" }), "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438\u2026"] }) : overview.plans.length === 0 ? _jsxs("div", { className: "ozfbo-empty", children: [_jsx(Boxes, {}), _jsx("strong", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }), _jsx("span", { children: "\u041F\u0435\u0440\u0432\u0430\u044F \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0438\u043C\u043F\u043E\u0440\u0442\u0430 Excel." })] }) : _jsx("div", { className: "ozfbo-plan-list", children: overview.plans.map((item) => _jsx(PlanRow, { item: item, onClick: () => void loadPlan(item.id) }, item.id)) })] })] })) : (_jsx(PlanDetail, { plan: plan, clusters: clusters, busy: busy, slots: slots, slotFrom: slotFrom, slotDateFrom: slotDateFrom, slotDateTo: slotDateTo, dropoffSearch: dropoffSearch, dropoffs: dropoffs, boxCapacity: boxCapacity, supplyMode: supplyMode, packingMode: packingMode, openBoxId: openBoxId, scanCode: scanCode, canResolveShortage: session.user.permissionCodes.includes('system:admin') || session.user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role)), onBack: () => { setPlan(null); setDropoffs([]); setSlots([]); }, onReload: () => void loadPlan(plan.id), onDelete: () => void deletePlan(), onMap: (rowId, option) => void run('map', () => mapOzonFboCluster(session.accessToken, plan.id, rowId, option), 'Кластер сопоставлен.'), onDropoffSearch: setDropoffSearch, onSearchDropoffs: () => void searchDropoffs(), onChooseDropoff: (warehouse) => void run('dropoff', () => setOzonFboDropoff(session.accessToken, plan.id, warehouse), 'Точка отгрузки выбрана.'), onSupplyMode: setSupplyMode, onPackingMode: setPackingMode, onDraft: () => void createDraft(), onLoadSlots: () => void loadTimeslots(), onSlotDateFrom: (value) => { setSlotDateFrom(value); setSlots([]); setSlotFrom(''); setSlotTo(''); }, onSlotDateTo: (value) => { setSlotDateTo(value); setSlots([]); setSlotFrom(''); setSlotTo(''); }, onSelectSlot: (slot) => { setSlotFrom(slot.from); setSlotTo(slot.to); }, onBook: () => void bookSlot(), onRefreshSupply: () => void run('supply', () => refreshOzonFboSupply(session.accessToken, plan.id), 'Статус поставки обновлён.'), onCapacity: setBoxCapacity, onGenerateBoxes: () => void run('boxes', () => generateOzonFboBoxes(session.accessToken, plan.id, boxCapacity, packingMode, 20), 'Короба WMS и задание на сборку созданы.'), onDownload: () => void downloadAssembly(), onDownloadLabels: () => void downloadBoxLabels(), onOpenBox: setOpenBoxId, onScanCode: setScanCode, onScan: (event, boxId) => void scan(event, boxId), onCloseBox: (boxId) => void run('close', () => closeOzonFboBox(session.accessToken, boxId), 'Короб закрыт.'), onReportShortage: (boxId) => void reportShortage(boxId), onResolveShortage: (boxId, decision) => void resolveShortage(boxId, decision), onUpload: () => {
                    if (window.confirm('Передать состав всех закрытых коробов в Ozon? Существующий состав грузомест будет заменён.')) {
                        void run('upload', () => uploadOzonFboCargoes(session.accessToken, plan.id), 'Состав коробов передан в Ozon.');
                    }
                }, onRefreshCargo: () => void run('cargo', () => refreshOzonFboCargoes(session.accessToken, plan.id), 'Статус грузомест обновлён.') }))] }));
}
function PlanRow({ item, onClick }) {
    return _jsxs("button", { className: "ozfbo-plan-row", onClick: onClick, children: [_jsxs("span", { className: `ozfbo-state ${tone(item.status)}`, children: [_jsx(CircleDot, {}), statusLabel(item.status)] }), _jsx("strong", { children: item.title }), _jsxs("small", { children: [new Date(item.createdAt).toLocaleString('ru-RU'), " \u00B7 ", item.totalUnits, " \u0448\u0442. \u00B7 ", item.clusters, " \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u043E\u0432"] }), _jsxs("div", { children: [_jsx("span", { children: item.boxes ? `${item.closedBoxes}/${item.boxes} коробов` : 'короба не созданы' }), item.errors > 0 && _jsxs("em", { children: [_jsx(AlertTriangle, {}), item.errors] }), _jsx(ChevronRight, {})] })] });
}
function PlanDetail(props) {
    const { plan } = props;
    const total = plan.clusters.flatMap((cluster) => cluster.items).reduce((sum, item) => sum + item.quantity, 0);
    const assembled = plan.clusters.flatMap((cluster) => cluster.items).reduce((sum, item) => sum + item.assembledQuantity, 0);
    const invalid = plan.clusters.some((cluster) => !cluster.macrolocalClusterId || cluster.items.some((item) => !item.isValid));
    const allClosed = plan.boxes.length > 0 && plan.boxes.every((box) => ['CLOSED', 'UPLOADED'].includes(box.status));
    const cityPlans = cityPlanCount(plan);
    const hasOzonDrafts = Boolean(plan.draftId || plan.ozonOrderId) || cityPlans > 0;
    return _jsxs("div", { className: "ozfbo-detail", children: [_jsxs("div", { className: "ozfbo-detail-head", children: [_jsxs("button", { className: "ozfbo-back", onClick: props.onBack, children: [_jsx(ArrowLeft, {}), "\u0412\u0441\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438"] }), _jsxs("div", { children: [_jsx("span", { className: `ozfbo-state ${tone(plan.status)}`, children: statusLabel(plan.status) }), _jsx("h2", { children: plan.title }), _jsxs("p", { children: [plan.sourceFileName, " \u00B7 ", total, " \u0448\u0442. \u00B7 ", plan.clusters.length, " \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439"] })] }), _jsxs("div", { className: "ozfbo-detail-actions", children: [_jsxs("button", { className: "ozfbo-secondary", onClick: props.onReload, children: [_jsx(RefreshCw, {}), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] }), _jsxs("button", { className: "ozfbo-delete-button", disabled: props.busy === 'delete', onClick: props.onDelete, children: [_jsx(Trash2, {}), "\u0423\u0434\u0430\u043B\u0438\u0442\u044C Excel"] })] })] }), plan.lastError && _jsxs("div", { className: "ozfbo-inline-warning danger", children: [_jsx(AlertTriangle, {}), plan.lastError] }), _jsxs("div", { className: "ozfbo-kpis", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("strong", { children: total })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0421\u043E\u0431\u0440\u0430\u043D\u043E" }), _jsxs("strong", { children: [assembled, _jsxs("small", { children: [" / ", total] })] })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("strong", { children: plan.boxes.length })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0417\u0430\u043A\u0430\u0437 Ozon" }), _jsx("strong", { children: plan.ozonOrderNumber || plan.ozonOrderId || '—' })] })] }), _jsxs("section", { className: "ozfbo-stage", children: [_jsxs("div", { className: "ozfbo-stage-head", children: [_jsx("b", { children: "1" }), _jsxs("div", { children: [_jsx("h3", { children: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u043F\u043E \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u0430\u043C" }), _jsx("p", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0433\u043E\u0440\u043E\u0434\u0430, SKU Ozon \u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u0430 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0435 WMS." })] }), invalid ? _jsxs("span", { className: "ozfbo-check bad", children: [_jsx(AlertTriangle, {}), "\u041D\u0443\u0436\u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430"] }) : _jsxs("span", { className: "ozfbo-check", children: [_jsx(CheckCircle2, {}), "\u0413\u043E\u0442\u043E\u0432\u043E"] })] }), _jsx("div", { className: "ozfbo-cluster-grid", children: plan.clusters.map((cluster) => _jsxs("article", { className: `ozfbo-cluster ${cluster.validationMessage ? 'warning' : ''}`, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("small", { children: "\u0418\u0437 Excel" }), _jsx("strong", { children: cluster.sourceName })] }), _jsx(ChevronRight, {}), _jsxs("div", { children: [_jsx("small", { children: "\u041A\u043B\u0430\u0441\u0442\u0435\u0440 Ozon" }), cluster.macrolocalClusterId ? _jsx("strong", { children: cluster.clusterName }) : _jsxs("select", { defaultValue: "", onChange: (event) => { const option = props.clusters.find((item) => item.id === event.target.value); if (option)
                                                        props.onMap(cluster.id, option); }, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0430\u0441\u0442\u0435\u0440" }), props.clusters.map((option) => _jsx("option", { value: option.id, children: option.name }, option.id))] })] })] }), cluster.validationMessage && _jsx("p", { className: "ozfbo-error-text", children: cluster.validationMessage }), _jsx("div", { className: "ozfbo-items", children: cluster.items.map((item) => _jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: item.offerId }), _jsx("small", { children: item.productName || item.validationMessage || 'Товар не сопоставлен' })] }), _jsxs("b", { children: [item.quantity, " \u0448\u0442."] }), item.isValid ? _jsx(CheckCircle2, { className: "ok" }) : _jsx(AlertTriangle, { className: "bad" })] }, item.id)) })] }, cluster.id)) })] }), _jsxs("section", { className: "ozfbo-stage", children: [_jsxs("div", { className: "ozfbo-stage-head", children: [_jsx("b", { children: "2" }), _jsxs("div", { children: [_jsx("h3", { children: "\u0422\u043E\u0447\u043A\u0430 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438, \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u0438 \u0441\u043B\u043E\u0442" }), _jsx("p", { children: "\u0420\u0435\u0430\u043B\u044C\u043D\u0430\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u00AB\u0417\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u00BB." })] })] }), _jsxs("div", { className: "ozfbo-action-grid", children: [_jsxs("div", { className: "ozfbo-action-card", children: [_jsx(MapPin, {}), _jsx("h4", { children: "\u0422\u043E\u0447\u043A\u0430 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438" }), plan.dropOffWarehouseId ? _jsxs("div", { className: "ozfbo-selected", children: [_jsx(CheckCircle2, {}), _jsxs("span", { children: [_jsx("strong", { children: plan.dropOffWarehouseName || plan.dropOffWarehouseId }), _jsxs("small", { children: ["ID ", plan.dropOffWarehouseId] })] })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "ozfbo-search", children: [_jsx("input", { value: props.dropoffSearch, onChange: (event) => props.onDropoffSearch(event.target.value), placeholder: "\u0413\u043E\u0440\u043E\u0434 \u0438\u043B\u0438 \u0441\u043A\u043B\u0430\u0434 Ozon" }), _jsx("button", { onClick: props.onSearchDropoffs, disabled: props.busy === 'dropoffs', children: "\u041D\u0430\u0439\u0442\u0438" })] }), _jsx("div", { className: "ozfbo-options", children: props.dropoffs.map((warehouse) => _jsxs("button", { onClick: () => props.onChooseDropoff(warehouse), children: [_jsx("strong", { children: warehouse.name }), _jsx("small", { children: warehouse.address || warehouse.warehouse_type })] }, warehouse.warehouse_id)) })] })] }), _jsxs("div", { className: "ozfbo-action-card ozfbo-draft-card", children: [_jsx(Warehouse, {}), _jsx("h4", { children: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A Ozon" }), _jsx("p", { children: plan.draftId ? `Черновик №${plan.draftId}` : cityPlans ? `Создано городских черновиков: ${cityPlans}` : 'Выберите схему поставок и упаковки перед созданием.' }), !plan.draftId && !cityPlans && _jsxs("div", { className: "ozfbo-preferences", children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "\u041A\u0430\u043A \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438?" }), _jsxs("label", { className: props.supplyMode === 'ONE' ? 'active' : '', children: [_jsx("input", { type: "radio", name: "supply-mode", checked: props.supplyMode === 'ONE', onChange: () => props.onSupplyMode('ONE') }), _jsxs("span", { children: [_jsx("strong", { children: "\u041E\u0434\u043D\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430" }), _jsx("small", { children: "\u0412\u0441\u0435 \u0433\u043E\u0440\u043E\u0434\u0430 \u0432 \u043E\u0434\u043D\u043E\u043C \u043F\u043B\u0430\u043D\u0435 Ozon" })] })] }), _jsxs("label", { className: props.supplyMode === 'BY_CITY' ? 'active' : '', children: [_jsx("input", { type: "radio", name: "supply-mode", checked: props.supplyMode === 'BY_CITY', onChange: () => props.onSupplyMode('BY_CITY') }), _jsxs("span", { children: [_jsx("strong", { children: "\u041A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0440\u043E\u0434 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E" }), _jsxs("small", { children: [plan.clusters.length, " \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u0438 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u043E\u0432"] })] })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "\u041A\u0430\u043A \u0441\u043E\u0431\u0438\u0440\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430?" }), _jsxs("label", { className: props.packingMode === 'MONO' ? 'active' : '', children: [_jsx("input", { type: "radio", name: "packing-mode", checked: props.packingMode === 'MONO', onChange: () => props.onPackingMode('MONO') }), _jsxs("span", { children: [_jsx("strong", { children: "\u0422\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u043D\u043E\u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("small", { children: "\u041E\u0434\u0438\u043D \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0432 \u043A\u0430\u0436\u0434\u043E\u043C \u043A\u043E\u0440\u043E\u0431\u0435" })] })] }), _jsxs("label", { className: props.packingMode === 'MONO_WITH_SMALL_MIXED' ? 'active' : '', children: [_jsx("input", { type: "radio", name: "packing-mode", checked: props.packingMode === 'MONO_WITH_SMALL_MIXED', onChange: () => props.onPackingMode('MONO_WITH_SMALL_MIXED') }), _jsxs("span", { children: [_jsx("strong", { children: "\u041C\u043E\u043D\u043E\u043A\u043E\u0440\u043E\u0431\u0430 + \u0441\u043C\u0435\u0448\u0430\u043D\u043D\u044B\u0435" }), _jsx("small", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B\u044B \u043C\u0435\u043D\u044C\u0448\u0435 20 \u0448\u0442. \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u044F\u044E\u0442\u0441\u044F" })] })] })] })] }), _jsxs("button", { className: "ozfbo-primary small", disabled: invalid || !plan.dropOffWarehouseId || props.busy === 'draft', onClick: props.onDraft, children: [props.busy === 'draft' ? _jsx(LoaderCircle, { className: "spin" }) : _jsx(RefreshCw, {}), plan.draftId ? 'Обновить черновик' : cityPlans ? 'Проверить городские черновики' : props.supplyMode === 'BY_CITY' ? 'Создать поставки по городам' : 'Создать один черновик'] }), plan.clusters.some((cluster) => cluster.storageWarehouseName) && _jsx("div", { className: "ozfbo-warehouses", children: plan.clusters.map((cluster) => cluster.storageWarehouseName && _jsxs("span", { children: [cluster.clusterName, ": ", _jsx("b", { children: cluster.storageWarehouseName })] }, cluster.id)) })] }), _jsxs("div", { className: "ozfbo-action-card", children: [_jsx(CalendarClock, {}), _jsx("h4", { children: cityPlans ? `Общий слот для ${cityPlans} городов` : 'Слот приёмки' }), cityPlans && _jsx("p", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B, \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u0432\u043E \u0432\u0441\u0435\u0445 \u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0438\u0445 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0430\u0445." }), _jsxs("div", { className: "ozfbo-slot-period", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u0441" }), _jsx("input", { type: "date", value: props.slotDateFrom, onChange: (event) => props.onSlotDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u043F\u043E" }), _jsx("input", { type: "date", value: props.slotDateTo, onChange: (event) => props.onSlotDateTo(event.target.value) })] })] }), _jsx("button", { className: "ozfbo-secondary compact", disabled: !hasOzonDrafts || props.busy === 'slots', onClick: props.onLoadSlots, children: cityPlans ? 'Найти общий свободный слот' : 'Показать свободные слоты' }), _jsx("div", { className: "ozfbo-slots", children: props.slots.slice(0, 30).map((slot) => _jsxs("button", { className: props.slotFrom === slot.from ? 'active' : '', onClick: () => props.onSelectSlot(slot), children: [_jsx("strong", { children: formatDateTime(slot.from) }), _jsxs("small", { children: ["\u0434\u043E ", formatTime(slot.to)] })] }, `${slot.from}-${slot.to}`)) }), _jsxs("button", { className: "ozfbo-danger-action", disabled: !props.slotFrom || props.busy === 'book', onClick: props.onBook, children: [_jsx(Send, {}), cityPlans ? 'Забронировать во всех городах' : 'Забронировать и создать поставку'] }), (plan.ozonOrderId || cityPlans > 0) && _jsx("button", { className: "ozfbo-link", onClick: props.onRefreshSupply, children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A" })] })] })] }), _jsxs("section", { className: "ozfbo-stage", children: [_jsxs("div", { className: "ozfbo-stage-head", children: [_jsx("b", { children: "3" }), _jsxs("div", { children: [_jsx("h3", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 WMS \u0438 \u0441\u0431\u043E\u0440\u043A\u0430" }), _jsx("p", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 \u0441\u043E\u0437\u0434\u0430\u044E\u0442\u0441\u044F \u0441 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u043C \u043F\u0440\u0435\u0444\u0438\u043A\u0441\u043E\u043C FFU \u0438 \u0441\u043E\u0431\u0438\u0440\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u043C \u043C\u0435\u043D\u044E \u0422\u0421\u0414 \u00AB\u0421\u0431\u043E\u0440\u043A\u0430 FBO Ozon\u00BB." })] }), _jsxs("div", { className: "ozfbo-stage-head-actions", children: [_jsxs("button", { className: "ozfbo-secondary", disabled: !plan.boxes.length, onClick: props.onDownload, children: [_jsx(Download, {}), "Excel \u0434\u043B\u044F \u0441\u0431\u043E\u0440\u043A\u0438"] }), _jsxs("button", { className: "ozfbo-secondary", disabled: !plan.boxes.length || props.busy === 'labels', onClick: props.onDownloadLabels, children: [_jsx(Download, {}), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0428\u041A \u043A\u043E\u0440\u043E\u0431\u043E\u0432"] })] })] }), !plan.boxes.length ? _jsxs("div", { className: "ozfbo-box-builder", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0435\u0434\u0438\u043D\u0438\u0446 \u0432 \u043A\u043E\u0440\u043E\u0431\u0435" }), _jsx("input", { type: "number", min: "1", max: "1000", value: props.boxCapacity, onChange: (event) => props.onCapacity(Number(event.target.value)) })] }), _jsxs("div", { className: "ozfbo-box-rule", children: [_jsx("strong", { children: props.packingMode === 'MONO' ? 'Только монокороба' : 'Монокороба + смешанные остатки' }), _jsxs("small", { children: [props.packingMode === 'MONO' ? 'В каждом коробе будет только один артикул.' : 'Артикулы с планом меньше 20 шт. будут объединены в смешанные короба.', " \u041F\u043B\u0430\u043D\u043E\u0432\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E Ozon \u043D\u0435 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442\u0441\u044F."] })] }), _jsxs("button", { className: "ozfbo-primary", disabled: invalid || props.busy === 'boxes', onClick: props.onGenerateBoxes, children: [_jsx(Boxes, {}), "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430 WMS"] })] }) : _jsx("div", { className: "ozfbo-box-list", children: plan.boxes.map((box) => { const count = box.items.reduce((sum, item) => sum + item.quantity, 0); const done = box.items.reduce((sum, item) => sum + item.assembledQuantity, 0); const missing = Math.max(0, count - done); const isOpen = props.openBoxId === box.id; const boxKind = box.items.length > 1 ? 'Смешанный короб' : 'Монокороб'; const shortage = box.status === 'SHORTAGE_PENDING' ? shortageForBox(plan, box.id) : null; return _jsxs("article", { className: `ozfbo-box ${isOpen ? 'open' : ''}`, children: [_jsxs("button", { className: "ozfbo-box-head", onClick: () => props.onOpenBox(isOpen ? '' : box.id), children: [_jsx(PackageCheck, {}), _jsxs("span", { children: [_jsx("strong", { children: box.boxCode }), _jsxs("small", { children: [box.cluster.clusterName || box.cluster.sourceName, " \u00B7 ", boxKind] })] }), _jsxs("b", { children: [done, "/", count] }), _jsx("span", { className: `ozfbo-state ${tone(box.status)}`, children: statusLabel(box.status) }), _jsx(ChevronRight, {})] }), isOpen && _jsxs("div", { className: "ozfbo-box-body", children: [_jsx("div", { className: "ozfbo-box-items", children: box.items.map((item) => _jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: item.planItem.offerId }), _jsx("small", { children: item.planItem.productName })] }), _jsxs("b", { children: [item.assembledQuantity, " / ", item.quantity] })] }, item.id)) }), !['CLOSED', 'UPLOADED', 'SHORTAGE_PENDING'].includes(box.status) && _jsxs("form", { onSubmit: (event) => props.onScan(event, box.id), className: "ozfbo-scan", children: [_jsx(ScanLine, {}), _jsx("input", { autoFocus: true, value: props.scanCode, onChange: (event) => props.onScanCode(event.target.value), placeholder: "\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u043E\u0432\u0430\u0440" }), _jsx("button", { disabled: props.busy === `scan:${box.id}`, children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] }), shortage && _jsxs("div", { className: "ozfbo-shortage", children: [_jsx(AlertTriangle, {}), _jsxs("span", { children: [_jsxs("strong", { children: ["\u041D\u0435\u0434\u043E\u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435: ", String(shortage.missingQuantity ?? missing), " \u0448\u0442."] }), _jsxs("small", { children: ["\u041F\u0440\u0438\u0447\u0438\u043D\u0430: ", String(shortage.reason ?? 'не указана')] })] }), props.canResolveShortage && _jsxs("div", { children: [_jsx("button", { className: "approve", disabled: props.busy === `shortage:${box.id}`, onClick: () => props.onResolveShortage(box.id, 'APPROVE'), children: "\u0421\u043E\u0433\u043B\u0430\u0441\u0438\u0442\u044C\u0441\u044F" }), _jsx("button", { className: "correct", disabled: props.busy === `shortage:${box.id}`, onClick: () => props.onResolveShortage(box.id, 'CORRECT'), children: "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C" })] })] }), _jsxs("div", { className: "ozfbo-box-actions", children: [missing > 0 && !['CLOSED', 'UPLOADED', 'SHORTAGE_PENDING'].includes(box.status) && _jsxs("button", { className: "ozfbo-shortage-button", disabled: props.busy === `shortage:${box.id}`, onClick: () => props.onReportShortage(box.id), children: [_jsx(AlertTriangle, {}), "\u0421\u043E\u043E\u0431\u0449\u0438\u0442\u044C \u043D\u0435\u0434\u043E\u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435"] }), done === count && !['CLOSED', 'UPLOADED'].includes(box.status) && _jsxs("button", { className: "ozfbo-primary small", onClick: () => props.onCloseBox(box.id), children: [_jsx(CheckCircle2, {}), "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u043E\u0440\u043E\u0431"] }), box.ozonBarcode && _jsxs("span", { children: ["\u0428\u041A Ozon: ", _jsx("b", { children: box.ozonBarcode })] })] })] })] }, box.id); }) })] }), _jsxs("section", { className: "ozfbo-stage ozfbo-final", children: [_jsxs("div", { className: "ozfbo-stage-head", children: [_jsx("b", { children: "4" }), _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442 \u0432 Ozon" }), _jsx("p", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0433\u0434\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0439 \u043A\u043E\u0440\u043E\u0431 \u0441\u043E\u0431\u0440\u0430\u043D \u0438 \u0437\u0430\u043A\u0440\u044B\u0442." })] })] }), _jsxs("div", { className: "ozfbo-final-content", children: [_jsxs("div", { className: `ozfbo-readiness ${allClosed ? 'ready' : ''}`, children: [allClosed ? _jsx(CheckCircle2, {}) : _jsx(AlertTriangle, {}), _jsxs("span", { children: [_jsx("strong", { children: allClosed ? 'Поставка готова к передаче' : 'Сборка ещё не завершена' }), _jsxs("small", { children: [plan.boxes.filter((box) => ['CLOSED', 'UPLOADED'].includes(box.status)).length, " \u0438\u0437 ", plan.boxes.length, " \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0437\u0430\u043A\u0440\u044B\u0442\u043E"] })] })] }), _jsxs("button", { className: "ozfbo-primary", disabled: !allClosed || !plan.ozonOrderId || props.busy === 'upload', onClick: props.onUpload, children: [_jsx(Send, {}), "\u041F\u0435\u0440\u0435\u0434\u0430\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u0432 Ozon"] }), ['CARGO_UPLOADING', 'READY_TO_SHIP'].includes(plan.status) && _jsxs("button", { className: "ozfbo-secondary", onClick: props.onRefreshCargo, children: [_jsx(RefreshCw, {}), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0430"] })] })] }), plan.events.length > 0 && _jsxs("section", { className: "ozfbo-events", children: [_jsx("h3", { children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), plan.events.slice(0, 20).map((event) => _jsxs("div", { children: [_jsx(CircleDot, {}), _jsxs("span", { children: [_jsx("strong", { children: event.message }), _jsxs("small", { children: [new Date(event.createdAt).toLocaleString('ru-RU'), event.userName ? ` · ${event.userName}` : ''] })] })] }, event.id))] })] });
}
const labels = {
    IMPORTED: 'Импортировано', NEEDS_ATTENTION: 'Нужна проверка', READY: 'Готово к черновику',
    DRAFT_CREATED: 'Черновик создан', DRAFT_PROCESSING: 'Ozon обрабатывает', DRAFT_READY: 'Черновик готов',
    SUPPLY_CREATING: 'Создаётся поставка', SUPPLY_CREATED: 'Поставка создана', BOXES_CREATED: 'Короба созданы',
    ASSEMBLY: 'Идёт сборка', ASSEMBLED: 'Собрано', CARGO_UPLOADING: 'Передаётся в Ozon', READY_TO_SHIP: 'Готово к отгрузке',
    SPLIT_BY_CITY: 'Разделено по городам', DRAFT_ERROR: 'Ошибка черновика', DRAFT_EXPIRED: 'Черновик истёк', DRAFTS_RECREATING: 'Черновики создаются заново',
    CITY_SLOT_READY: 'Общий слот найден', CITY_SLOT_UNAVAILABLE: 'Нет общего слота',
    CITY_SUPPLIES_CREATING: 'Бронируются города', CITY_SUPPLIES_CREATED: 'Все поставки созданы', CITY_SUPPLIES_PARTIAL: 'Часть городов с ошибкой',
    SUPPLY_ERROR: 'Ошибка поставки',
    SHORTAGE_REVIEW: 'Есть недовложение', ASSEMBLED_WITH_SHORTAGE: 'Собрано с недовложением',
    PLANNED: 'Ожидает сборки', ASSEMBLING: 'Собирается', SHORTAGE_PENDING: 'Ждёт решения', CLOSED: 'Закрыт', UPLOADED: 'Загружен в Ozon',
};
function statusLabel(value) { return labels[value] ?? value.replaceAll('_', ' ').toLowerCase(); }
function tone(value) { if (['READY', 'DRAFT_READY', 'SUPPLY_CREATED', 'CITY_SLOT_READY', 'CITY_SUPPLIES_CREATED', 'ASSEMBLED', 'READY_TO_SHIP', 'CLOSED', 'UPLOADED'].includes(value))
    return 'green'; if (['NEEDS_ATTENTION', 'DRAFT_ERROR', 'DRAFT_EXPIRED', 'SUPPLY_ERROR', 'CITY_SLOT_UNAVAILABLE', 'CITY_SUPPLIES_PARTIAL', 'SHORTAGE_REVIEW', 'SHORTAGE_PENDING', 'ASSEMBLED_WITH_SHORTAGE'].includes(value))
    return 'red'; if (['ASSEMBLY', 'ASSEMBLING', 'SUPPLY_CREATING', 'DRAFTS_RECREATING', 'CITY_SUPPLIES_CREATING', 'CARGO_UPLOADING'].includes(value))
    return 'violet'; return 'blue'; }
function cityPlanCount(plan) { const value = plan.importSummary?.childPlanIds; return Array.isArray(value) ? value.filter((id) => typeof id === 'string').length : 0; }
function shortageForBox(plan, boxId) {
    const event = plan.events.find((item) => item.type === 'BOX_SHORTAGE_REPORTED' && item.payload?.boxId === boxId);
    return event?.payload ?? null;
}
function messageOf(error) { return error instanceof Error ? error.message : 'Неизвестная ошибка.'; }
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function saveBlob(blob, fileName) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName.replace(/[\\/:*?"<>|]+/g, '-'); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function extractSlots(input) {
    const result = [];
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const object = value;
        const from = object.from_in_timezone ?? object.from;
        const to = object.to_in_timezone ?? object.to;
        if (typeof from === 'string' && typeof to === 'string' && !result.some((slot) => slot.from === from && slot.to === to))
            result.push({ from, to });
        Object.values(object).forEach(visit);
    };
    visit(input);
    return result.sort((a, b) => a.from.localeCompare(b.from));
}
