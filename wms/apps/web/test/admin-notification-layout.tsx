import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { AdminNotificationList } from '../src/components/admin-notifications/AdminNotifications';
const item={id:1,type:'MISSING_PALLET_BOX',title:'Сборщик сообщил: короба нет на палете',body:'Гулрух · Короб: FFL_LKB0409_315; паллетсорт: PALET_SORT_102; заявка: 001152; заказ: 5811494429. Проверьте размещение товара.',createdAt:'2026-09-20T15:55:03Z',isRead:false,clientId:'client'};
const state:any={enabled:true,items:[item,{...item,id:2,isRead:true}],error:'',markRead:async()=>{},older:()=>{},latest:()=>{}};
createRoot(document.getElementById('root')!).render(<div className="app-layout"><section className="header-notification-popover" style={{position:'relative',top:0,right:0,width:'min(440px, calc(100vw - 24px))'}}><AdminNotificationList state={state} onOpen={async()=>{}}/><button className="header-notification-item" id="ordinary"><span className="header-notification-item__icon">!</span><span className="header-notification-item__body"><strong>Обычное уведомление</strong><span>Текст</span></span><span>→</span></button></section></div>);
