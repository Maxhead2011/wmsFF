import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {CatalogSortControls} from './CatalogSortControls';
// TEST: the user can distinguish unverified links from missing pairs and see stock filtering.
it('exposes article/color/quantity sorting and distinct linkage filters',()=>{
 const html=renderToStaticMarkup(<CatalogSortControls value={{sort:'stock',direction:'desc',inStock:true,correspondence:'unknown'}} onChange={()=>{}} busy={false}/>);
 for(const text of ['Артикулу','Цвету','Количеству на складе','Только в наличии','Нет подтверждённой пары','Не проверено'])expect(html).toContain(text);
 expect(html).toContain('value="unknown" selected');expect(html).toContain('checked=""');
});
