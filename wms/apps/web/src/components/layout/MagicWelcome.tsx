import React, {useState,useEffect} from 'react';
import {magicEnabled, welcomeStyle} from './magicAppearanceState';
import './magic-appearance.css';
// FIX: explicit login plays once; loading fallbacks remain tied to actual loading.
export function MagicWelcome({user,enabled=true,onComplete}:{user:{id:string;name:string};enabled?:boolean;onComplete?:()=>void}) {
 const [skipped,setSkipped]=useState(false);
 const [failed,setFailed]=useState(false);
 const style=welcomeStyle(user);
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 // FIX: reduced motion and failed/autoplay-blocked media must never trap login.
 useEffect(()=>{if(!onComplete)return;const timer=window.setTimeout(onComplete,reduced?1500:30000);return ()=>window.clearTimeout(timer);},[onComplete,reduced]);
 if(!enabled||!magicEnabled(window.location.hostname)||!style||skipped)return <p role="status">Загрузка…</p>;
 return <section className="magic-welcome" aria-label="Приветствие">
  <h1>Добро пожаловать в мир волшебства и порядка</h1>
  {reduced||failed?<img alt="" src={`/themes/magic/${style}-welcome.webp`}/>:<video autoPlay muted playsInline loop={!onComplete} onEnded={onComplete} poster={`/themes/magic/${style}-welcome.webp`} onError={()=>{setFailed(true);onComplete?.();}} src={`/themes/magic/${style}-welcome.mp4`}/>}
  <button type="button" onClick={()=>{setSkipped(true);onComplete?.();}}>Пропустить</button>
 </section>;
}
