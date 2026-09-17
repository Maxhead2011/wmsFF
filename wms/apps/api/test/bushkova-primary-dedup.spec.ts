import { describe, it, expect } from 'vitest';
const { buildPlan, CLIENT, WAREHOUSE } = require('../scripts/bushkova-primary-dedup-20260917.cjs');
const row = (id: string, mode: string, ids = ['100'], quantity = 1) => {
  const item = { id: 'item-'+id, invoiceId: 'inv-'+id, chargeId: id, description: 'Обработка', unit: 'PIECE', quantity: String(quantity), unitPriceRub: '10', totalRub: String(quantity*10), serviceDate: '2026-08-10' };
  return { id, clientId: CLIENT, serviceId: 'service', sourceKey: `fbs-primary:${CLIENT}:WILDBERRIES:connection:${mode}:key:SERVICE:service`, status: 'DRAFT', description: 'Обработка', unit:'PIECE', quantity:String(quantity), unitPriceRub:'10', totalRub:String(quantity*10), serviceDate:'2026-08-10', request:{warehouseId:WAREHOUSE}, metadata:{kind:'FBS_PRIMARY_PROCESSING',orderIds:ids,serviceCode:'CUT',taxMode:'INCLUDED',priceBeforeTaxRub:10}, invoiceItems:[{...item,invoice:{id:'inv-'+id,clientId:CLIENT,number:id,warehouseId:WAREHOUSE,status:'DRAFT',paidRub:'0',payments:[],periodFrom:'2026-08-10',periodTo:'2026-08-10',totalRub:String(quantity*10),items:[item]}}] };
};
const snapshot = () => ({clientId:CLIENT,lifecycleEnabled:true,repeatOrderIds:[],charges:[row('date','date'),row('supply','supply')]});
describe('Bushkova exact primary correction',()=>{
  // TEST: same physical order/service billed by date and by supply must be counted once.
  it('removes only the exact date duplicate and preserves the supply',()=>{
    const s=snapshot(), copy=JSON.stringify(s),p=buildPlan(s);
    expect(p.corrections).toHaveLength(1);expect(p.corrections[0].removeChargeId).toBe('date');expect(p.corrections[0].keepChargeId).toBe('supply');expect(p.decreaseRub).toBe(10);expect(JSON.stringify(s)).toBe(copy);
    expect(p.invoices[0].afterTotalRub).toBe(10);expect(p.invoices[0].afterActiveRub).toBe(0);expect(p.invoices[0].retainedItemIds).toEqual(['item-date']);
  });
  // TEST: every exclusion below protects a financial fact from a false duplicate match.
  it.each(['paid','payment','issued','otherClient','otherBranch','outsidePeriod','partialOrders','quantity','price','tax','attempt','repeat','multipleKeepers','sharedItem','totalMismatch','cancelledKeeper'])('does not change %s',kind=>{
    const s:any=snapshot(),d=s.charges[0],k=s.charges[1],i=d.invoiceItems[0].invoice;
    if(kind==='paid')i.paidRub='1';if(kind==='payment')i.payments=[{status:'CANCELLED'}];if(kind==='issued')i.status='ISSUED';if(kind==='otherClient')d.clientId='other';if(kind==='otherBranch')i.warehouseId='other';if(kind==='outsidePeriod')d.serviceDate='2026-07-31';if(kind==='partialOrders')d.metadata.orderIds.push('101');if(kind==='quantity')d.quantity='2';if(kind==='price')k.unitPriceRub='11';if(kind==='tax')k.metadata.taxMode='ADD_6_PERCENT';if(kind==='attempt')k.metadata.billingAttemptId='repeat';if(kind==='repeat')s.repeatOrderIds=['100'];if(kind==='multipleKeepers')s.charges.push(row('supply2','supply'));if(kind==='sharedItem')d.invoiceItems.push({...d.invoiceItems[0],id:'another'});if(kind==='totalMismatch')i.totalRub='999';if(kind==='cancelledKeeper')k.status='CANCELLED';
    expect(buildPlan(s).corrections).toEqual([]);
  });
  it('rejects disabled lifecycle guard and foreign client snapshot',()=>{expect(()=>buildPlan({...snapshot(),lifecycleEnabled:false})).toThrow();expect(()=>buildPlan({...snapshot(),clientId:'other'})).toThrow();});
  it('leaves mixed drafts unchanged, preserving every unique service',()=>{
    const s=snapshot();const i=s.charges[0].invoiceItems[0].invoice; i.items.push({...i.items[0],id:'unique',chargeId:'unique',totalRub:'17'});i.totalRub='27';
    const p=buildPlan(s);expect(p.corrections).toEqual([]);expect(p.invoices).toEqual([]);
  });
  it('is a no-op after cancellation',()=>{const s=snapshot();s.charges[0].status='CANCELLED';expect(buildPlan(s).corrections).toEqual([]);});
});
