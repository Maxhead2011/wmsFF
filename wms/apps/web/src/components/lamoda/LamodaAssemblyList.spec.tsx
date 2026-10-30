import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {LamodaAssemblyList} from './LamodaAssemblyList';
import type {LamodaOverview} from '../../lib/api';

vi.mock('../client-requests/RequestRemoval',()=>({RequestRemovalButton:({request}:{request:{id:string;status:string}})=>['DONE','CANCELLED','REJECTED'].includes(request.status)?null:<button data-request-id={request.id}>Удалить заявку</button>}));
const plan:LamodaOverview['plans'][number]={id:'plan',title:'Исходный файл Lamoda',createdAt:'2026-10-29T10:00:00Z',warehouse:{name:'ФФ Москва'},items:[1,2,3,4].map(n=>({barcode:`460000${n}`,quantity:n})),assembly:{requestId:'request',request:{number:2506,status:'IN_WORK'}}};
const render=(row=plan,canWrite=true)=>renderToStaticMarkup(<LamodaAssemblyList plans={[row]} client={{code:'CL-000001',name:'ИП Лукин'}} disabled={false} canWrite={canWrite} onOpen={()=>{}} onReview={()=>{}}/>);
// TEST: the same operational label is used in Lamoda without changing shipment state.
it('shows packed pending control separately from request status',()=>{
 expect(render({...plan,assembly:{requestId:'request',request:{number:2506,status:'IN_WORK',fboProgressLabel:'Упаковано, ожидает проверки'}}})).toContain('Упаковано, ожидает проверки');
});

// TEST: the original plan remains explicitly labelled and cannot be mistaken for actual packed/request quantities.
it('shows five columns, client and bounded source-plan preview without fake deadlines',()=>{
 const html=render();
 for(const label of ['Заявка','Состав','Срок / статус','Склад','Действия'])expect(html).toContain(`<th>${label}</th>`);
 expect(html).toContain('№002506');expect(html).toContain('CL-000001');expect(html).toContain('ИП Лукин');expect(html).toContain('ФФ Москва');
 expect(html).toContain('По плану: 10 шт. · строк: 4');expect(html).toContain('ШК 4600001 × 1');expect(html).toContain('ещё 1');expect(html).not.toContain('4600004');
 expect(html).not.toContain('Дедлайн');expect(html).not.toContain('Плиток в ряд');
});
it('opens and removes by assembly request ID, never by draft plan ID',()=>{
 const html=render();expect(html).toContain('Открыть сборку');expect(html).toContain('data-request-id="request"');expect(html).not.toContain('Проверить соответствия и остатки');
});
it('retains a disabled review action for a draft without write access',()=>{
 const html=render({...plan,assembly:null},false);expect(html).toContain('Черновик');expect(html).toContain('<button type="button" disabled="">Проверить соответствия и остатки</button>');expect(html).not.toContain('Открыть сборку');expect(html).not.toContain('Удалить заявку');expect(html).not.toContain('data-selected');
});
it('keeps completed request status and does not offer deletion',()=>{
 const html=render({...plan,assembly:{requestId:'done',request:{number:20,status:'DONE'}}});expect(html).toContain('Сдана');expect(html).toContain('Открыть сборку');expect(html).not.toContain('Удалить заявку');
});
