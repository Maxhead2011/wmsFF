import { FormEvent, useRef, useState } from 'react';
import { actFbo, fetchFboPlan, downloadFboWbFile, downloadFboShippingFiles, downloadClientRequestWbProductsXlsx, downloadClientRequestWbPackagesXlsx, type FboPlan, type FboAction } from '../../lib/api';

// FIX: pallet scan narrows the list before the source box can be selected.
export function selectFboLocation(route:FboPlan['route'], pallet:string, scan:string) {
  const same=(a:string,b:string)=>a.trim().toUpperCase()===b.trim().toUpperCase();
  if(!pallet){const match=route.find(r=>r.pallet&&same(r.pallet,scan));if(match)return {pallet:match.pallet,source:''};}
  const box=route.find(r=>same(r.boxCode,scan)&&r.pallet===pallet);
  return box?{pallet,source:box.boxCode}:null;
}

export function FboTwoStagePanel({ initial, accessToken, userId, canWrite, onClose }: {initial:FboPlan;accessToken:string;userId:string;canWrite:boolean;onClose:()=>void}) {
  const [plan,setPlan]=useState(initial),[code,setCode]=useState(''),[source,setSource]=useState(''),[target,setTarget]=useState(''),[barcode,setBarcode]=useState('');
  const [pallet,setPallet]=useState('');
  const [downloading,setDownloading]=useState(false);
  const downloadInFlight=useRef(false);
  const storageKey=`fbo-pending:${userId}:${initial.requestId}`;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<FboAction|null>(()=>{
    try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch{return null;}
  });
  const inFlight=useRef(false),field=useRef<HTMLInputElement>(null);
  const sourceTask=plan.route.find(b=>b.boxCode===source);
  const title=plan.phase==='CONTROL'?'Проверка всех коробов поставки':plan.phase==='PACKING'?'2. Упаковка поставки':'1. Отбор товара';
  async function command(action:string,extra:Partial<FboAction>={}) {
    if(inFlight.current || !canWrite) return;
    const dto=pending??{action,operationId:crypto.randomUUID(),palletCode:pallet,...extra};inFlight.current=true;setBusy(true);setError('');setPending(dto);
    try {localStorage.setItem(storageKey,JSON.stringify(dto));const next=await actFbo(accessToken,plan.requestId,dto);setPlan(next);localStorage.removeItem(storageKey);setPending(null);setBarcode('');setCode('');
      if(!next.route.some(r=>r.boxCode===source))setSource('');
      if(!next.route.some(r=>r.pallet===pallet))setPallet('');
      if(!next.boxes.some(b=>b.code===target&&!b.closed) || next.phase!=='PACKING')setTarget('');
      if(dto.action==='OPEN_BOX')setTarget(dto.targetBoxCode??'');
      if(dto.action==='FINISH')void download();
    }catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить операцию.');if((e as {rejected?:boolean}).rejected){localStorage.removeItem(storageKey);setPending(null);}}
    finally{inFlight.current=false;setBusy(false);setTimeout(()=>field.current?.focus(),0);}
  }
  async function scan(event:FormEvent){event.preventDefault();const value=code.trim();if(!value||busy||pending)return;setCode('');
    if(plan.phase==='CONTROL'){await command('CONFIRM_BOX',{targetBoxCode:value});return;}
    if(plan.phase==='PICKING'&&!source){const selected=selectFboLocation(plan.route,pallet,value);if(!selected){setError(pallet?'Короб не входит в список на этом паллете.':'Сначала отсканируйте паллет. Короб без паллета можно сканировать сразу.');return;}setPallet(selected.pallet);setSource(selected.source);setError('');return;}
    if(plan.phase==='PACKING'&&!target){if(plan.wholeBoxes.includes(value)){await command('PACK_BOX',{sourceBoxCode:value});return;}await command('OPEN_BOX',{targetBoxCode:value});return;}
    if(barcode){await command(plan.phase==='PICKING'?'PICK_UNIT':'PACK_UNIT',{sourceBoxCode:source,targetBoxCode:target,barcode,kiz:value});return;}
    const line=plan.lines.find(l=>l.barcode===value&&(plan.phase==='PICKING'?l.remaining>0:l.picked>l.packed));
    if(!line){setError('Этот ШК не требуется на текущем этапе.');return;}
    if(line.requiresKiz){setBarcode(value);setError('');}
    else await command(plan.phase==='PICKING'?'PICK_UNIT':'PACK_UNIT',{sourceBoxCode:source,targetBoxCode:target,barcode:value});
  }
  async function refresh(){if(inFlight.current||pending)return;inFlight.current=true;setBusy(true);try{const next=await fetchFboPlan(accessToken,plan.requestId);setPlan(next);if(!next.route.some(r=>r.boxCode===source&&r.pallet===pallet)){setSource('');setBarcode('');}if(!next.route.some(r=>r.pallet===pallet))setPallet('');if(!next.boxes.some(b=>b.code===target&&!b.closed))setTarget('');setError('');}catch(e){setError(String(e));}finally{inFlight.current=false;setBusy(false);}}
  // FIX: document retries are read-only; final packing is already committed before a download starts.
  async function download(kind?:'products'|'packages'){
    if(downloadInFlight.current)return;downloadInFlight.current=true;setDownloading(true);setError('');
    try{
      const files=kind?[{name:`wb-${kind}-${plan.requestId}.xlsx`,blob:await (kind==='products'?downloadClientRequestWbProductsXlsx:downloadClientRequestWbPackagesXlsx)(accessToken,plan.requestId)}]
        :plan.closePickSupported?await downloadFboShippingFiles(accessToken,plan.requestId):[{name:'wb-packages.xlsx',blob:await downloadFboWbFile(accessToken,plan.requestId)}];
      for(const file of files){const a=document.createElement('a'),url=URL.createObjectURL(file.blob);a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    }catch(e){setError(`Не удалось скачать документы. Упаковка сохранена; повторите скачивание. ${e instanceof Error?e.message:String(e)}`);}
    finally{downloadInFlight.current=false;setDownloading(false);}
  }
  function finishPicking(){
    if(window.confirm(`Завершить отбор? Сейчас отобрано ${plan.picked} из ${plan.needed} ед. Дальнейший отбор будет закрыт, упаковка продолжится по фактически отобранным товарам.`))void command('STOP_PICK');
  }
  const hint=plan.phase==='CONTROL'?'ШК короба поставки':plan.phase==='PICKING'&&!source?(pallet?'ШК короба на выбранном паллете':'ШК паллета или короба без паллета'):plan.phase==='PACKING'&&!target?'ШК короба для упаковки или целого отобранного короба':barcode?'КИЗ товара':'ШК товара';
  return <div className="online-execution-modal" role="dialog" aria-modal="true" aria-label="Двухэтапная сборка ФБО"><section className="online-execution-modal__panel" style={{display:'block',maxWidth:1000,width:'95vw',maxHeight:'92vh',overflow:'auto',padding:24}}>
    {/* FIX: keep closing the view accessible even while the assembly plan is scrolled. */}
    <header style={{position:'sticky',top:0,zIndex:2,display:'flex',flexDirection:'row-reverse',alignItems:'center',justifyContent:'space-between',gap:16,background:'var(--surface, #fff)',padding:'8px 0'}}>
      <button type="button" className="icon-text-button" aria-label="Закрыть просмотр ФБО" title="Закрыть просмотр ФБО" disabled={busy||!!pending} onClick={onClose} style={{flexShrink:0,width:44,height:44,display:'grid',placeItems:'center'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <h2 style={{margin:0,overflowWrap:'anywhere'}}>ФБО · {plan.title}</h2>
    </header>
    <p>Нужно {plan.plannedNeeded??plan.needed} · Отобрано {plan.picked} · Упаковано {plan.packed}</p>
    {plan.pickClosed&&<p>Отбор завершён · К упаковке {plan.packingNeeded??plan.needed} ед. · Не отобрано {plan.unpicked??0} ед.</p>}
    {plan.compositionChanged&&<p role="alert">Состав заявки изменился. Требуется сверка.</p>}
    {plan.shortage>0&&<p role="alert">Недостаточно доступного остатка: {plan.shortage} ед.</p>}
    <h3>{plan.phase==='COMPLETED'?'Поставка проверена':title}</h3>
    {error&&<p role="alert">{error}</p>}
    {pending&&!busy&&<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} onClick={()=>void command(pending.action)}>Повторить неподтверждённый запрос</button>}
    {plan.phase==='NOT_STARTED'&&<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!canWrite} onClick={()=>void command('START')}>Начать отбор</button>}
    {['PICKING','PACKING','CONTROL'].includes(plan.phase)&&<form onSubmit={scan} style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap',margin:'20px 0'}}><label style={{display:'grid',gap:8,flex:'1 1 240px'}}>{hint}<input ref={field} autoFocus value={code} onChange={e=>setCode(e.target.value)} disabled={busy||!!pending||!canWrite} style={{minHeight:44,padding:10,border:'1px solid var(--line)',borderRadius:6}}/></label><button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!canWrite}>Подтвердить скан</button></form>}
    {sourceTask&&plan.phase==='PICKING'&&<div><p>{sourceTask.boxCode} · {sourceTask.pallet} · {sourceTask.zone}</p>{sourceTask.tasks.map(t=><p key={t.skuId}>Отберите {t.quantity} ед. · {t.name} · {t.barcode}</p>)}
      {sourceTask.recount&&<p role="alert">Количество и КИЗ расходятся. Требуется актуализация короба.</p>}
      {sourceTask.wholeBox&&<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!canWrite} onClick={()=>void command('PICK_BOX',{sourceBoxCode:source})}>Короб забран целиком</button>}
      <button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending} onClick={()=>{setSource('');setBarcode('');}}>Другой исходный короб</button></div>}
    {plan.phase==='PICKING'&&<><p>Осталось отобрать: {plan.needed-plan.picked}</p>{plan.closePickSupported
      ?<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!plan.picked||plan.compositionChanged||!canWrite} onClick={finishPicking}>Завершить отбор</button>
      :<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||plan.picked!==plan.needed||!canWrite} onClick={()=>void command('FINISH_PICK')}>Перейти к упаковке</button>}
      {!!pallet&&<p>Паллет {pallet} <button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending} onClick={()=>{setPallet('');setSource('');setBarcode('');}}>Другой паллет</button></p>}
      {!pallet&&<ul>{[...new Set(plan.route.map(r=>r.pallet).filter(Boolean))].map(p=><li key={p}>{p} · Нужных коробов: {plan.route.filter(r=>r.pallet===p).length}</li>)}</ul>}
      <div className="online-execution-table-wrap"><table className="online-execution-table"><thead><tr><th>Паллет / зона</th><th>Нужный короб</th><th>Отобрать</th></tr></thead><tbody>{plan.route.filter(r=>r.pallet===pallet).map(r=><tr key={r.boxCode}><td>{r.pallet||'Без паллета'} · {r.zone}</td><td>{r.boxCode}</td><td>{r.tasks.map(t=>`${t.name}: ${t.quantity}`).join('; ')}</td></tr>)}</tbody></table></div></>}
    {plan.phase==='PACKING'&&<><p>{target?`Открыт короб ${target}`:'Отсканируйте короб для упаковки'} · Осталось вложить {plan.needed-plan.packed}</p>
      {!!target&&<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!canWrite} onClick={()=>void command('CLOSE_BOX',{targetBoxCode:target})}>Закрыть короб</button>}
      {!!target&&plan.boxes.some(b=>b.code===target&&!b.quantity&&!b.closed)&&<button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!canWrite} onClick={()=>void command('CANCEL_EMPTY_BOX',{targetBoxCode:target})}>Отложить пустой короб</button>}
      {plan.wholeBoxes.length>0&&<p>Целые короба к добавлению: {plan.wholeBoxes.join(', ')}</p>}
      <button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||plan.packed!==plan.needed||plan.boxes.some(b=>!b.closed)||!canWrite} onClick={()=>void command('SORTED')}>Короба разобраны</button></>}
    {['PACKING','CONTROL','COMPLETED'].includes(plan.phase)&&<ul>{plan.boxes.map(b=><li key={b.code}>{b.code} · {b.quantity} ед. · {b.confirmed?'Подтверждён':b.closed?'Закрыт':'Открыт'}</li>)}</ul>}
    {plan.phase==='CONTROL'&&<><p>Подтверждено коробов {plan.boxes.filter(b=>b.confirmed).length} из {plan.boxes.length}</p><button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending||!plan.boxes.length||plan.boxes.some(b=>!b.confirmed)||plan.packed!==plan.needed||plan.compositionChanged||!canWrite} onClick={()=>void command('FINISH')}>{plan.closePickSupported?'Упаковка завершена':'Завершить проверку и сформировать файл WB'}</button></>}
    {plan.phase==='COMPLETED'&&<><button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={downloading} onClick={()=>void download()}>{plan.closePickSupported?'Скачать файлы отгрузки':'Скачать файл WB'}</button>
      {plan.closePickSupported&&<p>Скачать отдельно: <button disabled={downloading} onClick={()=>void download('products')}>Файл товаров WB</button> <button disabled={downloading} onClick={()=>void download('packages')}>Файл коробов WB</button></p>}</>}
    <p><button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending} onClick={()=>void refresh()}>Обновить</button> <button className="icon-text-button" style={{minHeight:42,margin:4,padding:"8px 14px"}} disabled={busy||!!pending} onClick={onClose}>Закрыть</button></p>
  </section></div>;
}
