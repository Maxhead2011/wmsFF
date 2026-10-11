import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FbsManualAssemblyResults } from './FbsManualAssemblyPanel';
import { defaultManualFbsChoices, manualFbsChoicesReady, parseManualFbsOrders, type ManualFbsPreview } from '../../lib/fbs-manual-assembly';
const preview:ManualFbsPreview={token:'token',canCreate:true,expiresAt:'2026-10-11T13:00:00Z',rows:['11','12'].map(orderId=>({
  orderId,skuId:'sku',article:'Зима_реглан_черный',size:'M / 46',supplyId:'WB-'+orderId,supplierStatus:'confirm',wbStatus:'waiting',
  blockers:[],free:2,boxes:[{boxId:'box1',boxCode:'FFL_LKBBOX_0142',palletCode:'PALET_SORT_1001',free:1},{boxId:'box2',boxCode:'BOX2',palletCode:'SORT2',free:1}]}))};
// TEST: actual preview renderer, input parsing and shared stock selection.
describe('manual FBS panel',()=>{
  it('shows each source supply, size, quantities and pallet without merging WB supplies',()=>{
    const html=renderToStaticMarkup(createElement(FbsManualAssemblyResults,{preview,choices:defaultManualFbsChoices(preview.rows),disabled:false,onChoose:()=>{}}));
    for(const text of ['WB-11','WB-12','M / 46','FFL_LKBBOX_0142','PALET_SORT_1001','К сборке: 1 шт.'])expect(html).toContain(text);
    expect(html).toContain('Короб для заказа 11');expect(html).toContain('Короб для заказа 12');
  });
  it('distributes two orders across two one-unit boxes and rejects manual over-allocation',()=>{
    const choices=defaultManualFbsChoices(preview.rows);expect(choices.map(c=>c.boxId)).toEqual(['box1','box2']);
    expect(manualFbsChoicesReady(preview,choices)).toBe(true);
    expect(manualFbsChoicesReady(preview,choices.map(c=>({...c,boxId:'box1'})))).toBe(false);
  });
  it('shows blockers in place of a misleading box selector',()=>{
    const blocked={...preview,canCreate:false,token:null,rows:preview.rows.map(r=>({...r,blockers:['Приёмка только ФБО']}))};
    const html=renderToStaticMarkup(createElement(FbsManualAssemblyResults,{preview:blocked,choices:[],disabled:false,onChoose:()=>{}}));
    expect(html).toContain('Приёмка только ФБО');expect(html).not.toContain('<select');expect(manualFbsChoicesReady(blocked,[])).toBe(false);
  });
  it('accepts pasted lines and rejects repeated or malformed numbers',()=>{
    expect(parseManualFbsOrders('5996192771\n5996851459')).toEqual(['5996192771','5996851459']);
    for(const text of ['11,11','1e5','','12x','9007199254740992'])expect(()=>parseManualFbsOrders(text)).toThrow();
  });
});
