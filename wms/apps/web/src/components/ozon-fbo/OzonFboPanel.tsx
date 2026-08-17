import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CloudUpload,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  MapPin,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Send,
  Sparkles,
  Trash2,
  Warehouse,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  bookOzonFboSlot,
  closeOzonFboBox,
  createOzonFboDraft,
  deleteOzonFboPlan,
  downloadOzonFboAssembly,
  downloadOzonFboBoxLabels,
  fetchClients,
  fetchOzonFboClusters,
  fetchOzonFboDropoffs,
  fetchOzonFboOverview,
  fetchOzonFboPlan,
  fetchOzonFboTimeslots,
  generateOzonFboBoxes,
  importOzonFboPlan,
  mapOzonFboCluster,
  refreshOzonFboCargoes,
  refreshOzonFboDraft,
  refreshOzonFboSupply,
  reportOzonFboBoxShortage,
  resolveOzonFboBoxShortage,
  scanOzonFboBox,
  setOzonFboDropoff,
  syncOzonFboSkus,
  uploadOzonFboCargoes,
  type AuthSession,
  type ClientSummary,
  type OzonFboClusterOption,
  type OzonFboPlan,
  type OzonFboPlanSummary,
} from '../../lib/api';
import './ozon-fbo.css';
import './ozon-fbo-actions.css';
import { useRememberedClientId } from '../../lib/rememberedClient';

type Props = { session: AuthSession };
type Notice = { type: 'success' | 'error'; text: string } | null;
type Slot = { from: string; to: string };
type SupplyMode = 'ONE' | 'BY_CITY';
type PackingMode = 'MONO' | 'MONO_WITH_SMALL_MIXED';

const steps = [
  { icon: FileSpreadsheet, title: 'Распределение', text: 'Excel по кластерам' },
  { icon: MapPin, title: 'Склады и слот', text: 'Черновик Ozon' },
  { icon: Boxes, title: 'Короба WMS', text: 'Задание на сборку' },
  { icon: ScanLine, title: 'Сборка', text: 'Контроль каждого товара' },
  { icon: Send, title: 'Передача', text: 'Грузоместа в Ozon' },
];

export function OzonFboPanel({ session }: Props) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [overview, setOverview] = useState<{ connections: any[]; plans: OzonFboPlanSummary[] }>({ connections: [], plans: [] });
  const [plan, setPlan] = useState<OzonFboPlan | null>(null);
  const [clusters, setClusters] = useState<OzonFboClusterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [dropoffSearch, setDropoffSearch] = useState('');
  const [dropoffs, setDropoffs] = useState<Array<any>>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotFrom, setSlotFrom] = useState('');
  const [slotTo, setSlotTo] = useState('');
  const [slotDateFrom, setSlotDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [slotDateTo, setSlotDateTo] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [boxCapacity, setBoxCapacity] = useState(100);
  const [supplyMode, setSupplyMode] = useState<SupplyMode>('BY_CITY');
  const [packingMode, setPackingMode] = useState<PackingMode>('MONO_WITH_SMALL_MIXED');
  const [openBoxId, setOpenBoxId] = useState('');
  const [scanCode, setScanCode] = useState('');

  const writableClients = useMemo(
    () => clients.filter((client) => client.status !== 'ARCHIVED'),
    [clients],
  );

  const show = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 6000);
  };

  const loadOverview = useCallback(async (selectedClientId: string, keepPlan = true) => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const data = await fetchOzonFboOverview(session.accessToken, selectedClientId);
      setOverview(data);
      setConnectionId((current) => current || data.connections[0]?.id || '');
      if (!keepPlan) setPlan(null);
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void fetchClients(session.accessToken)
      .then((data) => {
        setClients(data);
        const first = data.find((client) => session.user.clientIds.includes(client.id)) ?? data[0];
        if (first) setClientId(first.id);
      })
      .catch((error) => show('error', messageOf(error)));
  }, [session.accessToken, session.user.clientIds]);

  useEffect(() => {
    if (clientId) void loadOverview(clientId, false);
  }, [clientId, loadOverview]);

  const loadPlan = async (id: string) => {
    setBusy('plan');
    try {
      const data = await fetchOzonFboPlan(session.accessToken, id);
      setPlan(data);
      const preferences = data.importSummary ?? {};
      setSupplyMode(preferences.supplyMode === 'ONE' ? 'ONE' : 'BY_CITY');
      setPackingMode(preferences.packingMode === 'MONO' ? 'MONO' : 'MONO_WITH_SMALL_MIXED');
      setConnectionId(data.connectionId);
      if (!clusters.length) setClusters(await fetchOzonFboClusters(session.accessToken, data.connectionId));
      setSlots(extractSlots(data.availableTimeslots));
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const run = async (key: string, action: () => Promise<OzonFboPlan>, success: string) => {
    setBusy(key);
    try {
      const data = await action();
      setPlan(data);
      await loadOverview(data.clientId);
      show('success', success);
      return data;
    } catch (error) {
      show('error', messageOf(error));
      return null;
    } finally {
      setBusy('');
    }
  };

  const submitImport = async (event: FormEvent) => {
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
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const searchDropoffs = async () => {
    if (!plan) return;
    setBusy('dropoffs');
    try {
      setDropoffs(await fetchOzonFboDropoffs(session.accessToken, plan.connectionId, dropoffSearch));
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const loadTimeslots = async () => {
    if (!plan) return;
    if (!slotDateFrom || !slotDateTo || slotDateFrom > slotDateTo) {
      show('error', 'Укажите корректный период поиска: дата «с» не должна быть позже даты «по».');
      return;
    }
    setBusy('slots');
    try {
      const response = await fetchOzonFboTimeslots(
        session.accessToken,
        plan.id,
        slotDateFrom,
        slotDateTo,
      );
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
      const responseInfo = response as { message?: string; recreation?: { processing?: boolean } };
      if (responseInfo.recreation?.processing) {
        show('success', responseInfo.message || 'Просроченные черновики Ozon создаются заново. Повторите поиск слотов после завершения.');
        return;
      }
      show(
        found.length ? 'success' : 'error',
        found.length
          ? cityPlans
            ? `Найдено общих слотов для всех ${cityPlans} городов: ${found.length}.`
            : `Получено слотов: ${found.length}.`
          : cityPlans
            ? `Нет единого слота, доступного одновременно для всех ${cityPlans} городов.`
            : 'Ozon пока не вернул свободных слотов.',
      );
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const bookSlot = async () => {
    if (!plan || !slotFrom || !slotTo) return;
    const cityPlans = cityPlanCount(plan);
    const confirmation = cityPlans
      ? `Забронировать выбранный общий слот во всех ${cityPlans} городских черновиках Ozon? Для каждого города будет создана отдельная поставка.`
      : 'Создать реальную поставку в Ozon и забронировать выбранный слот?';
    if (!window.confirm(confirmation)) return;
    await run(
      'book',
      () => bookOzonFboSlot(session.accessToken, plan.id, slotFrom, slotTo),
      cityPlans ? `Бронирование общего слота запущено для ${cityPlans} городов.` : 'Запрос на поставку и слот отправлен в Ozon.',
    );
  };

  const createDraft = async () => {
    if (!plan) return;
    if (plan.draftId) {
      await run('draft', () => refreshOzonFboDraft(session.accessToken, plan.id), 'Черновик обновлён.');
      return;
    }
    if (supplyMode === 'BY_CITY' && !window.confirm(`Будет создано ${plan.clusters.length} отдельных черновиков Ozon — по одному на каждый город. Продолжить?`)) return;
    setBusy('draft');
    try {
      const data = await createOzonFboDraft(session.accessToken, plan.id, { supplyMode, packingMode, mixedThreshold: 20 });
      setPlan(data);
      await loadOverview(data.clientId);
      const summary = data.creationSummary;
      if (summary) {
        if (summary.processing) {
          show('success', `Создание ${summary.requested} городских черновиков запущено в фоне. Уже готово: ${summary.created}. Статусы обновляются в списке поставок.`);
        } else {
          const failed = summary.failed.length ? ` Не создано: ${summary.failed.length}.` : '';
          show(summary.failed.length ? 'error' : 'success', `Создано отдельных городских черновиков: ${summary.created} из ${summary.requested}.${failed}`);
        }
      } else {
        show('success', 'Черновик создан в Ozon.');
      }
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const scan = async (event: FormEvent, boxId: string) => {
    event.preventDefault();
    if (!scanCode.trim() || !plan) return;
    setBusy(`scan:${boxId}`);
    try {
      await scanOzonFboBox(session.accessToken, boxId, scanCode.trim());
      setScanCode('');
      setPlan(await fetchOzonFboPlan(session.accessToken, plan.id));
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const downloadAssembly = async () => {
    if (!plan) return;
    setBusy('excel');
    try {
      const blob = await downloadOzonFboAssembly(session.accessToken, plan.id);
      saveBlob(blob, `FBO-Ozon-${plan.title}.xlsx`);
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const downloadBoxLabels = async () => {
    if (!plan) return;
    setBusy('labels');
    try {
      const blob = await downloadOzonFboBoxLabels(session.accessToken, plan.id);
      saveBlob(blob, `FBO-Ozon-${plan.title}-ШК-коробов-58x40.pdf`);
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const reportShortage = async (boxId: string) => {
    if (!plan) return;
    const reason = window.prompt('Почему в короб положено меньше товара? Причина обязательна:');
    if (reason === null) return;
    if (reason.trim().length < 5) {
      show('error', 'Укажите понятную причину — минимум 5 символов.');
      return;
    }
    await run(`shortage:${boxId}`, () => reportOzonFboBoxShortage(session.accessToken, boxId, reason.trim()), 'Недовложение отправлено менеджеру на согласование.');
  };

  const resolveShortage = async (boxId: string, decision: 'APPROVE' | 'CORRECT') => {
    if (!plan) return;
    const action = decision === 'APPROVE' ? 'согласовать недовложение' : 'вернуть короб на исправление';
    if (!window.confirm(`Подтвердить действие: ${action}?`)) return;
    const comment = window.prompt('Комментарий к решению (необязательно):') ?? '';
    await run(
      `shortage:${boxId}`,
      () => resolveOzonFboBoxShortage(session.accessToken, boxId, decision, comment.trim()),
      decision === 'APPROVE' ? 'Недовложение согласовано и зафиксировано.' : 'Короб возвращён на исправление.',
    );
  };

  const syncSkus = async () => {
    if (!connectionId) {
      show('error', 'Выберите подключение кабинета Ozon.');
      return;
    }
    setBusy('skus');
    try {
      const result = await syncOzonFboSkus(session.accessToken, connectionId);
      if (plan) setPlan(await fetchOzonFboPlan(session.accessToken, plan.id));
      await loadOverview(clientId);
      show(
        result.skipped ? 'error' : 'success',
        `SKU Ozon обновлены: ${result.productsReceived}. Создано: ${result.created}, обновлено: ${result.updated}, опознано неизвестных товаров: ${result.mergedDrafts}.${result.skipped ? ` Ошибок: ${result.skipped}.` : ''}`,
      );
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  const deletePlan = async () => {
    if (!plan) return;
    if (!window.confirm(`Удалить загруженный Excel «${plan.sourceFileName}» и все связанные с ним планы из WMS? Уже созданные черновики и поставки в кабинете Ozon останутся без изменений. После удаления можно загрузить другой файл.`)) return;
    setBusy('delete');
    try {
      await deleteOzonFboPlan(session.accessToken, plan.id);
      setPlan(null);
      setFile(null);
      setDropoffs([]);
      setSlots([]);
      await loadOverview(clientId, false);
      show('success', 'Excel и связанные планы удалены из WMS. Черновики и поставки в кабинете Ozon сохранены. Можно загрузить другой файл.');
    } catch (error) {
      show('error', messageOf(error));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="ozfbo-shell">
      {notice && <div className={`ozfbo-toast ${notice.type}`}>{notice.type === 'success' ? <CheckCircle2 /> : <AlertTriangle />}<span>{notice.text}</span></div>}

      <header className="ozfbo-hero">
        <div>
          <span className="ozfbo-kicker"><Sparkles size={15} /> FFULLHAB WMS × OZON</span>
          <h1>Поставки FBO без ручной рутины</h1>
          <p>От распределения по кластерам до полностью проверенных коробов и загрузки состава поставки в кабинет Ozon.</p>
        </div>
        <div className="ozfbo-hero-tools">
          <label className="ozfbo-client-picker">
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {writableClients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}
            </select>
          </label>
          <button className="ozfbo-hero-action" type="button" disabled={!connectionId || busy === 'skus'} onClick={() => void syncSkus()}>
            {busy === 'skus' ? <LoaderCircle className="spin" /> : <RefreshCw />}
            Обновить SKU Ozon
          </button>
        </div>
      </header>

      <div className="ozfbo-flow">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return <div className="ozfbo-flow-step" key={step.title}><b>{index + 1}</b><Icon /><span><strong>{step.title}</strong><small>{step.text}</small></span></div>;
        })}
      </div>

      {!plan ? (
        <div className="ozfbo-home-grid">
          <form className="ozfbo-card ozfbo-import" onSubmit={submitImport}>
            <div className="ozfbo-card-title"><FileSpreadsheet /><div><h2>Новая поставка</h2><p>Загрузите распределение, подготовленное для Ozon FBO.</p></div></div>
            <label><span>Название поставки</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Трусы Попова · 5 августа" /></label>
            <label><span>Кабинет Ozon</span><select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">Выберите подключение</option>{overview.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.accountName || `Client ID ${connection.sellerId}`}</option>)}</select></label>
            <label className={`ozfbo-file ${file ? 'selected' : ''}`}><CloudUpload /><span><strong>{file ? file.name : 'Выберите Excel-файл'}</strong><small>XLSX или XLS, до 20 МБ</small></span><input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            {!overview.connections.length && <div className="ozfbo-inline-warning"><AlertTriangle />У клиента нет активного подключения Ozon. Добавьте его в разделе FBS → Подключения.</div>}
            <button className="ozfbo-primary" disabled={busy === 'import' || !overview.connections.length}>{busy === 'import' ? <LoaderCircle className="spin" /> : <Sparkles />}Разобрать распределение</button>
          </form>

          <div className="ozfbo-card ozfbo-plans">
            <div className="ozfbo-card-title"><CalendarClock /><div><h2>Поставки FBO</h2><p>Черновики, сборка и готовые отгрузки.</p></div><button className="ozfbo-icon-button" onClick={() => void loadOverview(clientId)}><RefreshCw /></button></div>
            {loading ? <div className="ozfbo-empty"><LoaderCircle className="spin" />Загружаю поставки…</div> : overview.plans.length === 0 ? <div className="ozfbo-empty"><Boxes /><strong>Поставок пока нет</strong><span>Первая появится после импорта Excel.</span></div> : <div className="ozfbo-plan-list">{overview.plans.map((item) => <PlanRow key={item.id} item={item} onClick={() => void loadPlan(item.id)} />)}</div>}
          </div>
        </div>
      ) : (
        <PlanDetail
          plan={plan}
          clusters={clusters}
          busy={busy}
          slots={slots}
          slotFrom={slotFrom}
          slotDateFrom={slotDateFrom}
          slotDateTo={slotDateTo}
          dropoffSearch={dropoffSearch}
          dropoffs={dropoffs}
          boxCapacity={boxCapacity}
          supplyMode={supplyMode}
          packingMode={packingMode}
          openBoxId={openBoxId}
          scanCode={scanCode}
          canResolveShortage={session.user.permissionCodes.includes('system:admin') || session.user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role))}
          onBack={() => { setPlan(null); setDropoffs([]); setSlots([]); }}
          onReload={() => void loadPlan(plan.id)}
          onDelete={() => void deletePlan()}
          onMap={(rowId, option) => void run('map', () => mapOzonFboCluster(session.accessToken, plan.id, rowId, option), 'Кластер сопоставлен.')}
          onDropoffSearch={setDropoffSearch}
          onSearchDropoffs={() => void searchDropoffs()}
          onChooseDropoff={(warehouse) => void run('dropoff', () => setOzonFboDropoff(session.accessToken, plan.id, warehouse), 'Точка отгрузки выбрана.')}
          onSupplyMode={setSupplyMode}
          onPackingMode={setPackingMode}
          onDraft={() => void createDraft()}
          onLoadSlots={() => void loadTimeslots()}
          onSlotDateFrom={(value) => { setSlotDateFrom(value); setSlots([]); setSlotFrom(''); setSlotTo(''); }}
          onSlotDateTo={(value) => { setSlotDateTo(value); setSlots([]); setSlotFrom(''); setSlotTo(''); }}
          onSelectSlot={(slot) => { setSlotFrom(slot.from); setSlotTo(slot.to); }}
          onBook={() => void bookSlot()}
          onRefreshSupply={() => void run('supply', () => refreshOzonFboSupply(session.accessToken, plan.id), 'Статус поставки обновлён.')}
          onCapacity={setBoxCapacity}
          onGenerateBoxes={() => void run('boxes', () => generateOzonFboBoxes(session.accessToken, plan.id, boxCapacity, packingMode, 20), 'Короба WMS и задание на сборку созданы.')}
          onDownload={() => void downloadAssembly()}
          onDownloadLabels={() => void downloadBoxLabels()}
          onOpenBox={setOpenBoxId}
          onScanCode={setScanCode}
          onScan={(event, boxId) => void scan(event, boxId)}
          onCloseBox={(boxId) => void run('close', () => closeOzonFboBox(session.accessToken, boxId), 'Короб закрыт.')}
          onReportShortage={(boxId) => void reportShortage(boxId)}
          onResolveShortage={(boxId, decision) => void resolveShortage(boxId, decision)}
          onUpload={() => {
            if (window.confirm('Передать состав всех закрытых коробов в Ozon? Существующий состав грузомест будет заменён.')) {
              void run('upload', () => uploadOzonFboCargoes(session.accessToken, plan.id), 'Состав коробов передан в Ozon.');
            }
          }}
          onRefreshCargo={() => void run('cargo', () => refreshOzonFboCargoes(session.accessToken, plan.id), 'Статус грузомест обновлён.')}
        />
      )}
    </section>
  );
}

function PlanRow({ item, onClick }: { item: OzonFboPlanSummary; onClick: () => void }) {
  return <button className="ozfbo-plan-row" onClick={onClick}><span className={`ozfbo-state ${tone(item.status)}`}><CircleDot />{statusLabel(item.status)}</span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.totalUnits} шт. · {item.clusters} кластеров</small><div><span>{item.boxes ? `${item.closedBoxes}/${item.boxes} коробов` : 'короба не созданы'}</span>{item.errors > 0 && <em><AlertTriangle />{item.errors}</em>}<ChevronRight /></div></button>;
}

type DetailProps = {
  plan: OzonFboPlan; clusters: OzonFboClusterOption[]; busy: string; slots: Slot[]; slotFrom: string; slotDateFrom: string; slotDateTo: string;
  dropoffSearch: string; dropoffs: any[]; boxCapacity: number; supplyMode: SupplyMode; packingMode: PackingMode; openBoxId: string; scanCode: string; canResolveShortage: boolean;
  onBack: () => void; onReload: () => void; onDelete: () => void; onMap: (rowId: string, option: OzonFboClusterOption) => void;
  onDropoffSearch: (value: string) => void; onSearchDropoffs: () => void; onChooseDropoff: (warehouse: any) => void;
  onSupplyMode: (value: SupplyMode) => void; onPackingMode: (value: PackingMode) => void;
  onDraft: () => void; onLoadSlots: () => void; onSlotDateFrom: (value: string) => void; onSlotDateTo: (value: string) => void; onSelectSlot: (slot: Slot) => void; onBook: () => void;
  onRefreshSupply: () => void; onCapacity: (value: number) => void; onGenerateBoxes: () => void; onDownload: () => void; onDownloadLabels: () => void;
  onOpenBox: (id: string) => void; onScanCode: (value: string) => void; onScan: (event: FormEvent, id: string) => void;
  onCloseBox: (id: string) => void; onReportShortage: (id: string) => void;
  onResolveShortage: (id: string, decision: 'APPROVE' | 'CORRECT') => void;
  onUpload: () => void; onRefreshCargo: () => void;
};

function PlanDetail(props: DetailProps) {
  const { plan } = props;
  const total = plan.clusters.flatMap((cluster) => cluster.items).reduce((sum, item) => sum + item.quantity, 0);
  const assembled = plan.clusters.flatMap((cluster) => cluster.items).reduce((sum, item) => sum + item.assembledQuantity, 0);
  const invalid = plan.clusters.some((cluster) => !cluster.macrolocalClusterId || cluster.items.some((item) => !item.isValid));
  const allClosed = plan.boxes.length > 0 && plan.boxes.every((box) => ['CLOSED', 'UPLOADED'].includes(box.status));
  const cityPlans = cityPlanCount(plan);
  const hasOzonDrafts = Boolean(plan.draftId || plan.ozonOrderId) || cityPlans > 0;
  return <div className="ozfbo-detail">
    <div className="ozfbo-detail-head"><button className="ozfbo-back" onClick={props.onBack}><ArrowLeft />Все поставки</button><div><span className={`ozfbo-state ${tone(plan.status)}`}>{statusLabel(plan.status)}</span><h2>{plan.title}</h2><p>{plan.sourceFileName} · {total} шт. · {plan.clusters.length} направлений</p></div><div className="ozfbo-detail-actions"><button className="ozfbo-secondary" onClick={props.onReload}><RefreshCw />Обновить</button><button className="ozfbo-delete-button" disabled={props.busy === 'delete'} onClick={props.onDelete}><Trash2 />Удалить Excel</button></div></div>

    {plan.lastError && <div className="ozfbo-inline-warning danger"><AlertTriangle />{plan.lastError}</div>}
    <div className="ozfbo-kpis"><div><span>Товаров</span><strong>{total}</strong></div><div><span>Собрано</span><strong>{assembled}<small> / {total}</small></strong></div><div><span>Коробов</span><strong>{plan.boxes.length}</strong></div><div><span>Заказ Ozon</span><strong>{plan.ozonOrderNumber || plan.ozonOrderId || '—'}</strong></div></div>

    <section className="ozfbo-stage"><div className="ozfbo-stage-head"><b>1</b><div><h3>Распределение по кластерам</h3><p>Проверьте города, SKU Ozon и наличие товара в каталоге WMS.</p></div>{invalid ? <span className="ozfbo-check bad"><AlertTriangle />Нужна проверка</span> : <span className="ozfbo-check"><CheckCircle2 />Готово</span>}</div>
      <div className="ozfbo-cluster-grid">{plan.clusters.map((cluster) => <article className={`ozfbo-cluster ${cluster.validationMessage ? 'warning' : ''}`} key={cluster.id}><header><div><small>Из Excel</small><strong>{cluster.sourceName}</strong></div><ChevronRight /><div><small>Кластер Ozon</small>{cluster.macrolocalClusterId ? <strong>{cluster.clusterName}</strong> : <select defaultValue="" onChange={(event) => { const option = props.clusters.find((item) => item.id === event.target.value); if (option) props.onMap(cluster.id, option); }}><option value="">Выберите кластер</option>{props.clusters.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select>}</div></header>{cluster.validationMessage && <p className="ozfbo-error-text">{cluster.validationMessage}</p>}<div className="ozfbo-items">{cluster.items.map((item) => <div key={item.id}><span><strong>{item.offerId}</strong><small>{item.productName || item.validationMessage || 'Товар не сопоставлен'}</small></span><b>{item.quantity} шт.</b>{item.isValid ? <CheckCircle2 className="ok" /> : <AlertTriangle className="bad" />}</div>)}</div></article>)}</div>
    </section>

    <section className="ozfbo-stage"><div className="ozfbo-stage-head"><b>2</b><div><h3>Точка отгрузки, черновик и слот</h3><p>Реальная поставка создаётся только кнопкой «Забронировать».</p></div></div>
      <div className="ozfbo-action-grid">
        <div className="ozfbo-action-card"><MapPin /><h4>Точка отгрузки</h4>{plan.dropOffWarehouseId ? <div className="ozfbo-selected"><CheckCircle2 /><span><strong>{plan.dropOffWarehouseName || plan.dropOffWarehouseId}</strong><small>ID {plan.dropOffWarehouseId}</small></span></div> : <><div className="ozfbo-search"><input value={props.dropoffSearch} onChange={(event) => props.onDropoffSearch(event.target.value)} placeholder="Город или склад Ozon" /><button onClick={props.onSearchDropoffs} disabled={props.busy === 'dropoffs'}>Найти</button></div><div className="ozfbo-options">{props.dropoffs.map((warehouse) => <button key={warehouse.warehouse_id} onClick={() => props.onChooseDropoff(warehouse)}><strong>{warehouse.name}</strong><small>{warehouse.address || warehouse.warehouse_type}</small></button>)}</div></>}</div>
        <div className="ozfbo-action-card ozfbo-draft-card"><Warehouse /><h4>Черновик Ozon</h4><p>{plan.draftId ? `Черновик №${plan.draftId}` : cityPlans ? `Создано городских черновиков: ${cityPlans}` : 'Выберите схему поставок и упаковки перед созданием.'}</p>{!plan.draftId && !cityPlans && <div className="ozfbo-preferences"><fieldset><legend>Как создать поставки?</legend><label className={props.supplyMode === 'ONE' ? 'active' : ''}><input type="radio" name="supply-mode" checked={props.supplyMode === 'ONE'} onChange={() => props.onSupplyMode('ONE')} /><span><strong>Одна поставка</strong><small>Все города в одном плане Ozon</small></span></label><label className={props.supplyMode === 'BY_CITY' ? 'active' : ''}><input type="radio" name="supply-mode" checked={props.supplyMode === 'BY_CITY'} onChange={() => props.onSupplyMode('BY_CITY')} /><span><strong>Каждый город отдельно</strong><small>{plan.clusters.length} отдельных поставок и черновиков</small></span></label></fieldset><fieldset><legend>Как собирать короба?</legend><label className={props.packingMode === 'MONO' ? 'active' : ''}><input type="radio" name="packing-mode" checked={props.packingMode === 'MONO'} onChange={() => props.onPackingMode('MONO')} /><span><strong>Только монокороба</strong><small>Один артикул в каждом коробе</small></span></label><label className={props.packingMode === 'MONO_WITH_SMALL_MIXED' ? 'active' : ''}><input type="radio" name="packing-mode" checked={props.packingMode === 'MONO_WITH_SMALL_MIXED'} onChange={() => props.onPackingMode('MONO_WITH_SMALL_MIXED')} /><span><strong>Монокороба + смешанные</strong><small>Артикулы меньше 20 шт. объединяются</small></span></label></fieldset></div>}<button className="ozfbo-primary small" disabled={invalid || !plan.dropOffWarehouseId || props.busy === 'draft'} onClick={props.onDraft}>{props.busy === 'draft' ? <LoaderCircle className="spin" /> : <RefreshCw />}{plan.draftId ? 'Обновить черновик' : cityPlans ? 'Проверить городские черновики' : props.supplyMode === 'BY_CITY' ? 'Создать поставки по городам' : 'Создать один черновик'}</button>{plan.clusters.some((cluster) => cluster.storageWarehouseName) && <div className="ozfbo-warehouses">{plan.clusters.map((cluster) => cluster.storageWarehouseName && <span key={cluster.id}>{cluster.clusterName}: <b>{cluster.storageWarehouseName}</b></span>)}</div>}</div>
        <div className="ozfbo-action-card"><CalendarClock /><h4>{cityPlans ? `Общий слот для ${cityPlans} городов` : 'Слот приёмки'}</h4>{cityPlans && <p>Показываются только интервалы, доступные одновременно во всех городских черновиках.</p>}<div className="ozfbo-slot-period"><label><span>Дата с</span><input type="date" value={props.slotDateFrom} onChange={(event) => props.onSlotDateFrom(event.target.value)} /></label><label><span>Дата по</span><input type="date" value={props.slotDateTo} onChange={(event) => props.onSlotDateTo(event.target.value)} /></label></div><button className="ozfbo-secondary compact" disabled={!hasOzonDrafts || props.busy === 'slots'} onClick={props.onLoadSlots}>{cityPlans ? 'Найти общий свободный слот' : 'Показать свободные слоты'}</button><div className="ozfbo-slots">{props.slots.slice(0, 30).map((slot) => <button className={props.slotFrom === slot.from ? 'active' : ''} key={`${slot.from}-${slot.to}`} onClick={() => props.onSelectSlot(slot)}><strong>{formatDateTime(slot.from)}</strong><small>до {formatTime(slot.to)}</small></button>)}</div><button className="ozfbo-danger-action" disabled={!props.slotFrom || props.busy === 'book'} onClick={props.onBook}><Send />{cityPlans ? 'Забронировать во всех городах' : 'Забронировать и создать поставку'}</button>{(plan.ozonOrderId || cityPlans > 0) && <button className="ozfbo-link" onClick={props.onRefreshSupply}>Обновить статус поставок</button>}</div>
      </div>
    </section>

    <section className="ozfbo-stage"><div className="ozfbo-stage-head"><b>3</b><div><h3>Короба WMS и сборка</h3><p>Короба создаются с настроенным префиксом FFU и собираются в отдельном меню ТСД «Сборка FBO Ozon».</p></div><div className="ozfbo-stage-head-actions"><button className="ozfbo-secondary" disabled={!plan.boxes.length} onClick={props.onDownload}><Download />Excel для сборки</button><button className="ozfbo-secondary" disabled={!plan.boxes.length || props.busy === 'labels'} onClick={props.onDownloadLabels}><Download />Скачать ШК коробов</button></div></div>
      {!plan.boxes.length ? <div className="ozfbo-box-builder"><label><span>Максимум единиц в коробе</span><input type="number" min="1" max="1000" value={props.boxCapacity} onChange={(event) => props.onCapacity(Number(event.target.value))} /></label><div className="ozfbo-box-rule"><strong>{props.packingMode === 'MONO' ? 'Только монокороба' : 'Монокороба + смешанные остатки'}</strong><small>{props.packingMode === 'MONO' ? 'В каждом коробе будет только один артикул.' : 'Артикулы с планом меньше 20 шт. будут объединены в смешанные короба.'} Плановое количество Ozon не уменьшается.</small></div><button className="ozfbo-primary" disabled={invalid || props.busy === 'boxes'} onClick={props.onGenerateBoxes}><Boxes />Создать короба WMS</button></div> : <div className="ozfbo-box-list">{plan.boxes.map((box) => { const count = box.items.reduce((sum, item) => sum + item.quantity, 0); const done = box.items.reduce((sum, item) => sum + item.assembledQuantity, 0); const missing = Math.max(0, count - done); const isOpen = props.openBoxId === box.id; const boxKind = box.items.length > 1 ? 'Смешанный короб' : 'Монокороб'; const shortage = box.status === 'SHORTAGE_PENDING' ? shortageForBox(plan, box.id) : null; return <article className={`ozfbo-box ${isOpen ? 'open' : ''}`} key={box.id}><button className="ozfbo-box-head" onClick={() => props.onOpenBox(isOpen ? '' : box.id)}><PackageCheck /><span><strong>{box.boxCode}</strong><small>{box.cluster.clusterName || box.cluster.sourceName} · {boxKind}</small></span><b>{done}/{count}</b><span className={`ozfbo-state ${tone(box.status)}`}>{statusLabel(box.status)}</span><ChevronRight /></button>{isOpen && <div className="ozfbo-box-body"><div className="ozfbo-box-items">{box.items.map((item) => <div key={item.id}><span><strong>{item.planItem.offerId}</strong><small>{item.planItem.productName}</small></span><b>{item.assembledQuantity} / {item.quantity}</b></div>)}</div>{!['CLOSED', 'UPLOADED', 'SHORTAGE_PENDING'].includes(box.status) && <form onSubmit={(event) => props.onScan(event, box.id)} className="ozfbo-scan"><ScanLine /><input autoFocus value={props.scanCode} onChange={(event) => props.onScanCode(event.target.value)} placeholder="Отсканируйте товар" /><button disabled={props.busy === `scan:${box.id}`}>Добавить</button></form>}{shortage && <div className="ozfbo-shortage"><AlertTriangle /><span><strong>Недовложение: {String(shortage.missingQuantity ?? missing)} шт.</strong><small>Причина: {String(shortage.reason ?? 'не указана')}</small></span>{props.canResolveShortage && <div><button className="approve" disabled={props.busy === `shortage:${box.id}`} onClick={() => props.onResolveShortage(box.id, 'APPROVE')}>Согласиться</button><button className="correct" disabled={props.busy === `shortage:${box.id}`} onClick={() => props.onResolveShortage(box.id, 'CORRECT')}>Исправить</button></div>}</div>}<div className="ozfbo-box-actions">{missing > 0 && !['CLOSED', 'UPLOADED', 'SHORTAGE_PENDING'].includes(box.status) && <button className="ozfbo-shortage-button" disabled={props.busy === `shortage:${box.id}`} onClick={() => props.onReportShortage(box.id)}><AlertTriangle />Сообщить недовложение</button>}{done === count && !['CLOSED', 'UPLOADED'].includes(box.status) && <button className="ozfbo-primary small" onClick={() => props.onCloseBox(box.id)}><CheckCircle2 />Закрыть короб</button>}{box.ozonBarcode && <span>ШК Ozon: <b>{box.ozonBarcode}</b></span>}</div></div>}</article>; })}</div>}
    </section>

    <section className="ozfbo-stage ozfbo-final"><div className="ozfbo-stage-head"><b>4</b><div><h3>Передача грузомест в Ozon</h3><p>Доступно только когда каждый созданный короб собран и закрыт.</p></div></div><div className="ozfbo-final-content"><div className={`ozfbo-readiness ${allClosed ? 'ready' : ''}`}>{allClosed ? <CheckCircle2 /> : <AlertTriangle />}<span><strong>{allClosed ? 'Поставка готова к передаче' : 'Сборка ещё не завершена'}</strong><small>{plan.boxes.filter((box) => ['CLOSED', 'UPLOADED'].includes(box.status)).length} из {plan.boxes.length} коробов закрыто</small></span></div><button className="ozfbo-primary" disabled={!allClosed || !plan.ozonOrderId || props.busy === 'upload'} onClick={props.onUpload}><Send />Передать состав в Ozon</button>{['CARGO_UPLOADING', 'READY_TO_SHIP'].includes(plan.status) && <button className="ozfbo-secondary" onClick={props.onRefreshCargo}><RefreshCw />Обновить грузоместа</button>}</div></section>

    {plan.events.length > 0 && <section className="ozfbo-events"><h3>История поставки</h3>{plan.events.slice(0, 20).map((event) => <div key={event.id}><CircleDot /><span><strong>{event.message}</strong><small>{new Date(event.createdAt).toLocaleString('ru-RU')}{event.userName ? ` · ${event.userName}` : ''}</small></span></div>)}</section>}
  </div>;
}

const labels: Record<string, string> = {
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
function statusLabel(value: string) { return labels[value] ?? value.replaceAll('_', ' ').toLowerCase(); }
function tone(value: string) { if (['READY', 'DRAFT_READY', 'SUPPLY_CREATED', 'CITY_SLOT_READY', 'CITY_SUPPLIES_CREATED', 'ASSEMBLED', 'READY_TO_SHIP', 'CLOSED', 'UPLOADED'].includes(value)) return 'green'; if (['NEEDS_ATTENTION', 'DRAFT_ERROR', 'DRAFT_EXPIRED', 'SUPPLY_ERROR', 'CITY_SLOT_UNAVAILABLE', 'CITY_SUPPLIES_PARTIAL', 'SHORTAGE_REVIEW', 'SHORTAGE_PENDING', 'ASSEMBLED_WITH_SHORTAGE'].includes(value)) return 'red'; if (['ASSEMBLY', 'ASSEMBLING', 'SUPPLY_CREATING', 'DRAFTS_RECREATING', 'CITY_SUPPLIES_CREATING', 'CARGO_UPLOADING'].includes(value)) return 'violet'; return 'blue'; }
function cityPlanCount(plan: OzonFboPlan) { const value = plan.importSummary?.childPlanIds; return Array.isArray(value) ? value.filter((id) => typeof id === 'string').length : 0; }
function shortageForBox(plan: OzonFboPlan, boxId: string) {
  const event = plan.events.find((item) => item.type === 'BOX_SHORTAGE_REPORTED' && item.payload?.boxId === boxId);
  return event?.payload ?? null;
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Неизвестная ошибка.'; }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function saveBlob(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName.replace(/[\\/:*?"<>|]+/g, '-'); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function extractSlots(input: unknown): Slot[] {
  const result: Slot[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = value as Record<string, unknown>;
    const from = object.from_in_timezone ?? object.from;
    const to = object.to_in_timezone ?? object.to;
    if (typeof from === 'string' && typeof to === 'string' && !result.some((slot) => slot.from === from && slot.to === to)) result.push({ from, to });
    Object.values(object).forEach(visit);
  };
  visit(input);
  return result.sort((a, b) => a.from.localeCompare(b.from));
}
