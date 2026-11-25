import {expect,it} from 'vitest';
import {groupLamodaDrafts} from './LamodaBatchFields';
const base={skuId:'s',model:'Костюм синий',size:'L',barcode:'4640684268387',article:'MP',composition:'Хлопок 100%',manufacturer:'Фабрика',origin:'РФ, Москва',manufacturedAt:'01.10.2026'};
// TEST: one form per model with shared production data, without mixing different batches.
it('groups sizes but separates different composition/date and model',()=>{
 const groups=groupLamodaDrafts([base,{...base,skuId:'s2',size:'M'},{...base,skuId:'s3',manufacturedAt:'20.11.2026'},{...base,skuId:'s4',model:'Костюм красный'}]);
 expect(groups.map(g=>g.map(x=>x.skuId))).toEqual([['s','s2'],['s3'],['s4']]);
});
