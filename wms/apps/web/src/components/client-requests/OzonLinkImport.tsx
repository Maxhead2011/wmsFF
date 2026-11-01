import {ozonStockDecision} from './ozonStockDecision';
import '../ozon-fbo/ozon-workspace.css';
import {useEffect,useRef,useState} from 'react';
import {checkOzonImportStock,OzonImportStockReview} from './OzonImportStockReview';
import {OzonImportCorrection} from './OzonImportCorrection';
import type {ClientRequestAvailabilityPreview} from '../../lib/api';
import {fetchOzonLinkConnections,previewOzonLinks,createOzonLinks,type AuthSession,type OzonLinkPreview} from '../../lib/api';
// FIX: show the owner even when the marketplace account has no custom name.
export function ozonCabinetLabel(c:{accountName:string|null;sellerId:string},clientName?:string){
 return [...new Set([clientName?.trim(),c.accountName?.trim()].filter(Boolean)),c.sellerId].filter(Boolean).join(' · ') || 'Ozon';
}
// FIX: preview and creation are separate; changing client/account/links invalidates the preview.
export function OzonLinkImport({session,clientId,clientName,warehouseId,onCreated}:{session:AuthSession;clientId:string;clientName?:string;warehouseId?:string;onCreated:()=>void}){
 const [connections,setConnections]=useState<Array<{id:string;accountName:string|null;sellerId:string}>>([]),[connectionId,setConnection]=useState(''),[links,setLinks]=useState('');
 const [preview,setPreview]=useState<OzonLinkPreview|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState('');
 const [stock,setStock]=useState<ClientRequestAvailabilityPreview|null>(null),[correction,setCorrection]=useState<{id:string;number:number}|null>(null);
 const inFlight=useRef(false);
 // FIX: failed loading is not proof that the customer has no connected account.
 const [loadError,setLoadError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{const g=++generation.current;setConnections([]);setConnection('');setPreview(null);setStock(null);setCorrection(null);setMessage('');setLoadError('');if(!clientId){setLoading(false);return;}setLoading(true);
  void fetchOzonLinkConnections(session.accessToken,clientId).then(rows=>{if(g!==generation.current)return;setConnections(rows);setConnection(rows[0]?.id??'');}).catch(e=>{if(g===generation.current)setLoadError(e instanceof Error?e.message:String(e));}).finally(()=>{if(g===generation.current)setLoading(false);});return()=>{generation.current++;};
 },[clientId,warehouseId,session.accessToken]);
 function change(fn:()=>void){generation.current++;fn();setPreview(null);setStock(null);setCorrection(null);setMessage('');}
 async function run(commit:boolean,adjust=false){if(inFlight.current||!warehouseId)return;const g=generation.current;inFlight.current=true;setBusy(true);setMessage('');try{
  const body={clientId,connectionId,links,warehouseId,previewHash:preview?.previewHash};
  if(commit){if(!preview||!stock)return;const result=await createOzonLinks(session.accessToken,{...body,stockDecision:ozonStockDecision(stock,Boolean(adjust))});if(g!==generation.current)return;setMessage(`Сборка №${result.request.number} ${result.existing?'уже существует':'создана'}.`);setPreview(null);setStock(null);if(adjust)setCorrection(result.request);onCreated();}
  else {setPreview(null);setStock(null);setCorrection(null);const result=await previewOzonLinks(session.accessToken,body);const s=await checkOzonImportStock(session.accessToken,clientId,warehouseId,result);if(g===generation.current){setPreview(result);setStock(s);}}
 }catch(e){if(g===generation.current)setMessage(e instanceof Error?e.message:String(e));}finally{inFlight.current=false;setBusy(false);}}
 return <section className="ozfbo-link-import" aria-label="Создать сборку по ссылке Ozon"><h3>Создать сборку по ссылке Ozon</h3>
 <p>Вставьте ссылку на существующую заявку из кабинета Ozon. Для общей сборки можно указать несколько ссылок — по одной на строку. Точка сдачи и время отгрузки должны совпадать.</p>
 <fieldset disabled={busy||loading||!clientId}><label>Кабинет Ozon<select value={connectionId} onChange={e=>change(()=>setConnection(e.target.value))}><option value="">Выберите кабинет</option>{connections.map(c=><option key={c.id} value={c.id}>{ozonCabinetLabel(c,clientName)}</option>)}</select></label>
 <label>Ссылка на заявку Ozon<textarea rows={3} value={links} placeholder="https://seller.ozon.ru/app/supply/orders/134006772" onChange={e=>change(()=>setLinks(e.target.value))}/></label>
 <button type="button" disabled={!connectionId||!warehouseId||!links.trim()} onClick={()=>void run(false)}>{busy?'Загрузка…':'Получить состав из Ozon'}</button>
 {preview&&<div><p>Точка сдачи: {preview.place} · {new Date(preview.date).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p><p>Одна сборка · {preview.directions.length} направлений · {preview.totalQuantity} шт.</p>
 <ul>{preview.orders.map(o=><li key={o.orderId}>Ozon №{o.orderNumber}</li>)}</ul>
 {preview.directions.map(d=><details key={d.name}><summary>{d.name}: {d.items.reduce((n,i)=>n+i.quantity,0)} шт.</summary><ul>{d.items.map(i=><li key={i.skuId}>ШК {i.barcode} — {i.quantity} шт.</li>)}</ul></details>)}
 {preview.existingRequest?<p role="status">Уже создана сборка №{preview.existingRequest.number}. Откройте её в списке сборок.</p>:stock&&<OzonImportStockReview stock={stock} busy={busy} source="link" onAdjust={()=>void run(true,true)} onCreate={()=>void run(true)}/>}</div>}
 </fieldset>{loading&&<p>Загрузка кабинетов…</p>}{!loading&&!loadError&&clientId&&!connections.length&&<p>Нет подключённого кабинета Ozon. Добавьте его в настройках клиента.</p>}{loadError&&<p role="alert">Не удалось загрузить кабинеты Ozon: {loadError}</p>}{message&&<p role="status">{message}</p>}{correction&&<OzonImportCorrection key={correction.id} request={correction} accessToken={session.accessToken} linked onChanged={onCreated}/>}</section>;
}
