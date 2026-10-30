import {useEffect,useRef,type ReactNode} from 'react';
import './fbo-workspace-modal.css';

// FIX: render beside the workspace CSS container, like the WB online window.
// Assembly content retains its own close controls and in-flight operation guards.
export function FboWorkspaceModal({children,title,onClose}:{children:ReactNode;title?:string;onClose?:()=>void}) {
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  panel.current?.focus({preventScroll:true});
  return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return <div className="online-execution-modal fbo-workspace-modal" role="dialog" aria-modal="true" aria-label={title??'Онлайн-выполнение сборки'}>
  <section ref={panel} tabIndex={-1} className="online-execution-modal__panel fbo-workspace-modal__panel">
   {title&&<header className="online-execution-modal__header"><h2>{title}</h2>{onClose&&<div className="online-execution-modal__actions"><button type="button" className="icon-button" aria-label="Закрыть" title="Закрыть" onClick={onClose}>×</button></div>}</header>}
   {children}
  </section>
 </div>;
}
