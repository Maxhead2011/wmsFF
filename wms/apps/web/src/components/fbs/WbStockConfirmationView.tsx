import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchWbStockConfirmations, verifyWbStockConfirmations, type AuthSession } from '../../lib/api';
import { confirmationAmount, confirmationStatus, type StockConfirmationResult } from '../../lib/wbStockConfirmation';
import './WbStockConfirmationView.css';
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Ещё не проверено';
export function WbStockConfirmationView({session,clientId,connectionId}:{session:AuthSession;clientId:string;connectionId:string}) {
  const [data,setData]=useState<StockConfirmationResult|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState('ALL'),[warehouse,setWarehouse]=useState('');
  const [page,setPage]=useState(1),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{setData(null);setQuery('');setSearch('');setStatus('ALL');setWarehouse('');setPage(1);setMessage('');},[clientId,connectionId]);
  useEffect(()=>{
    const id=++generation.current;
    if(!connectionId){setBusy(false);return;}
    setBusy(true);setError('');
    fetchWbStockConfirmations(session.accessToken,clientId,connectionId,{search:query,status,warehouseId:warehouse,page})
      .then(result=>{if(id===generation.current)setData(result);})
      .catch(e=>{if(id===generation.current)setError(e instanceof Error?e.message:'Не удалось загрузить подтверждения.');})
      .finally(()=>{if(id===generation.current)setBusy(false);});
    return()=>{generation.current++;};
  },[session.accessToken,clientId,connectionId,query,status,warehouse,page,reload]);
  useEffect(()=>{if(checking)return;const timer=window.setInterval(()=>setReload(n=>n+1),30000);return()=>window.clearInterval(timer);},[checking]);
  async function check() {
    if(checking||busy)return;const id=generation.current;setChecking(true);setError('');setMessage('');
    try{const result=await verifyWbStockConfirmations(session.accessToken,clientId,connectionId);if(id!==generation.current)return;
      setMessage(`Проверено в WB: ${result.checked}. Расхождений: ${result.mismatches}. Без подтверждения: ${result.unconfirmed??0}.`);setReload(n=>n+1);
    }catch(e){if(id===generation.current){setError(e instanceof Error?e.message:'Проверка WB не завершена.');setReload(n=>n+1);}}
    finally{setChecking(false);}
  }
  if(!connectionId)return <p>Для клиента не выбран активный кабинет WB.</p>;
  return <section className="wb-confirmation">
    <header><div><h3>Подтверждение остатков WB</h3><p>Последние результаты по каждому товару и складу{data?.accountName?` · ${data.accountName}`:''}.</p></div>
      <div className="wb-confirmation__actions"><button className="icon-text-button" disabled={busy||checking} onClick={()=>setReload(n=>n+1)}><RefreshCw size={17} aria-hidden="true"/> Обновить список</button>
        <button className="primary-button" disabled={busy||checking||!data?.summary.total} onClick={()=>void check()}><ShieldCheck size={17} aria-hidden="true"/>{checking?'Проверяем WB…':'Проверить в WB'}</button></div></header>
    <p className="wb-confirmation__hint">Проверка читает остатки WB и не отправляет новые количества. «—» означает отсутствие данных, а не нулевой остаток.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {data&&<><div className="wb-confirmation__stats">
      {[['Всего записей',data.summary.total,'all'],['Подтверждено',data.summary.confirmed,'ok'],['Расхождения',data.summary.mismatches,'bad'],['Нет подтверждения',data.summary.unconfirmed,'warn'],['В процессе',data.summary.pending,'pending']].map(([title,value,tone])=><div className={`wb-confirmation__stat wb-confirmation__stat--${tone}`} key={String(tone)}><span>{title}</span><strong>{value}</strong></div>)}
    </div><p className="wb-confirmation__hint">Сводка по всему кабинету · Последняя проверка: {date(data.summary.lastCheckedAt)}. Список обновлён: {date(data.generatedAt)}.</p></>}
    <form className="wb-confirmation__filters" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}>
      <label>Товар<input placeholder="Артикул, название, ШК или ID размера WB" value={search} onChange={e=>setSearch(e.target.value)} disabled={checking}/></label><button type="submit" className="icon-text-button" disabled={checking}>Найти</button>
      <label>Статус<select value={status} disabled={checking} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="ALL">Все статусы</option><option value="CONFIRMED">Подтверждено</option><option value="MISMATCH">Расхождения</option><option value="UNCONFIRMED">Нет подтверждения</option><option value="PENDING">В процессе</option></select></label>
      <label>Склад WB<select value={warehouse} disabled={checking} onChange={e=>{setWarehouse(e.target.value);setPage(1);}}><option value="">Все склады</option>{data?.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    </form>
    {busy&&<p role="status">Обновляем список…</p>}
    {data&&<><div className="wb-confirmation__table"><table><thead><tr><th>Товар / размер</th><th>Склад WB</th><th>Рассчитано</th><th>Отправлено</th><th>В WB</th><th>Разница</th><th>Статус / проверка</th></tr></thead><tbody>
      {data.rows.map(row=><tr key={row.id}><td><strong>{row.article||row.name||'Карточка недоступна'}</strong><small>{row.size||'Размер не указан'} · {row.barcode||`ID WB: ${row.chrtId}`}</small></td><td>{data.warehouses.find(w=>w.id===row.warehouseId)?.name||row.warehouseId}</td>
        <td>{row.calculatedAmount}</td><td>{confirmationAmount(row.sentAmount)}<small>{row.sentAt?date(row.sentAt):'Отправка не требовалась / не начата'}</small></td><td>{confirmationAmount(row.observedAmount)}</td><td>{row.difference===null?'—':row.difference>0?`+${row.difference}`:row.difference}</td>
        <td><span className={`wb-confirmation__status wb-confirmation__status--${row.status.toLowerCase()}`}>{confirmationStatus(row.status)}</span><small>{date(row.checkedAt)}</small>{row.error&&<small className="wb-confirmation__error">{row.error}</small>}</td></tr>)}
    </tbody></table></div>
    {!data.rows.length&&<p>{data.summary.total?'Нет записей по выбранным фильтрам.':'Подтверждений пока нет. Они появятся после первого расчёта и проверки отправки остатков WB.'}</p>}
    <footer><span>Найдено: {data.total} · Страница {page} из {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button className="icon-text-button" disabled={page<=1||busy||checking} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="icon-text-button" disabled={page*data.pageSize>=data.total||busy||checking} onClick={()=>setPage(p=>p+1)}>Далее</button></footer></>}
  </section>;
}
