import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { actualFbyRows, actualFbyWorkbook } from '../src/modules/yandex-fby/yandex-fby-export';
const context = () => ({ status:'PACKED', phase:'COMPLETED', items:[{id:'i',skuId:'s',quantity:2}],
  units:[1,2].map(id=>({id:String(id),requestItemId:'i',skuId:'s',barcode:'0001234567890',state:'PACKED',targetBoxId:'box'})),
  boxes:[{boxId:'box',closedAt:new Date(),confirmedAt:new Date()}], mappings:[] });
const offers=[{offerId:'001-SKU',name:'Товар Яндекса',barcodes:['0001234567890']}];
// TEST: actual packed units supply the quantity; IDs remain strings in the client template.
it('exports the supplied four columns and preserves the explanation sheet',async()=>{
 const rows=actualFbyRows(context(),offers);
 const b=XLSX.read(await actualFbyWorkbook(rows),{type:'buffer'});
 expect(b.SheetNames).toEqual(['Поставка','Описание полей']);
 expect(XLSX.utils.sheet_to_json(b.Sheets['Поставка'],{header:1,blankrows:false})).toEqual([
  ['Ваш SKU','Наименование','Штрихкод','Общее кол-во для поставки'],['001-SKU','Товар Яндекса','0001234567890',2]]);
 expect(b.Sheets['Поставка'].A2.t).toBe('s');expect(b.Sheets['Поставка'].C2.t).toBe('s');
 expect(b.Sheets['Описание полей'].A3.v).toBe('Ваш SKU');
});
it('refuses an incomplete assembly, open boxes, unconfirmed boxes and demand drift',()=>{
 for(const mutate of [c=>c.phase='PACKING',c=>c.status='CANCELLED',c=>c.boxes[0].closedAt=null,c=>c.boxes[0].confirmedAt=null,c=>c.units[0].state='PICKED',c=>c.items[0].quantity=3,c=>c.units[0].targetBoxId='other']){
  const c:any=context();mutate(c);expect(()=>actualFbyRows(c,offers)).toThrow();
 }
});
it('ignores returned units but rejects duplicated active units and foreign SKU rows',()=>{
 const c=context();c.units.push({...c.units[0],id:'returned',state:'RETURNED'});expect(actualFbyRows(c,offers)[0].quantity).toBe(2);
 c.units.push(c.units[0]);expect(()=>actualFbyRows(c,offers)).toThrow();
 const other=context();other.units[0].skuId='foreign';expect(()=>actualFbyRows(other,offers)).toThrow();
});
it('does not guess ambiguous offers or use an unrecognised physical barcode',()=>{
 expect(()=>actualFbyRows(context(),[])).toThrow('соответствие');
 expect(()=>actualFbyRows(context(),[...offers,{...offers[0],offerId:'other'}])).toThrow('соответствие');
 const c:any=context();c.mappings=[{skuId:'s',offerId:'001-SKU'}];
 expect(actualFbyRows(c,[...offers,{...offers[0],offerId:'other'}])[0].offerId).toBe('001-SKU');
 c.mappings=[{skuId:'s',offerId:'missing'}];expect(()=>actualFbyRows(c,offers)).toThrow();
});
it('keeps formula-looking names as literal text and rejects two SKUs using one offer',async()=>{
 const rows=actualFbyRows(context(),[{...offers[0],name:'=1+1'}]);
 const b=XLSX.read(await actualFbyWorkbook(rows),{type:'buffer'});expect(b.Sheets['Поставка'].B2.f).toBeUndefined();
 const c=context();c.items.push({id:'other',skuId:'other',quantity:1});c.units.push({...c.units[0],id:'3',requestItemId:'other',skuId:'other'});
 expect(()=>actualFbyRows(c,offers)).toThrow();
});
