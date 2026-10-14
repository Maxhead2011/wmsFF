import React, {useState} from 'react';
import {magicEnabled, welcomeStyle} from './magicAppearanceState';
import './magic-appearance.css';
// FIX: this is a loading fallback, never a timer that delays a ready workspace.
export function MagicWelcome({user,enabled=true}:{user:{id:string;name:string};enabled?:boolean}) {
 const [skipped,setSkipped]=useState(false);
 const [failed,setFailed]=useState(false);
 const style=welcomeStyle(user);
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(!enabled||!magicEnabled(window.location.hostname)||!style||skipped)return <p role="status">Загрузка…</p>;
 return <section className="magic-welcome" aria-label="Приветствие">
  <h1>Добро пожаловать в мир волшебства и порядка</h1>
  {reduced||failed?<img alt="" src={`/themes/magic/${style}-welcome.webp`}/>:<video autoPlay muted playsInline loop poster={`/themes/magic/${style}-welcome.webp`} onError={()=>setFailed(true)} src={`/themes/magic/${style}-welcome.mp4`}/>}
  <button type="button" onClick={()=>setSkipped(true)}>Пропустить</button>
 </section>;
}
