import { describe, expect, it } from 'vitest';
import { lamodaRelabelLabels, assertLamodaRelabelScan, assertLamodaRelabelPacked } from './lamoda-fbo-relabel';

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
