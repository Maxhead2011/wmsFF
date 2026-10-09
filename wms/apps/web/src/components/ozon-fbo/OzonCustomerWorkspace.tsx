import {useEffect,useRef,useState} from 'react';
import {fetchClients,fetchFboPlan,fetchOzonCustomerRequests,type AuthSession,type ClientSummary,type FboPlan,type OzonCustomerRequest} from '../../lib/api';
import {useRememberedClientId} from '../../lib/rememberedClient';
import {OzonCustomerImport} from '../client-requests/OzonCustomerImport';
import {FboTwoStagePanel} from '../client-requests/FboTwoStagePanel';

// FIX: customer workbooks are imported and reopened in FBO Ozon, not in the WB import screen.
export function OzonCustomerWorkspace({session}:{session:AuthSession}){
 const [clients,setClients]=useState<ClientSummary[]>([]),[clientId,setClient]=useRememberedClientId(session.user.id);
 const [rows,setRows]=useState<OzonCustomerRequest[]>([]),[plan,setPlan]=useState<FboPlan|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,reload]=useState(0);
 const current=useRef(clientId);current.current=clientId;
 useEffect(()=>{let live=true;void fetchClients(session.accessToken).then(data=>{if(!live)return;const choices=data.filter(c=>c.status!=='ARCHIVED');setClients(choices);setClient(old=>choices.some(c=>c.id===old)?old:choices[0]?.id??'');}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[session.accessToken]);
 useEffect(()=>{let live=true;setRows([]);setPlan(null);setError('');if(!clientId)return;setLoading(true);
  void fetchOzonCustomerRequests(session.accessToken,clientId).then(data=>{if(live)setRows(data);}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[session.accessToken,clientId,revision]);
 async function open(id:string){const selected=clientId;setError('');try{const data=await fetchFboPlan(session.accessToken,id);if(current.current===selected)setPlan(data);}catch(e){if(current.current===selected)setError(e instanceof Error?e.message:String(e));}}
 return <section className="ozfbo-shell" aria-label="ФБО Ozon по файлу клиента">
  <header className="ozfbo-hero"><div><span className="ozfbo-kicker">LOGOFF WMS · OZON</span><h1>Одна сборка — несколько направлений</h1><p>Количество по файлу клиента. Общий отбор, затем отдельные короба по направлениям. Остальной товар хранится на складе.</p></div>
   <label className="ozfbo-client-picker">Клиент<select value={clientId} onChange={e=>setClient(e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label></header>
  {error&&<p role="alert">{error}</p>}
  <div className="ozfbo-home-grid"><div className="ozfbo-card ozfbo-import">{clientId&&<OzonCustomerImport key={clientId} session={session} clients={clients} fixedClientId={clientId} embedded onCreated={()=>reload(n=>n+1)}/>}</div>
   <div className="ozfbo-card ozfbo-plans"><div className="ozfbo-card-title"><h2>Единые сборки Ozon</h2><button type="button" onClick={()=>reload(n=>n+1)} disabled={loading}>Обновить</button></div>
    {loading?<p>Загружаю сборки…</p>:rows.length===0?<p>Сборок пока нет. Проверьте файл и нажмите «Создать единую сборку».</p>:<div className="ozfbo-plan-list">{rows.map(r=><button type="button" key={r.id} className="ozfbo-card" onClick={()=>void open(r.id)}><strong>№{String(r.number).padStart(6,'0')} · {r.title}</strong><p>{r.quantity} шт. · {r.directions} направлений</p><small>{r.destinationCity} {r.desiredDate?new Date(r.desiredDate).toLocaleDateString('ru-RU'):''}</small><p>{r.phase==='COMPLETED'?'Сборка завершена':r.phase==='NOT_STARTED'?'Ожидает сборки':'Сборка в работе'} · Открыть</p></button>)}</div>}
   </div></div>
  {plan&&<FboTwoStagePanel key={plan.requestId} initial={plan} accessToken={session.accessToken} userId={session.user.id} canWrite onClose={()=>{setPlan(null);reload(n=>n+1);}}/>}
 </section>;
}
