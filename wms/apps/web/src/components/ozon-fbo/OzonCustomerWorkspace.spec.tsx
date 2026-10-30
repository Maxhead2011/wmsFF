import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
import {OzonCustomerWorkspace} from './OzonCustomerWorkspace';
// TEST: a previously remembered client must not hide the default all-client queue.
it('defaults to all clients only on our WMS despite a remembered selection',()=>{
 vi.stubGlobal('window',{localStorage:{getItem:()=> 'previous-client'},location:{hostname:'wms.logoff.pro'}});
 const html=renderToStaticMarkup(<OzonCustomerWorkspace session={{accessToken:'t',user:{id:'u'}} as any}/>);
 expect(html).toContain('ozfbo-combined');
 expect(html).toContain('<option value="" selected="">Все клиенты</option>');
 expect(html).not.toContain('Плиток в ряд');
 vi.stubGlobal('window',{localStorage:{getItem:()=>null},location:{hostname:'sold.example'}});
 expect(renderToStaticMarkup(<OzonCustomerWorkspace session={{accessToken:'t',user:{id:'u'}} as any}/>)).not.toContain('ozfbo-combined');
});
// TEST: the customer-file entry must be an Ozon screen, not a legacy seller-article upload.
it('explains one shared assembly and exposes its own list in FBO Ozon',()=>{
 const html=renderToStaticMarkup(<OzonCustomerWorkspace session={{accessToken:'t',user:{id:'u'}} as any}/>);
 expect(html).toContain('Одна сборка — несколько направлений');
 expect(html).toContain('Единые сборки Ozon');
 expect(html).not.toContain('Разобрать распределение');
 expect(html).not.toContain('Обновить SKU Ozon');
});
// TEST: isolate the 65/35 responsive layout from other Ozon screens.
it('scopes the approved customer workspace layout and accessible list tabs',()=>{
 const html=renderToStaticMarkup(<OzonCustomerWorkspace session={{accessToken:'t',user:{id:'u'}} as any}/>);
 expect(html).toContain('ozfbo-customer-workspace');
 expect(html).toContain('ozfbo-workspace-tabs');
 expect(html).toContain('aria-pressed="true"');
 expect(html).toContain('aria-pressed="false"');
});
