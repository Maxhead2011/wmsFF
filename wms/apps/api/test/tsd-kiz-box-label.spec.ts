import {expect,it,vi} from 'vitest';
import {kizBoxLabelDefinition} from '../src/modules/tsd/tsd-kiz-box-label';
import bwipjs = require('bwip-js');
// TEST: missing placement has bold text on 58x40, with no invented machine-readable code.
it('prints a text-only missing-pallet label',()=>{const spy=vi.spyOn(bwipjs,'toSVG');spy.mockClear();const doc=kizBoxLabelDefinition('ПАЛЕТ НЕ ОПРЕДЕЛЕН','ПАЛЛЕТ-СОРТ') as any;expect(spy).not.toHaveBeenCalled();expect(doc.defaultStyle.bold).toBe(true);expect(doc.pageSize.width/doc.pageSize.height).toBeCloseTo(58/40);expect(doc.content).toEqual([expect.objectContaining({text:'ПАЛЕТ\nНЕ ОПРЕДЕЛЕН'})]);spy.mockRestore();});
// TEST: box and pallet identifiers must encode QR inside 58x40 with unbroken bold text.
it.each(['FFL_LKB2710_173','VP_PALET_SORT_086'])('prints QR for %s',code=>{
 const spy=vi.spyOn(bwipjs,'toSVG');
 const doc=kizBoxLabelDefinition(code,'') as any;
 expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({bcid:'qrcode',text:code}));
 expect(doc.pageSize.width/doc.pageSize.height).toBeCloseTo(58/40);
 expect(doc.defaultStyle.bold).toBe(true);
 expect(doc.content[1].width).toBe(doc.content[1].height);
 expect(doc.content[2]).toMatchObject({text:code,noWrap:true});
 spy.mockRestore();
});
