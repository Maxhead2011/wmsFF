import { useEffect, useRef, useState } from 'react';
type Person={id:string;name:string;isActive:boolean;payrollPrimaryId?:string|null};
type Row={key:string;employeeId:string;amountKopecks:number;status:string};
type Advance={id:string;employeeId:string;issuedDate:string;amountKopecks:number;remainingKopecks:number;kind:string;reason:string;cancelledAt:string|null};
type Preview={grossKopecks:number;deductedKopecks:number;netKopecks:number;previewHash:string};
type Api=<T>(path:string,method?:'GET'|'POST'|'PUT',body?:unknown)=>Promise<T>;
const money=(n:number)=>(n/100).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
const root=(p:Person)=>p.payrollPrimaryId||p.id;
// FIX: each person carries their own unused balance; selected earning periods do not erase older advances.
export function payrollAdvanceSummary(people:Person[],rows:Row[],advances:Advance[],from:string,to:string){
  return people.filter(p=>!p.payrollPrimaryId).map(p=>{const ids=new Set(people.filter(e=>root(e)===p.id).map(e=>e.id));const own=advances.filter(a=>ids.has(a.employeeId)&&!a.cancelledAt);const gross=rows.filter(r=>ids.has(r.employeeId)&&r.status==='UNPAID').reduce((s,r)=>s+r.amountKopecks,0);const balance=own.reduce((s,a)=>s+a.remainingKopecks,0);const used=Math.min(gross,balance);return {id:p.id,name:p.name,gross,balance,used,net:gross-used,period:own.filter(a=>a.kind==='ADVANCE'&&a.issuedDate>=from&&a.issuedDate<=to).reduce((s,a)=>s+a.amountKopecks,0)};}).filter(p=>p.gross||p.balance||p.period);
}
export function PayrollAdvances({people,rows,selectedKeys,from,to,api,run,reload,busy}:{people:Person[];rows:Row[];selectedKeys:string[];from:string;to:string;api:Api;run:(action:()=>Promise<void|string>,success?:string)=>Promise<void>;reload:()=>Promise<void>;busy:boolean}){
  const[advances,setAdvances]=useState<Advance[]>([]);const[preview,setPreview]=useState<Preview|null>(null);const[error,setError]=useState('');const[ledgerError,setLedgerError]=useState('');const[loading,setLoading]=useState(true);const[previewSelection,setPreviewSelection]=useState('');const[revision,setRevision]=useState(0);
  const[person,setPerson]=useState('');const[date,setDate]=useState(new Date(Date.now()+10800000).toISOString().slice(0,10));const[amount,setAmount]=useState('');const[reason,setReason]=useState('');
  const advanceRetry=useRef<{key:string;id:string}|null>(null);const paymentRetry=useRef<{key:string;id:string}|null>(null);
  const selected=rows.filter(r=>r.status==='UNPAID'&&selectedKeys.includes(r.key));
  const entries=[...new Set(selected.map(r=>r.employeeId))].sort().map(employeeId=>({employeeId,keys:selected.filter(r=>r.employeeId===employeeId).map(r=>r.key).sort()}));
  const selection=JSON.stringify({entries,dateFrom:from,dateTo:to,status:'PAID',comment:'Выплата с учётом авансов',expectedAmountKopecks:selected.reduce((s,r)=>s+r.amountKopecks,0)});
  const peopleKey=people.map(p=>p.id).sort().join(',');
  useEffect(()=>{let live=true;setLoading(true);setLedgerError('');api<Advance[]>('/advances').then(a=>{if(live)setAdvances(a.filter(a=>people.some(p=>p.id===a.employeeId)));}).catch(e=>{if(live)setLedgerError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[revision,peopleKey]);
  useEffect(()=>{let live=true;setPreview(null);setError('');if(entries.length)api<Preview>('/payment-preview','POST',JSON.parse(selection)).then(p=>{if(live){setPreview(p);setPreviewSelection(selection);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[selection,revision]);
  const refresh=async()=>{setRevision(v=>v+1);await reload();};
  const summary=payrollAdvanceSummary(people,rows,advances,from,to);
  return <section aria-label="Авансы и сумма к выплате">
    <h3>Авансы и сумма к выплате</h3>
    <p>Из неоплаченного заработка вычитается неиспользованный остаток авансов и переплат, в том числе за прошлые периоды. Остаток сверх заработка переносится на следующую выплату.</p>
    {loading?<p role="status">Загружаю авансы…</p>:ledgerError?<p role="alert">{ledgerError}</p>:<table><thead><tr><th>Сотрудник</th><th>Заработано, не оплачено</th><th>Выдано авансов за период</th><th>Остаток к зачёту</th><th>Зачесть сейчас</th><th>К выплате</th></tr></thead><tbody>{summary.map(s=><tr key={s.id}><td>{s.name}</td><td>{money(s.gross)}</td><td>{money(s.period)}</td><td>{money(s.balance)}</td><td>{money(s.used)}</td><td><strong>{money(s.net)}</strong></td></tr>)}</tbody></table>}
    {error&&<p role="alert">{error}</p>}
    {preview&&previewSelection===selection&&<p>Выбрано заработка: <strong>{money(preview.grossKopecks)}</strong> · Зачёт: <strong>{money(preview.deductedKopecks)}</strong> · Выдать: <strong>{money(preview.netKopecks)}</strong></p>}
    <button type="button" disabled={busy||loading||!!ledgerError||!preview||previewSelection!==selection||!selected.length} onClick={()=>void run(async()=>{
      if(!preview||previewSelection!==selection)throw new Error('Дождитесь расчёта.');const key=selection+preview.previewHash;if(paymentRetry.current?.key!==key)paymentRetry.current={key,id:crypto.randomUUID()};
      const result=await api<{netKopecks:number;deductedKopecks:number}>('/statuses/batch','POST',{...JSON.parse(selection),previewHash:preview.previewHash,operationId:paymentRetry.current.id});paymentRetry.current=null;setPreview(null);await refresh();return `Отмечено к выдаче: ${money(result.netKopecks)}; зачтено: ${money(result.deductedKopecks)}`;
    })}>Отметить выплату выбранных с учётом авансов</button>
    <details><summary>Внести аванс / посмотреть историю</summary>
      <form onSubmit={event=>{event.preventDefault();void run(async()=>{
        if(!/^\d+(?:[.,]\d{1,2})?$/.test(amount.trim()))throw new Error('Укажите сумму с точностью до копеек.');
        const body={issuedDate:date,amountKopecks:Math.round(Number(amount.replace(',','.'))*100),reason};const key=JSON.stringify({person,...body});if(advanceRetry.current?.key!==key)advanceRetry.current={key,id:crypto.randomUUID()};
        await api(`/employees/${encodeURIComponent(person)}/advances`,'POST',{...body,operationId:advanceRetry.current.id});advanceRetry.current=null;setAmount('');setReason('');await refresh();return 'Аванс сохранён';
      });}}><div className="payroll-fields"><label>Сотрудник для аванса<select required value={person} onChange={e=>setPerson(e.target.value)}><option value="">Выберите сотрудника</option>{people.filter(p=>p.isActive&&!p.payrollPrimaryId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Дата выдачи<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Сумма аванса, ₽<input inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Основание / комментарий<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label></div><button disabled={busy}>Сохранить аванс</button></form>
      <table aria-label="История авансов"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Вид</th><th>Сумма</th><th>Остаток</th><th>Основание</th><th>Действия</th></tr></thead><tbody>{advances.map(a=><tr key={a.id}><td>{a.issuedDate.split('-').reverse().join('.')}</td><td>{people.find(p=>p.id===a.employeeId)?.name}</td><td>{a.kind==='OVERPAYMENT'?'Переплата к зачёту':'Аванс'}{a.cancelledAt?' · отменён':''}</td><td>{money(a.amountKopecks)}</td><td>{a.cancelledAt?'—':money(a.remainingKopecks)}</td><td>{a.reason}</td><td>{!a.cancelledAt&&a.kind==='ADVANCE'&&a.remainingKopecks===a.amountKopecks&&<button type="button" disabled={busy} onClick={()=>{const reason=window.prompt('Причина отмены аванса');if(reason?.trim())void run(async()=>{await api(`/advances/${a.id}/cancel`,'POST',{reason});await refresh();},'Аванс отменён');}}>Отменить ошибочный аванс</button>}</td></tr>)}</tbody></table>
    </details>
  </section>;
}
