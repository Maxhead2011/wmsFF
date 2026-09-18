import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FboTwoStagePanel, selectFboLocation } from './FboTwoStagePanel';
import type { FboPlan } from '../../lib/api';

const base:FboPlan={requestId:'r',title:'1029',phase:'PACKING',needed:2,picked:2,packed:2,looseRemaining:0,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[{code:'FFL_1',quantity:2,wholeBox:false,closed:true,confirmed:false}]};
const render=(plan:FboPlan)=>renderToStaticMarkup(<FboTwoStagePanel initial={plan} accessToken="test" userId="picker" canWrite onClose={()=>{}}/>);
describe('FBO packing and final box control',()=>{
  it('offers box sorting completion before final verification and keeps WB export unavailable',()=>{
    // TEST: closing parcels is not proof that all shipment boxes were scanned.
    const html=render(base);expect(html).toContain('Сканировать все короба поставки');expect(html).not.toContain('Скачать состав для WB');expect(html).not.toContain('Скачать распределение по коробам для WB');
  });
  it('requires each closed box to be scanned before the final button is enabled',()=>{
    const html=render({...base,phase:'CONTROL'});expect(html).toContain('Подтверждено коробов 0 из 1');
    expect(html).toMatch(/disabled="">Завершить проверку и сформировать файлы WB/);
  });
  it('offers the WB workbook only for the completed shipment',()=>{
    const html=render({...base,phase:'COMPLETED'});expect(html).toContain('Скачать состав для WB');expect(html).toContain('Скачать распределение по коробам для WB');
  });
  it('opens only the selected pallet boxes, with a direct scan for boxes without a pallet',()=>{
    const route=[{boxCode:'FFL_1',pallet:'PALET_SORT_27',zone:'2',tasks:[],wholeBox:false,recount:false},{boxCode:'FFL_2',pallet:'PALET_SORT_28',zone:'2',tasks:[],wholeBox:false,recount:false},{boxCode:'FFL_3',pallet:'',zone:'',tasks:[],wholeBox:false,recount:false}];
    expect(selectFboLocation(route,'','FFL_1')).toBeNull();
    expect(selectFboLocation(route,'','PALET_SORT_27')).toEqual({pallet:'PALET_SORT_27',source:''});
    expect(selectFboLocation(route,'PALET_SORT_27','FFL_2')).toBeNull();
    expect(selectFboLocation(route,'PALET_SORT_27','ffl_1')).toEqual({pallet:'PALET_SORT_27',source:'FFL_1'});
    expect(selectFboLocation(route,'','FFL_3')).toEqual({pallet:'',source:'FFL_3'});
  });
});
