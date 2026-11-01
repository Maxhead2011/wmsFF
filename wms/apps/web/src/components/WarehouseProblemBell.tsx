import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Archive,BellRing,CheckCheck,X} from 'lucide-react';
import {fetchWarehouseProblems,markWarehouseProblemRead,markWarehouseProblemsRead,type WarehouseProblem} from '../lib/api';
import './warehouse-problem-bell.css';

const signalTime = new Intl.DateTimeFormat('ru-RU',{
  timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',
});

export function WarehouseProblemBell({token,scope,onOpen}:{token:string;scope:string;onOpen:(row:WarehouseProblem)=>void}){
  const [rows,setRows]=useState<WarehouseProblem[]>([]);
  const [open,setOpen]=useState(false);
  const [toast,setToast]=useState<WarehouseProblem|null>(null);
  const [error,setError]=useState('');
  const [readingAll,setReadingAll]=useState(false);
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [archiveRows,setArchiveRows]=useState<WarehouseProblem[]>([]);
  const [more,setMore]=useState(false);
  const [archiveBusy,setArchiveBusy]=useState(false);
  const archiveRevision=useRef(0);
  async function loadArchive(append=false){
    const revision=++archiveRevision.current;
    setArchiveBusy(true);
    try {
      const page=await fetchWarehouseProblems(token,true,append?archiveRows[archiveRows.length-1]?.id:'');
      if(revision!==archiveRevision.current)return;
      setArchiveRows(previous=>append?[...new Map([...previous,...page].map(row=>[row.id,row])).values()]:page);
      setMore(page.length===40);
    }catch{if(revision===archiveRevision.current)setError('Не удалось загрузить архив.');}
    finally{if(revision===archiveRevision.current)setArchiveBusy(false);}
  }
  const acknowledged=useRef(new Set<string>());
  useEffect(()=>{
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    const key='wms.problem-toasts.v2.'+scope;
    let shown=new Set<string>();
    try{shown=new Set(JSON.parse(sessionStorage.getItem(key)||'[]'));}catch{}
    async function refresh(){
      try{
        const result=await fetchWarehouseProblems(token);
        if(!alive)return;
        const current=result.map(row=>acknowledged.current.has(row.id)?{...row,isRead:true}:row);
        setRows(current);
        const newest=current.find(row=>!row.isRead&&!shown.has(row.id));
        if(newest)setToast(newest);
        else setToast(previous=>current.find(row=>row.id===previous?.id&&!row.isRead)??null);
        shown=new Set(current.map(row=>row.id));
        try{sessionStorage.setItem(key,JSON.stringify([...shown]));}catch{}
      }catch{if(alive)setError('Не удалось обновить список проблем.');}
      finally{if(alive)timer=setTimeout(refresh,15000);}
    }
    void refresh();return ()=>{alive=false;clearTimeout(timer);};
  },[scope,token]);
  async function mark(row:WarehouseProblem){
    try{await markWarehouseProblemRead(token,row.id);acknowledged.current.add(row.id);
      setRows(list=>list.map(x=>x.id===row.id?{...x,isRead:true}:x));setToast(x=>x?.id===row.id?null:x);setError('');if(archiveOpen)void loadArchive();
    }catch{setError('Не удалось сохранить отметку о прочтении.');}
  }
  async function readAll(){
    const ids=rows.filter(row=>!row.isRead).map(row=>row.id);
    if(readingAll||!ids.length)return;
    setReadingAll(true);
    try {
      const {readIds}=await markWarehouseProblemsRead(token,ids);
      const confirmed=new Set(readIds);
      for(const id of confirmed)acknowledged.current.add(id);
      setRows(list=>list.map(row=>confirmed.has(row.id)?{...row,isRead:true}:row));
      setToast(current=>current&&confirmed.has(current.id)?null:current);
      setError('');
      if(archiveOpen)await loadArchive();
    } catch {setError('Не удалось отметить проблемы прочитанными. Повторите попытку.');}
    finally {setReadingAll(false);}
  }
  function card(row:WarehouseProblem){return <article key={row.id}><strong>{row.title}</strong><div><time dateTime={row.createdAt}>{signalTime.format(new Date(row.createdAt))} МСК</time></div><div>Сборщик: {row.worker}</div><div>Клиент: {row.client}</div><div>{row.detail}</div>
    <div className="warehouse-signal-actions"><button type="button" disabled={row.kind==='box'&&!row.boxCode} onClick={()=>{setOpen(false);setToast(null);onOpen(row);}}>{row.kind==='box'?'Открыть товародвижение':'Открыть актуализацию'}</button>
    {row.status==='COMPLETED'?<small>Разобрано</small>:row.status==='CANCELLED'?<small>Проверка отменена</small>:row.isRead?<small>Прочитано · проверка открыта</small>:<button type="button" onClick={()=>void mark(row)}>Пометить прочитанной</button>}</div></article>;}
  const unread=rows.filter(row=>!row.isRead).length;
  return <div className="warehouse-problem-bell"><button type="button" aria-label={'Проблемы с товаром: '+unread} aria-expanded={open} onClick={()=>{setToast(null);setOpen(!open);}}><BellRing size={19}/>{unread>0&&<b>{unread}</b>}</button>
    {open&&<section role="dialog" aria-label="Проблемы с товаром"><header><strong>Проблемы с товаром</strong><button aria-label="Закрыть" onClick={()=>setOpen(false)}><X size={18}/></button></header>
    {error&&<p role="alert">{error}</p>}{unread===0&&!error&&<p>Непрочитанных проблем нет</p>}{rows.filter(row=>!row.isRead).map(card)}
      {/* FIX: keep the archive and acknowledgement controls together, before the archive list. */}
      <div className="warehouse-problem-controls">
        <button type="button" aria-expanded={archiveOpen} onClick={()=>{setArchiveOpen(!archiveOpen);if(!archiveOpen)void loadArchive();}}>
          <Archive size={16} aria-hidden="true"/>{archiveOpen?'Свернуть архив':'Архив проблем'}
        </button>
        <button type="button" className="warehouse-problem-controls__read" disabled={readingAll||unread===0} onClick={()=>void readAll()}>
          <CheckCheck size={16} aria-hidden="true"/>{readingAll?'Отмечаю…':'Прочитать все'}
        </button>
      </div>
      {archiveOpen&&<div>{archiveRows.map(card)}{archiveBusy&&<p>Загрузка архива…</p>}{!archiveBusy&&!archiveRows.length&&!error&&<p>Архив пуст</p>}
      {more&&<button type="button" disabled={archiveBusy} onClick={()=>void loadArchive(true)}>Показать ещё</button>}</div>}

    </section>}
    {toast&&createPortal(<aside className="warehouse-new-signal" role="alert" aria-label="Новая проблема с товаром"><header><strong>Проблема с товаром</strong><button aria-label="Скрыть уведомление" onClick={()=>setToast(null)}><X size={18}/></button></header>{card(toast)}{error&&<p>{error}</p>}</aside>,document.body)}
  </div>;
}
