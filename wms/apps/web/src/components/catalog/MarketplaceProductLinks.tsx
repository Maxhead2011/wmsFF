import { useEffect, useRef, useState } from 'react';
import { fetchProductLinks, confirmProductLink, type AuthSession, type MarketplaceConnectionSummary, type ProductLinkRow } from '../../lib/api';
// FIX: explicit, lazy-loaded review; stock publication remains a separate action.
export function MarketplaceProductLinks({session,connections,canWrite}:{session:AuthSession;connections:MarketplaceConnectionSummary[];canWrite:boolean}) {
 const [connection,setConnection]=useState(''),[rows,setRows]=useState<ProductLinkRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState<boolean|null>(null),[search,setSearch]=useState('');
 const [choices,setChoices]=useState<Record<string,string>>({}),[reasons,setReasons]=useState<Record<string,string>>({});
 const [reviewOnly,setReviewOnly]=useState(false),[revision,setRevision]=useState(0);const generation=useRef(0);
 useEffect(()=>{generation.current++;setConnection('');setRows([]);setEnabled(null);setChoices({});setReasons({});setError('');setBusy(false);},[connections]);
 useEffect(()=>{let active=true;setRows([]);setEnabled(null);setError('');if(!connection){setBusy(false);return;}setBusy(true);
  fetchProductLinks(session.accessToken,connection).then(r=>{if(active){setRows(r.items);setEnabled(r.enabled);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
 },[connection,session.accessToken,revision]);
 async function save(row:ProductLinkRow){const current=generation.current;setBusy(true);setError('');try{await confirmProductLink(session.accessToken,connection,row,choices[row.id],reasons[row.id]);const r=await fetchProductLinks(session.accessToken,connection);if(current===generation.current)setRows(r.items);}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Не удалось сохранить связь');}finally{if(current===generation.current)setBusy(false);}}
 const filtered=rows.filter(r=>(!reviewOnly||r.status==='REVIEW')&&`${r.productId} ${r.offerId} ${r.sku?.name??''} ${r.sku?.article??''}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')));
 return <details><summary>Сверка карточек WB и Ozon</summary>
  <p>Карточки связываются с общим складским товаром. Остатки и движения при подтверждении не меняются.</p>
  <label>Кабинет <select aria-label="Кабинет сверки" value={connection} disabled={busy} onChange={e=>setConnection(e.target.value)}><option value="">Выберите кабинет</option>{connections.map(c=><option key={c.id} value={c.id}>{c.marketplace} · {c.accountName||c.id}</option>)}</select></label>
  <button type="button" disabled={!connection||busy} onClick={()=>setRevision(r=>r+1)}>Обновить сверку</button>
  {error&&<p role="alert">{error}</p>}{busy&&<p>Загрузка…</p>}{enabled===false&&<p>Сверка пока не включена для этого клиента.</p>}
  {enabled&&<><p>Связано: {rows.filter(r=>r.status==='LINKED').length}. Требуют проверки: {rows.filter(r=>r.status==='REVIEW').length}.</p><input aria-label="Поиск привязки" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Артикул или идентификатор карточки"/>
  <label><input type="checkbox" checked={reviewOnly} onChange={e=>setReviewOnly(e.target.checked)}/>Только требующие проверки</label>
  {rows.length>0&&!filtered.length&&<p>По выбранным условиям карточки не найдены.</p>}
  {!rows.length&&<p>Связей пока нет. Выполните синхронизацию карточек нужного кабинета.</p>}
  {filtered.slice(0,100).map(r=><section key={r.id}><strong>{r.marketplace} · {r.offerId} · {r.productId}</strong>
    {r.sku?<p>{r.sku.name} · {r.sku.article} · {r.sku.size} · {r.sku.color}<br/>На складе (AVAILABLE): {r.available}; ещё зарезервировано: {r.reserved}. Количество для публикации проверяется в «Товары FBS» с учётом размещения.</p>:<p>{r.reason}</p>}
    {r.status==='REVIEW'&&canWrite&&<><select aria-label={`Товар для ${r.productId}`} value={choices[r.id]??''} disabled={busy} onChange={e=>setChoices({...choices,[r.id]:e.target.value})}><option value="">Выберите складской товар</option>{r.candidates.map(s=><option key={s.id} value={s.id}>{s.article} · {s.size} · {s.color} · {s.id}</option>)}</select><input aria-label={`Причина для ${r.productId}`} value={reasons[r.id]??''} onChange={e=>setReasons({...reasons,[r.id]:e.target.value})} placeholder="Основание решения"/><button disabled={busy||!choices[r.id]||(reasons[r.id]??'').trim().length<3} onClick={()=>void save(r)}>Подтвердить связь</button></>}
   </section>)}{filtered.length>100&&<p>Показаны первые 100 связей. Уточните поиск.</p>}</>}
 </details>;
}
