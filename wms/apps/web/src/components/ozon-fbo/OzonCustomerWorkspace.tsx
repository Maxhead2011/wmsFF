import {OzonAssemblyList} from './OzonAssemblyList';
import {FboWorkspaceModal} from '../client-requests/FboWorkspaceModal';
import {fetchWorkspaceClients} from '../../lib/marketplaceWorkspace';
import {OzonEditCountdown} from './OzonEditCountdown';
import {RequestRemovalProvider,RequestRemovalButton} from '../client-requests/RequestRemoval';
import './ozon-workspace.css';
import {OzonAssemblySupply} from './OzonAssemblySupply';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {fetchClients,fetchFboPlan,fetchOzonCustomerRequests,type AuthSession,type ClientSummary,type FboPlan,type OzonCustomerRequest} from '../../lib/api';
import {useRememberedClientId} from '../../lib/rememberedClient';
import {OzonCustomerImport} from '../client-requests/OzonCustomerImport';
import {FboTwoStagePanel} from '../client-requests/FboTwoStagePanel';

// FIX: scoped 65/35 workspace retains the existing import, selection and action handlers.
// FIX: customer workbooks are imported and reopened in FBO Ozon, not in the WB import screen.
export function OzonCustomerWorkspace({session}:{session:AuthSession}){
 // FIX: the combined layout is restricted to our deployment and local previews.
 const combined=typeof window!=='undefined'&&['wms.logoff.pro','localhost','127.0.0.1'].includes(window.location.hostname);
 const [columns,setColumns]=useState(6);
 const [selected,setSelected]=useState<{id:string;mode:'assembly'|'cargo'}|null>(null);
 const [opening,setOpening]=useState(false);
 const requestSequence=useRef(0);
 useEffect(()=>()=>{requestSequence.current++;},[]);
 const [clients,setClients]=useState<ClientSummary[]>([]),[rememberedClient,setRememberedClient]=useRememberedClientId(session.user.id);
 // FIX: browsing starts with all allowed clients and never overwrites another screen's client selection.
 const [filterClient,setFilterClient]=useState('');const clientId=combined?filterClient:rememberedClient,setClient=combined?setFilterClient:setRememberedClient;
 const [hasMore,setHasMore]=useState(false),[moreBusy,setMoreBusy]=useState(false);
 const [rows,setRows]=useState<OzonCustomerRequest[]>([]),[plan,setPlan]=useState<FboPlan|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,reload]=useState(0);
 const [supplyId,setSupplyId]=useState('');
 // FIX: keep handed-over requests accessible outside the active queue.
 const [view,setView]=useState<'active'|'completed'>('active');
 // FIX: branch comes from the import selector, with client identity to reject stale selections.
 const branchScope=session.user.id+':'+(session.user.activeWarehouseId??'')+':'+clientId;
 const [branch,setBranch]=useState({scope:'',warehouseId:''});
 const warehouseId=branch.scope===branchScope?branch.warehouseId:'';
 // FIX: refresh and branch changes invalidate outstanding pages and detail requests.
 const listScope=session.accessToken+':'+branchScope+':'+warehouseId+':'+view;
 const selectionKey=listScope+':'+revision;const current=useRef(selectionKey);current.current=selectionKey;
 const previousListScope=useRef(listScope);
 useEffect(()=>{let live=true;void fetchWorkspaceClients(session.accessToken,"OZON").then(data=>{if(!live)return;const choices=data.filter(c=>c.status!=='ARCHIVED');setClients(choices);if(!combined)setClient(old=>choices.some(c=>c.id===old)?old:choices[0]?.id??'');}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[session.accessToken]);
 useEffect(()=>{let live=true;requestSequence.current++;setSelected(null);setOpening(false);if(!combined||previousListScope.current!==listScope)setRows([]);previousListScope.current=listScope;setPlan(null);setSupplyId('');setError('');setHasMore(false);setMoreBusy(false);if(!combined&&(!clientId||!warehouseId)){setLoading(false);return;}setLoading(true);
  void fetchOzonCustomerRequests(session.accessToken,clientId,warehouseId,view,{allClients:combined}).then(data=>{if(live){setRows(data);setHasMore(combined&&data.length===100);}}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[session.accessToken,session.user.activeWarehouseId,clientId,warehouseId,revision,view]);
 async function more(){if(loading||moreBusy||!rows.length)return;const scope=selectionKey;setMoreBusy(true);try{const data=await fetchOzonCustomerRequests(session.accessToken,clientId,warehouseId,view,{allClients:combined,beforeNumber:rows[rows.length-1].number});if(current.current===scope){setRows(old=>[...old,...data.filter(r=>!old.some(o=>o.id===r.id))]);setHasMore(data.length===100);}}catch(e){if(current.current===scope)setError(String(e));}finally{if(current.current===scope)setMoreBusy(false);}}
 // FIX: a late response for order A cannot replace the selected order B or its cargo panel.
 async function open(id:string){const scope=selectionKey,sequence=++requestSequence.current;setError('');
  if(combined){setSelected({id,mode:'assembly'});setSupplyId('');setPlan(null);setOpening(true);}
  try{const data=await fetchFboPlan(session.accessToken,id);if(current.current===scope&&requestSequence.current===sequence)setPlan(data);}
  catch(e){if(current.current===scope&&requestSequence.current===sequence)setError(e instanceof Error?e.message:String(e));}
  finally{if(requestSequence.current===sequence)setOpening(false);}
 }
 function cargo(id:string){if(combined){requestSequence.current++;setOpening(false);setPlan(null);setSelected({id,mode:'cargo'});}setSupplyId(id);}
 function close(){requestSequence.current++;setSelected(null);setOpening(false);setPlan(null);setSupplyId('');reload(n=>n+1);}
 const clientPicker=<label className="ozfbo-client-picker">Клиент<select value={clientId} onChange={e=>setClient(e.target.value)}>{combined&&<option value="">Все клиенты</option>}{clients.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>;
 const selectedRow=rows.find(r=>r.id===selected?.id);
 return <RequestRemovalProvider token={session.accessToken} onRemoved={close}><section className={"ozfbo-shell ozfbo-customer-workspace"+(combined?" ozfbo-combined":"")} style={{"--ozfbo-columns":columns} as CSSProperties} aria-label="ФБО Ozon по файлу клиента">
  <header className="ozfbo-hero"><div><span className="ozfbo-kicker">LOGOFF WMS · OZON</span><h1>{combined?"Сборки Ozon":"Одна сборка — несколько направлений"}</h1>{!combined&&<p>Количество по файлу клиента. Общий отбор, затем отдельные короба по направлениям. Остальной товар хранится на складе.</p>}</div>
   {clientPicker}</header>
  {error&&<p role="alert">{error}</p>}
  <div className="ozfbo-home-grid"><div className="ozfbo-workspace-left"><div className="ozfbo-card ozfbo-import">{combined&&!clientId&&<p>Для создания сборки выберите конкретного клиента.</p>}{clientId&&<OzonCustomerImport key={branchScope} session={session} clients={clients} fixedClientId={clientId} embedded compact={combined} toolbar={combined?undefined:clientPicker} onWarehouseChange={(_,warehouseId)=>setBranch({scope:branchScope,warehouseId})} onCreated={()=>reload(n=>n+1)}/>}</div>
  {!combined&&plan&&<FboTwoStagePanel key={plan.requestId} embedded initial={plan} accessToken={session.accessToken} userId={session.user.id} canWrite={view==='active'} onClose={()=>{setPlan(null);reload(n=>n+1);}}/>}</div>
   <div className="ozfbo-card ozfbo-plans"><div className="ozfbo-card-title"><h2>Единые сборки Ozon</h2><button type="button" onClick={()=>reload(n=>n+1)} disabled={loading}>Обновить</button></div>
    <div className="ozfbo-workspace-tabs" role="group" aria-label="Список сборок"><button type="button" aria-pressed={view==='active'} onClick={()=>setView('active')}>Активные</button><button type="button" aria-pressed={view==='completed'} onClick={()=>setView('completed')}>Завершённые</button></div>
    {loading&&(!combined||!rows.length)?<p>Загружаю сборки…</p>:rows.length===0?<p>{view==='completed'?'Завершённых сборок пока нет.':'Активных сборок пока нет. Проверьте файл и нажмите «Создать единую сборку».'}</p>:combined?<OzonAssemblyList rows={rows} active={view==='active'} selectedId={selected?.id} onOpen={id=>void open(id)} onCargo={cargo}/>:<div className="ozfbo-plan-list">{rows.map(r=><div key={r.id} className="ozfbo-card ozfbo-workspace-order" data-selected={combined&&selected?.id===r.id||undefined}><strong className="ozfbo-workspace-number">№{String(r.number).padStart(6,'0')}</strong><p className="ozfbo-workspace-name">{r.title}</p><p>{r.quantity} шт. · {r.directions} направлений</p><small>{r.destinationCity} {r.desiredDate?new Date(r.desiredDate).toLocaleDateString('ru-RU'):''}</small>{view==='active'&&<OzonEditCountdown orders={r.editDeadlines}/>}<p className="ozfbo-workspace-status">{r.status==='DONE'?'Сдано':r.status==='CANCELLED'?'Отменена':r.status==='REJECTED'?'Отклонена':r.phase==='COMPLETED'?'Упаковано, ожидает сдачи':r.phase==='NOT_STARTED'?'Ожидает сборки':'Сборка в работе'}</p><div className="ozfbo-workspace-actions"><RequestRemovalButton request={r}/><button type="button" onClick={()=>cargo(r.id)}>Поставка и грузоместа Ozon</button><button type="button" onClick={()=>void open(r.id)}>Открыть сборку</button></div></div>)}</div>}
    {combined&&hasMore&&<button className="ozfbo-more" type="button" disabled={loading||moreBusy} onClick={()=>void more()}>{moreBusy?'Загружаю…':'Показать ещё'}</button>}
   </div></div>
  {!combined&&supplyId&&<OzonAssemblySupply key={supplyId} requestId={supplyId} accessToken={session.accessToken} clientName={rows.find(r=>r.id===supplyId)?.clientName??clients.find(c=>c.id===clientId)?.name}/>}

 </section>
  {/* FIX: modal is a sibling of the size container, so it centers on the viewport. */}
  {combined&&selected&&<FboWorkspaceModal key={selected.id+":"+selected.mode} title={selected.mode==='cargo'?`Поставка и грузоместа Ozon · №${selectedRow?.number??''}`:!plan?`Сборка №${selectedRow?.number??''}`:undefined} onClose={close}>
   <div className="ozfbo-customer-workspace ozfbo-combined" aria-label="Выбранная сборка">
   {error&&<p role="alert">{error}</p>}
   {view==='active'&&selected.mode==='assembly'&&<OzonEditCountdown orders={selectedRow?.editDeadlines}/>}
   {opening&&<p role="status">Загружаю сборку…</p>}
   {selected.mode==='assembly'&&plan&&<FboTwoStagePanel key={plan.requestId} embedded initial={plan} accessToken={session.accessToken} userId={session.user.id} canWrite={view==='active'} onClose={close}/>}
   {selected.mode==='cargo'&&supplyId&&<OzonAssemblySupply key={supplyId} requestId={supplyId} accessToken={session.accessToken} clientName={rows.find(r=>r.id===supplyId)?.clientName??clients.find(c=>c.id===clientId)?.name}/>}
  </div></FboWorkspaceModal>}
 </RequestRemovalProvider>;
}
