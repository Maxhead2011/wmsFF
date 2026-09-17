import { lazy, Suspense, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import '../fbs/fbs.css';
import './fbo.css';
const Requests=lazy(()=>import('./ClientRequestsPanel').then(m=>({default:m.ClientRequestsPanel})));
const Ozon=lazy(()=>import('../ozon-fbo/OzonFboPanel').then(m=>({default:m.OzonFboPanel})));
// FIX: preserve the existing Ozon workflow while placing WB Excel/manual requests next to it.
export function FboWorkspace({session}:{session:AuthSession}) {
  const [market,setMarket]=useState<'wb'|'ozon'|null>(null);
  const canReadWb=session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:read');
  return <section aria-label="FBO"><div className="section-heading"><div><p className="eyebrow">Поставки на склады маркетплейсов</p><h2>FBO</h2></div></div>
    <div className="fbo-marketplaces">{canReadWb&&<button className="fbs-marketplace-card fbs-marketplace-card--wb" aria-pressed={market==='wb'} onClick={()=>setMarket('wb')}><span className="fbs-marketplace-card__brand">WB</span><span className="fbs-marketplace-card__content"><strong>FBO WB</strong><span>Заявки из Excel и созданные вручную</span></span></button>}
      <button className="fbs-marketplace-card fbs-marketplace-card--ozon" aria-pressed={market==='ozon'} onClick={()=>setMarket('ozon')}><span className="fbs-marketplace-card__brand">OZON</span><span className="fbs-marketplace-card__content"><strong>FBO Ozon</strong><span>Планы, короба и поставки Ozon</span></span></button></div>
    <Suspense fallback={<p className="inline-status">Загружаю заявки…</p>}>{market==='wb'&&canReadWb?<Requests session={session} fboOnly/>:market==='ozon'?<Ozon session={session}/>:null}</Suspense>
  </section>;
}
