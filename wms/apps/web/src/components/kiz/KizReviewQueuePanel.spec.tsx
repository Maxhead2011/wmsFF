import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {KizReviewCard} from './KizReviewQueuePanel';
// TEST: sold/retired history never presents an enabled reuse action in WMS.
it('shows both decisions, with only the evidence-compatible action enabled',()=>{
  const row:any={id:'case',active:true,status:'OPEN',decision:'RELABEL',snapshot:{requestNumber:646,orderId:'order',productName:'Костюм',workerName:'Соня',boxCode:'335'},createdAt:'2026-09-21T12:00:00Z',attempts:2};
  const html=renderToStaticMarkup(<KizReviewCard row={row} disabled={false} onInspect={()=>{}} onDecision={()=>{}}/>);
  expect(html).toContain('Соня');expect(html).toContain('000646');
  expect(html).toMatch(/disabled="">Разрешить использовать/);
  expect(html).not.toMatch(/disabled="">Разрешить переклейку/);
  row.active=false;
  expect(renderToStaticMarkup(<KizReviewCard row={row} disabled={false} onInspect={()=>{}} onDecision={()=>{}}/>)).toMatch(/disabled="">Разрешить переклейку/);
});
