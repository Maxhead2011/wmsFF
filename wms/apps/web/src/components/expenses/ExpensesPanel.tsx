import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  Download,
  HandCoins,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Truck,
  UsersRound,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  addExpenseMaterialStock,
  cancelExpenseEntry,
  createExpenseEntry,
  createExpenseMaterial,
  downloadExpenseReportXlsx,
  fetchClientExpenseMaterialRules,
  fetchClients,
  fetchExpenseDebts,
  fetchExpenseEntries,
  fetchExpenseMaterialMovements,
  fetchExpenseMaterials,
  fetchExpensePayroll,
  fetchExpenseReport,
  resetExpensePayrollCounter,
  updateExpensePayrollRate,
  updateClientExpenseMaterialRule,
  updateExpenseMaterial,
  type AuthSession,
  type ClientExpenseMaterialRules,
  type ClientSummary,
  type ExpenseCategory,
  type ExpenseDebtReport,
  type ExpenseEntry,
  type ExpenseMaterial,
  type ExpenseMaterialMovement,
  type ExpensePayrollReport,
  type ExpenseReport,
} from '../../lib/api';
import './expenses.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';

type ExpensesPanelProps = {
  session: AuthSession;
};

type Tab = 'overview' | 'payroll' | 'materials' | 'rules' | 'entries' | 'debts';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор и отчёт' },
  { id: 'payroll', label: 'ФОТ' },
  { id: 'materials', label: 'Расходные материалы' },
  { id: 'rules', label: 'Настройки клиентов' },
  { id: 'entries', label: 'Все расходы' },
  { id: 'debts', label: 'Задолженность клиентов' },
];

const expenseCategories: Array<{ value: ExpenseCategory; label: string }> = [
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

export function ExpensesPanel({ session }: ExpensesPanelProps) {
  const canWrite = canUse(session, 'expenses:write');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [materials, setMaterials] = useState<ExpenseMaterial[]>([]);
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [payroll, setPayroll] = useState<ExpensePayrollReport | null>(null);
  const [debts, setDebts] = useState<ExpenseDebtReport | null>(null);
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
  const rulesClientId = selectedClientId;
  const setRulesClientId = setSelectedClientId;
  const [rules, setRules] = useState<ClientExpenseMaterialRules | null>(null);
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [loading, setLoading] = useState(true);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const [nextClients, nextMaterials, nextEntries, nextReport, nextDebts, nextPayroll] =
        await Promise.all([
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadRules(clientId: string) {
    setRulesLoading(true);
    setError(null);
    try {
      setRules(
        await fetchClientExpenseMaterialRules(session.accessToken, clientId),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4500);
  }

  return (
    <WorkspaceTileGate
      eyebrow="Финансовый контроль"
      title="Расходы"
      description="Выберите, с чем работаете: отчётностью, расходными материалами, правилами клиента или задолженностью."
      tiles={[
        { title: 'Обзор и отчёт', description: 'Расходы за период и выгрузка в Excel.', icon: WalletCards, tone: 'blue', onOpen: () => setActiveTab('overview') },
        { title: 'ФОТ', description: 'Выработка пользователей ТСД, ставки и сумма оплаты.', icon: UsersRound, tone: 'violet', onOpen: () => setActiveTab('payroll') },
        { title: 'Расходные материалы', description: 'Остатки упаковки и движение материалов.', icon: Boxes, tone: 'green', onOpen: () => setActiveTab('materials') },
        { title: 'Правила клиентов', description: 'Настроить автоматическое списание материалов.', icon: Wrench, tone: 'violet', onOpen: () => setActiveTab('rules') },
        { title: 'Все расходы', description: 'Ручные и автоматические начисления по категориям.', icon: HandCoins, tone: 'orange', onOpen: () => setActiveTab('entries') },
        { title: 'Задолженность', description: 'Проверить долг клиентов по материалам и услугам.', icon: AlertTriangle, tone: 'red', onOpen: () => setActiveTab('debts') },
      ]}
    >
    <section className="expenses-panel" aria-label="Расходы">
      <header className="expenses-header">
        <div>
          <p className="eyebrow">Финансовый контроль</p>
          <h2>Расходы</h2>
          <p>
            Материалы, логистика, ФОТ, ПРР, отдельные работы и задолженность
            клиентов в одном контуре.
          </p>
        </div>
        <div className="expenses-header__actions">
          <button className="secondary-button" type="button" onClick={() => void downloadReport()}>
            <Download size={17} />
            Скачать Excel
          </button>
          <button className="icon-button" type="button" onClick={() => void loadAll()} title="Обновить">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <div className="expenses-filters">
        <label>
          <span>Период с</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>по</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        {activeTab !== 'payroll' ? <label>
          <span>Клиент</span>
          <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
            <option value="">Все клиенты</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </label> : null}
        {activeTab !== 'payroll' ? <label>
          <span>Категория</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory | '')}>
            <option value="">Все категории</option>
            {expenseCategories.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label> : null}
      </div>

      <nav className="expenses-tabs" aria-label="Разделы расходов">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? <div className="panel-message panel-message--error">{error}</div> : null}
      {message ? <div className="panel-message panel-message--success">{message}</div> : null}
      {loading ? <div className="expenses-loading">Обновляю финансовые данные…</div> : null}

      {!loading && activeTab === 'overview' ? (
        <ExpenseOverview report={report} materials={materials} debts={debts} />
      ) : null}
      {!loading && activeTab === 'payroll' ? (
        <PayrollWorkspace
          session={session}
          report={payroll}
          canWrite={canWrite}
          onChanged={() => void loadAll()}
          notify={notify}
          setError={setError}
        />
      ) : null}
      {!loading && activeTab === 'materials' ? (
        <MaterialsWorkspace
          session={session}
          materials={materials}
          canWrite={canWrite}
          onChanged={() => void loadAll()}
          notify={notify}
          setError={setError}
        />
      ) : null}
      {!loading && activeTab === 'rules' ? (
        <MaterialRulesWorkspace
          session={session}
          clients={clients}
          clientId={rulesClientId}
          setClientId={setRulesClientId}
          rules={rules}
          loading={rulesLoading}
          canWrite={canWrite}
          onSaved={(next) => {
            setRules(next);
            notify('Настройка автоматического списания сохранена.');
          }}
          setError={setError}
        />
      ) : null}
      {!loading && activeTab === 'entries' ? (
        <ExpenseEntriesWorkspace
          session={session}
          clients={clients}
          entries={entries}
          canWrite={canWrite}
          onChanged={() => void loadAll()}
          notify={notify}
          setError={setError}
        />
      ) : null}
      {!loading && activeTab === 'debts' ? <ClientDebts report={debts} /> : null}
    </section>
    </WorkspaceTileGate>
  );
}

function PayrollWorkspace({
  session,
  report,
  canWrite,
  onChanged,
  notify,
  setError,
}: {
  session: AuthSession;
  report: ExpensePayrollReport | null;
  canWrite: boolean;
  onChanged: () => void;
  notify: (message: string) => void;
  setError: (message: string | null) => void;
}) {
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState('');
  const [resettingUserId, setResettingUserId] = useState('');

  useEffect(() => {
    if (!report) return;
    setRateDrafts(Object.fromEntries(report.workers.map((worker) => [worker.userId, String(worker.rateRub)])));
  }, [report]);

  async function saveRate(worker: ExpensePayrollReport['workers'][number]) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingUserId('');
    }
  }

  async function resetCounter(worker: ExpensePayrollReport['workers'][number]) {
    if (!window.confirm(
      `Обнулить счётчик сборщицы «${worker.userName}»?\n\nЕдиницы, заказы и сумма к выплате начнут считаться заново с текущего момента. Выполненные задания и история не удалятся.`,
    )) return;
    setResettingUserId(worker.userId);
    setError(null);
    try {
      const result = await resetExpensePayrollCounter(session.accessToken, worker.userId);
      notify(result.message);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setResettingUserId('');
    }
  }

  if (!report) return <div className="expenses-empty">Не удалось получить расчёт ФОТ.</div>;

  return (
    <div className="expenses-workspace expenses-payroll">
      <div className="expenses-workspace__heading">
        <div>
          <p className="eyebrow">Расчёт по факту ТСД</p>
          <h3>ФОТ сборщиков</h3>
          <p>Учитываются завершённые FBS-заказы и фактически отпиканные единицы. Ставка по умолчанию — {formatMoney(report.defaultRateRub)} ₽ за единицу.</p>
        </div>
        <strong>{formatDate(report.period.from)} — {formatDate(new Date(new Date(report.period.to).getTime() - 1).toISOString())}</strong>
      </div>

      <div className="expenses-payroll__summary">
        <article><span>Пользователей ТСД</span><strong>{report.summary.users}</strong><small>Работали: {report.summary.activeWorkers}</small></article>
        <article><span>Отпикано единиц</span><strong>{report.summary.units}</strong><small>{report.summary.orders} заказов</small></article>
        <article><span>Учтённое время</span><strong>{formatDurationSeconds(report.summary.productiveDurationSeconds)}</strong><small>Сумма времени по заданиям</small></article>
        <article className="is-total"><span>К выплате</span><strong>{formatMoney(report.summary.payrollRub)} ₽</strong><small>По индивидуальным ставкам</small></article>
      </div>

      <div className="expenses-payroll-table-wrap">
        <table className="expenses-payroll-table">
          <thead>
            <tr>
              <th>Сотрудник ТСД</th>
              <th>Единиц</th>
              <th>Заказов</th>
              <th>Начало</th>
              <th>Конец</th>
              <th>Время работы</th>
              <th>Среднее / ед.</th>
              <th>Ставка, ₽/ед.</th>
              <th>К выплате</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {report.workers.map((worker) => (
              <tr key={worker.userId} className={worker.units ? undefined : 'is-idle'}>
                <td>
                  <strong>{worker.userName}</strong>
                  <span>{worker.email}</span>
                  <small>{worker.deviceCodes.length ? worker.deviceCodes.join(' · ') : 'Устройство не привязано'}</small>
                  {worker.resetAt ? <small className="expenses-payroll-reset-note">Счётчик с {formatPayrollTime(worker.resetAt)}</small> : null}
                </td>
                <td><b>{worker.units}</b></td>
                <td>{worker.orders}</td>
                <td>{worker.workStartedAt ? formatPayrollTime(worker.workStartedAt) : '—'}</td>
                <td>{worker.workEndedAt ? formatPayrollTime(worker.workEndedAt) : '—'}</td>
                <td>{formatDurationSeconds(worker.workSpanSeconds)}</td>
                <td>{formatDurationSeconds(worker.averageDurationSecondsPerUnit)}</td>
                <td>
                  <div className="expenses-payroll-rate">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rateDrafts[worker.userId] ?? String(worker.rateRub)}
                      disabled={!canWrite || savingUserId === worker.userId}
                      onChange={(event) => setRateDrafts((current) => ({ ...current, [worker.userId]: event.target.value }))}
                      aria-label={`Ставка ${worker.userName} за единицу`}
                    />
                    {canWrite ? <button
                      type="button"
                      onClick={() => void saveRate(worker)}
                      disabled={savingUserId === worker.userId || Number(rateDrafts[worker.userId]) === worker.rateRub}
                      title="Сохранить ставку"
                    >
                      <Save size={14} />
                    </button> : null}
                  </div>
                  <small>{worker.rateIsDefault ? 'по умолчанию' : 'индивидуальная'}</small>
                </td>
                <td><strong>{formatMoney(worker.payrollRub)} ₽</strong></td>
                <td>
                  {canWrite ? <button
                    type="button"
                    className="expenses-payroll-reset"
                    onClick={() => void resetCounter(worker)}
                    disabled={resettingUserId === worker.userId}
                    title="Обнулить единицы, заказы и сумму этого сотрудника, не удаляя историю"
                  >
                    <RotateCcw size={14} className={resettingUserId === worker.userId ? 'is-spinning' : undefined} />
                    {resettingUserId === worker.userId ? 'Обнуление…' : 'Обнулить счётчик'}
                  </button> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.workers.length === 0 ? <div className="expenses-empty">Пользователи ТСД пока не созданы.</div> : null}
    </div>
  );
}

function ExpenseOverview({
  report,
  materials,
  debts,
}: {
  report: ExpenseReport | null;
  materials: ExpenseMaterial[];
  debts: ExpenseDebtReport | null;
}) {
  if (!report) return <div className="expenses-empty">Нет данных за выбранный период.</div>;
  const maxCategory = Math.max(1, ...report.byCategory.map((item) => item.amountRub));
  const maxDay = Math.max(1, ...report.daily.map((item) => item.amountRub));
  const lowStock = materials.filter((material) => material.isActive && material.isLowStock);

  return (
    <div className="expenses-dashboard">
      <div className="expenses-metrics">
        <MetricCard icon={WalletCards} label="Всего расходов" value={report.totals.totalRub} tone="primary" />
        <MetricCard icon={Boxes} label="Материалы" value={report.totals.materialsRub} />
        <MetricCard icon={Truck} label="Логистика" value={report.totals.logisticsRub} />
        <MetricCard icon={UsersRound} label="ФОТ сборщиков" value={report.totals.payrollPickersRub} />
        <MetricCard icon={HandCoins} label="ПРР" value={report.totals.handlingPprRub} />
        <MetricCard icon={Wrench} label="Отдельные работы" value={report.totals.contractWorkRub} />
        <MetricCard icon={AlertTriangle} label="Долг клиентов" value={debts?.totals.debtRub ?? 0} tone="warning" />
      </div>

      <div className="expenses-dashboard__grid">
        <article className="expenses-card">
          <div className="expenses-card__heading">
            <div>
              <span>Структура</span>
              <h3>Расходы по категориям</h3>
            </div>
            <strong>{report.totals.entriesCount} записей</strong>
          </div>
          <div className="expense-bars">
            {report.byCategory.filter((item) => item.amountRub > 0).map((item) => (
              <div className="expense-bar" key={item.category}>
                <div>
                  <span>{categoryLabel(item.category)}</span>
                  <strong>{formatMoney(item.amountRub)} ₽</strong>
                </div>
                <i style={{ width: `${Math.max(3, (item.amountRub / maxCategory) * 100)}%` }} />
              </div>
            ))}
            {report.byCategory.every((item) => item.amountRub === 0) ? <p>Расходов пока нет.</p> : null}
          </div>
        </article>

        <article className="expenses-card">
          <div className="expenses-card__heading">
            <div>
              <span>Динамика</span>
              <h3>Расходы по дням</h3>
            </div>
          </div>
          <div className="expense-days">
            {report.daily.map((item) => (
              <div key={item.date} title={`${formatDate(item.date)} — ${formatMoney(item.amountRub)} ₽`}>
                <i style={{ height: `${Math.max(6, (item.amountRub / maxDay) * 100)}%` }} />
                <span>{new Date(item.date).getDate()}</span>
              </div>
            ))}
            {report.daily.length === 0 ? <p>Нет движений за период.</p> : null}
          </div>
        </article>

        <article className="expenses-card">
          <div className="expenses-card__heading">
            <div>
              <span>Контроль склада</span>
              <h3>Заканчиваются материалы</h3>
            </div>
          </div>
          <div className="expenses-alert-list">
            {lowStock.slice(0, 8).map((material) => (
              <div key={material.id}>
                <AlertTriangle size={17} />
                <span>
                  <strong>{material.name}</strong>
                  <small>Остаток {formatQuantity(material.stockQuantity)} {material.unit}; минимум {formatQuantity(material.minStockQuantity)}</small>
                </span>
              </div>
            ))}
            {lowStock.length === 0 ? <p>Все материалы выше минимального остатка.</p> : null}
          </div>
        </article>

        <article className="expenses-card">
          <div className="expenses-card__heading">
            <div>
              <span>Распределение</span>
              <h3>Клиенты и общие расходы</h3>
            </div>
          </div>
          <div className="expenses-client-costs">
            {report.byClient.slice(0, 10).map((item, index) => (
              <div key={item.client?.id ?? `overhead-${index}`}>
                <span>{item.client ? `${item.client.name} (${item.client.code})` : 'Общехозяйственные расходы'}</span>
                <strong>{formatMoney(item.amountRub)} ₽</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="expenses-card">
          <div className="expenses-card__heading">
            <div>
              <span>ФОТ и работы</span>
              <h3>Затраты по сотрудникам</h3>
            </div>
          </div>
          <div className="expenses-client-costs">
            {report.byWorker.slice(0, 10).map((worker) => (
              <div key={worker.workerName}>
                <span>
                  {worker.workerName}
                  <small>
                    ФОТ {formatMoney(worker.payrollPickersRub)} ₽ · ПРР{' '}
                    {formatMoney(worker.handlingPprRub)} ₽ · работы{' '}
                    {formatMoney(worker.contractWorkRub)} ₽
                  </small>
                </span>
                <strong>{formatMoney(worker.totalRub)} ₽</strong>
              </div>
            ))}
            {report.byWorker.length === 0 ? (
              <p>Расходов с указанным исполнителем пока нет.</p>
            ) : null}
          </div>
        </article>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof WalletCards;
  label: string;
  value: number;
  tone?: 'default' | 'primary' | 'warning';
}) {
  return (
    <article className={`expense-metric expense-metric--${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{formatMoney(value)} ₽</strong>
    </article>
  );
}

function MaterialsWorkspace({
  session,
  materials,
  canWrite,
  onChanged,
  notify,
  setError,
}: {
  session: AuthSession;
  materials: ExpenseMaterial[];
  canWrite: boolean;
  onChanged: () => void;
  notify: (message: string) => void;
  setError: (message: string | null) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<ExpenseMaterial | null>(null);
  const [mode, setMode] = useState<'stock' | 'history' | null>(null);
  const [movements, setMovements] = useState<ExpenseMaterialMovement[]>([]);
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
    type: 'PURCHASE' as 'PURCHASE' | 'ADJUSTMENT' | 'WRITE_OFF',
    quantity: '',
    unitCostRub: '',
    expenseDate: todayInput(),
    comment: '',
  });
  const [saving, setSaving] = useState(false);

  async function submitMaterial(event: FormEvent) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function submitStock(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(material: ExpenseMaterial) {
    setSelected(material);
    setMode('history');
    setError(null);
    try {
      setMovements(await fetchExpenseMaterialMovements(session.accessToken, material.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function toggleActive(material: ExpenseMaterial) {
    setError(null);
    try {
      await updateExpenseMaterial(session.accessToken, material.id, { isActive: !material.isActive });
      notify(material.isActive ? 'Материал отключён.' : 'Материал включён.');
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="expenses-workspace">
      <div className="expenses-workspace__heading">
        <div>
          <h3>Склад расходных материалов</h3>
          <p>Закупки увеличивают остаток и одновременно попадают в отчёт по расходам.</p>
        </div>
        {canWrite ? (
          <button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>
            <Plus size={17} /> Добавить материал
          </button>
        ) : null}
      </div>

      {showCreate ? (
        <form className="expenses-form expenses-form--material" onSubmit={submitMaterial}>
          <label><span>Код</span><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PACK_17X21" /></label>
          <label className="wide"><span>Название</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Курьерский пакет 17 × 21 см" /></label>
          <label><span>Ед. измерения</span><input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
          <label><span>Начальный остаток</span><input type="number" min="0" step="0.001" value={form.initialQuantity} onChange={(e) => setForm({ ...form, initialQuantity: e.target.value })} /></label>
          <label><span>Себестоимость, ₽</span><input type="number" min="0" step="0.0001" value={form.averageUnitCostRub} onChange={(e) => setForm({ ...form, averageUnitCostRub: e.target.value })} /></label>
          <label><span>Минимальный остаток</span><input type="number" min="0" step="0.001" value={form.minStockQuantity} onChange={(e) => setForm({ ...form, minStockQuantity: e.target.value })} /></label>
          <label className="wide"><span>Комментарий</span><input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
          <button className="primary-button" disabled={saving} type="submit"><Save size={16} /> Сохранить</button>
        </form>
      ) : null}

      <div className="expenses-table-wrap">
        <table className="expenses-table">
          <thead><tr><th>Материал</th><th>Остаток</th><th>Минимум</th><th>Средняя цена</th><th>Стоимость остатка</th><th>Клиентов</th><th /></tr></thead>
          <tbody>
            {materials.map((material) => (
              <tr key={material.id} className={material.isLowStock ? 'danger-row' : material.isActive ? '' : 'muted-row'}>
                <td><strong>{material.name}</strong><small>{material.code}</small></td>
                <td><strong>{formatQuantity(material.stockQuantity)} {material.unit}</strong></td>
                <td>{formatQuantity(material.minStockQuantity)} {material.unit}</td>
                <td>{formatMoney(material.averageUnitCostRub)} ₽</td>
                <td>{formatMoney(material.stockValueRub)} ₽</td>
                <td>{material.rulesCount}</td>
                <td>
                  <div className="table-actions">
                    {canWrite ? <button type="button" onClick={() => { setSelected(material); setMode('stock'); }}>Движение</button> : null}
                    <button type="button" onClick={() => void openHistory(material)}>История</button>
                    {canWrite ? <button type="button" onClick={() => void toggleActive(material)}>{material.isActive ? 'Отключить' : 'Включить'}</button> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && mode === 'stock' ? (
        <form className="expenses-side-card" onSubmit={submitStock}>
          <div><span>Движение материала</span><h4>{selected.name}</h4></div>
          <label><span>Операция</span><select value={stockForm.type} onChange={(e) => setStockForm({ ...stockForm, type: e.target.value as typeof stockForm.type })}><option value="PURCHASE">Закупка / приход</option><option value="ADJUSTMENT">Корректировка (+ или −)</option><option value="WRITE_OFF">Списание</option></select></label>
          <label><span>Количество</span><input required type="number" step="0.001" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} /></label>
          <label><span>Цена за единицу, ₽</span><input type="number" min="0" step="0.0001" value={stockForm.unitCostRub} onChange={(e) => setStockForm({ ...stockForm, unitCostRub: e.target.value })} placeholder={String(selected.averageUnitCostRub)} /></label>
          <label><span>Дата</span><input type="date" value={stockForm.expenseDate} onChange={(e) => setStockForm({ ...stockForm, expenseDate: e.target.value })} /></label>
          <label><span>Комментарий</span><textarea value={stockForm.comment} onChange={(e) => setStockForm({ ...stockForm, comment: e.target.value })} /></label>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setMode(null)}>Закрыть</button><button className="primary-button" disabled={saving} type="submit">Провести</button></div>
        </form>
      ) : null}

      {selected && mode === 'history' ? (
        <div className="expenses-side-card expenses-side-card--history">
          <div><span>Журнал движений</span><h4>{selected.name}</h4></div>
          <div className="material-movements">
            {movements.map((movement) => (
              <div key={movement.id}>
                <i className={movement.quantity < 0 ? 'out' : 'in'}>{movement.quantity > 0 ? '+' : ''}{formatQuantity(movement.quantity)}</i>
                <span><strong>{movementLabel(movement.type)}</strong><small>{formatDateTime(movement.createdAt)}{movement.client ? ` · ${movement.client.name}` : ''}{movement.request ? ` · заявка №${String(movement.request.number).padStart(6, '0')}` : ''}</small></span>
                <em>{movement.comment}</em>
              </div>
            ))}
            {movements.length === 0 ? <p>Движений пока нет.</p> : null}
          </div>
          <button className="secondary-button" type="button" onClick={() => setMode(null)}>Закрыть</button>
        </div>
      ) : null}
    </div>
  );
}

function MaterialRulesWorkspace({
  session,
  clients,
  clientId,
  setClientId,
  rules,
  loading,
  canWrite,
  onSaved,
  setError,
}: {
  session: AuthSession;
  clients: ClientSummary[];
  clientId: string;
  setClientId: (id: string) => void;
  rules: ClientExpenseMaterialRules | null;
  loading: boolean;
  canWrite: boolean;
  onSaved: (rules: ClientExpenseMaterialRules) => void;
  setError: (message: string | null) => void;
}) {
  return (
    <div className="expenses-workspace">
      <div className="expenses-workspace__heading">
        <div>
          <h3>Автоматическое списание по клиенту</h3>
          <p>При закрытии заявки материал списывается по количеству отправленных единиц. Если «считать отдельно» выключено, себестоимость входит в обработку и клиенту не начисляется.</p>
        </div>
        <label className="rules-client-select"><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.code})</option>)}</select></label>
      </div>
      {loading ? <div className="expenses-loading">Загружаю настройки…</div> : null}
      {!loading && rules ? (
        <div className="material-rules">
          {rules.materials.map((item) => (
            <MaterialRuleRow
              key={item.material.id}
              session={session}
              clientId={clientId}
              item={item}
              canWrite={canWrite}
              onSaved={onSaved}
              setError={setError}
            />
          ))}
          {rules.materials.length === 0 ? <div className="expenses-empty">Сначала добавьте расходные материалы.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function MaterialRuleRow({
  session,
  clientId,
  item,
  canWrite,
  onSaved,
  setError,
}: {
  session: AuthSession;
  clientId: string;
  item: ClientExpenseMaterialRules['materials'][number];
  canWrite: boolean;
  onSaved: (rules: ClientExpenseMaterialRules) => void;
  setError: (message: string | null) => void;
}) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`material-rule ${enabled ? 'active' : ''}`}>
      <div className="material-rule__name"><span>{item.material.code}</span><strong>{item.material.name}</strong><small>На складе: {formatQuantity(item.material.stockQuantity)} {item.material.unit}</small></div>
      <label className="switch-field"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canWrite} /><span>Списывать автоматически</span></label>
      <label><span>На 1 отправленную ед.</span><input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={!canWrite || !enabled} /></label>
      <label className="switch-field"><input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} disabled={!canWrite || !enabled} /><span>Считать клиенту отдельно</span></label>
      <label><span>Цена клиенту, ₽</span><input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!canWrite || !enabled || !separate} placeholder={separate ? 'Обязательно' : 'Входит в обработку'} /></label>
      <label className="wide"><span>Комментарий</span><input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!canWrite} /></label>
      {canWrite ? <button className="primary-button" type="button" onClick={() => void save()} disabled={saving}><Save size={16} /> Сохранить</button> : null}
    </article>
  );
}

function ExpenseEntriesWorkspace({
  session,
  clients,
  entries,
  canWrite,
  onChanged,
  notify,
  setError,
}: {
  session: AuthSession;
  clients: ClientSummary[];
  entries: ExpenseEntry[];
  canWrite: boolean;
  onChanged: () => void;
  notify: (message: string) => void;
  setError: (message: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category: 'LOGISTICS' as ExpenseCategory,
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

  async function submit(event: FormEvent) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(entry: ExpenseEntry) {
    if (!window.confirm(`Отменить расход «${entry.description}»?`)) return;
    setError(null);
    try {
      await cancelExpenseEntry(session.accessToken, entry.id);
      notify('Расход отменён.');
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function setCalculation(nextQuantity: string, nextUnitPrice: string) {
    const calculatedAmount =
      nextQuantity !== '' && nextUnitPrice !== ''
        ? String(
            Math.round(
              (Number(nextQuantity) * Number(nextUnitPrice) +
                Number.EPSILON) *
                100,
            ) / 100,
          )
        : form.amountRub;
    setForm({
      ...form,
      quantity: nextQuantity,
      unitPriceRub: nextUnitPrice,
      amountRub: calculatedAmount,
    });
  }

  return (
    <div className="expenses-workspace">
      <div className="expenses-workspace__heading">
        <div><h3>Журнал расходов</h3><p>Здесь учитываются логистика, ФОТ, ПРР, отдельные работы и остальные затраты.</p></div>
        {canWrite ? <button className="primary-button" type="button" onClick={() => setShowForm((value) => !value)}><Plus size={17} /> Добавить расход</button> : null}
      </div>
      {showForm ? (
        <form className="expenses-form" onSubmit={submit}>
          <label><span>Категория</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>{expenseCategories.filter((item) => item.value !== 'MATERIALS').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Дата</span><input required type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></label>
          <label className="wide"><span>Описание</span><input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Доставка на СЦ, зарплата сборщика, разгрузка…" /></label>
          <label><span>Сумма, ₽</span><input required type="number" min="0.01" step="0.01" value={form.amountRub} onChange={(e) => setForm({ ...form, amountRub: e.target.value })} /></label>
          <label><span>Клиент (необязательно)</span><select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Общий расход</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.code})</option>)}</select></label>
          <label><span>Сотрудник / исполнитель</span><input value={form.workerName} onChange={(e) => setForm({ ...form, workerName: e.target.value })} /></label>
          <label><span>Количество / часы</span><input type="number" min="0" step="0.001" value={form.quantity} onChange={(e) => setCalculation(e.target.value, form.unitPriceRub)} /></label>
          <label><span>Единица</span><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="час, рейс, смена" /></label>
          <label><span>Ставка, ₽</span><input type="number" min="0" step="0.0001" value={form.unitPriceRub} onChange={(e) => setCalculation(form.quantity, e.target.value)} /></label>
          <label className="wide"><span>Комментарий</span><textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={saving}><Save size={16} /> Записать расход</button>
        </form>
      ) : null}

      <div className="expenses-table-wrap">
        <table className="expenses-table">
          <thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Клиент</th><th>Исполнитель</th><th>Расчёт</th><th>Сумма</th><th /></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.status === 'CANCELLED' ? 'muted-row' : ''}>
                <td>{formatDate(entry.expenseDate)}</td>
                <td><span className={`expense-category expense-category--${entry.category.toLowerCase()}`}>{categoryLabel(entry.category)}</span></td>
                <td><strong>{entry.description}</strong><small>{sourceLabel(entry.source)}{entry.request ? ` · заявка №${String(entry.request.number).padStart(6, '0')}` : ''}</small></td>
                <td>{entry.client ? `${entry.client.name} (${entry.client.code})` : 'Общий'}</td>
                <td>{entry.workerName ?? '—'}</td>
                <td>{entry.quantity == null ? '—' : `${formatQuantity(entry.quantity)} ${entry.unit ?? ''} × ${formatMoney(entry.unitPriceRub ?? 0)} ₽`}</td>
                <td><strong>{formatMoney(entry.amountRub)} ₽</strong></td>
                <td>{canWrite && entry.status === 'ACTIVE' && (entry.source === 'MANUAL' || entry.source === 'LOGISTICS') ? <button className="table-link table-link--danger" type="button" onClick={() => void cancel(entry)}>Отменить</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 ? <div className="expenses-empty">Расходов за выбранный период нет.</div> : null}
      </div>
    </div>
  );
}

function ClientDebts({ report }: { report: ExpenseDebtReport | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!report) return <div className="expenses-empty">Нет данных по задолженности.</div>;
  return (
    <div className="expenses-workspace">
      <div className="expenses-workspace__heading">
        <div><h3>Задолженность клиентов</h3><p>Долг рассчитан по выставленным счетам за вычетом оплат и авансирования. Нажмите на клиента, чтобы увидеть, за что он должен.</p></div>
        <div className="debt-total"><span>Общий долг</span><strong>{formatMoney(report.totals.debtRub)} ₽</strong></div>
      </div>
      <div className="client-debts">
        {report.clients.map((client) => {
          const isOpen = expanded === client.client.id;
          const openInvoices = client.invoices.filter((invoice) => invoice.remainingRub > 0);
          return (
            <article key={client.client.id} className={client.overdueRub > 0 ? 'overdue' : ''}>
              <button type="button" className="client-debt__summary" onClick={() => setExpanded(isOpen ? null : client.client.id)}>
                {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span><strong>{client.client.name}</strong><small>{client.client.code} · открыто счетов: {client.openInvoicesCount}</small></span>
                <span><small>Аванс</small><strong>{formatMoney(client.advanceRub)} ₽</strong></span>
                <span><small>Просрочено</small><strong>{formatMoney(client.overdueRub)} ₽</strong></span>
                <span><small>Долг</small><strong>{formatMoney(client.debtRub)} ₽</strong></span>
              </button>
              {isOpen ? (
                <div className="client-debt__details">
                  {openInvoices.map((invoice) => (
                    <section key={invoice.id}>
                      <header><span><strong>Счёт {invoice.number}</strong><small>{formatDate(invoice.periodFrom)} — {formatDate(invoice.periodTo)}{invoice.dueDate ? ` · оплатить до ${formatDate(invoice.dueDate)}` : ''}</small></span><strong>{formatMoney(invoice.remainingRub)} ₽</strong></header>
                      <div>
                        {invoice.items.map((item) => (
                          <p key={item.id}><span>{item.description}<small>{formatQuantity(item.quantity)} × {formatMoney(item.unitPriceRub)} ₽</small></span><strong>{formatMoney(item.totalRub)} ₽</strong></p>
                        ))}
                        {invoice.items.length === 0 ? <p><span>{invoice.comment || 'Состав счёта не указан'}</span></p> : null}
                      </div>
                    </section>
                  ))}
                  {openInvoices.length === 0 ? <p className="expenses-empty">Открытых счетов нет.</p> : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {report.clients.length === 0 ? <div className="expenses-empty">Задолженности нет.</div> : null}
      </div>
    </div>
  );
}

function canUse(session: AuthSession, permission: string) {
  return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}

function categoryLabel(category: ExpenseCategory) {
  return expenseCategories.find((item) => item.value === category)?.label ?? category;
}

function sourceLabel(source: ExpenseEntry['source']) {
  const labels: Record<ExpenseEntry['source'], string> = {
    MANUAL: 'Внесено вручную',
    MATERIAL_PURCHASE: 'Закупка материала',
    AUTO_MATERIAL_CONSUMPTION: 'Автосписание по отгрузке',
    MATERIAL_WRITE_OFF: 'Списание материала',
    LOGISTICS: 'Логистика',
  };
  return labels[source];
}

function movementLabel(type: ExpenseMaterialMovement['type']) {
  const labels: Record<ExpenseMaterialMovement['type'], string> = {
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

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU');
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function formatPayrollTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDurationSeconds(value: number | null) {
  if (value == null) return '—';
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  if (minutes > 0) return `${minutes} мин ${String(seconds).padStart(2, '0')} сек`;
  return `${seconds} сек`;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}
