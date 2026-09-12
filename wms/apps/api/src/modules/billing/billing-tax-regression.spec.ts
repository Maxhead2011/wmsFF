import { describe, expect, it, vi } from 'vitest';
import { BillingService } from './billing.service';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';

const user: any = { id: 'u', activeWarehouseId: 'w1', permissionCodes: ['system:admin'], roleCodes: [], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
function storage(mode: string | null = 'ADD_6_PERCENT') {
  const db: any = {
    billingCharge: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(async ({data}) => data) },
    client: { findUnique: vi.fn().mockResolvedValue({storageAccountingEnabled:true,storagePriceRubPerLiterDay:0.06}) },
    clientBillingService: { findUnique: vi.fn().mockResolvedValue(mode ? {isActive:true,priceRub:0.06,taxMode:mode}:null) },
    stockMovement: { findMany: vi.fn().mockResolvedValue([]) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([{warehouseId:'w1',quantity:68,sku:{id:'s',internalSku:'s',name:'s',volumeLiters:1}}]) },
  };
  const service: any = new BillingService(db,new ClientScopeService());
  service.ensureStorageService=vi.fn().mockResolvedValue({id:'storage',defaultPriceRub:0.06});
  return {db,service};
}
describe('gross-up and line rounding',()=>{
  // TEST: storage must apply the configured 6% to the full line and retain its base.
  it('grosses storage up from the base instead of omitting tax',async()=>{
    const {service}=storage();
    const r=await service.generateStorageChargeLocked({clientId:'c',periodFrom:'2026-09-11',periodTo:'2026-09-11'},user);
    expect(Number(r.totalRub)).toBe(4.34);
    expect(r.metadata).toMatchObject({priceBeforeTaxRub:0.06,taxMode:'ADD_6_PERCENT'});
  });
  // TEST: existing clients without an extra-tax tariff keep their original storage amounts.
  it.each([null,'INCLUDED'])('preserves untaxed storage for %s',async mode=>{
    const {service}=storage(mode);
    const r=await service.generateStorageChargeLocked({clientId:'c',periodFrom:'2026-09-11',periodTo:'2026-09-11'},user);
    expect(Number(r.totalRub)).toBe(4.08);
  });
  // TEST: deleting a day must not lose the tax or multiply a rounded fractional rate.
  it('keeps the recorded gross-up when deleting a storage day',async()=>{
    const db:any={billingCharge:{findUnique:vi.fn().mockResolvedValue({id:'charge',clientId:'c',source:'STORAGE',unitPriceRub:0.06,invoiceItems:[],metadata:{priceBeforeTaxRub:0.06,taxMode:'ADD_6_PERCENT',daily:[{date:'2026-09-10',literDays:20,positions:1,totalLiters:20},{date:'2026-09-11',literDays:68,positions:1,totalLiters:68}]}}),update:vi.fn(async({data})=>data)}};
    const service:any=new BillingService(db,new ClientScopeService());
    await service.deleteStorageChargeDayLocked('charge','2026-09-10',user);
    expect(db.billingCharge.update.mock.calls[0][0].data).toMatchObject({quantity:68,totalRub:4.34});
  });
  // TEST: a 68-unit relabel job is 723.40, never 723.52 from a rounded unit price.
  it('rounds the warehouse fulfillment line once',async()=>{
    const db:any={billingService:{},clientBillingService:{},billingCharge:{findFirst:vi.fn().mockResolvedValue(null),create:vi.fn(async ({data})=>data)}};
    const service:any=Object.create(StockOperationsService.prototype);
    service.resolveRequestRelabelUnits=vi.fn().mockResolvedValue(68);
    service.resolveRequestProcessingBreakdown=vi.fn().mockResolvedValue({standardUnits:0,clothingUnits:0});
    service.findConfiguredFulfillmentService=vi.fn().mockResolvedValue({service:{id:'s'},clientPrice:{priceRub:10,taxMode:'ADD_6_PERCENT',isActive:true},priceRequiresConfirmation:false});
    await service.createFulfillmentBillingCharges(db,{request:{id:'r',clientId:'c',items:[]},packages:[],processedUnits:0,user,serviceDate:new Date()});
    expect(db.billingCharge.create).toHaveBeenCalledTimes(1);
    expect(db.billingCharge.create.mock.calls[0][0].data.totalRub).toBe(723.40);
  });
  // TEST: FBS invoices use the same line total, while the display unit remains rounded.
  it.each([['ADD_6_PERCENT',723.40],['INCLUDED',680]])('rounds the FBS invoice using %s',async(mode,expected)=>{
    const db:any={billingInvoice:{findUnique:vi.fn().mockResolvedValue(null),create:vi.fn(async({data})=>({id:'i',...data}))},billingCharge:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn(async({data})=>({id:'charge',...data}))}};
    const service:any=Object.create(MarketplaceConnectionsService.prototype);service.prisma=db;service.nextFbsPrimaryInvoiceNumber=vi.fn().mockResolvedValue('TEST');
    const invoice=await service.ensureFbsPrimaryProcessingInvoiceLocked({clientId:'c',shipmentKey:'shipment',shipmentOrders:[],warehouseId:'w1',shipmentItems:68,serviceDate:new Date(),requestId:null,lines:[{key:'RELABEL',description:'Relabel',quantity:68,unitPriceRub:mode==='INCLUDED'?10:10.64,priceBeforeTaxRub:10,taxMode:mode,serviceId:'s',serviceCode:'RELABEL'}]});
    expect(invoice.totalRub).toBe(expected);
  });
});
