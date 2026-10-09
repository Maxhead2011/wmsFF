import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {OzonCustomerWorkspace} from './OzonCustomerWorkspace';
// TEST: the customer-file entry must be an Ozon screen, not a legacy seller-article upload.
it('explains one shared assembly and exposes its own list in FBO Ozon',()=>{
 const html=renderToStaticMarkup(<OzonCustomerWorkspace session={{accessToken:'t',user:{id:'u'}} as any}/>);
 expect(html).toContain('Одна сборка — несколько направлений');
 expect(html).toContain('Единые сборки Ozon');
 expect(html).not.toContain('Разобрать распределение');
 expect(html).not.toContain('Обновить SKU Ozon');
});
