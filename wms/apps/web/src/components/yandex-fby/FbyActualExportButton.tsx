import { useEffect, useRef, useState } from 'react';
// FIX: downloading the actual composition is read-only and isolated from assembly/status mutations.
export function FbyActualExportButton({token,accountId,requestId,number,status}:{token:string;accountId:string;requestId:string;number:string|number;status:string}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const controller=useRef<AbortController|null>(null);
 useEffect(()=>{controller.current=null;setBusy(false);setError('');return()=>{controller.current?.abort()}},[token,accountId,requestId]);
 async function download(){
  if(controller.current)return;const current=new AbortController();controller.current=current;setBusy(true);setError('');
  try{
   const response=await fetch(`${import.meta.env?.VITE_API_URL??'/api/v1'}/yandex-fby/accounts/${encodeURIComponent(accountId)}/requests/${encodeURIComponent(requestId)}/export`,{headers:{Authorization:`Bearer ${token}`},signal:current.signal});
   if(!response.ok){let message='Не удалось скачать файл для Яндекса.';try{const data=await response.json();if(typeof data.message==='string')message=data.message;}catch{}throw new Error(message);}
   const blob=await response.blob();if(current.signal.aborted)return;
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Yandex-FBY-${String(number).replace(/[^0-9]/g,'')}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:'Не удалось скачать файл.');}
  finally{if(controller.current===current){controller.current=null;if(!current.signal.aborted)setBusy(false);}}
 }
 return <span><button type="button" className="icon-text-button" disabled={busy||!['PACKED','DONE'].includes(status)} onClick={()=>void download()} title="После завершения упаковки и проверки коробов">{busy?'Готовлю файл…':'Скачать для Яндекса'}</button>{error&&<span role="alert" className="error-message">{error}</span>}</span>;
}
