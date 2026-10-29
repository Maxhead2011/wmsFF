import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {KizReviewCard} from './KizReviewQueuePanel';
import type {KizReviewCase} from '../../lib/api';
// TEST: every case starts collapsed, keeping actions and evidence inside.
it('collapses each review independently',()=>{const row={id:'1',status:'OPEN',active:true,decision:'REVIEW',createdAt:'2026-09-29T00:00:00Z',snapshot:{productName:'Товар',requestNumber:1,orderId:'2'},kizIdentity:'k',attempts:1} as KizReviewCase;const html=renderToStaticMarkup(<KizReviewCard row={row} disabled={false} onInspect={()=>{}} onDecision={()=>{}}/>);expect(html).toContain('<details');expect(html).not.toContain(' open=');expect(html).toContain('<summary');expect(html).toContain('Посмотреть историю КИЗа');expect(html.indexOf('</summary>')).toBeLessThan(html.indexOf('Разрешить использовать'));});

import {reviewWeek} from './reviewWeek';
// TEST: inclusive seven-day boundary and pagination cutoff.
it('keeps seven days and stops before older history',()=>{const now=Date.parse('2026-09-29T12:00:00Z');expect(reviewWeek({items:[{createdAt:'2026-09-29T11:00:00Z'},{createdAt:'2026-09-22T12:00:00Z'},{createdAt:'2026-09-22T11:59:59Z'}],nextCursor:'old'},now)).toEqual({items:[{createdAt:'2026-09-29T11:00:00Z'},{createdAt:'2026-09-22T12:00:00Z'}],nextCursor:null});expect(reviewWeek({items:[{createdAt:'2026-09-28T00:00:00Z'}],nextCursor:'next'},now).nextCursor).toBe('next');});

// TEST: sold-order permission comes from scoped server capability.
it('offers physical reuse only when server allows it',()=>{
 const row={id:'1',status:'OPEN',active:true,decision:'RELABEL',createdAt:'2026-10-13T00:00:00Z',snapshot:{productName:'Товар',requestNumber:1,orderId:'2'},kizIdentity:'k',attempts:1} as KizReviewCase;
 const render=(extra:Partial<KizReviewCase>)=>renderToStaticMarkup(<KizReviewCard row={{...row,...extra}} disabled={false} onInspect={()=>{}} onDecision={()=>{}}/>);
 expect(render({})).toContain('disabled="">Разрешить использовать');
 expect(render({physicalReuseAllowed:true})).not.toContain('disabled="">Разрешить использовать');
 expect(render({physicalReuseAllowed:true,active:false})).toContain('disabled="">Разрешить использовать');
});

// TEST: pending client-guard cases stay reachable in the sole administrative queue.
it('keeps unresolved old cases and their pagination with the client guard',()=>{
 const row={createdAt:'2026-01-01T00:00:00Z',status:'OPEN'};
 expect(reviewWeek({items:[row],nextCursor:'more'},Date.parse('2026-10-29'),true)).toEqual({items:[row],nextCursor:'more'});
});
it('identifies FBO context and exposes an explicit refusal',()=>{
 const row:KizReviewCase={id:'1',taskId:'GUARD:FBO:client:request',status:'OPEN',active:true,decision:'REVIEW',createdAt:'2026-10-29',updatedAt:'2026-10-29',resolution:null,reason:null,decidedByName:null,
  snapshot:{scope:'FBO',productName:'Товар',requestNumber:1813,orderId:'',article:null,barcode:null,boxCode:null,workerName:null},kizIdentity:'k',attempts:1,physicalReuseAllowed:true,evidence:{circulation:null,history:[]}};
 const html=renderToStaticMarkup(<KizReviewCard row={row} disabled={false} onInspect={()=>{}} onDecision={()=>{}}/>);
 expect(html).toContain('FBO');expect(html).toContain('Отказать');expect(html).not.toContain('заказ WB');
});
