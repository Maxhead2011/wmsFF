import { useState } from 'react';
import type { FboPlan } from '../../lib/api';
import './fbo.css';

const time = (value?:string|null) => value ? new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}) : '—';
// FIX: FBO uses durable picked/packed units, never inferred stock reductions, for online statistics.
export function FboProgress({plan,paused=false}:{plan:FboPlan;paused?:boolean}) {
  const [search,setSearch]=useState(''),[tab,setTab]=useState('all');
  const q=search.trim().toLocaleLowerCase('ru-RU');
  const lines=plan.lines.filter(l=>(`${l.name} ${l.article??''} ${l.size??''} ${l.barcode}`).toLocaleLowerCase('ru-RU').includes(q))
    .filter(l=>tab==='remaining'?l.remaining>0:tab==='picked'?l.picked>0:tab==='packed'?l.packed>0:true);
  const percentage=(value:number)=>plan.needed?Math.min(100,Math.round(value/plan.needed*100)):0;
  return <section className="fbo-progress" aria-label="Онлайн-выполнение FBO">
    <p className="inline-status">Онлайн-выполнение · {paused?'Автообновление приостановлено на время сканирования или повтора операции':'Обновление каждые 5 секунд'}{plan.observedAt?` · ${time(plan.observedAt)} МСК`:''}</p>
    <div className="online-execution-metrics">
      <article><span>Нужно</span><strong>{plan.needed}</strong></article>
      <article className="is-done"><span>Отобрано</span><strong>{plan.picked}</strong></article>
      <article className="is-done"><span>Упаковано</span><strong>{plan.packed}</strong></article>
      <article className="is-warning"><span>Осталось отобрать</span><strong>{Math.max(0,plan.needed-plan.picked)}</strong></article>
    </div>
    <div className="fbo-progress-bars">{[['Отбор',plan.picked],['Упаковка',plan.packed]].map(([label,count])=><section className="online-execution-progress" key={label}><div><strong>{percentage(Number(count))}%</strong><span>{label}: {count} из {plan.needed}</span></div><meter aria-label={String(label)} min={0} max={100} value={percentage(Number(count))}/></section>)}</div>
    <div className="fbo-progress-filters"><label>Поиск товара, артикула или ШК<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Название, размер, штрихкод"/></label><div role="group" aria-label="Фильтр выполнения">{[['all','Все позиции'],['remaining','Не отобрано'],['picked','Отобрано'],['packed','Упаковано']].map(([value,label])=><button className="icon-text-button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}</button>)}</div></div>
    <div className="online-execution-table-wrap"><table className="online-execution-table"><thead><tr><th>Товар</th><th>ШК</th><th>Нужно</th><th>Отобрано</th><th>Упаковано</th><th>Осталось</th><th>Где отбирать</th></tr></thead><tbody>
      {lines.map(l=><tr key={l.id}><td><strong>{l.name}</strong><br/>{l.article} · {l.size}</td><td>{l.barcode}</td><td>{l.needed}</td><td>{l.picked}</td><td>{l.packed}</td><td>{l.remaining}</td><td>{l.remaining>0 ? plan.route.filter(r=>r.tasks.some(t=>t.skuId===l.skuId)).map(r=><div key={r.boxCode}>{r.boxCode} · {r.pallet||'Без паллета'} · {r.tasks.filter(t=>t.skuId===l.skuId).reduce((s,t)=>s+t.quantity,0)} шт.</div>) : 'Отбор завершён'}{l.remaining>0&&!plan.route.some(r=>r.tasks.some(t=>t.skuId===l.skuId))?'Доступный короб не найден':null}</td></tr>)}
      {!lines.length&&<tr><td colSpan={7}>Нет позиций по выбранному фильтру.</td></tr>}
    </tbody></table></div>
    <details className="fbo-progress-history"><summary>История отбора · {(plan.pickedUnits??[]).length} единиц</summary><div className="online-execution-table-wrap"><table className="online-execution-table"><thead><tr><th>Товар / ШК</th><th>КИЗ</th><th>Исходный короб</th><th>Отобрал / время МСК</th><th>Упаковка / время МСК</th></tr></thead><tbody>{(plan.pickedUnits??[]).map(u=><tr key={u.id}><td>{plan.lines.find(l=>l.id===u.requestItemId)?.name}<br/>{u.barcode}</td><td className="fbo-kiz">{u.kiz||'Без КИЗ'}</td><td>{u.sourceBoxCode}{u.wholeBox?' · целиком':''}</td><td>{u.pickedBy||'—'}<br/>{time(u.pickedAt)}</td><td>{u.targetBoxCode||'Не упаковано'}<br/>{u.packedBy} {time(u.packedAt)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
