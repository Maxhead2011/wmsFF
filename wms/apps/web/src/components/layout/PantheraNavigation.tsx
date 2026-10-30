import { usePantheraFavorites } from './usePantheraFavorites';
import { useState } from 'react';
import { Settings, type LucideIcon } from 'lucide-react';
import { SidebarGroup } from './SidebarGroup';
import {SidebarRequestBadge,type useSidebarRequestCounts} from './SidebarRequestCounts';

type Item = {id: string; title: string; icon: LucideIcon};
type Group = {id:string; title:string; items:Item[]};
type Props = {groups:Group[]; userId:string; accessToken:string; activeId:string; onOpen:(id:string)=>void; kizUnread:number;counts?:ReturnType<typeof useSidebarRequestCounts>};

// FIX: quick links are copies of authorized items; original groups are never reordered.
export function PantheraNavigation({groups,userId,accessToken,activeId,onOpen,kizUnread,counts=null}:Props) {
  const {ids,busy,ready,message,save,reload}=usePantheraFavorites(userId,accessToken);
  const [picker,setPicker]=useState(false),[editing,setEditing]=useState(false);
  const [quickTarget,setQuickTarget]=useState<string|null>(null),[dragged,setDragged]=useState<string|null>(null);
  const available=groups.flatMap(group=>group.items).filter(item=>item.id!=='overview');
  const favorites=ids.flatMap(id=>available.find(item=>item.id===id)??[]);
  // FIX: reorder only personal shortcuts, never the original navigation groups.
  function move(id:string,target:string){if(busy||!ready||id===target)return;const next=ids.filter(value=>value!==id);next.splice(ids.indexOf(target),0,id);save(next);}
  function itemButton(item:Item,quick=false){const Icon=item.icon;return <button key={item.id} type="button" className={item.id===activeId?'active':''} onClick={()=>{if(quick&&editing)return;setQuickTarget(quick?item.id:null);onOpen(item.id);}}>
    <Icon size={18} aria-hidden={true}/><span>{item.title}</span>
    <SidebarRequestBadge id={item.id} state={counts}/>
    {item.id==='kiz'&&kizUnread>0?<strong className="workspace-nav__badge" aria-label={`Непрочитанных проблем КИЗ: ${kizUnread}`}>{kizUnread>99?'99+':kizUnread}</strong>:null}
  </button>;}
  const quickLinks=<section className="workspace-favorites" aria-label="Часто используемые" onContextMenu={event=>{event.preventDefault();if(ready&&!busy)setEditing(true);}}>
    <div className="workspace-favorites__heading"><strong>Часто используемые</strong><button disabled={busy||!ready} type="button" aria-label={editing?'Завершить редактирование быстрых ссылок':'Редактировать быстрые ссылки'} aria-pressed={editing} onClick={()=>setEditing(!editing)}><Settings size={16} aria-hidden="true"/></button><button disabled={busy||!ready} type="button" aria-label="Добавить быструю ссылку" aria-expanded={picker} onClick={()=>setPicker(!picker)}>+</button></div>
    {message?<div role="status">{message}<button type="button" disabled={busy} onClick={reload}>Повторить</button></div>:null}
    {favorites.map((item,index)=><div className="workspace-favorites__item" key={item.id} onDragOver={event=>{if(editing&&dragged){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={event=>{event.preventDefault();if(editing&&dragged)move(dragged,item.id);setDragged(null);}}>{editing?<span className="workspace-favorites__drag" draggable aria-label={`Перетащить: ${item.title}`} title="Перетащите для изменения порядка" onDragStart={event=>{setDragged(item.id);event.dataTransfer.setData('text/plain',item.id);event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDragged(null)}>⠿</span>:null}{itemButton(item,true)}{editing?<div className="workspace-favorites__order"><button type="button" disabled={busy||!ready||index===0} aria-label={`Выше: ${item.title}`} onClick={()=>move(item.id,favorites[index-1].id)}>↑</button><button type="button" disabled={busy||!ready||index===favorites.length-1} aria-label={`Ниже: ${item.title}`} onClick={()=>move(favorites[index+1].id,item.id)}>↓</button></div>:null}{editing?<button type="button" disabled={busy||!ready} className="workspace-favorites__remove" aria-label={`Убрать быструю ссылку: ${item.title}`} onClick={()=>save(ids.filter(id=>id!==item.id))}>−</button>:null}</div>)}
    {picker?<div className="workspace-favorites__picker" role="group" aria-label="Выбор быстрых ссылок">{available.filter(item=>!ids.includes(item.id)).map(item=><button type="button" disabled={busy||!ready} key={item.id} onClick={()=>save([...ids,item.id])}>+ {item.title}</button>)}<button type="button" onClick={()=>setPicker(false)}>Готово</button></div>:null}
  </section>;
  const overviewIndex=groups.findIndex(group=>group.items.some(item=>item.id==='overview'));
  return <>{groups.map((group,index)=><div className="workspace-nav__group-slot" key={group.id}>
    <SidebarGroup id={group.id} title={group.title} userId={userId} activeId={quickTarget!==activeId&&group.items.some(item=>item.id===activeId)?activeId:null} collapsible={!group.items.some(item=>item.id==='overview')}>
      {group.items.map(item=>itemButton(item))}
    </SidebarGroup>
    {index===Math.max(0,overviewIndex)?quickLinks:null}
  </div>)}</>;
}
