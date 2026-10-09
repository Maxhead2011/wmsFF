import { describe, it, expect } from 'vitest';
import { parseOzonFboRows } from '../src/modules/client-requests/parsers/ozon-fbo-xlsx.parser';
import { assertDirectionCapacity, directionProgress } from '../src/modules/tsd/ozon-fbo-directions';

// TEST: vertical customer workbook, inherited cells and totals must never duplicate demand.
describe('Ozon customer distribution', () => {
  const header = ['Склад хранения', 'Артикул', 'ШК', 'Поставка, шт'];
  it('keeps destinations within one allocation and ignores summary rows', () => {
    const rows = [[],header,['Москва','a','4610389216310',2],[null,'b','4610389216327',3],['Москва Итог',null,null,5],['Уфа','a','4610389216310',4],['Общий итог',null,null,9]];
    const lines = parseOzonFboRows(rows);
    expect(lines.map(l=>l.direction)).toEqual(['Москва','Москва','Уфа']);
    expect(lines.reduce((s,l)=>s+l.quantity,0)).toBe(9);
  });
  it.each([0,-1,1.5,'bad'])('rejects malformed demand %s instead of silently dropping it', n => {
    expect(()=>parseOzonFboRows([header,['Уфа','a','4610389216310',n]])).toThrow();
  });
  it('does not inherit a direction across a subtotal',()=>{
    expect(()=>parseOzonFboRows([header,['Москва Итог',null,null,2],[null,'a','4610389216310',2]])).toThrow();
  });
});

// TEST: packing uses persisted physical boxes, with independent per-SKU quotas.
describe('one pick pool, several destinations',()=>{
  const dirs=[{name:'Москва',items:[{skuId:'a',barcode:'1',quantity:2}]},{name:'Уфа',items:[{skuId:'a',barcode:'1',quantity:1}]}];
  const boxes=[{boxId:'box',direction:'Уфа'}];
  const units=[{skuId:'a',state:'PACKED',targetBoxId:'box'},{skuId:'a',state:'PICKED',targetBoxId:null}];
  it('shows separate quotas without counting unassigned picked units',()=>{
    expect(directionProgress(dirs,boxes,units).map(d=>[d.needed,d.packed])).toEqual([[2,0],[1,1]]);
  });
  it('rejects overflowing a direction while stock is still required elsewhere',()=>{
    expect(()=>assertDirectionCapacity(dirs,boxes,units,'Уфа',[{skuId:'a'}])).toThrow();
    expect(()=>assertDirectionCapacity(dirs,boxes,units,'Москва',[{skuId:'a'}])).not.toThrow();
  });
  it('rejects a missing destination and an alien SKU',()=>{
    expect(()=>assertDirectionCapacity(dirs,boxes,units,undefined,[])).toThrow();
    expect(()=>assertDirectionCapacity(dirs,boxes,units,'Москва',[{skuId:'b'}])).toThrow();
  });
});
