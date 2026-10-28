import { fetchWorkspaceClients, visibleMarket, workspaceEnabled } from '../../lib/marketplaceWorkspace';
import { lazy, Suspense, useState, useEffect } from 'react';
import { fetchFboActiveCounts, type AuthSession, type ClientSummary } from '../../lib/api';
import '../fbs/fbs.css';
import './fbo.css';
const Requests=lazy(()=>import('./ClientRequestsPanel').then(m=>({default:m.ClientRequestsPanel})));
const Ozon=lazy(()=>import('../ozon-fbo/OzonFboPanel').then(m=>({default:m.OzonFboPanel})));
const Yandex=lazy(()=>import('../yandex-fby/YandexFbyPanel').then(m=>({default:m.YandexFbyPanel})));
const Lamoda=lazy(()=>import('../lamoda/LamodaPanel').then(m=>({default:m.LamodaPanel})));
// FIX: preserve the existing Ozon workflow while placing WB Excel/manual requests next to it.
export function FboWorkspace({session}:{session:AuthSession}) {
  const [market,setMarket]=useState<'wb'|'ozon'|'lamoda'|'yandex'|null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [directoryError, setDirectoryError] = useState('');
  const countScope = JSON.stringify([session.accessToken, session.user.activeWarehouseId, session.user.clientIds]);
  const [counts, setCounts] = useState<{scope:string; value?:{wb:number;ozon:number;lamoda:number}; error?:boolean} | null>(null);
  const canReadCounts = workspaceEnabled() && session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read');
  // FIX: discard late responses from another branch/session and refresh after returning to the screen.
  useEffect(() => {
    if (!canReadCounts) return;
    let active=true, pending=false;
    const refresh=async()=>{
      if (pending || document.visibilityState==='hidden') return;
      pending=true;
      try { const value=await fetchFboActiveCounts(session.accessToken); if(active) setCounts({scope:countScope,value}); }
      catch { if(active) setCounts({scope:countScope,error:true}); }
      finally { pending=false; }
    };
    setCounts(null);
    void refresh();
    const timer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[canReadCounts,countScope,market,session.accessToken]);
  const countBadge=(key:'wb'|'ozon'|'lamoda')=>canReadCounts ? <FboActiveCount count={counts?.scope===countScope?counts.value?.[key]:undefined} error={counts?.scope===countScope&&counts.error} /> : null;

  useEffect(() => { let active = true; setClients([]); setDirectoryError(''); if (workspaceEnabled()) fetchWorkspaceClients(session.accessToken).then(v => { if(active) setClients(v); }).catch(() => { if(active) setDirectoryError('Не удалось загрузить подключённые площадки. Обновите страницу.'); }); return () => { active=false; }; }, [session.accessToken]);
  const canReadLamoda=visibleMarket(session,clients,'LAMODA')&&import.meta.env.VITE_LAMODA_ENABLED==='true'&&(session.user.permissionCodes.some(p=>p==='system:admin'||p==='marketplace-api:read')||(session.user.roleCodes.includes('CLIENT')&&session.user.permissionCodes.includes('client-requests:read')));
  const canReadWb=visibleMarket(session,clients,'WILDBERRIES')&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read');
  const canReadYandex=import.meta.env.VITE_YANDEX_FBY_ENABLED==='true'&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read')&&visibleMarket(session,clients,'YANDEX_MARKET');
  return <section aria-label="FBO"><div className="section-heading"><div><p className="eyebrow">Поставки на склады маркетплейсов</p><h2>FBO</h2></div></div>
    {directoryError&&<p role="alert">{directoryError}</p>}<div className="fbo-marketplaces">{canReadWb&&<button className="fbs-marketplace-card fbs-marketplace-card--wb" aria-pressed={market==='wb'} onClick={()=>setMarket('wb')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/wb.svg" alt="" /></span><span className="fbs-marketplace-card__content"><strong>FBO WB</strong>{countBadge('wb')}<span>Заявки из Excel и созданные вручную</span></span></button>}
      {visibleMarket(session,clients,'OZON')&&<button className="fbs-marketplace-card fbs-marketplace-card--ozon" aria-pressed={market==='ozon'} onClick={()=>setMarket('ozon')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/ozon.png" alt="" /></span><span className="fbs-marketplace-card__content"><strong>FBO Ozon</strong>{countBadge('ozon')}<span>Планы, короба и поставки Ozon</span></span></button>}
    {canReadLamoda&&<button className="fbs-marketplace-card fbs-marketplace-card--lamoda" aria-pressed={market==='lamoda'} onClick={()=>setMarket('lamoda')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/lamoda.jpg" alt="" /></span><span className="fbs-marketplace-card__content"><strong className="lamoda-wordmark" role="img" aria-label="lamoda" />{countBadge('lamoda')}<span>{workspaceEnabled() ? 'Поставки из файла или кабинета Lamoda' : 'Подключение, каталог и подготовка FBO/FBS'}</span></span></button>}
    {canReadYandex&&<button className="fbs-marketplace-card fbs-marketplace-card--yandex" aria-pressed={market==='yandex'} onClick={()=>setMarket('yandex')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/yandex-market.png" alt="" /></span><span className="fbs-marketplace-card__content"><strong>Яндекс Маркет · FBY</strong><span>Поставка из кабинета, Excel или вручную</span></span></button>}</div>
    <Suspense fallback={<p className="inline-status">Загружаю заявки…</p>}>{market==='wb'&&canReadWb?<Requests session={session} fboOnly/>:market==='ozon'?<Ozon session={session}/>:market==='lamoda'&&canReadLamoda?<Lamoda session={session}/>:market==='yandex'&&canReadYandex?<Yandex session={session}/>:null}</Suspense>
  </section>;
}

// FIX: an unavailable counter is never shown as a misleading zero.
export function FboActiveCount({count,error}:{count?:number;error?:boolean}) {
  const state=error?'error':count===undefined?'loading':'ready';
  const word=count!==undefined && count%100>=11 && count%100<=14?'заявок':count!==undefined && count%10===1?'заявка':count!==undefined && count%10>=2 && count%10<=4?'заявки':'заявок';
  return <span className="fbs-marketplace-card__active-count" data-state={state} data-has-orders={state==='ready'&&count!>0?'true':'false'} aria-live="polite" title="Активные заявки: поданные, на рассмотрении, согласованные, в работе и упакованные">
    <span className="fbs-marketplace-card__active-dot" aria-hidden="true" />
    {error?'Не удалось загрузить':count===undefined?'Загрузка…':`${count} ${word}`}
  </span>;
}
