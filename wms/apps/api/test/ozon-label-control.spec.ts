import {afterEach,it,expect,vi} from 'vitest';
import {ozonLabelReceipt,ozonBoxLabelConfirmed,confirmOzonBoxLabel} from '../src/modules/tsd/ozon-label-control';
const box={id:'b',boxCode:'FFL_1',direction:'Москва',confirmedAt:new Date()};
const make=()=>({mapping:{Москва:'s'},frozenHash:'hash',operations:{s:{state:'SUCCESS',labelUrl:'https://ozon.ru/label',cargoes:[{key:'b',cargoId:'1000000000064215123'}]}}});
// TEST: exact string identity, legacy checks cannot bypass pair control.
it('requires an exact mapped cargo identity and successful printed-label receipt',()=>{
 const link:any=make();expect(ozonLabelReceipt(link,box).cargoId).toBe('1000000000064215123');expect(ozonBoxLabelConfirmed(link,box)).toBe(false);
 link.boxLabelChecks={b:{cargoId:'1000000000064215123',supplyId:'s',frozenHash:'hash',at:'now',userId:'u'}};expect(ozonBoxLabelConfirmed(link,box)).toBe(true);
 link.operations.s.cargoes[0].cargoId='1000000000064215122';expect(ozonBoxLabelConfirmed(link,box)).toBe(false);
});
it('rejects missing, unknown and duplicate cargo mappings',()=>{
 for(const mutate of [(l:any)=>l.operations.s.state='UNKNOWN',(l:any)=>delete l.operations.s.labelUrl,(l:any)=>l.operations.s.cargoes.push({key:'other',cargoId:'1000000000064215123'}),(l:any)=>l.mapping.Москва='other']){
  const l:any=make();mutate(l);expect(()=>ozonLabelReceipt(l,box)).toThrow();
 }
});

// TEST: wrong stickers cannot persist confirmation; audit contains the actual scanned pair.
it('rejects a different sticker before writes and records the exact successful pair',async()=>{
 const tx:any={ozonFboShipment:{update:vi.fn()},clientRequestEvent:{create:vi.fn()}},shipment={requestId:'r',clientId:'c',integration:make()};
 await expect(confirmOzonBoxLabel(tx,shipment,box,'1000000000064215122','u')).rejects.toThrow('не соответствует');expect(tx.ozonFboShipment.update).not.toHaveBeenCalled();
 await confirmOzonBoxLabel(tx,shipment,box,'1000000000064215123','u');
 expect(tx.ozonFboShipment.update.mock.calls[0][0].data.integration.boxLabelChecks.b).toMatchObject({cargoId:'1000000000064215123',userId:'u',supplyId:'s',frozenHash:'hash'});
 expect(tx.clientRequestEvent.create.mock.calls[0][0].data).toMatchObject({requestId:'r',clientId:'c',createdByUserId:'u'});
});
