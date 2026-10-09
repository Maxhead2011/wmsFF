import { useEffect, useState } from 'react';
import { fetchFboHistory, type FboPlan } from '../../lib/api';
const time=(value?:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
export function FboHistory({plan,accessToken}:{plan:FboPlan;accessToken?:string}){
  // FIX: closed history creates no rows; open history is bounded and cancels stale reads.
  const lazy=import.meta.env.VITE_MENU_READS_ENABLED==='true';
  const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [history,setHistory]=useState<NonNullable<FboPlan['pickedUnits']>>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [historyTotal,setHistoryTotal]=useState<number>();
  useEffect(()=>{
    if(!lazy||!open||!accessToken)return;
    let cancelled=false;setLoading(true);setError('');setHistory([]);
    fetchFboHistory(accessToken,plan.requestId,offset).then(data=>{if(!cancelled){setHistory(data.pickedUnits);setHistoryTotal(data.total);}})
      .catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[lazy,open,accessToken,plan.requestId,plan.observedAt,offset,retry]);
  const total=historyTotal??plan.pickedUnitsCount??plan.pickedUnits?.length??0;
  const historyRows=lazy?(open?(accessToken?history:(plan.pickedUnits??[]).slice(offset,offset+100)):[]):(plan.pickedUnits??[]);
  return (    <details className="fbo-progress-history" onToggle={e=>setOpen(e.currentTarget.open)}><summary>История отбора · {total} единиц</summary>{loading&&<p role="status">Загрузка истории…</p>}{error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Повторить</button></p>}{(!lazy||open)&&<><div className="online-execution-table-wrap"><table className="online-execution-table"><thead><tr><th>Товар / ШК</th><th>КИЗ</th><th>Исходный короб</th><th>Отобрал / время МСК</th><th>Упаковка / время МСК</th></tr></thead><tbody>{historyRows.map(u=><tr key={u.id}><td>{plan.lines.find(l=>l.id===u.requestItemId)?.name}<br/>{u.barcode}</td><td className="fbo-kiz">{u.kiz||'Без КИЗ'}</td><td>{u.sourceBoxCode}{u.wholeBox?' · целиком':''}</td><td>{u.pickedBy||'—'}<br/>{time(u.pickedAt)}</td><td>{u.targetBoxCode||'Не упаковано'}<br/>{u.packedBy} {time(u.packedAt)}</td></tr>)}</tbody></table></div>{lazy&&<div><button disabled={offset===0||loading} onClick={()=>setOffset(n=>Math.max(0,n-100))}>Назад</button><span> {total?offset+1:0}–{Math.min(offset+100,total)} из {total} </span><button disabled={offset+100>=total||loading} onClick={()=>setOffset(n=>n+100)}>Далее</button></div>}</>}</details>);
}
