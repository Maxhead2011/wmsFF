import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {checkRequestMarketStatus,marketStatusTargets} from '../../lib/api';
import {requestStatusLabel} from './clientRequestMeta';

type Target={id:string;number:number};
type Outcome=Target&{kind:'done'|'pending'|'error';detail:string};
export async function checkMarketBatch(targets:Target[],check:(id:string)=>ReturnType<typeof checkRequestMarketStatus>, progress:(rows:Outcome[])=>void,active:()=>boolean) {
  const rows:Outcome[]=[];
  for(const target of targets){
    if(!active())break;
    try{
      const result=await check(target.id);
      rows.push({...target,kind:result.status==='DONE'?'done':'pending',detail:result.message+' · '+requestStatusLabel(result.status)});
    }catch(e){rows.push({...target,kind:'error',detail:e instanceof Error?e.message:'Ошибка проверки'});}
    if(active())progress([...rows]);
  }
  return rows;
}

// FIX: one action for all scoped open marketplace requests, independent of selection and table filters.
export function MarketStatusBatch({token,reload,disabled,onBusy}:{token:string;reload:()=>Promise<unknown>;disabled:boolean;onBusy:(v:boolean)=>void}) {
  const [running,setRunning]=useState(false),[total,setTotal]=useState(0),[rows,setRows]=useState<Outcome[]>([]);
  const [finished,setFinished]=useState(''),[error,setError]=useState('');
  const lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusy(false);};},[onBusy]);
  async function run(){
    if(lock.current||disabled)return;
    lock.current=true;onBusy(true);setRunning(true);setRows([]);setTotal(0);setFinished('');setError('');
    try{
      const targets=await marketStatusTargets(token);
      if(!mounted.current)return;
      setTotal(targets.length);
      await checkMarketBatch(targets,id=>checkRequestMarketStatus(token,id),setRows,()=>mounted.current);
      if(mounted.current){setFinished(new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow'}));await reload();}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Проверка не удалась.');}
    finally{lock.current=false;if(mounted.current){setRunning(false);onBusy(false);}}
  }
  const problems=rows.filter(r=>r.kind==='error');
  return <>
    <button type="button" className="secondary-button" style={{marginInlineStart:'auto'}} disabled={disabled||running}
      onClick={()=>void run()}><RefreshCw size={16} aria-hidden="true"/> {running?'Проверяю '+rows.length+' из '+total+'…':'Проверить статусы всех заявок'}</button>
    {error&&<p role="alert">{error}</p>}
    {finished&&<div style={{flexBasis:'100%'}}><p role="status">{total?'Проверено заявок: '+rows.length:'Открытых заявок для проверки нет'} · {finished} МСК</p>
      {total>0&&<><p>Перешли в «Сдано» — {rows.filter(r=>r.kind==='done').length} · Без изменения — {rows.filter(r=>r.kind==='pending').length} · Требуют внимания — {problems.length}</p>
        {problems.map(r=><p key={r.id}>№{r.number} · {r.detail}</p>)}
        <details><summary>Результаты по всем заявкам</summary>{rows.map(r=><p key={r.id}>№{r.number} · {r.detail}</p>)}</details></>}
    </div>}
  </>;
}
