import {it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {readFileSync} from 'node:fs';
import {parseOzonFboRows} from '../src/modules/client-requests/parsers/ozon-fbo-xlsx.parser';
// TEST: destination naming must work alongside historical customer files.
it('accepts the destination header with blank optional articles',()=>{
 const rows=[['Направление / склад назначения Ozon','ШК','Поставка, шт','Артикул'],['Воронеж','2048701988171',10,'']];
 expect(parseOzonFboRows(rows)[0]).toMatchObject({direction:'Воронеж',barcode:'2048701988171',quantity:10,article:''});
 rows[0][0]='Склад хранения';expect(parseOzonFboRows(rows)).toHaveLength(1);
});
it('ships an empty import sheet with a separate valid example',()=>{
 const wb=XLSX.read(readFileSync(new URL('../../web/public/downloads/ozon-fbo-template.xlsx',import.meta.url)),{type:'buffer',cellNF:true,cellStyles:true});
 expect(wb.SheetNames[0]).toBe('Поставка');
 const rows=(name:string)=>XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true}) as any[][];
 expect(()=>parseOzonFboRows(rows('Поставка'))).toThrow();
 const example=parseOzonFboRows(rows('Пример'));expect(example).toHaveLength(3);expect(example.reduce((n,x)=>n+x.quantity,0)).toBe(30);expect(example[0].article).toBe('');
 expect(wb.Sheets['Поставка'].B2.z).toBe('@');
});


