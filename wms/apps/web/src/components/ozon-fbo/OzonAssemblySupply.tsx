import {useEffect,useState} from 'react';
import {ozonAssemblySupply,downloadOzonCargoMapping,type OzonSupplyView} from '../../lib/api';

// FIX: readiness follows every mapped direction, not merely one successful response.
export function cargoMappingReady(data:OzonSupplyView|null){return !!data?.directions.length&&data.directions.every(d=>data.link?.operations[data.link.mapping[d.name]]?.state==='SUCCESS');}

// FIX: bind before picking; upload the verified physical packing, not a planned box split.
export function OzonAssemblySupply({requestId,accessToken}:{requestId:string;accessToken:string}){
 const [data,setData]=useState<OzonSupplyView|null>(null),[connection,setConnection]=useState(''),[order,setOrder]=useState(''),[mapping,setMapping]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[notice,setNotice]=useState('');
 function accept(v:OzonSupplyView){setData(v);setMapping(v.link?.mapping??{});setConnection(v.link?.connectionId??v.connections[0]?.id??'');setOrder('');}
 useEffect(()=>{let live=true;void ozonAssemblySupply(accessToken,requestId).then(v=>{if(live)accept(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[accessToken,requestId]);
 async function action(name:string,body:unknown={}){setBusy(true);setError('');setNotice('');try{accept(await ozonAssemblySupply(accessToken,requestId,name,body));setNotice('Данные обновлены.');setConfirm(false);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const frozen=!!data?.link?.frozenHash;
 // FIX: a partial transfer must not look like a complete carton-to-label report.
 const mappingReady=cargoMappingReady(data);
 async function downloadMapping(){setBusy(true);setError('');try{const blob=await downloadOzonCargoMapping(accessToken,requestId),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ozon-boxes-${requestId}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const orders=data?.link?(data.link.orders??[data.link]):[];
 return <section className="ozfbo-card" aria-label="Связь сборки с Ozon"><h2>Поставка и грузоместа Ozon</h2><p>Привяжите существующую поставку до сборки. Состав коробов передаётся после упаковки и проверки.</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!data?<p>Загрузка…</p>:<><fieldset disabled={busy||frozen}><label>Кабинет<select disabled={!!data.link} value={connection} onChange={e=>setConnection(e.target.value)}>{data.connections.map(c=><option key={c.id} value={c.id}>{c.accountName||c.sellerId}</option>)}</select></label><label>Ссылка или ID заявки Ozon из адреса кабинета<input value={order} onChange={e=>setOrder(e.target.value)}/></label><button type="button" disabled={!connection||!order} onClick={()=>void action('bind',{connectionId:connection,orderId:order})}>Добавить заявку Ozon</button></fieldset>
 {data.link&&<><h3>Заявки Ozon общей сборки ({orders.length})</h3>{orders.map(o=><p key={o.orderId}><a href={'https://seller.ozon.ru/app/supply/orders/'+o.orderId} target="_blank" rel="noreferrer">Ozon №{o.orderNumber}</a> · {o.place} · {o.date?new Date(o.date).toLocaleString('ru-RU'):''} · {o.state} · {o.supplies.reduce((n,s)=>n+s.items.reduce((n,i)=>n+i.quantity,0),0)} шт.</p>)}<p>Всего по файлу: {data.directions.reduce((n,d)=>n+d.items.reduce((n,i)=>n+i.quantity,0),0)} шт. · В Ozon: {data.link.supplies.reduce((n,s)=>n+s.items.reduce((n,i)=>n+i.quantity,0),0)} шт.</p>
 <fieldset disabled={busy||frozen}><legend>Направления из файла → Ozon</legend>{data.directions.map(d=><label key={d.name} style={{display:'block',marginBottom:8}}>{d.name} · {d.items.reduce((n,i)=>n+i.quantity,0)} шт.<select value={mapping[d.name]??''} onChange={e=>setMapping(m=>({...m,[d.name]:e.target.value}))}><option value="">Не сопоставлено</option>{data.link!.supplies.map(s=><option value={s.id} key={s.id}>{s.name} · №{orders.find(o=>o.supplies.some(v=>v.id===s.id))?.orderNumber} · поставка {s.id} · {s.items.reduce((n,i)=>n+i.quantity,0)} шт.</option>)}</select></label>)}<button type="button" onClick={()=>void action('mapping',{mapping})}>Сохранить соответствия</button></fieldset>
 {data.differences.length>0?<div role="alert"><strong>Есть расхождения — отправка заблокирована</strong><ul>{data.differences.map((v,i)=><li key={i}>{v}</li>)}</ul><p>Исправьте поставку в кабинете Ozon или сопоставление. Количества файла сохраняются.</p></div>:<p>Состав файла совпадает с Ozon.</p>}
 <button type="button" disabled={busy} onClick={()=>void action('refresh')}>Повторно сверить с Ozon</button>
 {data.packingError&&<p>{data.packingError}</p>}
 <button type="button" disabled={busy||!mappingReady} onClick={()=>void downloadMapping()}>Скачать соответствия коробов (Excel)</button>
 <p>Короб WMS → направление → номер грузоместа Ozon. Файл доступен после подтверждения всех направлений. Порядок этикеток может отличаться от порядка коробов.</p>
 <label><input type="checkbox" checked={confirm} disabled={busy} onChange={e=>setConfirm(e.target.checked)}/>Подтверждаю передачу состава проверенных коробов</label>
 <button type="button" disabled={busy||!confirm||!!data.packingError||data.differences.length>0} onClick={()=>void action('upload',{confirm:true})}>Передать короба в Ozon</button>
 {Object.keys(data.link.operations).length>0&&<><button type="button" disabled={busy} onClick={()=>void action('status')}>Проверить результат отправки</button><p>Состав зафиксирован. Повторная отправка уже начатых направлений не выполняется.</p>{Object.entries(data.link.operations).map(([id,op])=><div key={id}><strong>{data.link!.supplies.find(s=>s.id===id)?.name??id}</strong><p>{({SENDING:'Запрос отправляется; повтор заблокирован',UNKNOWN:'Ответ не подтверждён — требуется сверка грузомест в кабинете',ACCEPTED:'Ozon обрабатывает',SUCCESS:'Грузоместа подтверждены',FAILED:'Ozon отклонил грузоместа'})[op.state]??op.state}</p>{op.error&&<p role="alert">{op.error}</p>}{op.state==='SUCCESS'&&<button disabled={busy} type="button" onClick={()=>void action('labels',{supplyId:id})}>Получить этикетки Ozon</button>}{op.labelOperationId&&!op.labelUrl&&<p>Этикетки готовятся. Нажмите «Получить этикетки Ozon» повторно.</p>}{op.labelUrl&&<a href={op.labelUrl} target="_blank" rel="noreferrer">Открыть этикетки для печати</a>}</div>)}</>}
 </>}
 </>}
 </section>;
}
