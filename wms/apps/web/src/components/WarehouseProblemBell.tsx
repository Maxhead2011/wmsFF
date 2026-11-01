import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { fetchWarehouseProblems, type WarehouseProblem } from '../lib/api';
import './warehouse-problem-bell.css';

export function WarehouseProblemBell({token,scope}:{token:string;scope:string}) {
  const [rows,setRows]=useState<WarehouseProblem[]>([]);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    let shown=new Set<string>();
    const key='wms.problem-alerts.'+scope;
    try { shown=new Set(JSON.parse(sessionStorage.getItem(key) || '[]')); } catch { /* storage is optional */ }
    async function refresh(){
      try {
        const result=await fetchWarehouseProblems(token);
        if(!alive)return;
        setRows(result);setError(false);
        if(result.some(row=>!shown.has(row.id)))setOpen(true);
        shown=new Set(result.map(row=>row.id));
        try {sessionStorage.setItem(key,JSON.stringify([...shown]));} catch { /* still deduplicated in memory */ }
      } catch { if(alive)setError(true); }
      finally {if(alive)timer=setTimeout(refresh,15000);}
    }
    void refresh();return ()=>{alive=false;clearTimeout(timer);};
  },[token,scope]);
  return <div className="warehouse-problem-bell">
    <button type="button" aria-label={'Проблемы с товаром: '+rows.length} aria-expanded={open} onClick={()=>setOpen(!open)}>
      <BellRing size={19}/>{rows.length>0 && <b>{rows.length}</b>}
    </button>
    {open && <section role="dialog" aria-label="Проблемы с товаром">
      <header><strong>Проблемы с товаром</strong><button type="button" aria-label="Закрыть" onClick={()=>setOpen(false)}><X size={18}/></button></header>
      {error && <p>Не удалось обновить список</p>}
      {!error && !rows.length && <p>Открытых проблем нет</p>}
      {rows.map(row=><article key={row.id}><strong>{row.title}</strong><div>Сборщик: {row.worker}</div><div>Клиент: {row.client}</div><div>{row.detail}</div></article>)}
    </section>}
  </div>;
}
