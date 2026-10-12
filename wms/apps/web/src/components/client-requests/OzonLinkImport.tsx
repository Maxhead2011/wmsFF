import {useEffect,useRef,useState} from 'react';
import {fetchOzonLinkConnections,previewOzonLinks,createOzonLinks,type AuthSession,type OzonLinkPreview} from '../../lib/api';
// FIX: preview and creation are separate; changing client/account/links invalidates the preview.
export function OzonLinkImport({session,clientId,onCreated}:{session:AuthSession;clientId:string;onCreated:()=>void}){
 const [connections,setConnections]=useState<Array<{id:string;accountName:string|null;sellerId:string}>>([]),[connectionId,setConnection]=useState(''),[links,setLinks]=useState('');
 const [preview,setPreview]=useState<OzonLinkPreview|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0);
 useEffect(()=>{const g=++generation.current;setConnections([]);setConnection('');setPreview(null);setMessage('');if(!clientId)return;setLoading(true);
  void fetchOzonLinkConnections(session.accessToken,clientId).then(rows=>{if(g!==generation.current)return;setConnections(rows);setConnection(rows[0]?.id??'');}).catch(e=>{if(g===generation.current)setMessage(e instanceof Error?e.message:String(e));}).finally(()=>{if(g===generation.current)setLoading(false);});return()=>{generation.current++;};
 },[clientId,session.accessToken]);
 function change(fn:()=>void){generation.current++;fn();setPreview(null);setMessage('');}
 async function run(commit:boolean){const g=generation.current;setBusy(true);setMessage('');try{
  const body={clientId,connectionId,links,previewHash:preview?.previewHash};
  if(commit){if(!preview)return;const result=await createOzonLinks(session.accessToken,body);if(g!==generation.current)return;setMessage(`Сборка №${result.request.number} ${result.existing?'уже существует':'создана'}.`);setPreview(null);onCreated();}
  else {const result=await previewOzonLinks(session.accessToken,body);if(g===generation.current)setPreview(result);}
 }catch(e){if(g===generation.current)setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <section aria-label="Создать сборку по ссылке Ozon" style={{marginTop:24}}><h3>Создать сборку по ссылке Ozon</h3>
 <p>Вставьте ссылку на существующую заявку из кабинета Ozon. Для общей сборки можно указать несколько ссылок — по одной на строку. Точка сдачи и время отгрузки должны совпадать.</p>
 <fieldset disabled={busy||loading||!clientId}><label>Кабинет Ozon<select value={connectionId} onChange={e=>change(()=>setConnection(e.target.value))}><option value="">Выберите кабинет</option>{connections.map(c=><option key={c.id} value={c.id}>{c.accountName||'Ozon'} · {c.sellerId}</option>)}</select></label>
 <label>Ссылка на заявку Ozon<textarea rows={3} value={links} placeholder="https://seller.ozon.ru/app/supply/orders/134006772" onChange={e=>change(()=>setLinks(e.target.value))}/></label>
 <button type="button" disabled={!connectionId||!links.trim()} onClick={()=>void run(false)}>{busy?'Загрузка…':'Получить состав из Ozon'}</button>
 {preview&&<div><p>Точка сдачи: {preview.place} · {new Date(preview.date).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p><p>Одна сборка · {preview.directions.length} направлений · {preview.totalQuantity} шт.</p>
 <ul>{preview.orders.map(o=><li key={o.orderId}>Ozon №{o.orderNumber}</li>)}</ul>
 {preview.directions.map(d=><details key={d.name}><summary>{d.name}: {d.items.reduce((n,i)=>n+i.quantity,0)} шт.</summary><ul>{d.items.map(i=><li key={i.skuId}>ШК {i.barcode} — {i.quantity} шт.</li>)}</ul></details>)}
 {preview.existingRequest?<p role="status">Уже создана сборка №{preview.existingRequest.number}. Откройте её в списке сборок.</p>:<button type="button" onClick={()=>void run(true)}>Создать сборку</button>}</div>}
 </fieldset>{loading&&<p>Загрузка кабинетов…</p>}{!loading&&clientId&&!connections.length&&<p>Нет подключённого кабинета Ozon. Добавьте его в настройках клиента.</p>}{message&&<p role="status">{message}</p>}</section>;
}
