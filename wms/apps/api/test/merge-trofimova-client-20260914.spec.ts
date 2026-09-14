import { describe, it, expect } from 'vitest';
const {buildPlan, canonical, SOURCE, TARGET, OLD_CONNECTION, CONNECTION, SKU_MAP, merge, validateApplyGate} = require('../src/scripts/merge-trofimova-client-20260914.cjs');

function fixture(): Record<string, any[]> {
  return {
    Client:[{id:SOURCE,code:'00-00000020',status:'ARCHIVED'},{id:TARGET,code:'CL-000009',status:'ACTIVE',inn:'753504978331'}],
    ClientMarketplaceConnection:[{id:OLD_CONNECTION,clientId:SOURCE,marketplace:'WB',apiKey:'test-only'},{id:CONNECTION,clientId:TARGET,marketplace:'WB',apiKey:'test-only'}],
    Sku:Object.entries(SKU_MAP).flatMap(([a,b],i)=>[{id:a,clientId:SOURCE,internalSku:`sku${i}`,name:'item'},{id:b,clientId:TARGET,internalSku:`sku${i}`,name:'item'}]),
    Barcode:Object.entries(SKU_MAP).flatMap(([a,b],i)=>[{id:`old-barcode${i}`,skuId:a,value:`bar${i}`},{id:`new-barcode${i}`,skuId:b,value:`bar${i}`}]),
    ClientFbsBillingSettings:[{id:'old-settings',clientId:SOURCE,price:10},{id:'new-settings',clientId:TARGET,price:10}],
    BillingCharge:[{id:'old-charge',clientId:SOURCE,sourceKey:`fbs:${SOURCE}:${OLD_CONNECTION}:2026-08-01`,status:'DRAFT',totalRub:100},
      {id:'new-charge',clientId:TARGET,sourceKey:`fbs:${TARGET}:${CONNECTION}:2026-08-01`,status:'DRAFT',totalRub:100}],
    BillingInvoice:[{id:'old-invoice',clientId:SOURCE,totalRub:100,paidRub:0,number:'FBS-001'}],
    BillingInvoiceItem:[{id:'line',chargeId:'old-charge',invoiceId:'old-invoice',quantity:1,totalRub:100}],
    FbsTsdAssembly:[{id:'old-task',clientId:SOURCE,marketplace:'WB',orderId:'1',status:'WAITING_STOCK'},
      {id:'new-task',clientId:TARGET,marketplace:'WB',orderId:'1',status:'COMPLETED',kiz:'real-kiz'}],
    ClientRequest:[{id:'old-request',clientId:SOURCE,status:'CANCELLED',warehouseId:'Moscow'}],
    FbsOrderRequestLink:[{id:'old-link',clientId:SOURCE,marketplace:'WB',orderId:'1',requestId:'old-request'},
      {id:'new-link',clientId:TARGET,marketplace:'WB',orderId:'1',requestId:'new-request'}],
    StockMovement:[{id:'movement',clientId:SOURCE,skuId:Object.keys(SKU_MAP)[0],quantity:-3,status:'SHIPPING',idempotencyKey:'immutable'}],
    FbsStockMonitorEvent:[{id:'old-event',clientId:SOURCE,eventKey:`${OLD_CONNECTION}:${Object.keys(SKU_MAP)[0]}:1:SALE`},
      {id:'new-event',clientId:TARGET,eventKey:`${CONNECTION}:${Object.values(SKU_MAP)[0]}:1:SALE`}],
    FbsStockMonitorHistory:[{id:'history',eventId:'old-event',status:'ERROR'}],
    UserClient:[{userId:'collector',clientId:SOURCE,canRead:true,canWrite:true}],
  };
}

describe('Trofimova one-off merge safety',()=>{
  // TEST: reproduces unique(clientId, internalSku)/sourceKey collisions in a naive clientId-only merge.
  it('deduplicates identical entities instead of double-counting',()=>{
    const plan=buildPlan(fixture());
    expect(plan.filter((p:any)=>p.table==='Sku'&&p.op==='delete')).toHaveLength(3);
    expect(plan.find((p:any)=>p.table==='BillingCharge'&&p.key.id==='old-charge')?.op).toBe('delete');
    expect(plan.some((p:any)=>p.op==='insert')).toBe(false);
  });
  // TEST: invoice totals/payments/identities are untouched, only chargeId and clientId change.
  it('preserves invoice and reconnects the original line before removing duplicate charge',()=>{
    const p=buildPlan(fixture());
    const line=p.findIndex((p:any)=>p.table==='BillingInvoiceItem');
    const charge=p.findIndex((p:any)=>p.table==='BillingCharge');
    expect(line).toBeLessThan(charge);
    expect(p[line].data).toEqual({chargeId:'new-charge'});
    expect(p.find((p:any)=>p.table==='BillingInvoice').data).toEqual({clientId:TARGET});
  });
  it('never changes stock quantity or canonical task',()=>{
    const p=buildPlan(fixture());
    expect(p.find((p:any)=>p.table==='StockMovement').data).toEqual({clientId:TARGET,skuId:Object.values(SKU_MAP)[0]});
    expect(p.some((p:any)=>p.key.id==='new-task'||p.table==='StockBalance')).toBe(false);
  });
  it.each(['RESERVED','IN_PROGRESS','COMPLETED'])('refuses source tasks in %s',status=>{
    const f=fixture();f.FbsTsdAssembly[0].status=status;
    expect(()=>buildPlan(f)).toThrow('Source task is active');
  });
  it.each(['kiz','startedAt','reservedBoxId','completedAt','boxId','marketplaceSubmittedAt'])('refuses physical evidence %s',field=>{
    const f=fixture();f.FbsTsdAssembly[0][field]='evidence';expect(()=>buildPlan(f)).toThrow('physical evidence');
  });
  it('rejects unknown billing differences and duplicate invoicing',()=>{
    const f=fixture();f.BillingCharge[1].totalRub=101;expect(()=>buildPlan(f)).toThrow('Unapproved billing');
    const g=fixture();g.BillingInvoiceItem.push({id:'second',chargeId:'new-charge'});expect(()=>buildPlan(g)).toThrow('Both charges are invoiced');
  });
  it('keeps approved canonical amounts without rewriting them',()=>{
    const f=fixture();f.BillingInvoiceItem=[];
    Object.assign(f.BillingCharge[0],{id:'0b51d3cb-e90e-4e58-924f-b46995fed0f7',totalRub:1902.13});
    Object.assign(f.BillingCharge[1],{id:'2252a192-c2bd-4fba-a01e-35ebf3a366b1',totalRub:1881.38});
    expect(buildPlan(f).filter((p:any)=>p.table==='BillingCharge')).toEqual([{op:'delete',table:'BillingCharge',key:{id:f.BillingCharge[0].id}}]);
  });
  it('retains monitor history and existing read/write permissions',()=>{
    const p=buildPlan(fixture());
    expect(p.find((p:any)=>p.table==='FbsStockMonitorHistory').data).toEqual({eventId:'new-event'});
    expect(p.find((p:any)=>p.table==='UserClient').data).toEqual({clientId:TARGET});
  });
  it('fails closed for new dependencies and different accounts',()=>{
    const f=fixture();f.StockBalance=[{id:'new-stock',clientId:SOURCE}];expect(()=>buildPlan(f)).toThrow('Unreviewed references');
    const g=fixture();g.ClientMarketplaceConnection[1].apiKey='another';expect(()=>buildPlan(g)).toThrow('Different marketplace accounts');
  });
  it('does not remove links from active source requests',()=>{
    const f=fixture();f.ClientRequest[0].status='SUBMITTED';expect(()=>buildPlan(f)).toThrow('non-cancelled');
  });
  it('canonicalizes client, connection and sku identities inside deduplication keys',()=>{
    expect(canonical(`${SOURCE}:${OLD_CONNECTION}:${Object.keys(SKU_MAP)[0]}`)).toBe(`${TARGET}:${CONNECTION}:${Object.values(SKU_MAP)[0]}`);
  });
  it('is idempotent when the committed audit marker already exists',async()=>{
    const tx={$executeRawUnsafe:async()=>0,$queryRawUnsafe:async()=>[{id:'committed'}]};
    const db={$transaction:async(fn:any)=>fn(tx)};
    expect(await merge(db)).toEqual({alreadyApplied:true});
  });
  // TEST: loaded background responses must be drained before deleting their parent client.
  it('requires the old connection disabled AND explicit drain confirmation',()=>{
    const f=fixture();f.ClientMarketplaceConnection[0].isActive=true;
    expect(()=>validateApplyGate(f,OLD_CONNECTION)).toThrow('Disable and drain');
    f.ClientMarketplaceConnection[0].isActive=false;
    expect(()=>validateApplyGate(f,undefined)).toThrow('drain confirmation');
    expect(()=>validateApplyGate(f,CONNECTION)).toThrow('drain confirmation');
    expect(()=>validateApplyGate(f,OLD_CONNECTION)).not.toThrow();
  });
});
