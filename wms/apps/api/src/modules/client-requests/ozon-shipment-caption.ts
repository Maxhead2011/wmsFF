import {supplyOrders,type SupplyIntegration} from './ozon-supply-policy';

// FIX: readiness is per Ozon order, and requires confirmed cargoes for every supply.
export function ozonShipmentCaptions(link:SupplyIntegration){
 return supplyOrders(link).map(o=>({orderId:o.orderId,orderNumber:o.orderNumber,editDeadlineAt:o.editDeadlineAt??null,checkedAt:o.checkedAt,
  handoverAt:o.date||null,
  readyToShip:!!link.frozenHash&&o.supplies.length>0&&o.supplies.every(s=>{
   const op=link.operations?.[s.id];
   return op?.state==='SUCCESS'&&!op.error&&!!op.cargoes?.length&&op.cargoes.every(c=>!!c.cargoId);
  })}));
}
