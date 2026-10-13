import {describe,it,expect} from 'vitest';
import {syncComposition} from '../src/modules/tsd/ozon-request-sync-policy';
const source=()=>({request:{items:[{id:'i',skuId:'s',barcode:'old',quantity:2}],fboAssembly:{units:[{id:'u',skuId:'s',state:'PACKED',targetBoxId:'b'}],boxes:[{boxId:'b',direction:'A'}]}},directions:[{name:'A',items:[{skuId:'s',barcode:'old',quantity:2}]}]});
const link=(quantity=3)=>({mapping:{A:'1'},supplies:[{id:'1',items:[{barcode:'new',quantity}]}]});
const catalog=[{id:'s',name:'Dress',barcodes:[{value:'old'},{value:'new'}]}];
// TEST: inbound synchronization preserves SKU identity and physical progress.
describe('Ozon inbound composition',()=>{
 it('adds demand through an exact registered barcode alias',()=>{const p=syncComposition(source(),link(),catalog);expect(p.items).toEqual([{skuId:'s',barcode:'new',name:'Dress',quantity:3}]);expect(p.rows[0]).toMatchObject({before:2,after:3,packed:1});});
 it('blocks reduction below packed units',()=>expect(()=>syncComposition(source(),link(0),catalog)).toThrow());
 it('blocks ambiguous barcode owners',()=>expect(()=>syncComposition(source(),link(),[...catalog,{...catalog[0],id:'other'}])).toThrow('однозначно'));
 it('blocks unknown barcode rather than matching a name',()=>expect(()=>syncComposition(source(),link(),[])).toThrow('однозначно'));
 it('blocks missing destination mapping',()=>expect(()=>syncComposition(source(),{...link(),mapping:{}},catalog)).toThrow('направлений'));
 it('blocks reduction below picked quantity across directions',()=>{const s=source();s.request.fboAssembly.units.push({id:'u2',skuId:'s',state:'PICKED',targetBoxId:''});expect(()=>syncComposition(s,link(1),catalog)).toThrow('отобрано');});
});
