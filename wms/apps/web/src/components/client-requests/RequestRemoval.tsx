import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';

type Target={id:string;number:number;title:string;type?:string;status:string};
type Preview=Target&{revision:string;quantity:number;allowed:boolean;blockers:string[];ozonLinked:boolean;externalOrders:Array<{marketplace:string;orderId:string;supplyId:string|null}>};
const Context=createContext<((target:Target)=>void)|null>(null);
const base=import.meta.env.VITE_API_URL??'/api/v1';
async function api<T>(token:string,path:string,body?:unknown):Promise<T>{
 const r=await fetch(`${base}/client-request-removal/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw new Error(Array.isArray(data.message)?data.message.join('; '):data.message||'Не удалось выполнить действие.');return data;
}
// FIX: capability comes from the server; a stale preview is never submitted for another request/account.
export function RequestRemovalProvider({token,onRemoved,children}:{token:string;onRemoved:()=>void;children:ReactNode}){
 const [cap,setCap]=useState(''),[target,setTarget]=useState<Target|null>(null),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[number,setNumber]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
 const sequence=useRef(0),submitting=useRef(false);
 useEffect(()=>{let live=true;setCap('');setTarget(null);setPreview(null);sequence.current++;void api<{enabled:boolean}>(token,'capability').then(r=>{if(live&&r.enabled)setCap(token);}).catch(()=>{});return()=>{live=false;sequence.current++;};},[token]);
 async function open(t:Target){if(submitting.current)return;const seq=++sequence.current;setTarget(t);setPreview(null);setError('');setReason('');setNumber('');setConfirmed(false);setBusy(true);
  try{const p=await api<Preview>(token,`${encodeURIComponent(t.id)}/preview`);if(sequence.current===seq)setPreview(p);}catch(e){if(sequence.current===seq)setError(String(e instanceof Error?e.message:e));}finally{if(sequence.current===seq)setBusy(false);}
 }
 function close(){if(submitting.current)return;sequence.current++;setTarget(null);setPreview(null);setBusy(false);}
 async function remove(){if(!target||!preview||!ready||submitting.current)return;submitting.current=true;setBusy(true);setError('');const seq=sequence.current;
  try{await api(token,encodeURIComponent(target.id),{reason:reason.trim(),number:Number(number),revision:preview.revision,confirmed});if(sequence.current===seq){setTarget(null);setPreview(null);onRemoved();}}
  catch(e){if(sequence.current===seq){setError(e instanceof Error?e.message:String(e));setPreview(null);setConfirmed(false);}}
  finally{submitting.current=false;if(sequence.current===seq)setBusy(false);}
 }
 const ready=!!preview?.allowed&&reason.trim().length>=5&&reason.trim().length<=2000&&/^\d+$/.test(number)&&Number(number)===preview.number&&confirmed&&cap===token;
 return <Context.Provider value={cap===token?open:null}>{children}{target&&<div role="dialog" aria-modal="true" aria-label={`Удаление заявки №${target.number}`} style={{position:'fixed',inset:0,zIndex:20000,background:'#0009',display:'grid',placeItems:'center',padding:16}}><div style={{background:'var(--surface,#202127)',color:'var(--text-primary,#f5f5f7)',border:'1px solid #888',borderRadius:16,padding:24,width:'min(620px,100%)',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px #0006'}}>
  <h2>Удалить заявку №{target.number}</h2><p>{target.title}</p>
  <p>Заявка исчезнет из активных списков и ТСД. История сохранится в архиве со статусом «Отменена» и причиной удаления.</p>
  {busy&&!preview&&<p role="status">Проверяю заявку…</p>}
  {preview&&<><p>Состав: {preview.quantity} шт. Резервы этой заявки будут освобождены. Фактические остатки и КИЗы не списываются.</p>
   {(preview.ozonLinked||preview.externalOrders.length>0)&&<div role="note"><strong>Заказы и поставки на маркетплейсе не отменяются.</strong><p>Автоматическое восстановление этой сборки блокируется. Действующие заказы требуют отдельного решения.</p>{preview.externalOrders.length>0&&<p>{preview.externalOrders.map(o=>`${o.marketplace}: ${o.orderId}`).join(', ')}</p>}</div>}
   {preview.blockers.map(text=><p role="alert" key={text}>{text}</p>)}
  </>}
  {preview?.allowed&&<fieldset disabled={busy} style={{display:'grid',gap:12,border:0,padding:0}}><label>Причина удаления<textarea autoFocus value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} rows={3} style={{display:'block',width:'100%'}}/></label><label>Для подтверждения введите номер {preview.number}<input inputMode="numeric" value={number} onChange={e=>setNumber(e.target.value)} style={{display:'block',width:'100%'}}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю удаление заявки и освобождение её резервов</label></fieldset>}
  {error&&<p role="alert">{error}</p>}
  <div style={{display:'flex',gap:12,marginTop:20,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={close}>Закрыть</button>{!preview&&!busy&&<button type="button" onClick={()=>void open(target)}>Повторить проверку</button>}<button type="button" disabled={busy||!ready} onClick={()=>void remove()} style={{background:ready?'#b42332':undefined,color:ready?'white':undefined}}>Удалить заявку</button></div>
 </div></div>}</Context.Provider>;
}
export function RequestRemovalButton({request}:{request:Target}){
 const open=useContext(Context);if(!open||request.type&&request.type!=='OUTBOUND'||['DONE','CANCELLED','REJECTED'].includes(request.status))return null;
 return <button type="button" className="client-request-action-button client-request-action-button--cancel" onClick={()=>open(request)}>Удалить заявку</button>;
}
