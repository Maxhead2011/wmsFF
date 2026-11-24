import { expect, it } from 'vitest';
import { fitLabel, labelPages } from './fileLabel';
import { blockText, defaultLabel, wrapText } from './freeLabel';
// TEST: portrait/landscape fit, page selection, independent counters and explicit line breaks.
it('fits a landscape document without cropping or distortion',()=>{expect(fitLabel(200,100,60,40)).toEqual({x:0,y:5,width:60,height:30});expect(fitLabel(100,200,60,40)).toEqual({x:20,y:0,width:20,height:40});});
it('validates page ranges and removes accidental duplicates',()=>{expect(labelPages('1,3-5,3',5)).toEqual([1,3,4,5]);expect(labelPages('',2)).toEqual([1,2]);expect(()=>labelPages('0,2',2)).toThrow();expect(()=>labelPages('1-999999',2)).toThrow();});
it('numbers each field separately without changing literal text',()=>{const b=defaultLabel().blocks[0];expect(blockText({...b,counter:true,text:'BOX-',start:8,step:2,digits:3},2)).toBe('BOX-012');expect(blockText(b,99)).toBe('ФБО');});
it('keeps newlines and wraps text to field width',()=>{expect(wrapText('АБВ\nГД',2,s=>s.length)).toEqual(['АБ','В','ГД']);});
