import {useEffect,useState} from 'react';
import type {AuthSession} from '../../lib/api';
export type RequestCounts=Record<'requests'|'fbs'|'fbo',{total:number;inWork:number}>;
type State={scope:string;value?:RequestCounts;error?:boolean};
// FIX: one polling request for all sidebar entries, including favorite copies.
export function useSidebarRequestCounts(session:AuthSession|null,enabled:boolean) {
  const scope=JSON.stringify([session?.user.id,session?.user.activeWarehouseId,session?.user.clientIds,session?.accessToken]);
  const allowed=enabled&&!!session?.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read');
  const [state,setState]=useState<State|null>(null);
  useEffect(()=>{
    if(!allowed||!session)return;
    let active=true,pending=false;
    const abort=new AbortController();
    const refresh=async()=>{
      if(pending||document.visibilityState==='hidden')return;
      pending=true;
      try {
        const response=await fetch('/api/v1/client-requests/navigation-counts',{headers:{Authorization:`Bearer ${session.accessToken}`},cache:'no-store',signal:abort.signal});
        if(!response.ok)throw new Error('Count request failed');
        const value:RequestCounts=await response.json();
        if(!['requests','fbs','fbo'].every(k=>{const c=value[k as keyof RequestCounts];return c&&Number.isSafeInteger(c.total)&&Number.isSafeInteger(c.inWork)&&c.inWork>=0&&c.total>=c.inWork;}))throw new Error('Invalid counts');
        if(active)setState({scope,value});
      }catch{if(active)setState({scope,error:true});}finally{pending=false;}
    };
    void refresh();const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);window.addEventListener('client-requests-changed',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{active=false;abort.abort();window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('client-requests-changed',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[scope,allowed]);
  return allowed?(state?.scope===scope?state:{scope}):null;
}
// FIX: full exact numbers, no 99+ cap; unknown/error is never displayed as zero.
export function SidebarRequestBadge({id,state}:{id:string;state:State|null}) {
  const key=id==='fbo-ozon'?'fbo':id;
  if(!state||!['requests','fbs','fbo'].includes(key))return null;
  const count=state.value?.[key as keyof RequestCounts];
  const title=count?`Незавершённых заявок: ${count.total}. Из них в работе: ${count.inWork}.`:state.error?'Не удалось загрузить количество заявок':'Загружаю количество заявок';
  return <strong className="workspace-nav__badge" style={{whiteSpace:'nowrap',minWidth:'max-content'}} title={title} aria-label={title}>{count?`${count.total} (${count.inWork})`:state.error?'—':'…'}</strong>;
}
