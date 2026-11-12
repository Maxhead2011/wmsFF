import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import {parseUsage,popularItems,recordUsage,usageKey,type Usage} from './soulUsage';
type Item={id:string;title:string;groupId:string};
function read(key:string):Usage {try{return parseUsage(localStorage.getItem(key));}catch{return {};}}
// FIX: mounted per user; track actual section transitions including search navigation.
export function SoulQuickAccess({userId,activeId,items,onOpen,renderBadge}:{userId:string;activeId:string;items:Item[];onOpen:(id:string)=>void;renderBadge?:(id:string)=>ReactNode}){
 const key=usageKey(userId),last=useRef(activeId),[usage,setUsage]=useState(()=>read(key));
 useEffect(()=>{
  if(last.current===activeId)return;
  last.current=activeId;
  if(activeId==='overview'||!items.some(i=>i.id===activeId))return;
  let next=recordUsage(usage,activeId,Date.now());
  try{next=recordUsage(parseUsage(localStorage.getItem(key)),activeId,Date.now());localStorage.setItem(key,JSON.stringify(next));}catch{/* Navigation still works with storage blocked. */}
  setUsage(next);
 },[activeId,items,key,usage]);
 if(activeId!=='overview')return null;
 const popular=popularItems(items,usage);
 return <section className="soul-quick-access" aria-label="Быстрый доступ">
  <h2>Быстрый доступ</h2>
  {popular.length?<div className="soul-quick-items">{popular.map(item=><button type="button" className={`soul-${item.groupId}`} key={item.id} data-soul-quick={item.id} title={item.title} onClick={()=>onOpen(item.id)}><span className="soul-item-label">{item.title}</span>{renderBadge?.(item.id)}</button>)}</div>:<p>Открывайте разделы — самые популярные появятся здесь.</p>}
 </section>;
}
