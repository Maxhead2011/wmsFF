import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi,afterEach} from 'vitest';
import {OzonAssemblyList} from './OzonAssemblyList';
import {fetchOzonCustomerRequests,type OzonCustomerRequest} from '../../lib/api';
afterEach(()=>vi.unstubAllGlobals());
const row:OzonCustomerRequest={id:'r',number:2477,title:'Поставка Ozon',clientName:'ИП Лукин',clientCode:'CL-000001',warehouseName:'Москва',status:'IN_WORK',phase:'COMPLETED',quantity:291,itemCount:4,itemsPreview:[{name:'Костюм',barcode:'123',quantity:10}],directions:9,desiredDate:'2026-10-30',destinationCity:'Строгино'};
// TEST: retain the payer and show the actual shop as a separate label.
it('shows shop separately from payer and explicitly marks unknown shops',()=>{
 const render=(extra:object)=>renderToStaticMarkup(<OzonAssemblyList rows={[{...row,...extra}]} active onOpen={()=>{}} onCargo={()=>{}}/>);
 expect(render({storeState:'ASSIGNED',storeNames:['Брайбо']})).toContain('Брайбо');
 expect(render({storeState:'ASSIGNED',storeNames:['Брайбо']})).toContain('ИП Лукин');
 expect(render({storeState:'UNASSIGNED',storeNames:[]})).toContain('Магазин не определён');
});
// TEST: display packing completion without claiming physical control/handover.
it('shows the operational label before physical control',()=>{
 const html=renderToStaticMarkup(<OzonAssemblyList rows={[{...row,phase:'PACKING',fboProgressLabel:'Упаковано, ожидает проверки'}]} active onOpen={()=>{}} onCargo={()=>{}}/>);
 expect(html).toContain('Упаковано, ожидает проверки');expect(html).not.toContain('Упаковано, ожидает сдачи');
});
// TEST: Ozon keeps its deadline and actions in the requested WB-style columns.
it('places client in composition, deadline in status and Ozon actions in warehouse',()=>{
 vi.stubGlobal('window',{location:{hostname:'wms.logoff.pro'}});
 const html=renderToStaticMarkup(<OzonAssemblyList rows={[row]} active onOpen={()=>{}} onCargo={()=>{}}/>);
 for(const label of ['Заявка','Состав','Срок / статус','Склад','Действия','ИП Лукин','CL-000001','Костюм','291','Дедлайн редактирования Ozon','Поставка и грузоместа Ozon'])expect(html).toContain(label);
 expect(html).toMatch(/data-label="Состав"[^>]*><div class="ozfbo-row-client"/);
 expect(html).not.toContain('Процесс');
});
it('does not show a live deadline for archived requests',()=>{
 const html=renderToStaticMarkup(<OzonAssemblyList rows={[{...row,status:'DONE'}]} active={false} onOpen={()=>{}} onCargo={()=>{}}/>);
 expect(html).toContain('Сдано');expect(html).not.toContain('Дедлайн редактирования Ozon');
});
it('sends explicit read-only all-clients and paging options without changing legacy requests',async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('[]'));vi.stubGlobal('fetch',fetcher);
 await fetchOzonCustomerRequests('t','','','active',{allClients:true,beforeNumber:100});
 expect(String(fetcher.mock.calls[0][0])).toContain('allClients=true&beforeNumber=100');
 await fetchOzonCustomerRequests('t','c','w');
 expect(String(fetcher.mock.calls[1][0])).not.toContain('allClients=');
});
