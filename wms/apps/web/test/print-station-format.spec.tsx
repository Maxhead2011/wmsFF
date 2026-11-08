import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {StationFormat} from '../src/components/print/PrintStationFormatPanel';
const h=vi.hoisted(()=>({slots:[] as any[],cursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState(initial:any){const i=h.cursor++;if(!(i in h.slots))h.slots[i]=initial;return [h.slots[i],(v:any)=>{h.slots[i]=v;}];}}));
function render(){h.cursor=0;return StationFormat({station:{id:'ozon',name:'ОЗОН',printerName:'TSC TE200',labelWidthMm:58,labelHeightMm:40},token:'test'});}
function nodes(t:any,type:string):any[]{if(!t||typeof t!=='object')return [];if(Array.isArray(t))return t.flatMap(x=>nodes(x,type));return [...(t.type===type?[t]:[]),...nodes(t.props?.children,type)];}
afterEach(()=>{h.slots=[];vi.unstubAllGlobals();});
// TEST: exercise the actual selector and submit handler, including custom media.
it('selects Ozon 70 wide / 120 long and persists it to the chosen station',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 nodes(render(),'select')[0].props.onChange({target:{value:'70x120'}});
 expect(nodes(render(),'input').map(x=>x.props.value)).toEqual([70,120]);
 await render().props.onSubmit({preventDefault(){}});
 expect(fetch.mock.calls[0][0]).toContain('/stations/ozon/format');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({widthMm:70,heightMm:120});
});
it('custom selection retains entered dimensions and failed saves report the error',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({message:'Филиал недоступен'})}));
 nodes(render(),'select')[0].props.onChange({target:{value:'custom'}});
 expect(nodes(render(),'input').map(x=>x.props.value)).toEqual([58,40]);
 await render().props.onSubmit({preventDefault(){}});
 expect(nodes(render(),'p')[0].props.children).toBe('Филиал недоступен');
});
