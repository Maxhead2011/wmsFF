import './ozon-workspace.css';
import {OzonAssemblySupply} from './OzonAssemblySupply';
import {useEffect,useRef,useState} from 'react';
import {fetchClients,fetchFboPlan,fetchOzonCustomerRequests,type AuthSession,type ClientSummary,type FboPlan,type OzonCustomerRequest} from '../../lib/api';
import {useRememberedClientId} from '../../lib/rememberedClient';
import {OzonCustomerImport} from '../client-requests/OzonCustomerImport';
import {FboTwoStagePanel} from '../client-requests/FboTwoStagePanel';

// FIX: scoped 65/35 workspace retains the existing import, selection and action handlers.
// FIX: customer workbooks are imported and reopened in FBO Ozon, not in the WB import screen.
export function OzonCustomerWorkspace({session}:{session:AuthSession}){
 const [clients,setClients]=useState<ClientSummary[]>([]),[clientId,setClient]=useRememberedClientId(session.user.id);
 const [rows,setRows]=useState<OzonCustomerRequest[]>([]),[plan,setPlan]=useState<FboPlan|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,reload]=useState(0);
 const [supplyId,setSupplyId]=useState('');
 // FIX: keep handed-over requests accessible outside the active queue.
 const [view,setView]=useState<'active'|'completed'>('active');
 // FIX: branch comes from the import selector, with client identity to reject stale selections.
 const [branch,setBranch]=useState({clientId:'',warehouseId:''});
 const warehouseId=branch.clientId===clientId?branch.warehouseId:'';
 const selectionKey=clientId+':'+warehouseId+':'+view;const current=useRef(selectionKey);current.current=selectionKey;
 useEffect(()=>{let live=true;void fetchClients(session.accessToken).then(data=>{if(!live)return;const choices=data.filter(c=>c.status!=='ARCHIVED');setClients(choices);setClient(old=>choices.some(c=>c.id===old)?old:choices[0]?.id??'');}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[session.accessToken]);
 useEffect(()=>{let live=true;setRows([]);setPlan(null);setSupplyId('');setError('');if(!clientId||!warehouseId){setLoading(false);return;}setLoading(true);
  void fetchOzonCustomerRequests(session.accessToken,clientId,warehouseId,view).then(data=>{if(live)setRows(data);}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[session.accessToken,clientId,warehouseId,revision,view]);
 async function open(id:string){const selected=selectionKey;setError('');try{const data=await fetchFboPlan(session.accessToken,id);if(current.current===selected)setPlan(data);}catch(e){if(current.current===selected)setError(e instanceof Error?e.message:String(e));}}
 return <section className="ozfbo-shell ozfbo-customer-workspace" aria-label="ФБО Ozon по файлу клиента">
  <header className="ozfbo-hero"><div><span className="ozfbo-kicker">LOGOFF WMS · OZON</span><h1>Одна сборка — несколько направлений</h1><p>Количество по файлу клиента. Общий отбор, затем отдельные короба по направлениям. Остальной товар хранится на складе.</p></div>
   <label className="ozfbo-client-picker">Клиент<select value={clientId} onChange={e=>setClient(e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label></header>
  {error&&<p role="alert">{error}</p>}
  <div className="ozfbo-home-grid"><div className="ozfbo-card ozfbo-import">{clientId&&<OzonCustomerImport key={clientId} session={session} clients={clients} fixedClientId={clientId} embedded onWarehouseChange={(clientId,warehouseId)=>setBranch({clientId,warehouseId})} onCreated={()=>reload(n=>n+1)}/>}</div>
   <div className="ozfbo-card ozfbo-plans"><div className="ozfbo-card-title"><h2>Единые сборки Ozon</h2><button type="button" onClick={()=>reload(n=>n+1)} disabled={loading}>Обновить</button></div>
    <div className="ozfbo-workspace-tabs" role="group" aria-label="Список сборок"><button type="button" aria-pressed={view==='active'} onClick={()=>setView('active')}>Активные</button><button type="button" aria-pressed={view==='completed'} onClick={()=>setView('completed')}>Завершённые</button></div>
    {loading?<p>Загружаю сборки…</p>:rows.length===0?<p>{view==='completed'?'Завершённых сборок пока нет.':'Активных сборок пока нет. Проверьте файл и нажмите «Создать единую сборку».'}</p>:<div className="ozfbo-plan-list">{rows.map(r=><div key={r.id} className="ozfbo-card ozfbo-workspace-order"><strong className="ozfbo-workspace-number">№{String(r.number).padStart(6,'0')}</strong><p className="ozfbo-workspace-name">{r.title}</p><p>{r.quantity} шт. · {r.directions} направлений</p><small>{r.destinationCity} {r.desiredDate?new Date(r.desiredDate).toLocaleDateString('ru-RU'):''}</small><p className="ozfbo-workspace-status">{r.status==='DONE'?'Сдано':r.status==='CANCELLED'?'Отменена':r.status==='REJECTED'?'Отклонена':r.phase==='COMPLETED'?'Упаковано, ожидает сдачи':r.phase==='NOT_STARTED'?'Ожидает сборки':'Сборка в работе'}</p><div className="ozfbo-workspace-actions"><button type="button" onClick={()=>setSupplyId(r.id)}>Поставка и грузоместа Ozon</button><button type="button" onClick={()=>void open(r.id)}>Открыть сборку</button></div></div>)}</div>}
   </div></div>
  {supplyId&&<OzonAssemblySupply key={supplyId} requestId={supplyId} accessToken={session.accessToken} clientName={clients.find(c=>c.id===clientId)?.name}/>}
  {plan&&<FboTwoStagePanel key={plan.requestId} initial={plan} accessToken={session.accessToken} userId={session.user.id} canWrite={view==='active'} onClose={()=>{setPlan(null);reload(n=>n+1);}}/>}
 </section>;
}
