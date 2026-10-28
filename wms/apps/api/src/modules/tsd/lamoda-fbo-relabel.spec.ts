import { describe, expect, it } from 'vitest';
import { resolveLamodaRelabelUnit, lamodaRelabelLabels, assertLamodaRelabelScan, assertLamodaRelabelPacked } from './lamoda-fbo-relabel';

// TEST: warehouse aliases must never become the replacement Lamoda barcode.
describe('Lamoda FBO relabel evidence', () => {
  const line = { barcode:'4640684266611', article:'', destination:'Lamoda', quantity:8 };
  const card = { barcode:line.barcode, remoteSku:'MP002XW1PSOJR520', externalSku:'winter52', skuId:'warehouse52', linkState:'CONFIRMED', isPresent:true, name:'Coat', size:'52' };
  it('freezes the marketplace barcode and exact size', () => {
    expect(lamodaRelabelLabels([line], [card])).toEqual([{skuId:'warehouse52',barcode:line.barcode,article:'MP002XW1PSOJR520',name:'Coat',size:'52'}]);
  });
  it('rejects ambiguous marketplace identities for one warehouse SKU', () => {
    expect(()=>lamodaRelabelLabels([line,{...line,barcode:'4640684266628'}],[card,{...card,barcode:'4640684266628',remoteSku:'other'}])).toThrow();
  });
  it('rejects unconfirmed mappings', () => {
    expect(()=>lamodaRelabelLabels([line],[{...card,linkState:'REVIEW'}])).toThrow();
  });
  it('requires a confirmed print and the exact target scan', () => {
    expect(()=>assertLamodaRelabelScan('target','source','PRINTED')).toThrow();
    for(const state of ['QUEUED','CLAIMED','FAILED',null]) expect(()=>assertLamodaRelabelScan('target','target',state)).toThrow();
    expect(()=>assertLamodaRelabelScan('target','target','PRINTED')).not.toThrow();
  });
  it('blocks old terminals from packing without evidence', () => {
    expect(()=>assertLamodaRelabelPacked(true,null)).toThrow();
    expect(()=>assertLamodaRelabelPacked(true,new Date())).not.toThrow();
    expect(()=>assertLamodaRelabelPacked(false,null)).not.toThrow();
  });
});

// TEST: physical source scan replaces manual unit selection; size and KIZ cannot be guessed.
describe('source scan resolution',()=>{
 const label={skuId:'s52',barcode:'target52',article:'MP52',name:'Coat',size:'52'};
 const unit={id:'a',skuId:'s52',sourceBarcode:'warehouse52',label};
 const lines=[{skuId:'s52',barcode:'warehouse52',barcodes:['alias52']}];
 it('resolves a warehouse alias to the exact target size',()=>expect(resolveLamodaRelabelUnit([unit],lines,'alias52')).toEqual(unit));
 it('does not resolve a marketplace barcode or absent product',()=>{
  expect(()=>resolveLamodaRelabelUnit([unit],lines,'target52')).toThrow();
  expect(()=>resolveLamodaRelabelUnit([],lines,'warehouse52')).toThrow();
 });
 it('rejects the same barcode assigned to different SKUs',()=>expect(()=>resolveLamodaRelabelUnit([unit,{...unit,id:'b',skuId:'s54'}],lines,'warehouse52')).toThrow('разными'));
 it('requires the physical KIZ to choose among marked units',()=>{
  const units=[{...unit,kiz:'mark1'},{...unit,id:'b',kiz:'mark2'}];
  expect(()=>resolveLamodaRelabelUnit(units,lines,'warehouse52')).toThrow('КИЗ');
  expect(()=>resolveLamodaRelabelUnit(units,lines,'warehouse52','wrong')).toThrow();
  expect(resolveLamodaRelabelUnit(units,lines,'warehouse52','mark2').id).toBe('b');
 });
 it('resumes an already queued identical unmarked unit rather than duplicate printing',()=>expect(resolveLamodaRelabelUnit([unit,{...unit,id:'b',printId:'queued'}],lines,'warehouse52').id).toBe('b'));
 it('rejects absent or ambiguous confirmed identities',()=>{
  expect(()=>resolveLamodaRelabelUnit([{...unit,label:null}],lines,'warehouse52')).toThrow('соответствия');
  expect(()=>resolveLamodaRelabelUnit([unit,{...unit,id:'b',label:{...label,barcode:'wrong'}}],lines,'warehouse52')).toThrow();
 });
});
