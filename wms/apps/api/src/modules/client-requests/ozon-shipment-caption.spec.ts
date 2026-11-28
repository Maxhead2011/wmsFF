import {describe,it,expect} from 'vitest';
import {ozonShipmentCaptions} from './ozon-shipment-caption';
const link=()=>({frozenHash:'hash',orders:[{orderId:'1',orderNumber:'A',date:'2026-11-28T14:00:00Z',supplies:[{id:'a'},{id:'b'}]}],operations:{a:{state:'SUCCESS',cargoes:[{cargoId:'11'}]},b:{state:'SUCCESS',cargoes:[{cargoId:'12'}]}}} as any);
describe('Ozon shipment caption',()=>{
 // TEST: editing deadlines are not handover dates; all cargo acknowledgements are required.
 it('uses confirmed cargoes and the Ozon handover date',()=>{expect(ozonShipmentCaptions(link())[0]).toMatchObject({readyToShip:true,handoverAt:'2026-11-28T14:00:00Z'});});
 it.each(['QUEUED','SENDING','UNKNOWN','ACCEPTED','FAILED'])('does not mark partial %s transfer ready',state=>{const l=link();l.operations.b.state=state;expect(ozonShipmentCaptions(l)[0].readyToShip).toBe(false);});
 it('requires frozen composition and nonempty confirmed cargoes',()=>{for(const change of [(l:any)=>delete l.frozenHash,(l:any)=>l.operations.b.cargoes=[],(l:any)=>l.orders[0].supplies=[]]){const l=link();change(l);expect(ozonShipmentCaptions(l)[0].readyToShip).toBe(false);}});
 it('does not let one order hide another order pending transfer',()=>{const l=link();l.orders.push({orderId:'2',orderNumber:'B',supplies:[{id:'c'}]});expect(ozonShipmentCaptions(l).map(o=>o.readyToShip)).toEqual([true,false]);});
});
