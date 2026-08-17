import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Download, HandCoins, Plus, RefreshCw, RotateCcw, Save, Truck, UsersRound, WalletCards, Wrench, } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addExpenseMaterialStock, cancelExpenseEntry, createExpenseEntry, createExpenseMaterial, downloadExpenseReportXlsx, fetchClientExpenseMaterialRules, fetchClients, fetchExpenseDebts, fetchExpenseEntries, fetchExpenseMaterialMovements, fetchExpenseMaterials, fetchExpensePayroll, fetchExpenseReport, resetExpensePayrollCounter, updateExpensePayrollRate, updateClientExpenseMaterialRule, updateExpenseMaterial, } from '../../lib/api';
import './expenses.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';
const tabs = [
    { id: 'overview', label: 'Обзор и отчёт' },
    { id: 'payroll', label: 'ФОТ' },
    { id: 'materials', label: 'Расходные материалы' },
    { id: 'rules', label: 'Настройки клиентов' },
    { id: 'entries', label: 'Все расходы' },
    { id: 'debts', label: 'Задолженность клиентов' },
];
const expenseCategories = [
    { value: 'MATERIALS', label: 'Расходные материалы' },
    { value: 'LOGISTICS', label: 'Логистика' },
    { value: 'PAYROLL_PICKERS', label: 'ФОТ сборщиков' },
    { value: 'HANDLING_PPR', label: 'ПРР' },
    { value: 'CONTRACT_WORK', label: 'Отдельные работы' },
    { value: 'RENT', label: 'Аренда' },
    { value: 'UTILITIES', label: 'Коммунальные услуги' },
    { value: 'TAXES', label: 'Налоги' },
    { value: 'SOFTWARE', label: 'ПО и сервисы' },
    { value: 'EQUIPMENT', label: 'Оборудование' },
    { value: 'MARKETING', label: 'Маркетинг' },
    { value: 'OTHER', label: 'Прочее' },
];
const initialPeriod = currentMonthPeriod();
export function ExpensesPanel({ session }) {
    const canWrite = canUse(session, 'expenses:write');
    const [activeTab, setActiveTab] = useState('overview');
    const [clients, setClients] = useState([]);
    const [materials, setMaterials] = useState([]);
    const [entries, setEntries] = useState([]);
    const [report, setReport] = useState(null);
    const [payroll, setPayroll] = useState(null);
    const [debts, setDebts] = useState(null);
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const rulesClientId = selectedClientId;
    const setRulesClientId = setSelectedClientId;
    const [rules, setRules] = useState(null);
    const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
    const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
    const [category, setCategory] = useState('');
    const [loading, setLoading] = useState(true);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        void loadAll();
    }, [selectedClientId, dateFrom, dateTo, category]);
    useEffect(() => {
        if (!rulesClientId) {
            setRules(null);
            return;
        }
        void loadRules(rulesClientId);
    }, [rulesClientId]);
    async function loadAll() {
        setLoading(true);
        setError(null);
        const filter = {
            clientId: selectedClientId || undefined,
            category: category || undefined,
            dateFrom,
            dateTo,
        };
        try {
            const [nextClients, nextMaterials, nextEntries, nextReport, nextDebts, nextPayroll] = await Promise.all([
                fetchClients(session.accessToken),
                fetchExpenseMaterials(session.accessToken),
                fetchExpenseEntries(session.accessToken, filter),
                fetchExpenseReport(session.accessToken, filter),
                fetchExpenseDebts(session.accessToken, selectedClientId || undefined),
                fetchExpensePayroll(session.accessToken, { dateFrom, dateTo }),
            ]);
            setClients(nextClients);
            setMaterials(nextMaterials);
            setEntries(nextEntries);
            setReport(nextReport);
            setDebts(nextDebts);
            setPayroll(nextPayroll);
            if (!rulesClientId && nextClients.length > 0) {
                setRulesClientId(nextClients[0].id);
            }
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setLoading(false);
        }
    }
    async function loadRules(clientId) {
        setRulesLoading(true);
        setError(null);
        try {
            setRules(await fetchClientExpenseMaterialRules(session.accessToken, clientId));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setRulesLoading(false);
        }
    }
    async function downloadReport() {
        setError(null);
        try {
            const blob = await downloadExpenseReportXlsx(session.accessToken, {
                clientId: selectedClientId || undefined,
                category: category || undefined,
                dateFrom,
                dateTo,
            });
            downloadBlob(blob, `Расходы_${dateFrom}_${dateTo}.xlsx`);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    function notify(text) {
        setMessage(text);
        window.setTimeout(() => setMessage(null), 4500);
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u0424\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0439 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C", title: "\u0420\u0430\u0441\u0445\u043E\u0434\u044B", description: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u0441 \u0447\u0435\u043C \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442\u0435: \u043E\u0442\u0447\u0451\u0442\u043D\u043E\u0441\u0442\u044C\u044E, \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u044B\u043C\u0438 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u0430\u043C\u0438, \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u043C\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438\u043B\u0438 \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C\u044E.", tiles: [
            { title: 'Обзор и отчёт', description: 'Расходы за период и выгрузка в Excel.', icon: WalletCards, tone: 'blue', onOpen: () => setActiveTab('overview') },
            { title: 'ФОТ', description: 'Выработка пользователей ТСД, ставки и сумма оплаты.', icon: UsersRound, tone: 'violet', onOpen: () => setActiveTab('payroll') },
            { title: 'Расходные материалы', description: 'Остатки упаковки и движение материалов.', icon: Boxes, tone: 'green', onOpen: () => setActiveTab('materials') },
            { title: 'Правила клиентов', description: 'Настроить автоматическое списание материалов.', icon: Wrench, tone: 'violet', onOpen: () => setActiveTab('rules') },
            { title: 'Все расходы', description: 'Ручные и автоматические начисления по категориям.', icon: HandCoins, tone: 'orange', onOpen: () => setActiveTab('entries') },
            { title: 'Задолженность', description: 'Проверить долг клиентов по материалам и услугам.', icon: AlertTriangle, tone: 'red', onOpen: () => setActiveTab('debts') },
        ], children: _jsxs("section", { className: "expenses-panel", "aria-label": "\u0420\u0430\u0441\u0445\u043E\u0434\u044B", children: [_jsxs("header", { className: "expenses-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0424\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0439 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C" }), _jsx("h2", { children: "\u0420\u0430\u0441\u0445\u043E\u0434\u044B" }), _jsx("p", { children: "\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B, \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430, \u0424\u041E\u0422, \u041F\u0420\u0420, \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B \u0438 \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432 \u0432 \u043E\u0434\u043D\u043E\u043C \u043A\u043E\u043D\u0442\u0443\u0440\u0435." })] }), _jsxs("div", { className: "expenses-header__actions", children: [_jsxs("button", { className: "secondary-button", type: "button", onClick: () => void downloadReport(), children: [_jsx(Download, { size: 17 }), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C Excel"] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadAll(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", children: _jsx(RefreshCw, { size: 18 }) })] })] }), _jsxs("div", { className: "expenses-filters", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: dateFrom, onChange: (event) => setDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u043F\u043E" }), _jsx("input", { type: "date", value: dateTo, onChange: (event) => setDateTo(event.target.value) })] }), activeTab !== 'payroll' ? _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.name, " (", client.code, ")"] }, client.id)))] })] }) : null, activeTab !== 'payroll' ? _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F" }), _jsxs("select", { value: category, onChange: (event) => setCategory(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438" }), expenseCategories.map((item) => (_jsx("option", { value: item.value, children: item.label }, item.value)))] })] }) : null] }), _jsx("nav", { className: "expenses-tabs", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432", children: tabs.map((tab) => (_jsx("button", { className: activeTab === tab.id ? 'active' : '', type: "button", onClick: () => setActiveTab(tab.id), children: tab.label }, tab.id))) }), error ? _jsx("div", { className: "panel-message panel-message--error", children: error }) : null, message ? _jsx("div", { className: "panel-message panel-message--success", children: message }) : null, loading ? _jsx("div", { className: "expenses-loading", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435\u2026" }) : null, !loading && activeTab === 'overview' ? (_jsx(ExpenseOverview, { report: report, materials: materials, debts: debts })) : null, !loading && activeTab === 'payroll' ? (_jsx(PayrollWorkspace, { session: session, report: payroll, canWrite: canWrite, onChanged: () => void loadAll(), notify: notify, setError: setError })) : null, !loading && activeTab === 'materials' ? (_jsx(MaterialsWorkspace, { session: session, materials: materials, canWrite: canWrite, onChanged: () => void loadAll(), notify: notify, setError: setError })) : null, !loading && activeTab === 'rules' ? (_jsx(MaterialRulesWorkspace, { session: session, clients: clients, clientId: rulesClientId, setClientId: setRulesClientId, rules: rules, loading: rulesLoading, canWrite: canWrite, onSaved: (next) => {
                        setRules(next);
                        notify('Настройка автоматического списания сохранена.');
                    }, setError: setError })) : null, !loading && activeTab === 'entries' ? (_jsx(ExpenseEntriesWorkspace, { session: session, clients: clients, entries: entries, canWrite: canWrite, onChanged: () => void loadAll(), notify: notify, setError: setError })) : null, !loading && activeTab === 'debts' ? _jsx(ClientDebts, { report: debts }) : null] }) }));
}
function PayrollWorkspace({ session, report, canWrite, onChanged, notify, setError, }) {
    const [rateDrafts, setRateDrafts] = useState({});
    const [savingUserId, setSavingUserId] = useState('');
    const [resettingUserId, setResettingUserId] = useState('');
    useEffect(() => {
        if (!report)
            return;
        setRateDrafts(Object.fromEntries(report.workers.map((worker) => [worker.userId, String(worker.rateRub)])));
    }, [report]);
    async function saveRate(worker) {
        const rateRub = Number(rateDrafts[worker.userId]);
        if (!Number.isFinite(rateRub) || rateRub < 0) {
            setError('Ставка должна быть положительным числом или нулём.');
            return;
        }
        setSavingUserId(worker.userId);
        setError(null);
        try {
            await updateExpensePayrollRate(session.accessToken, worker.userId, rateRub);
            notify(`Ставка для ${worker.userName} сохранена: ${formatMoney(rateRub)} ₽/ед.`);
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSavingUserId('');
        }
    }
    async function resetCounter(worker) {
        if (!window.confirm(`Обнулить счётчик сборщицы «${worker.userName}»?\n\nЕдиницы, заказы и сумма к выплате начнут считаться заново с текущего момента. Выполненные задания и история не удалятся.`))
            return;
        setResettingUserId(worker.userId);
        setError(null);
        try {
            const result = await resetExpensePayrollCounter(session.accessToken, worker.userId);
            notify(result.message);
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setResettingUserId('');
        }
    }
    if (!report)
        return _jsx("div", { className: "expenses-empty", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0440\u0430\u0441\u0447\u0451\u0442 \u0424\u041E\u0422." });
    return (_jsxs("div", { className: "expenses-workspace expenses-payroll", children: [_jsxs("div", { className: "expenses-workspace__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0420\u0430\u0441\u0447\u0451\u0442 \u043F\u043E \u0444\u0430\u043A\u0442\u0443 \u0422\u0421\u0414" }), _jsx("h3", { children: "\u0424\u041E\u0422 \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u043E\u0432" }), _jsxs("p", { children: ["\u0423\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 FBS-\u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u043F\u0438\u043A\u0430\u043D\u043D\u044B\u0435 \u0435\u0434\u0438\u043D\u0438\u0446\u044B. \u0421\u0442\u0430\u0432\u043A\u0430 \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u2014 ", formatMoney(report.defaultRateRub), " \u20BD \u0437\u0430 \u0435\u0434\u0438\u043D\u0438\u0446\u0443."] })] }), _jsxs("strong", { children: [formatDate(report.period.from), " \u2014 ", formatDate(new Date(new Date(report.period.to).getTime() - 1).toISOString())] })] }), _jsxs("div", { className: "expenses-payroll__summary", children: [_jsxs("article", { children: [_jsx("span", { children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439 \u0422\u0421\u0414" }), _jsx("strong", { children: report.summary.users }), _jsxs("small", { children: ["\u0420\u0430\u0431\u043E\u0442\u0430\u043B\u0438: ", report.summary.activeWorkers] })] }), _jsxs("article", { children: [_jsx("span", { children: "\u041E\u0442\u043F\u0438\u043A\u0430\u043D\u043E \u0435\u0434\u0438\u043D\u0438\u0446" }), _jsx("strong", { children: report.summary.units }), _jsxs("small", { children: [report.summary.orders, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0423\u0447\u0442\u0451\u043D\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F" }), _jsx("strong", { children: formatDurationSeconds(report.summary.productiveDurationSeconds) }), _jsx("small", { children: "\u0421\u0443\u043C\u043C\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u043F\u043E \u0437\u0430\u0434\u0430\u043D\u0438\u044F\u043C" })] }), _jsxs("article", { className: "is-total", children: [_jsx("span", { children: "\u041A \u0432\u044B\u043F\u043B\u0430\u0442\u0435" }), _jsxs("strong", { children: [formatMoney(report.summary.payrollRub), " \u20BD"] }), _jsx("small", { children: "\u041F\u043E \u0438\u043D\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043B\u044C\u043D\u044B\u043C \u0441\u0442\u0430\u0432\u043A\u0430\u043C" })] })] }), _jsx("div", { className: "expenses-payroll-table-wrap", children: _jsxs("table", { className: "expenses-payroll-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0422\u0421\u0414" }), _jsx("th", { children: "\u0415\u0434\u0438\u043D\u0438\u0446" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("th", { children: "\u041D\u0430\u0447\u0430\u043B\u043E" }), _jsx("th", { children: "\u041A\u043E\u043D\u0435\u0446" }), _jsx("th", { children: "\u0412\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u044B" }), _jsx("th", { children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 / \u0435\u0434." }), _jsx("th", { children: "\u0421\u0442\u0430\u0432\u043A\u0430, \u20BD/\u0435\u0434." }), _jsx("th", { children: "\u041A \u0432\u044B\u043F\u043B\u0430\u0442\u0435" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsx("tbody", { children: report.workers.map((worker) => (_jsxs("tr", { className: worker.units ? undefined : 'is-idle', children: [_jsxs("td", { children: [_jsx("strong", { children: worker.userName }), _jsx("span", { children: worker.email }), _jsx("small", { children: worker.deviceCodes.length ? worker.deviceCodes.join(' · ') : 'Устройство не привязано' }), worker.resetAt ? _jsxs("small", { className: "expenses-payroll-reset-note", children: ["\u0421\u0447\u0451\u0442\u0447\u0438\u043A \u0441 ", formatPayrollTime(worker.resetAt)] }) : null] }), _jsx("td", { children: _jsx("b", { children: worker.units }) }), _jsx("td", { children: worker.orders }), _jsx("td", { children: worker.workStartedAt ? formatPayrollTime(worker.workStartedAt) : '—' }), _jsx("td", { children: worker.workEndedAt ? formatPayrollTime(worker.workEndedAt) : '—' }), _jsx("td", { children: formatDurationSeconds(worker.workSpanSeconds) }), _jsx("td", { children: formatDurationSeconds(worker.averageDurationSecondsPerUnit) }), _jsxs("td", { children: [_jsxs("div", { className: "expenses-payroll-rate", children: [_jsx("input", { type: "number", min: "0", step: "0.01", value: rateDrafts[worker.userId] ?? String(worker.rateRub), disabled: !canWrite || savingUserId === worker.userId, onChange: (event) => setRateDrafts((current) => ({ ...current, [worker.userId]: event.target.value })), "aria-label": `Ставка ${worker.userName} за единицу` }), canWrite ? _jsx("button", { type: "button", onClick: () => void saveRate(worker), disabled: savingUserId === worker.userId || Number(rateDrafts[worker.userId]) === worker.rateRub, title: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0441\u0442\u0430\u0432\u043A\u0443", children: _jsx(Save, { size: 14 }) }) : null] }), _jsx("small", { children: worker.rateIsDefault ? 'по умолчанию' : 'индивидуальная' })] }), _jsx("td", { children: _jsxs("strong", { children: [formatMoney(worker.payrollRub), " \u20BD"] }) }), _jsx("td", { children: canWrite ? _jsxs("button", { type: "button", className: "expenses-payroll-reset", onClick: () => void resetCounter(worker), disabled: resettingUserId === worker.userId, title: "\u041E\u0431\u043D\u0443\u043B\u0438\u0442\u044C \u0435\u0434\u0438\u043D\u0438\u0446\u044B, \u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u0441\u0443\u043C\u043C\u0443 \u044D\u0442\u043E\u0433\u043E \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430, \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044E", children: [_jsx(RotateCcw, { size: 14, className: resettingUserId === worker.userId ? 'is-spinning' : undefined }), resettingUserId === worker.userId ? 'Обнуление…' : 'Обнулить счётчик'] }) : '—' })] }, worker.userId))) })] }) }), report.workers.length === 0 ? _jsx("div", { className: "expenses-empty", children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0422\u0421\u0414 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u044B." }) : null] }));
}
function ExpenseOverview({ report, materials, debts, }) {
    if (!report)
        return _jsx("div", { className: "expenses-empty", children: "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434." });
    const maxCategory = Math.max(1, ...report.byCategory.map((item) => item.amountRub));
    const maxDay = Math.max(1, ...report.daily.map((item) => item.amountRub));
    const lowStock = materials.filter((material) => material.isActive && material.isLowStock);
    return (_jsxs("div", { className: "expenses-dashboard", children: [_jsxs("div", { className: "expenses-metrics", children: [_jsx(MetricCard, { icon: WalletCards, label: "\u0412\u0441\u0435\u0433\u043E \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432", value: report.totals.totalRub, tone: "primary" }), _jsx(MetricCard, { icon: Boxes, label: "\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B", value: report.totals.materialsRub }), _jsx(MetricCard, { icon: Truck, label: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430", value: report.totals.logisticsRub }), _jsx(MetricCard, { icon: UsersRound, label: "\u0424\u041E\u0422 \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u043E\u0432", value: report.totals.payrollPickersRub }), _jsx(MetricCard, { icon: HandCoins, label: "\u041F\u0420\u0420", value: report.totals.handlingPprRub }), _jsx(MetricCard, { icon: Wrench, label: "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B", value: report.totals.contractWorkRub }), _jsx(MetricCard, { icon: AlertTriangle, label: "\u0414\u043E\u043B\u0433 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", value: debts?.totals.debtRub ?? 0, tone: "warning" })] }), _jsxs("div", { className: "expenses-dashboard__grid", children: [_jsxs("article", { className: "expenses-card", children: [_jsxs("div", { className: "expenses-card__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430" }), _jsx("h3", { children: "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F\u043C" })] }), _jsxs("strong", { children: [report.totals.entriesCount, " \u0437\u0430\u043F\u0438\u0441\u0435\u0439"] })] }), _jsxs("div", { className: "expense-bars", children: [report.byCategory.filter((item) => item.amountRub > 0).map((item) => (_jsxs("div", { className: "expense-bar", children: [_jsxs("div", { children: [_jsx("span", { children: categoryLabel(item.category) }), _jsxs("strong", { children: [formatMoney(item.amountRub), " \u20BD"] })] }), _jsx("i", { style: { width: `${Math.max(3, (item.amountRub / maxCategory) * 100)}%` } })] }, item.category))), report.byCategory.every((item) => item.amountRub === 0) ? _jsx("p", { children: "\u0420\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) : null] })] }), _jsxs("article", { className: "expenses-card", children: [_jsx("div", { className: "expenses-card__heading", children: _jsxs("div", { children: [_jsx("span", { children: "\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430" }), _jsx("h3", { children: "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u0434\u043D\u044F\u043C" })] }) }), _jsxs("div", { className: "expense-days", children: [report.daily.map((item) => (_jsxs("div", { title: `${formatDate(item.date)} — ${formatMoney(item.amountRub)} ₽`, children: [_jsx("i", { style: { height: `${Math.max(6, (item.amountRub / maxDay) * 100)}%` } }), _jsx("span", { children: new Date(item.date).getDate() })] }, item.date))), report.daily.length === 0 ? _jsx("p", { children: "\u041D\u0435\u0442 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434." }) : null] })] }), _jsxs("article", { className: "expenses-card", children: [_jsx("div", { className: "expenses-card__heading", children: _jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u0441\u043A\u043B\u0430\u0434\u0430" }), _jsx("h3", { children: "\u0417\u0430\u043A\u0430\u043D\u0447\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B" })] }) }), _jsxs("div", { className: "expenses-alert-list", children: [lowStock.slice(0, 8).map((material) => (_jsxs("div", { children: [_jsx(AlertTriangle, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: material.name }), _jsxs("small", { children: ["\u041E\u0441\u0442\u0430\u0442\u043E\u043A ", formatQuantity(material.stockQuantity), " ", material.unit, "; \u043C\u0438\u043D\u0438\u043C\u0443\u043C ", formatQuantity(material.minStockQuantity)] })] })] }, material.id))), lowStock.length === 0 ? _jsx("p", { children: "\u0412\u0441\u0435 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B \u0432\u044B\u0448\u0435 \u043C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430." }) : null] })] }), _jsxs("article", { className: "expenses-card", children: [_jsx("div", { className: "expenses-card__heading", children: _jsxs("div", { children: [_jsx("span", { children: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435" }), _jsx("h3", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u0438 \u043E\u0431\u0449\u0438\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B" })] }) }), _jsx("div", { className: "expenses-client-costs", children: report.byClient.slice(0, 10).map((item, index) => (_jsxs("div", { children: [_jsx("span", { children: item.client ? `${item.client.name} (${item.client.code})` : 'Общехозяйственные расходы' }), _jsxs("strong", { children: [formatMoney(item.amountRub), " \u20BD"] })] }, item.client?.id ?? `overhead-${index}`))) })] }), _jsxs("article", { className: "expenses-card", children: [_jsx("div", { className: "expenses-card__heading", children: _jsxs("div", { children: [_jsx("span", { children: "\u0424\u041E\u0422 \u0438 \u0440\u0430\u0431\u043E\u0442\u044B" }), _jsx("h3", { children: "\u0417\u0430\u0442\u0440\u0430\u0442\u044B \u043F\u043E \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430\u043C" })] }) }), _jsxs("div", { className: "expenses-client-costs", children: [report.byWorker.slice(0, 10).map((worker) => (_jsxs("div", { children: [_jsxs("span", { children: [worker.workerName, _jsxs("small", { children: ["\u0424\u041E\u0422 ", formatMoney(worker.payrollPickersRub), " \u20BD \u00B7 \u041F\u0420\u0420", ' ', formatMoney(worker.handlingPprRub), " \u20BD \u00B7 \u0440\u0430\u0431\u043E\u0442\u044B", ' ', formatMoney(worker.contractWorkRub), " \u20BD"] })] }), _jsxs("strong", { children: [formatMoney(worker.totalRub), " \u20BD"] })] }, worker.workerName))), report.byWorker.length === 0 ? (_jsx("p", { children: "\u0420\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u0441 \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u043C \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u0435\u043C \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." })) : null] })] })] })] }));
}
function MetricCard({ icon: Icon, label, value, tone = 'default', }) {
    return (_jsxs("article", { className: `expense-metric expense-metric--${tone}`, children: [_jsx(Icon, { size: 20 }), _jsx("span", { children: label }), _jsxs("strong", { children: [formatMoney(value), " \u20BD"] })] }));
}
function MaterialsWorkspace({ session, materials, canWrite, onChanged, notify, setError, }) {
    const [showCreate, setShowCreate] = useState(false);
    const [selected, setSelected] = useState(null);
    const [mode, setMode] = useState(null);
    const [movements, setMovements] = useState([]);
    const [form, setForm] = useState({
        code: '',
        name: '',
        unit: 'шт.',
        initialQuantity: '0',
        averageUnitCostRub: '0',
        minStockQuantity: '0',
        comment: '',
    });
    const [stockForm, setStockForm] = useState({
        type: 'PURCHASE',
        quantity: '',
        unitCostRub: '',
        expenseDate: todayInput(),
        comment: '',
    });
    const [saving, setSaving] = useState(false);
    async function submitMaterial(event) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await createExpenseMaterial(session.accessToken, {
                code: form.code,
                name: form.name,
                unit: form.unit,
                initialQuantity: Number(form.initialQuantity),
                averageUnitCostRub: Number(form.averageUnitCostRub),
                minStockQuantity: Number(form.minStockQuantity),
                comment: form.comment || undefined,
            });
            setForm({ code: '', name: '', unit: 'шт.', initialQuantity: '0', averageUnitCostRub: '0', minStockQuantity: '0', comment: '' });
            setShowCreate(false);
            notify('Расходный материал создан.');
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSaving(false);
        }
    }
    async function submitStock(event) {
        event.preventDefault();
        if (!selected)
            return;
        setSaving(true);
        setError(null);
        try {
            await addExpenseMaterialStock(session.accessToken, selected.id, {
                type: stockForm.type,
                quantity: Number(stockForm.quantity),
                unitCostRub: stockForm.unitCostRub === '' ? undefined : Number(stockForm.unitCostRub),
                expenseDate: stockForm.expenseDate,
                comment: stockForm.comment || undefined,
            });
            setStockForm({ type: 'PURCHASE', quantity: '', unitCostRub: '', expenseDate: todayInput(), comment: '' });
            setMode(null);
            setSelected(null);
            notify(stockForm.type === 'PURCHASE' ? 'Приход материала учтён в расходах и остатках.' : 'Остаток материала скорректирован.');
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSaving(false);
        }
    }
    async function openHistory(material) {
        setSelected(material);
        setMode('history');
        setError(null);
        try {
            setMovements(await fetchExpenseMaterialMovements(session.accessToken, material.id));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    async function toggleActive(material) {
        setError(null);
        try {
            await updateExpenseMaterial(session.accessToken, material.id, { isActive: !material.isActive });
            notify(material.isActive ? 'Материал отключён.' : 'Материал включён.');
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    return (_jsxs("div", { className: "expenses-workspace", children: [_jsxs("div", { className: "expenses-workspace__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0421\u043A\u043B\u0430\u0434 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u044B\u0445 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u043E\u0432" }), _jsx("p", { children: "\u0417\u0430\u043A\u0443\u043F\u043A\u0438 \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0432\u0430\u044E\u0442 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0438 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u043E\u0442\u0447\u0451\u0442 \u043F\u043E \u0440\u0430\u0441\u0445\u043E\u0434\u0430\u043C." })] }), canWrite ? (_jsxs("button", { className: "primary-button", type: "button", onClick: () => setShowCreate((value) => !value), children: [_jsx(Plus, { size: 17 }), " \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B"] })) : null] }), showCreate ? (_jsxs("form", { className: "expenses-form expenses-form--material", onSubmit: submitMaterial, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0434" }), _jsx("input", { required: true, value: form.code, onChange: (e) => setForm({ ...form, code: e.target.value }), placeholder: "PACK_17X21" })] }), _jsxs("label", { className: "wide", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "\u041A\u0443\u0440\u044C\u0435\u0440\u0441\u043A\u0438\u0439 \u043F\u0430\u043A\u0435\u0442 17 \u00D7 21 \u0441\u043C" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434. \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u044F" }), _jsx("input", { required: true, value: form.unit, onChange: (e) => setForm({ ...form, unit: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0447\u0430\u043B\u044C\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("input", { type: "number", min: "0", step: "0.001", value: form.initialQuantity, onChange: (e) => setForm({ ...form, initialQuantity: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C, \u20BD" }), _jsx("input", { type: "number", min: "0", step: "0.0001", value: form.averageUnitCostRub, onChange: (e) => setForm({ ...form, averageUnitCostRub: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("input", { type: "number", min: "0", step: "0.001", value: form.minStockQuantity, onChange: (e) => setForm({ ...form, minStockQuantity: e.target.value }) })] }), _jsxs("label", { className: "wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: form.comment, onChange: (e) => setForm({ ...form, comment: e.target.value }) })] }), _jsxs("button", { className: "primary-button", disabled: saving, type: "submit", children: [_jsx(Save, { size: 16 }), " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"] })] })) : null, _jsx("div", { className: "expenses-table-wrap", children: _jsxs("table", { className: "expenses-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A" }), _jsx("th", { children: "\u041C\u0438\u043D\u0438\u043C\u0443\u043C" }), _jsx("th", { children: "\u0421\u0440\u0435\u0434\u043D\u044F\u044F \u0446\u0435\u043D\u0430" }), _jsx("th", { children: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0430" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u043E\u0432" }), _jsx("th", {})] }) }), _jsx("tbody", { children: materials.map((material) => (_jsxs("tr", { className: material.isLowStock ? 'danger-row' : material.isActive ? '' : 'muted-row', children: [_jsxs("td", { children: [_jsx("strong", { children: material.name }), _jsx("small", { children: material.code })] }), _jsx("td", { children: _jsxs("strong", { children: [formatQuantity(material.stockQuantity), " ", material.unit] }) }), _jsxs("td", { children: [formatQuantity(material.minStockQuantity), " ", material.unit] }), _jsxs("td", { children: [formatMoney(material.averageUnitCostRub), " \u20BD"] }), _jsxs("td", { children: [formatMoney(material.stockValueRub), " \u20BD"] }), _jsx("td", { children: material.rulesCount }), _jsx("td", { children: _jsxs("div", { className: "table-actions", children: [canWrite ? _jsx("button", { type: "button", onClick: () => { setSelected(material); setMode('stock'); }, children: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0435" }) : null, _jsx("button", { type: "button", onClick: () => void openHistory(material), children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F" }), canWrite ? _jsx("button", { type: "button", onClick: () => void toggleActive(material), children: material.isActive ? 'Отключить' : 'Включить' }) : null] }) })] }, material.id))) })] }) }), selected && mode === 'stock' ? (_jsxs("form", { className: "expenses-side-card", onSubmit: submitStock, children: [_jsxs("div", { children: [_jsx("span", { children: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0435 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u0430" }), _jsx("h4", { children: selected.name })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F" }), _jsxs("select", { value: stockForm.type, onChange: (e) => setStockForm({ ...stockForm, type: e.target.value }), children: [_jsx("option", { value: "PURCHASE", children: "\u0417\u0430\u043A\u0443\u043F\u043A\u0430 / \u043F\u0440\u0438\u0445\u043E\u0434" }), _jsx("option", { value: "ADJUSTMENT", children: "\u041A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0430 (+ \u0438\u043B\u0438 \u2212)" }), _jsx("option", { value: "WRITE_OFF", children: "\u0421\u043F\u0438\u0441\u0430\u043D\u0438\u0435" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { required: true, type: "number", step: "0.001", value: stockForm.quantity, onChange: (e) => setStockForm({ ...stockForm, quantity: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430 \u0437\u0430 \u0435\u0434\u0438\u043D\u0438\u0446\u0443, \u20BD" }), _jsx("input", { type: "number", min: "0", step: "0.0001", value: stockForm.unitCostRub, onChange: (e) => setStockForm({ ...stockForm, unitCostRub: e.target.value }), placeholder: String(selected.averageUnitCostRub) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: stockForm.expenseDate, onChange: (e) => setStockForm({ ...stockForm, expenseDate: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { value: stockForm.comment, onChange: (e) => setStockForm({ ...stockForm, comment: e.target.value }) })] }), _jsxs("div", { className: "form-actions", children: [_jsx("button", { className: "secondary-button", type: "button", onClick: () => setMode(null), children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), _jsx("button", { className: "primary-button", disabled: saving, type: "submit", children: "\u041F\u0440\u043E\u0432\u0435\u0441\u0442\u0438" })] })] })) : null, selected && mode === 'history' ? (_jsxs("div", { className: "expenses-side-card expenses-side-card--history", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439" }), _jsx("h4", { children: selected.name })] }), _jsxs("div", { className: "material-movements", children: [movements.map((movement) => (_jsxs("div", { children: [_jsxs("i", { className: movement.quantity < 0 ? 'out' : 'in', children: [movement.quantity > 0 ? '+' : '', formatQuantity(movement.quantity)] }), _jsxs("span", { children: [_jsx("strong", { children: movementLabel(movement.type) }), _jsxs("small", { children: [formatDateTime(movement.createdAt), movement.client ? ` · ${movement.client.name}` : '', movement.request ? ` · заявка №${String(movement.request.number).padStart(6, '0')}` : ''] })] }), _jsx("em", { children: movement.comment })] }, movement.id))), movements.length === 0 ? _jsx("p", { children: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) : null] }), _jsx("button", { className: "secondary-button", type: "button", onClick: () => setMode(null), children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" })] })) : null] }));
}
function MaterialRulesWorkspace({ session, clients, clientId, setClientId, rules, loading, canWrite, onSaved, setError, }) {
    return (_jsxs("div", { className: "expenses-workspace", children: [_jsxs("div", { className: "expenses-workspace__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043F\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0443" }), _jsx("p", { children: "\u041F\u0440\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0438 \u0437\u0430\u044F\u0432\u043A\u0438 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B \u0441\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0435\u0434\u0438\u043D\u0438\u0446. \u0415\u0441\u043B\u0438 \u00AB\u0441\u0447\u0438\u0442\u0430\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u00BB \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E, \u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0432\u0445\u043E\u0434\u0438\u0442 \u0432 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 \u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043D\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u044F\u0435\u0442\u0441\u044F." })] }), _jsxs("label", { className: "rules-client-select", children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => _jsxs("option", { value: client.id, children: [client.name, " (", client.code, ")"] }, client.id)) })] })] }), loading ? _jsx("div", { className: "expenses-loading", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438\u2026" }) : null, !loading && rules ? (_jsxs("div", { className: "material-rules", children: [rules.materials.map((item) => (_jsx(MaterialRuleRow, { session: session, clientId: clientId, item: item, canWrite: canWrite, onSaved: onSaved, setError: setError }, item.material.id))), rules.materials.length === 0 ? _jsx("div", { className: "expenses-empty", children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u044B\u0435 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B." }) : null] })) : null] }));
}
function MaterialRuleRow({ session, clientId, item, canWrite, onSaved, setError, }) {
    const [enabled, setEnabled] = useState(item.isEnabled);
    const [quantity, setQuantity] = useState(String(item.quantityPerShippedUnit));
    const [separate, setSeparate] = useState(item.chargeSeparately);
    const [price, setPrice] = useState(item.billingUnitPriceRub == null ? '' : String(item.billingUnitPriceRub));
    const [comment, setComment] = useState(item.comment ?? '');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setEnabled(item.isEnabled);
        setQuantity(String(item.quantityPerShippedUnit));
        setSeparate(item.chargeSeparately);
        setPrice(item.billingUnitPriceRub == null ? '' : String(item.billingUnitPriceRub));
        setComment(item.comment ?? '');
    }, [item]);
    async function save() {
        setSaving(true);
        setError(null);
        try {
            onSaved(await updateClientExpenseMaterialRule(session.accessToken, clientId, item.material.id, {
                isEnabled: enabled,
                quantityPerShippedUnit: Number(quantity),
                chargeSeparately: separate,
                billingUnitPriceRub: separate ? Number(price) : undefined,
                comment: comment || undefined,
            }));
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("article", { className: `material-rule ${enabled ? 'active' : ''}`, children: [_jsxs("div", { className: "material-rule__name", children: [_jsx("span", { children: item.material.code }), _jsx("strong", { children: item.material.name }), _jsxs("small", { children: ["\u041D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435: ", formatQuantity(item.material.stockQuantity), " ", item.material.unit] })] }), _jsxs("label", { className: "switch-field", children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: (e) => setEnabled(e.target.checked), disabled: !canWrite }), _jsx("span", { children: "\u0421\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430 1 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u0443\u044E \u0435\u0434." }), _jsx("input", { type: "number", min: "0.001", step: "0.001", value: quantity, onChange: (e) => setQuantity(e.target.value), disabled: !canWrite || !enabled })] }), _jsxs("label", { className: "switch-field", children: [_jsx("input", { type: "checkbox", checked: separate, onChange: (e) => setSeparate(e.target.checked), disabled: !canWrite || !enabled }), _jsx("span", { children: "\u0421\u0447\u0438\u0442\u0430\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0443, \u20BD" }), _jsx("input", { type: "number", min: "0", step: "0.01", value: price, onChange: (e) => setPrice(e.target.value), disabled: !canWrite || !enabled || !separate, placeholder: separate ? 'Обязательно' : 'Входит в обработку' })] }), _jsxs("label", { className: "wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (e) => setComment(e.target.value), disabled: !canWrite })] }), canWrite ? _jsxs("button", { className: "primary-button", type: "button", onClick: () => void save(), disabled: saving, children: [_jsx(Save, { size: 16 }), " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"] }) : null] }));
}
function ExpenseEntriesWorkspace({ session, clients, entries, canWrite, onChanged, notify, setError, }) {
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        category: 'LOGISTICS',
        expenseDate: todayInput(),
        description: '',
        amountRub: '',
        clientId: '',
        quantity: '',
        unit: '',
        unitPriceRub: '',
        workerName: '',
        comment: '',
    });
    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await createExpenseEntry(session.accessToken, {
                category: form.category,
                expenseDate: form.expenseDate,
                description: form.description,
                amountRub: Number(form.amountRub),
                clientId: form.clientId || undefined,
                quantity: form.quantity === '' ? undefined : Number(form.quantity),
                unit: form.unit || undefined,
                unitPriceRub: form.unitPriceRub === '' ? undefined : Number(form.unitPriceRub),
                workerName: form.workerName || undefined,
                comment: form.comment || undefined,
            });
            setForm({ category: 'LOGISTICS', expenseDate: todayInput(), description: '', amountRub: '', clientId: '', quantity: '', unit: '', unitPriceRub: '', workerName: '', comment: '' });
            setShowForm(false);
            notify('Расход добавлен.');
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSaving(false);
        }
    }
    async function cancel(entry) {
        if (!window.confirm(`Отменить расход «${entry.description}»?`))
            return;
        setError(null);
        try {
            await cancelExpenseEntry(session.accessToken, entry.id);
            notify('Расход отменён.');
            onChanged();
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
    }
    function setCalculation(nextQuantity, nextUnitPrice) {
        const calculatedAmount = nextQuantity !== '' && nextUnitPrice !== ''
            ? String(Math.round((Number(nextQuantity) * Number(nextUnitPrice) +
                Number.EPSILON) *
                100) / 100)
            : form.amountRub;
        setForm({
            ...form,
            quantity: nextQuantity,
            unitPriceRub: nextUnitPrice,
            amountRub: calculatedAmount,
        });
    }
    return (_jsxs("div", { className: "expenses-workspace", children: [_jsxs("div", { className: "expenses-workspace__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432" }), _jsx("p", { children: "\u0417\u0434\u0435\u0441\u044C \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430, \u0424\u041E\u0422, \u041F\u0420\u0420, \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B \u0438 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0437\u0430\u0442\u0440\u0430\u0442\u044B." })] }), canWrite ? _jsxs("button", { className: "primary-button", type: "button", onClick: () => setShowForm((value) => !value), children: [_jsx(Plus, { size: 17 }), " \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0440\u0430\u0441\u0445\u043E\u0434"] }) : null] }), showForm ? (_jsxs("form", { className: "expenses-form", onSubmit: submit, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F" }), _jsx("select", { value: form.category, onChange: (e) => setForm({ ...form, category: e.target.value }), children: expenseCategories.filter((item) => item.value !== 'MATERIALS').map((item) => _jsx("option", { value: item.value, children: item.label }, item.value)) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430" }), _jsx("input", { required: true, type: "date", value: form.expenseDate, onChange: (e) => setForm({ ...form, expenseDate: e.target.value }) })] }), _jsxs("label", { className: "wide", children: [_jsx("span", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: form.description, onChange: (e) => setForm({ ...form, description: e.target.value }), placeholder: "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u043D\u0430 \u0421\u0426, \u0437\u0430\u0440\u043F\u043B\u0430\u0442\u0430 \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u0430, \u0440\u0430\u0437\u0433\u0440\u0443\u0437\u043A\u0430\u2026" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0443\u043C\u043C\u0430, \u20BD" }), _jsx("input", { required: true, type: "number", min: "0.01", step: "0.01", value: form.amountRub, onChange: (e) => setForm({ ...form, amountRub: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 (\u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E)" }), _jsxs("select", { value: form.clientId, onChange: (e) => setForm({ ...form, clientId: e.target.value }), children: [_jsx("option", { value: "", children: "\u041E\u0431\u0449\u0438\u0439 \u0440\u0430\u0441\u0445\u043E\u0434" }), clients.map((client) => _jsxs("option", { value: client.id, children: [client.name, " (", client.code, ")"] }, client.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A / \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C" }), _jsx("input", { value: form.workerName, onChange: (e) => setForm({ ...form, workerName: e.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E / \u0447\u0430\u0441\u044B" }), _jsx("input", { type: "number", min: "0", step: "0.001", value: form.quantity, onChange: (e) => setCalculation(e.target.value, form.unitPriceRub) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430" }), _jsx("input", { value: form.unit, onChange: (e) => setForm({ ...form, unit: e.target.value }), placeholder: "\u0447\u0430\u0441, \u0440\u0435\u0439\u0441, \u0441\u043C\u0435\u043D\u0430" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0432\u043A\u0430, \u20BD" }), _jsx("input", { type: "number", min: "0", step: "0.0001", value: form.unitPriceRub, onChange: (e) => setCalculation(form.quantity, e.target.value) })] }), _jsxs("label", { className: "wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("textarea", { value: form.comment, onChange: (e) => setForm({ ...form, comment: e.target.value }) })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: saving, children: [_jsx(Save, { size: 16 }), " \u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0440\u0430\u0441\u0445\u043E\u0434"] })] })) : null, _jsxs("div", { className: "expenses-table-wrap", children: [_jsxs("table", { className: "expenses-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F" }), _jsx("th", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C" }), _jsx("th", { children: "\u0420\u0430\u0441\u0447\u0451\u0442" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", {})] }) }), _jsx("tbody", { children: entries.map((entry) => (_jsxs("tr", { className: entry.status === 'CANCELLED' ? 'muted-row' : '', children: [_jsx("td", { children: formatDate(entry.expenseDate) }), _jsx("td", { children: _jsx("span", { className: `expense-category expense-category--${entry.category.toLowerCase()}`, children: categoryLabel(entry.category) }) }), _jsxs("td", { children: [_jsx("strong", { children: entry.description }), _jsxs("small", { children: [sourceLabel(entry.source), entry.request ? ` · заявка №${String(entry.request.number).padStart(6, '0')}` : ''] })] }), _jsx("td", { children: entry.client ? `${entry.client.name} (${entry.client.code})` : 'Общий' }), _jsx("td", { children: entry.workerName ?? '—' }), _jsx("td", { children: entry.quantity == null ? '—' : `${formatQuantity(entry.quantity)} ${entry.unit ?? ''} × ${formatMoney(entry.unitPriceRub ?? 0)} ₽` }), _jsx("td", { children: _jsxs("strong", { children: [formatMoney(entry.amountRub), " \u20BD"] }) }), _jsx("td", { children: canWrite && entry.status === 'ACTIVE' && (entry.source === 'MANUAL' || entry.source === 'LOGISTICS') ? _jsx("button", { className: "table-link table-link--danger", type: "button", onClick: () => void cancel(entry), children: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C" }) : null })] }, entry.id))) })] }), entries.length === 0 ? _jsx("div", { className: "expenses-empty", children: "\u0420\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442." }) : null] })] }));
}
function ClientDebts({ report }) {
    const [expanded, setExpanded] = useState(null);
    if (!report)
        return _jsx("div", { className: "expenses-empty", children: "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u043F\u043E \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438." });
    return (_jsxs("div", { className: "expenses-workspace", children: [_jsxs("div", { className: "expenses-workspace__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0417\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432" }), _jsx("p", { children: "\u0414\u043E\u043B\u0433 \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D \u043F\u043E \u0432\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u043C \u0441\u0447\u0435\u0442\u0430\u043C \u0437\u0430 \u0432\u044B\u0447\u0435\u0442\u043E\u043C \u043E\u043F\u043B\u0430\u0442 \u0438 \u0430\u0432\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C, \u0437\u0430 \u0447\u0442\u043E \u043E\u043D \u0434\u043E\u043B\u0436\u0435\u043D." })] }), _jsxs("div", { className: "debt-total", children: [_jsx("span", { children: "\u041E\u0431\u0449\u0438\u0439 \u0434\u043E\u043B\u0433" }), _jsxs("strong", { children: [formatMoney(report.totals.debtRub), " \u20BD"] })] })] }), _jsxs("div", { className: "client-debts", children: [report.clients.map((client) => {
                        const isOpen = expanded === client.client.id;
                        const openInvoices = client.invoices.filter((invoice) => invoice.remainingRub > 0);
                        return (_jsxs("article", { className: client.overdueRub > 0 ? 'overdue' : '', children: [_jsxs("button", { type: "button", className: "client-debt__summary", onClick: () => setExpanded(isOpen ? null : client.client.id), children: [isOpen ? _jsx(ChevronDown, { size: 18 }) : _jsx(ChevronRight, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: client.client.name }), _jsxs("small", { children: [client.client.code, " \u00B7 \u043E\u0442\u043A\u0440\u044B\u0442\u043E \u0441\u0447\u0435\u0442\u043E\u0432: ", client.openInvoicesCount] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0410\u0432\u0430\u043D\u0441" }), _jsxs("strong", { children: [formatMoney(client.advanceRub), " \u20BD"] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E" }), _jsxs("strong", { children: [formatMoney(client.overdueRub), " \u20BD"] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0414\u043E\u043B\u0433" }), _jsxs("strong", { children: [formatMoney(client.debtRub), " \u20BD"] })] })] }), isOpen ? (_jsxs("div", { className: "client-debt__details", children: [openInvoices.map((invoice) => (_jsxs("section", { children: [_jsxs("header", { children: [_jsxs("span", { children: [_jsxs("strong", { children: ["\u0421\u0447\u0451\u0442 ", invoice.number] }), _jsxs("small", { children: [formatDate(invoice.periodFrom), " \u2014 ", formatDate(invoice.periodTo), invoice.dueDate ? ` · оплатить до ${formatDate(invoice.dueDate)}` : ''] })] }), _jsxs("strong", { children: [formatMoney(invoice.remainingRub), " \u20BD"] })] }), _jsxs("div", { children: [invoice.items.map((item) => (_jsxs("p", { children: [_jsxs("span", { children: [item.description, _jsxs("small", { children: [formatQuantity(item.quantity), " \u00D7 ", formatMoney(item.unitPriceRub), " \u20BD"] })] }), _jsxs("strong", { children: [formatMoney(item.totalRub), " \u20BD"] })] }, item.id))), invoice.items.length === 0 ? _jsx("p", { children: _jsx("span", { children: invoice.comment || 'Состав счёта не указан' }) }) : null] })] }, invoice.id))), openInvoices.length === 0 ? _jsx("p", { className: "expenses-empty", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0445 \u0441\u0447\u0435\u0442\u043E\u0432 \u043D\u0435\u0442." }) : null] })) : null] }, client.client.id));
                    }), report.clients.length === 0 ? _jsx("div", { className: "expenses-empty", children: "\u0417\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438 \u043D\u0435\u0442." }) : null] })] }));
}
function canUse(session, permission) {
    return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}
function categoryLabel(category) {
    return expenseCategories.find((item) => item.value === category)?.label ?? category;
}
function sourceLabel(source) {
    const labels = {
        MANUAL: 'Внесено вручную',
        MATERIAL_PURCHASE: 'Закупка материала',
        AUTO_MATERIAL_CONSUMPTION: 'Автосписание по отгрузке',
        MATERIAL_WRITE_OFF: 'Списание материала',
        LOGISTICS: 'Логистика',
    };
    return labels[source];
}
function movementLabel(type) {
    const labels = {
        INITIAL: 'Начальный остаток',
        PURCHASE: 'Закупка',
        CONSUMPTION: 'Автосписание',
        ADJUSTMENT: 'Корректировка',
        WRITE_OFF: 'Списание',
    };
    return labels[type];
}
function currentMonthPeriod() {
    const now = new Date();
    return {
        dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
        dateTo: todayInput(),
    };
}
function todayInput() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function formatQuantity(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}
function formatDate(value) {
    return new Date(value).toLocaleDateString('ru-RU');
}
function formatDateTime(value) {
    return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
function formatPayrollTime(value) {
    return new Date(value).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
function formatDurationSeconds(value) {
    if (value == null)
        return '—';
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0)
        return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
    if (minutes > 0)
        return `${minutes} мин ${String(seconds).padStart(2, '0')} сек`;
    return `${seconds} сек`;
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
function downloadBlob(blob, fileName) {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(href);
}
