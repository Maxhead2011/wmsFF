import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {KizReviewCard} from './KizReviewCard';
// TEST: a repeated local scan is evidence to review, not a confirmed second physical unit.
it('labels unconfirmed receipt evidence and keeps reuse disabled',()=>{
 const row:any={id:'review',active:true,status:'OPEN',decision:'REVIEW',createdAt:'2026-10-30T09:00:00Z',attempts:1,kizIdentity:'identity',snapshot:{scope:'RECEIPT',receiptDuplicateUnconfirmed:true,productName:'Товар',boxCode:'BOX',workerName:'Worker'}};
 const html=renderToStaticMarkup(<KizReviewCard row={row} disabled={false} onDecision={()=>{}} onInspect={()=>{}}/>);
 expect(html).toContain('первая единица ещё не была зарегистрирована');
 expect(html).toMatch(/disabled="">Разрешить использовать/);
 expect(html).toContain('Наличие двух физических товаров');
});
