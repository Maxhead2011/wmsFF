import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { LamodaStockReview, reviewLamodaQuantities } from './LamodaStockReview';
import { createLamodaAssembly, type LamodaPreview } from '../../lib/api';
const preview: LamodaPreview = {canAdjust:true,canAssemble:false,message:'Проверка',unresolvedRows:[],availability:{lines:[
  {skuId:'s',name:'Костюм',article:'Зима',size:'52',barcode:'12345678',requestedQuantity:8,reservedQuantity:3,availableQuantity:5,shortageQuantity:3},
  {skuId:'absent',name:'Платье',barcode:'87654321',requestedQuantity:2,reservedQuantity:0,availableQuantity:0,shortageQuantity:2},
]}};
afterEach(()=>vi.unstubAllGlobals());
// TEST: shortages are visible before a request exists; rendering never creates demand.
it('shows identifiers, reserves, deficits and a disabled create button for the original demand',()=>{
  const onCreate=vi.fn();const html=renderToStaticMarkup(<LamodaStockReview preview={preview} title="План" disabled={false} onCreate={onCreate}/>);
  for(const text of ['12345678','52','Зима','В резервах','Дефицит плана','Скорректировать по доступному остатку']) expect(html).toContain(text);
  expect(html).toMatch(/class="lamoda-stock-create" disabled=""/);expect(onCreate).not.toHaveBeenCalled();
});
it('only permits nonempty explicit quantities within both the plan and current free stock',()=>{
  const lines=preview.availability!.lines;
  expect(reviewLamodaQuantities(lines,{s:'5',absent:'0'})).toEqual({valid:true,total:5,quantities:[{skuId:'s',quantity:5},{skuId:'absent',quantity:0}]});
  for(const value of ['8','-1','1.5','','NaN','0']) expect(reviewLamodaQuantities(lines,{s:value,absent:'0'}).valid).toBe(false);
  expect(reviewLamodaQuantities([{...lines[0],availableQuantity:20}],{s:'9'}).valid).toBe(false);
});
it('keeps creation disabled for unresolved mappings and disabled access',()=>{
  const available={...preview,canAssemble:true,availability:{lines:[{...preview.availability!.lines[0],availableQuantity:8,shortageQuantity:0}]}};
  for(const p of [{...available,canAdjust:false},{...available,unresolvedRows:[2]}]) {
    expect(renderToStaticMarkup(<LamodaStockReview preview={p} title="План" disabled={false} onCreate={()=>{}}/>)).toMatch(/class="lamoda-stock-create" disabled=""/);
  }
  expect(renderToStaticMarkup(<LamodaStockReview preview={available} title="План" disabled={true} onCreate={()=>{}}/>)).toMatch(/class="lamoda-stock-create" disabled=""/);
});
it('sends the reviewed quantities, including exclusions, in the authenticated create request',async()=>{
  const fetcher=vi.fn(async(_url:string,_init:RequestInit)=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);
  const quantities=[{skuId:'s',quantity:5},{skuId:'absent',quantity:0}];
  await createLamodaAssembly('token','a','p',quantities);
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',body:JSON.stringify({quantities}),headers:expect.objectContaining({Authorization:'Bearer token'})});
});
