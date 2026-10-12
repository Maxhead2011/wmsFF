import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
// TEST: simulate an enabled import panel without a network call during server rendering.
vi.mock('react',async()=>{const real=await vi.importActual<typeof import('react')>('react');return {...real,useState:(initial:any)=>real.useState(initial===false?true:initial)};});
import {OzonCustomerImport} from './OzonCustomerImport';
it('places a downloadable workbook next to upload for the customer',()=>{
 const html=renderToStaticMarkup(<OzonCustomerImport session={{accessToken:'t',user:{id:'u'}} as any} clients={[]} fixedClientId="client" embedded onCreated={()=>{}}/>);
 expect(html.indexOf('Создать сборку по ссылке Ozon')).toBeGreaterThan(html.indexOf('</details>'));expect(html).toContain('https://seller.ozon.ru/app/supply/orders/134006772');
 expect(html).toContain('href="/downloads/ozon-fbo-template.xlsx"');expect(html).toContain('download="Шаблон-ФБО-Ozon.xlsx"');
 expect(html).toMatch(/type="file"[^]*Скачать шаблон<\/a><\/div>/);expect(html).toContain('конечные направления');
});
