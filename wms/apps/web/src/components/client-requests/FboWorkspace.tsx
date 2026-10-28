import { fetchWorkspaceClients, visibleMarket, workspaceEnabled } from '../../lib/marketplaceWorkspace';
import { lazy, Suspense, useState, useEffect } from 'react';
import type { AuthSession, ClientSummary } from '../../lib/api';
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
  useEffect(() => { let active = true; setClients([]); setDirectoryError(''); if (workspaceEnabled()) fetchWorkspaceClients(session.accessToken).then(v => { if(active) setClients(v); }).catch(() => { if(active) setDirectoryError('Не удалось загрузить подключённые площадки. Обновите страницу.'); }); return () => { active=false; }; }, [session.accessToken]);
  const canReadLamoda=visibleMarket(session,clients,'LAMODA')&&import.meta.env.VITE_LAMODA_ENABLED==='true'&&(session.user.permissionCodes.some(p=>p==='system:admin'||p==='marketplace-api:read')||(session.user.roleCodes.includes('CLIENT')&&session.user.permissionCodes.includes('client-requests:read')));
  const canReadWb=visibleMarket(session,clients,'WILDBERRIES')&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read');
  const canReadYandex=import.meta.env.VITE_YANDEX_FBY_ENABLED==='true'&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read')&&visibleMarket(session,clients,'YANDEX_MARKET');
  return <section aria-label="FBO"><div className="section-heading"><div><p className="eyebrow">Поставки на склады маркетплейсов</p><h2>FBO</h2></div></div>
    {directoryError&&<p role="alert">{directoryError}</p>}<div className="fbo-marketplaces">{canReadWb&&<button className="fbs-marketplace-card fbs-marketplace-card--wb" aria-pressed={market==='wb'} onClick={()=>setMarket('wb')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/wb.svg" alt="" /></span><span className="fbs-marketplace-card__content"><strong>FBO WB</strong><span>Заявки из Excel и созданные вручную</span></span></button>}
      {visibleMarket(session,clients,'OZON')&&<button className="fbs-marketplace-card fbs-marketplace-card--ozon" aria-pressed={market==='ozon'} onClick={()=>setMarket('ozon')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/ozon.png" alt="" /></span><span className="fbs-marketplace-card__content"><strong>FBO Ozon</strong><span>Планы, короба и поставки Ozon</span></span></button>}
    {canReadLamoda&&<button className="fbs-marketplace-card fbs-marketplace-card--lamoda" aria-pressed={market==='lamoda'} onClick={()=>setMarket('lamoda')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/lamoda.jpg" alt="" /></span><span className="fbs-marketplace-card__content"><strong className="lamoda-wordmark" role="img" aria-label="lamoda" /><span>{workspaceEnabled() ? 'Поставки из файла или кабинета Lamoda' : 'Подключение, каталог и подготовка FBO/FBS'}</span></span></button>}
    {canReadYandex&&<button className="fbs-marketplace-card fbs-marketplace-card--yandex" aria-pressed={market==='yandex'} onClick={()=>setMarket('yandex')}><span className="fbs-marketplace-card__brand" aria-hidden="true"><img src="/brand/yandex-market.png" alt="" /></span><span className="fbs-marketplace-card__content"><strong>Яндекс Маркет · FBY</strong><span>Поставка из кабинета, Excel или вручную</span></span></button>}</div>
    <Suspense fallback={<p className="inline-status">Загружаю заявки…</p>}>{market==='wb'&&canReadWb?<Requests session={session} fboOnly/>:market==='ozon'?<Ozon session={session}/>:market==='lamoda'&&canReadLamoda?<Lamoda session={session}/>:market==='yandex'&&canReadYandex?<Yandex session={session}/>:null}</Suspense>
  </section>;
}
