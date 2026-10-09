import {useEffect,useState} from 'react';
import {foundKizAction,fetchFoundKiz,type AuthSession} from '../../lib/api';
export const foundCaptions:Record<string,string>={OPEN:'Товар физически у меня — отправить на разбор',REUSE:'Разрешить использовать КИЗ',RELABEL:'Разрешить переклейку',RETURN:'Вернуть на склад',REJECT:'Отклонить обращение'};
// FIX: found units are independent of picking tasks and need no box until physical return.
export function KizFoundPanel({session,candidate}:{session:AuthSession;candidate?:{markId:string;identity:string}}){
 const [items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<{action:string;row?:any}|null>(null),[reason,setReason]=useState(''),[box,setBox]=useState(''),[confirmed,setConfirmed]=useState(false),[release,setRelease]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){try{setItems(await fetchFoundKiz(session.accessToken));setError('');}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить обращения');}}
 useEffect(()=>{let live=true;fetchFoundKiz(session.accessToken).then(rows=>{if(live)setItems(rows);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[session.accessToken,candidate?.markId]);
 function choose(action:string,row?:any){setSelected({action,row});setReason('');setBox('');setConfirmed(false);setRelease(false);setError('');}
 const rows=candidate?items.filter(r=>r.snapshot.markId===candidate.markId):items;
 return <section className="kiz-queue"><h3>КИЗы, найденные после отгрузки</h3><p>Обращение и разрешение использования не увеличивают остаток. Короб нужен при возврате на склад.</p>
 {candidate&&!rows.length&&<button disabled={busy} onClick={()=>choose('OPEN')}>{foundCaptions.OPEN}</button>}
 <button disabled={busy} onClick={()=>void load()}>Обновить найденные КИЗы</button>{error&&<p role="alert">{error}</p>}
 {rows.map(row=><details key={row.id}><summary>{row.snapshot.productName} · {row.snapshot.boxCode??'Без короба'} · {row.resolution?foundCaptions[row.resolution]:'Требует решения'}</summary>
 <p>КИЗ: {row.kizIdentity}</p><p>Нашёл: {row.snapshot.workerName} · {new Date(row.createdAt).toLocaleString('ru-RU')}</p>
 <p>{row.snapshot.returned?'Возврат учтён':'Возврат ещё не учтён'}{row.resolution?' · разрешение сохранено для одного следующего отбора':''}</p>
 {(row.evidence.history??[]).map((h:any,i:number)=><p key={i}>{h.event} · заказ {h.orderId??'—'} · {h.at?new Date(h.at).toLocaleString('ru-RU'):''}</p>)}
 {['REUSE','RELABEL','RETURN','REJECT'].map(action=><button key={action} disabled={busy||(action==='REUSE'&&(row.decision==='RELABEL'||!!row.resolution))||(action==='RELABEL'&&row.resolution==='RELABEL')||(action==='RETURN'&&row.snapshot.returned)||(action==='REJECT'&&(!!row.resolution||row.snapshot.returned))} onClick={()=>choose(action,row)}>{foundCaptions[action]}</button>)}
 </details>)}
 {selected&&<form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await foundKizAction(session.accessToken,{action:selected.action,id:selected.row?.id,markId:candidate?.markId,reason,confirmed,boxCode:box,releaseBindings:release});setSelected(null);await load();}catch(e){setError(e instanceof Error?e.message:'Решение не сохранено');}finally{setBusy(false);}}}>
 <h4>{foundCaptions[selected.action]}</h4><label>Основание<textarea required minLength={5} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
 {selected.action==='RETURN'&&<label>Отсканируйте короб<input required value={box} disabled={busy} onChange={e=>setBox(e.target.value)}/></label>}
 <label><input type="checkbox" required checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Подтверждаю физическое наличие товара и выбранное действие{selected.action==='REUSE'?', КИЗ проверен и не погашен':''}.</label>
 {selected.action!=='OPEN'&&selected.action!=='REJECT'&&<label><input type="checkbox" checked={release} disabled={busy} onChange={e=>setRelease(e.target.checked)}/>Подтверждаю освобождение прежних привязок после возврата. Их история будет сохранена. Действующая сборка требует отдельного возврата.</label>}
 <button disabled={busy||!confirmed||reason.trim().length<5}>{busy?'Сохраняю…':'Подтвердить'}</button><button type="button" disabled={busy} onClick={()=>setSelected(null)}>Отмена</button></form>}
 </section>;
}
