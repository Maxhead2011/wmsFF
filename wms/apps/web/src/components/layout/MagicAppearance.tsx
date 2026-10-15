import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {nextWallpaperIndex, wallpapers, type MagicStyle} from './magicAppearanceState';
import './magic-appearance.css';
// FIX: menu changes alone select a new wallpaper; stale/failed downloads cannot erase the current one.
export function MagicAppearance({style, workspaceId}:{style:MagicStyle; workspaceId:string}) {
 const [background,setBackground]=useState('');
 const previous=useRef(-1);
 const cursor=useRef<HTMLDivElement>(null);
 const dust=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const images=wallpapers(style);
  const index=nextWallpaperIndex(images.length,previous.current);
  let active=true;
  const image=new Image();
  image.onload=()=>{if(active){previous.current=index;setBackground(images[index]);}};
  image.src=images[index];
  return ()=>{active=false; image.onload=null;};
 },[style,workspaceId]);
 useEffect(()=>{
  const pointer=cursor.current!, trail=dust.current!;
  const fine=window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0, x=0, y=0, lastDust=0;
  const hide=()=>{pointer.hidden=true; delete document.documentElement.dataset.magicCursor;};
  const move=(event:PointerEvent)=>{
   if(!fine.matches||event.pointerType==='touch'||(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))){hide();return;}
   x=event.clientX;y=event.clientY;
   if(frame)return;
   frame=requestAnimationFrame(()=>{
    frame=0;pointer.hidden=false;pointer.style.transform=`translate3d(${x}px,${y}px,0)`;
    if(pointer.dataset.ready==='true')document.documentElement.dataset.magicCursor='true';
    if(style==='winx'&&!reduce.matches&&performance.now()-lastDust>65){
     lastDust=performance.now();const spark=document.createElement('i');spark.style.left=`${x}px`;spark.style.top=`${y}px`;
     spark.addEventListener('animationend',()=>spark.remove(),{once:true});trail.append(spark);
     while(trail.children.length>12)trail.firstElementChild?.remove();
    }
   });
  };
  window.addEventListener('pointermove',move,{passive:true});
  document.documentElement.addEventListener('pointerleave',hide);
  window.addEventListener('blur',hide);fine.addEventListener('change',hide);
  return ()=>{cancelAnimationFrame(frame);hide();window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',hide);window.removeEventListener('blur',hide);fine.removeEventListener('change',hide);trail.replaceChildren();};
 },[style]);
 return createPortal(<><div className="magic-wallpaper" aria-hidden="true" style={{backgroundImage:background?`url("${background}")`:undefined}}/>
  <div ref={cursor} hidden aria-hidden="true" className={`magic-cursor magic-cursor--${style}`}>
   <img alt="" src={`/themes/magic/${style}-cursor.png`} onLoad={()=>{if(cursor.current)cursor.current.dataset.ready='true';}} onError={()=>{if(cursor.current)cursor.current.dataset.ready='false';delete document.documentElement.dataset.magicCursor;}}/>
  </div><div ref={dust} className="magic-dust" aria-hidden="true"/></>,document.body);
}
