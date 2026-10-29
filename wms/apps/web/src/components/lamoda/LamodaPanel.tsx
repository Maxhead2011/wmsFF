import { LamodaSubmissionPanel } from './LamodaSubmissionPanel';
import { LamodaAssemblyList } from './LamodaAssemblyList';
import { FboWorkspaceModal } from '../client-requests/FboWorkspaceModal';
import { fetchWorkspaceClients, workspaceEnabled } from '../../lib/marketplaceWorkspace';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fetchClients, fetchLamodaAccounts, fetchLamodaOverview, createLamodaAccount, checkLamodaAccount,
  syncLamoda, fetchLamodaCandidates, linkLamodaProduct, importLamodaPlan, previewLamodaPlan,
  downloadLamodaTemplate, fetchLamodaWarehouses, updateLamodaAccount,
  type AuthSession, type ClientSummary, type LamodaAccount, type LamodaOverview, type LamodaCandidate,
  type LamodaResource, type LamodaPreview,
} from '../../lib/api';
import './lamoda.css';
import { importLamodaShipment, createLamodaAssembly, fetchFboPlan, type FboPlan } from '../../lib/api';
import { FboTwoStagePanel } from '../client-requests/FboTwoStagePanel';
import { LamodaStockReview } from './LamodaStockReview';
import { RequestRemovalProvider } from '../client-requests/RequestRemoval';

type Tab = 'connection' | 'catalog' | 'fbo' | 'fbs' | 'returns' | 'log';
const tabs: [Tab, string][] = [['connection', 'Подключение'], ['catalog', 'Товары и соответствия'], ['fbo', 'Планы FBO'], ['fbs', 'Заказы FBS'], ['returns', 'Возвраты'], ['log', 'Журнал обмена']];
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Не проверено';
const linkLabels: Record<string, string> = { CONFIRMED: 'Подтверждено', UNLINKED: 'Не сопоставлено', REVIEW: 'Нужна повторная сверка' };
const emptyForm = () => ({ name: 'Lamoda', sellerId: '', oauthClientId: '', secret: '', fboEnabled: true, fbsEnabled: false });

// FIX: a separate opt-in workspace cannot activate outgoing business operations.
export function LamodaPanel({ session, maintenanceClientId, mode = 'fbo' }: { session: AuthSession; maintenanceClientId?: string; mode?: 'fbo' | 'fbs' }) {
  const operational = workspaceEnabled() && !maintenanceClientId;
  // FIX: Ozon-style landing is restricted to our operational FBO workspace.
  const compact = operational && mode === 'fbo';
  const [createOpen, setCreateOpen] = useState(false);
  const [createMethod, setCreateMethod] = useState<'file' | 'shipment'>('file');
  const token = session.accessToken;
  const canManage = !session.user.isDemo && session.user.permissionCodes.some(p => p === 'system:admin' || p === 'marketplace-api:write');
  // FIX: customer planning uses existing request rights; credential controls stay administrative.
  const customerMode = session.user.roleCodes.includes('CLIENT') && !session.user.permissionCodes.some(p=>p==='system:admin'||p==='marketplace-api:read'||p==='marketplace-api:write');
  const [clients, setClients] = useState<ClientSummary[]>([]), [clientId, setClientId] = useState(maintenanceClientId ?? '');
  const canWrite = canManage || (!session.user.isDemo && customerMode && session.user.permissionCodes.includes('client-requests:write') && session.user.writableClientIds.includes(clientId));
  const [accounts, setAccounts] = useState<LamodaAccount[]>([]), [accountId, setAccountId] = useState('');
  const [overview, setOverview] = useState<LamodaOverview | null>(null), [tab, setTab] = useState<Tab>(maintenanceClientId ? 'catalog' : operational || customerMode ? mode : 'connection');
  const [form, setForm] = useState(emptyForm), [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]), [warehouseId, setWarehouseId] = useState('');
  const [title, setTitle] = useState(''), [remoteShipmentId, setRemoteShipmentId] = useState(''), [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LamodaPreview | null>(null), [previewPlan, setPreviewPlan] = useState('');
  const [candidates, setCandidates] = useState<{ productId: string; rows: LamodaCandidate[] } | null>(null);
  const [mappingQuery,setMappingQuery]=useState(''),[mappingChoice,setMappingChoice]=useState<LamodaCandidate|null>(null);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(false);
  const [reference,setReference]=useState(''),[previewId,setPreviewId]=useState('');
  const [assembly,setAssembly]=useState<FboPlan|null>(null);
  const [planView,setPlanView]=useState<'active'|'closed'>('active');
  const detailRef=useRef<HTMLDivElement>(null),openSequence=useRef(0);
  const previousOverviewScope=useRef<string|null>(null);
  const scope=JSON.stringify([token,clientId,accountId,session.user.activeWarehouseId]);
  const currentScope=useRef(scope);currentScope.current=scope;
  // FIX: refresh the list without closing the selected assembly; account/branch changes do close it.
  useEffect(()=>{setAssembly(null);setCreateOpen(false);openSequence.current++;return()=>{openSequence.current++};},[scope]);
  useEffect(()=>{if(operational&&!compact&&assembly)detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'});},[operational,compact,assembly?.requestId]);
  const closedPlan=(p: NonNullable<LamodaOverview>['plans'][number])=>['DONE','CANCELLED','REJECTED'].includes(p.assembly?.request?.status ?? '');
  const selected = accounts.find(c => c.id === accountId);
  useEffect(() => {
    let current = true;
    fetchWorkspaceClients(token, 'LAMODA', mode).then(value => { if (current) { setClients(value); if (!maintenanceClientId && value.length === 1) setClientId(value[0].id); } }).catch(e => { if (current) setError(String(e.message)); });
    return () => { current = false; };
  }, [token]);
  useEffect(() => {
    let current = true;
    setAccounts([]); setAccountId(''); setForm(emptyForm()); setError(''); setNotice('');
    if (clientId) fetchLamodaAccounts(token, clientId).then(value => { if (current) { setAccounts(value); setAccountId(value.find(a=>a.isActive)?.id ?? value[0]?.id ?? ''); } }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [token, clientId]);
  useEffect(() => {
    let current = true;
    // FIX: a same-account refresh keeps rows in place; a different account/branch clears them.
    const overviewScope=JSON.stringify([token,accountId,session.user.activeWarehouseId]);
    if(previousOverviewScope.current!==overviewScope)setOverview(null);
    previousOverviewScope.current=overviewScope;
    setCandidates(null); setPreview(null); setPreviewPlan(''); setFile(null); setTitle(''); setRemoteShipmentId(''); setWarehouses([]); setWarehouseId(''); setForm(emptyForm());
    setReference('');setPreviewId('');setMappingQuery('');setMappingChoice(null);
    if (!accountId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchLamodaOverview(token, accountId), fetchLamodaWarehouses(token, accountId)])
      .then(([data, choices]) => { if (current) { setOverview(data); setWarehouses(choices); setWarehouseId(choices.find(w => w.id === session.user.activeWarehouseId)?.id ?? choices[0]?.id ?? ''); } })
      .catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, accountId, revision, session.user.activeWarehouseId]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Операция не выполнена.'); }
    finally { setBusy(false); }
  }
  async function openAssembly(requestId:string) {
    const requestedScope=scope,sequence=++openSequence.current;setAssembly(null);
    const data=await fetchFboPlan(token,requestId);
    if(currentScope.current===requestedScope&&sequence===openSequence.current){setAssembly(data);setPreview(null);setPreviewId('');}
  }
  function sync(kind: LamodaResource) { void run(async () => { const result = await syncLamoda(token, accountId, kind); setNotice(result.message); setRevision(v => v + 1); }); }
  function save(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const saved = await createLamodaAccount(token, { ...form, clientId });
      setAccounts(await fetchLamodaAccounts(token, clientId)); setAccountId(saved.id); setForm(emptyForm()); setNotice('Подключение сохранено. Теперь проверьте доступ.');
    });
  }
  const disabled = busy || loading;
  const documents = overview?.documents.filter(d => tab === 'fbo' ? d.kind === 'FBO_SHIPMENTS' : tab === 'fbs' ? ['ORDERS', 'FBS_SHIPMENTS'].includes(d.kind) : tab === 'returns' ? d.kind === 'RETURNS' : false) ?? [];
  const visiblePlans = overview?.plans.filter(p=>!operational||(planView==='closed')===closedPlan(p)) ?? [];
  function closeAssembly(){openSequence.current++;setAssembly(null);setRevision(v=>v+1);}
  const execution=assembly&&<FboTwoStagePanel key={assembly.requestId} embedded={operational} initial={assembly} accessToken={token} userId={session.user.id} canWrite={!customerMode&&canManage} onClose={closeAssembly}/>;
  const submission=assembly&&<LamodaSubmissionPanel key={accountId+assembly.requestId} token={token} accountId={accountId} requestId={assembly.requestId} canWrite={canWrite}/>;
  // FIX: keep both existing workflows in one window, with the guarded execution close action.
  const assemblyContent=assembly&&<div ref={detailRef} className={compact?'lamoda-workspace lamoda-ozon-layout lamoda-assembly-detail':operational?'lamoda-assembly-detail':undefined} aria-label="Выбранная сборка Lamoda">{compact?<>{execution}{submission}</>:<>{submission}{execution}</>}</div>;
  const content = <section className={`lamoda-workspace${compact ? ' lamoda-ozon-layout' : ''}`} aria-label="Lamoda">
    {compact && <header className="lamoda-page-header"><small>LOGOFF WMS · LAMODA</small><h2>Сборки Lamoda</h2></header>}
    {!compact && <h2>{maintenanceClientId ? 'Lamoda · обслуживание кабинета' : operational || customerMode ? mode==='fbs' ? 'Lamoda · заказы FBS' : 'Lamoda · поставки FBO' : 'Lamoda · подготовка подключения'}</h2>}
    {!compact && <p className="lamoda-note">{mode==='fbs' ? 'Заказы и отгрузки FBS Lamoda. Здесь доступны загруженные документы и их статусы; сборка и отправка остатков пока не подключены.' : 'Загрузите план из Excel или из существующей поставки Lamoda и проверьте состав. Отправка остатков и подтверждение отгрузок пока недоступны.'}</p>}
    <div className={compact ? "lamoda-fields lamoda-toolbar" : "lamoda-fields"}>
      <label>Клиент<select value={clientId} disabled={busy || !!maintenanceClientId} onChange={e => setClientId(e.target.value)}><option value="">Выберите клиента</option>{clients.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      <label>Кабинет Lamoda<select value={accountId} disabled={busy || !clientId} onChange={e => setAccountId(e.target.value)}><option value="">{operational || maintenanceClientId || customerMode ? "Выберите кабинет" : "Новое подключение"}</option>{accounts.map(c => <option key={c.id} value={c.id}>{c.name} · {c.sellerId}{c.isActive ? '' : ' · отключено'}</option>)}</select></label>
      {compact && <><label>Филиал WMS<select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} disabled={disabled || !accountId}><option value="">Выберите филиал</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button className="lamoda-create-toggle" disabled={disabled || !selected?.fboEnabled || !selected.isActive || !canWrite} aria-expanded={createOpen} aria-controls="lamoda-create-panel" onClick={()=>{setTab('fbo');setCreateOpen(v=>!v);}}>{createOpen ? 'Свернуть создание' : 'Создать сборку'}</button></>}
    </div>
    <nav className="lamoda-tabs" aria-label="Разделы Lamoda">{tabs.filter(([key])=>maintenanceClientId ? key!=='connection'&&key!=='fbo'&&key!=='fbs'&&(!customerMode||key==='catalog') : operational ? key===mode||key==='catalog' : !customerMode||key==='fbo'||key==='catalog').map(([key, label]) => <button key={key} disabled={busy || (key !== 'connection' && !accountId)} aria-pressed={tab === key} onClick={() => setTab(key)}>{operational && key==='catalog' ? 'Сопоставление товаров' : label}</button>)}</nav>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="lamoda-error">{error}</p>}{loading && <p role="status">Загружаю данные…</p>}
    {!customerMode && tab === 'connection' && <>
      {selected ? <div className="lamoda-card"><h3>{selected.name}</h3><p>Seller ID: {selected.sellerId} · {selected.fboEnabled ? 'FBO ' : ''}{selected.fbsEnabled ? 'FBS' : ''}</p><p>Проверка доступа: {date(selected.checkedAt)}</p>
        <button disabled={disabled || !canManage || !selected.isActive} onClick={() => void run(async () => { setNotice((await checkLamodaAccount(token, accountId)).message); setAccounts(await fetchLamodaAccounts(token, clientId)); })}>Проверить подключение</button>
        <button disabled={disabled || !canManage} onClick={() => void run(async () => { await updateLamodaAccount(token, accountId, { isActive: !selected.isActive }); setAccounts(await fetchLamodaAccounts(token, clientId)); setNotice(selected.isActive ? 'Подключение отключено.' : 'Подключение включено для чтения.'); })}>{selected.isActive ? 'Отключить подключение' : 'Включить чтение'}</button>
        <form onSubmit={e => { e.preventDefault(); void run(async () => { await updateLamodaAccount(token, accountId, { secret: form.secret }); setForm(emptyForm()); setAccounts(await fetchLamodaAccounts(token, clientId)); setNotice('Секрет обновлён. Повторите проверку доступа.'); }); }}><label>Новый Client secret<input type="password" autoComplete="new-password" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} disabled={!canManage || disabled} /></label><button disabled={!canManage || disabled || !form.secret}>Заменить секрет</button></form>
      </div> : <form onSubmit={save} className="lamoda-card"><h3>Подключить кабинет</h3><div className="lamoda-fields">{(['name', 'sellerId', 'oauthClientId', 'secret'] as const).map((key, i) => <label key={key}>{['Название', 'Seller ID', 'OAuth Client ID', 'Client secret'][i]}<input required type={key === 'secret' ? 'password' : 'text'} autoComplete={key === 'secret' ? 'new-password' : 'off'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} disabled={!canManage || busy} /></label>)}</div><label><input type="checkbox" checked={form.fboEnabled} onChange={e => setForm({ ...form, fboEnabled: e.target.checked })} disabled={!canManage || busy} />FBO</label><label><input type="checkbox" checked={form.fbsEnabled} onChange={e => setForm({ ...form, fbsEnabled: e.target.checked })} disabled={!canManage || busy} />FBS</label><button disabled={!canManage || busy || !clientId}>Сохранить подключение</button></form>}
    </>}
    {tab === 'catalog' && overview && <>
      {!customerMode && <button disabled={disabled || !canManage || !selected?.isActive} onClick={() => sync('CATALOG')}>Загрузить каталог Lamoda</button>}
      <p>Свяжите карточку Lamoda с товаром своего склада. ШК и артикулы могут различаться. Сверьте модель, цвет и размер перед подтверждением. Остатки и исходные карточки не меняются. Показано {overview.products.length} из максимум {overview.limits.products} товаров.</p>

      {candidates && <div className="lamoda-card" role="region" aria-label="Ручное соответствие">
        <h3>Ручное соответствие</h3>
        {overview.products.filter(p=>p.id===candidates.productId).map(p=><p key={p.id}><strong>Lamoda: {p.name}</strong><br/>Артикул: {p.externalSku ?? '—'} · ШК: {p.barcode ?? '—'} · Размер: {p.size ?? '—'}<br/>Текущее соответствие: {p.sku?.name ?? 'Не задано'}</p>)}
        <form onSubmit={e=>{e.preventDefault();void run(async()=>{setMappingChoice(null);setCandidates({...candidates,rows:await fetchLamodaCandidates(token,accountId,candidates.productId,mappingQuery)});});}}><label>Поиск товара WMS<input value={mappingQuery} maxLength={200} placeholder="Название, наш артикул или ШК" disabled={disabled} onChange={e=>{setMappingQuery(e.target.value);setMappingChoice(null);}}/></label><button disabled={disabled}>Найти товар WMS</button></form>
        {!candidates.rows.length && <p>Товар не найден. Введите наше название, артикул или штрихкод — они могут отличаться от Lamoda.</p>}
        {candidates.rows.length===100 && <p>Показаны первые 100 товаров. Уточните поиск.</p>}
        {candidates.rows.map(s=><p key={s.id}>{s.name} · Артикул: {s.internalSku} · Размер: {s.size ?? '—'} · Цвет: {s.color ?? '—'} · ШК: {s.barcodes?.map(b=>b.value).join(', ') || 'Нет ШК'} <button disabled={disabled||!canWrite} onClick={()=>setMappingChoice(s)}>Выбрать</button></p>)}
        {mappingChoice && <div><p><strong>WMS: {mappingChoice.name}</strong><br/>Артикул: {mappingChoice.internalSku} · ШК: {mappingChoice.barcodes?.map(b=>b.value).join(', ')} · Размер: {mappingChoice.size ?? '—'} · Цвет: {mappingChoice.color ?? '—'}</p><p>Подтвердите, что это один товар, цвет и размер. Новая связь заменит прежнюю для будущих сборок; созданные сборки не изменятся.</p><button disabled={disabled||!canWrite} onClick={()=>void run(async()=>{await linkLamodaProduct(token,accountId,candidates.productId,mappingChoice.id);setNotice('Соответствие сохранено.');setRevision(v=>v+1);})}>Подтвердить соответствие</button></div>}
        <button disabled={disabled} onClick={()=>{setCandidates(null);setMappingChoice(null);}}>Закрыть соответствие</button>
      </div>}
      <div className="lamoda-scroll"><table><thead><tr><th>Товар Lamoda / артикул</th><th>ШК Lamoda</th><th>Размер</th><th>Товар WMS / артикул / ШК</th><th>Сверка</th></tr></thead><tbody>{overview.products.map(p => <tr key={p.id}><td>{p.name}<small>SKU: {p.remoteSku} · Артикул: {p.externalSku ?? '—'}</small></td><td>{p.barcode ?? 'Нет ШК'}</td><td>{p.size ?? '—'}</td><td>{p.sku ? <>{p.sku.name}<small>{p.sku.internalSku} · {p.sku.size} · {p.sku.color}</small><small>{p.sku.barcodes?.map(b=>b.value).join(', ')}</small></> : 'Не связан'}</td><td>{p.isPresent ? linkLabels[p.linkState] ?? p.linkState : 'Нет в последней загрузке'}<button disabled={disabled || !p.isPresent} onClick={() => void run(async () => {setMappingQuery('');setMappingChoice(null);setCandidates({ productId: p.id, rows: await fetchLamodaCandidates(token, accountId, p.id) });})}>Сопоставить с товаром WMS</button></td></tr>)}</tbody></table></div>
    </>}
    {tab === 'fbo' && (compact || selected?.fboEnabled) && <div className={operational ? 'lamoda-operational-grid' : undefined}>
      {(!compact || createOpen) && <div className="lamoda-operational-create" id="lamoda-create-panel">
      {compact && <div className="lamoda-tabs" aria-label="Способ создания сборки"><button aria-pressed={createMethod==='file'} onClick={()=>setCreateMethod('file')}>Файл клиента</button><button aria-pressed={createMethod==='shipment'} onClick={()=>setCreateMethod('shipment')}>Из поставки Lamoda</button></div>}
      {!customerMode && <button disabled={disabled || !canManage || !selected?.isActive} onClick={() => sync('FBO_SHIPMENTS')}>Загрузить поставки Lamoda</button>}
      <form hidden={compact && createMethod!=='file'} className="lamoda-card" onSubmit={e => { e.preventDefault(); if (!file) return; void run(async () => { await importLamodaPlan(token, accountId, { title, warehouseId, remoteShipmentId }, file); setNotice('Черновик сохранён. Товар ещё не зарезервирован.'); setRevision(v => v + 1); }); }}>
        <h3>План из файла клиента</h3><div className="lamoda-fields"><label>Название<input value={title} onChange={e => setTitle(e.target.value)} required disabled={disabled} /></label>{!compact && <label>Филиал WMS<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required disabled={disabled}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}<label>Существующая поставка Lamoda<select value={remoteShipmentId} onChange={e => setRemoteShipmentId(e.target.value)} disabled={disabled}><option value="">Пока без привязки</option>{overview?.documents.filter(d => d.kind === 'FBO_SHIPMENTS').map(d => <option key={d.id} value={d.remoteId}>{d.number} · {d.remoteId}</option>)}</select></label></div>
        <label>Файл клиента<input key={`${accountId}-${revision}`} type="file" accept=".xlsx,.xls" disabled={disabled} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><button type="button" disabled={disabled} onClick={() => void run(async () => { const blob = await downloadLamodaTemplate(token, accountId); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'Lamoda-FBO.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); })}>Скачать шаблон</button><button disabled={disabled || !canWrite || !file || !warehouseId}>Сохранить черновик</button>
      </form>
      <form hidden={compact && createMethod!=='shipment'} className="lamoda-card" onSubmit={e=>{e.preventDefault();void run(async()=>{await importLamodaShipment(token,accountId,{reference,warehouseId,title});setNotice('Состав поставки загружен. Проверьте соответствия и остатки.');setRevision(v=>v+1);});}}>
        <h3>Создать сборку по ссылке или ID Lamoda</h3>
        <label>Ссылка или ID поставки<input value={reference} onChange={e=>setReference(e.target.value)} required disabled={disabled}/></label>
        <label>Или выберите загруженную поставку<select value="" disabled={disabled} onChange={e=>setReference(e.target.value)}><option value="">Выберите поставку</option>{documents.map(d=><option key={d.id} value={d.remoteId}>{d.number} · {d.status}</option>)}</select></label>
        <p>Используется филиал WMS, выбранный выше. Загружается плановое количество, без изменения поставки в Lamoda.</p>
        <button disabled={disabled||!canWrite||!warehouseId||!reference}>Загрузить состав поставки</button>
      </form>
      </div>}<aside className="lamoda-operational-list">
      <div className="lamoda-list-header"><h3>{compact ? 'Единые сборки Lamoda' : 'Сборки Lamoda'}</h3>{operational && <button disabled={disabled || !accountId} onClick={()=>setRevision(v=>v+1)}>Обновить</button>}</div>
      {operational && <div className="lamoda-tabs lamoda-list-tabs"><button aria-pressed={planView==='active'} onClick={()=>setPlanView('active')}>Активные</button><button aria-pressed={planView==='closed'} onClick={()=>setPlanView('closed')}>Завершённые</button></div>}
      {!loading && !visiblePlans.length && <p>{!accountId ? 'Выберите клиента и кабинет Lamoda.' : planView==='closed' ? 'Завершённых сборок пока нет.' : 'Активных сборок пока нет. Нажмите «Создать сборку», чтобы загрузить файл или поставку Lamoda.'}</p>}
      {compact?<LamodaAssemblyList plans={visiblePlans} client={clients.find(c=>c.id===clientId)} disabled={disabled} canWrite={canWrite} selectedId={assembly?.requestId} onOpen={requestId=>void run(()=>openAssembly(requestId))} onReview={p=>void run(async()=>{setPreview(await previewLamodaPlan(token,accountId,p.id));setPreviewPlan(p.title);setPreviewId(p.id);})}/>:<div>
      {visiblePlans.map(p => <div className="lamoda-card" key={p.id}><strong>{p.title}</strong><p>{p.assembly?.request ? `№${p.assembly.request.number} · ${({SUBMITTED:'Новая',IN_REVIEW:'На проверке',APPROVED:'Согласована',IN_WORK:'В работе',PACKED:'Упакована',DONE:'Сдана',CANCELLED:'Отменена',REJECTED:'Отклонена'} as Record<string,string>)[p.assembly.request.status] ?? p.assembly.request.status}` : 'Черновик'}</p><p>{p.warehouse.name} · {p.items.reduce((sum, i) => sum + i.quantity, 0)} шт. · {date(p.createdAt)}</p>{!p.assembly && <button disabled={disabled || !canWrite} onClick={() => void run(async () => { setPreview(await previewLamodaPlan(token, accountId, p.id)); setPreviewPlan(p.title);setPreviewId(p.id); })}>Проверить соответствия и остатки</button>}{p.assembly && <button disabled={disabled} onClick={()=>void run(()=>openAssembly(p.assembly!.requestId))}>Открыть сборку</button>}</div>)}
      </div>}</aside>
      {preview && <LamodaStockReview key={previewId} preview={preview} title={previewPlan} disabled={disabled||(preview.existingRequest?false:!canWrite||!previewId||!overview?.assemblyEnabled)}
        onOpen={requestId=>void run(()=>openAssembly(requestId))}
        onCreate={quantities => void run(async () => {
          let result;
          try {
            result = await createLamodaAssembly(token, accountId, previewId, quantities);
          } catch (e) {
            // FIX: a new reservation after preview must return the operator to current shortages.
            try { setPreview(await previewLamodaPlan(token, accountId, previewId)); } catch { setPreview(null); }
            throw e;
          }
          // FIX: discard the draft review after creation; subsequent work uses the persisted request.
          setPreview(null);setPreviewId('');
          setNotice(`Создана сборка №${result.number}. Зарезервирован выбранный состав.`); setRevision(v => v + 1);
          if (operational) await openAssembly(result.id);
        })}/>}
    </div>}
    {tab === 'fbs' && <><p>Загруженные заказы пока не создают сборок и резервов WMS. До запуска обработки FBS остатки в Lamoda не публикуются.</p><button disabled={disabled || !canManage || !selected?.fbsEnabled || !selected.isActive} onClick={() => sync('ORDERS')}>Загрузить заказы</button><button disabled={disabled || !canManage || !selected?.fbsEnabled || !selected.isActive} onClick={() => sync('FBS_SHIPMENTS')}>Загрузить отгрузки FBS</button></>}
    {!customerMode && tab === 'returns' && <><p>Это ожидаемые возвраты Lamoda. Доступный остаток увеличивается только после физической приёмки в WMS.</p><button disabled={disabled || !canManage || !selected?.fbsEnabled || !selected.isActive} onClick={() => sync('RETURNS')}>Загрузить ожидаемые возвраты</button></>}
    {(!operational || tab !== 'fbo') && ['fbo', 'fbs', 'returns'].includes(tab) && <div className="lamoda-scroll"><table><thead><tr><th>Номер</th><th>ID Lamoda</th><th>Статус Lamoda</th><th>Последняя загрузка</th></tr></thead><tbody>{documents.map(d => <tr key={d.id}><td>{d.number}</td><td>{d.remoteId}</td><td>{d.status}</td><td>{date(d.syncedAt)}</td></tr>)}</tbody></table><p>Показано до 500 документов. Поставки и возвраты загружаются за период ±90 дней; заказы — с последней успешной загрузки, при первом запуске за 90 дней.</p></div>}
    {!customerMode && tab === 'log' && <div className="lamoda-scroll"><table><thead><tr><th>Время</th><th>Операция</th><th>Результат</th><th>Записей</th></tr></thead><tbody>{overview?.exchanges.map(e => <tr key={e.id}><td>{date(e.createdAt)}</td><td>{e.operation}</td><td>{({ RUNNING: 'Выполняется', SUCCEEDED: 'Завершено', FAILED: 'Ошибка' } as Record<string, string>)[e.status] ?? e.status} {e.errorCode}</td><td>{e.itemCount}</td></tr>)}</tbody></table></div>}
    {!compact&&assemblyContent}
  </section>;
  // FIX: scope changes dismiss stale confirmations; modal stays outside the CSS container.
  return compact ? <RequestRemovalProvider key={scope} token={token} onRemoved={()=>{openSequence.current++;setAssembly(null);setPreview(null);setPreviewId('');setRevision(v=>v+1);}}>{content}{assemblyContent&&<FboWorkspaceModal>{assemblyContent}</FboWorkspaceModal>}</RequestRemovalProvider> : content;
}
