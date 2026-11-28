import {useEffect,useState} from 'react';
import type {OzonEditDeadline} from '../../lib/api';
import './ozon-edit-deadline.css';

// FIX: no slot-based guesses and no marketplace calls from the ticking clock.
export function deadlineDisplay(deadline:string|null|undefined,now:number){
 const at=deadline?Date.parse(deadline):NaN;
 if(!Number.isFinite(at))return {tone:'unknown',text:'Дедлайн неизвестен — обновите сверку с Ozon'};
 const remaining=at-now;
 if(remaining<=0)return {tone:'expired',text:'Срок редактирования истёк'};
 const minutes=Math.ceil(remaining/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;
 return {tone:remaining<=2*3600000?'urgent':remaining<=24*3600000?'warning':'normal',text:`До дедлайна: ${days?days+' д. ':''}${hours} ч. ${mins} мин.`};
}
export function OzonEditCountdown({orders,enabled}:{orders?:OzonEditDeadline[];enabled?:boolean}){
 const [now,setNow]=useState(Date.now);
 const visible=enabled??(typeof window!=='undefined'&&['wms.logoff.pro','localhost','127.0.0.1'].includes(window.location.hostname));
 useEffect(()=>{if(!visible)return;const tick=()=>setNow(Date.now());const timer=setInterval(tick,15000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[visible]);
 if(!visible)return null;
 const list:OzonEditDeadline[]=orders?.length?orders:[{orderId:'unknown',orderNumber:'',editDeadlineAt:null}];
 return <span className="ozfbo-edit-deadlines" aria-label={list.some(o=>o.readyToShip)?"Срок и готовность Ozon":"Дедлайн редактирования Ozon"}>{list.map(o=>{const d=deadlineDisplay(o.editDeadlineAt,now);const stale=o.checkedAt&&now-Date.parse(o.checkedAt)>15*60000;
 // FIX: accepted cargoes replace the deadline alarm; never substitute the editing deadline for handover.
 if(o.readyToShip)return <span className="ozfbo-edit-deadline is-ready" key={o.orderId}>{list.length>1&&<strong>Ozon №{o.orderNumber}</strong>}<strong>Готово к отгрузке</strong><small>Дата сдачи: {o.handoverAt&&Number.isFinite(Date.parse(o.handoverAt))?new Date(o.handoverAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'не указана в Ozon'}</small></span>;
 return <span className={'ozfbo-edit-deadline is-'+d.tone} key={o.orderId}>
 {list.length>1&&<strong>Ozon №{o.orderNumber}</strong>}<strong>{d.text}</strong>
 {o.editDeadlineAt&&Number.isFinite(Date.parse(o.editDeadlineAt))&&<small>До {new Date(o.editDeadlineAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</small>}
 {stale&&<small>Срок получен ранее. После переноса обновите сверку с Ozon.</small>}
 </span>;})}</span>;
}
