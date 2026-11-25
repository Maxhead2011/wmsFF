import {describe,it,expect} from 'vitest';
import {analyzeFulfillment, type ProductFact} from '../src/modules/analytics/fulfillment-math';
const product=(id:string,extra:Partial<ProductFact>={}):ProductFact=>({skuId:id,name:id,article:id,size:null,color:null,receivedUnits:100,returnedUnits:0,currentUnits:100,availableUnits:80,allocatedUnits:10,openDemandUnits:30,firstReceiptAt:'2026-01-01T00:00:00Z',ageUnitDays:3000,ageKnownUnits:100,shippedAgeUnitDays:100,shippedAgeKnownUnits:10,ledgerUnits:100,...extra});
const options={dateFrom:'2026-08-03',dateTo:'2026-10-25',leadDays:7,reviewDays:7,safetyDays:3,channel:'FBS' as const,asOf:'2026-10-26T09:00:00Z'};
// TEST: classify full weekly demand, keep zero weeks, and reserve promised inventory before replenishment.
describe('fulfillment ABC XYZ and replenishment',()=>{
 it('classifies steady demand, calculates net free stock and replenishment',()=>{
  const daily=Array.from({length:84},(_,i)=>({skuId:'a',date:new Date(Date.UTC(2026,7,3+i)).toISOString().slice(0,10),units:10,requests:1}));
  const r=analyzeFulfillment([product('a')],daily,[],options).items[0];
  expect(r).toMatchObject({shippedUnits:840,abc:'A',xyz:'X',sharePercent:100,freeUnits:60,recommendedUnits:170,toReplenish:110,daysOfStock:6});
 });
 it('does not call an unsold SKU stable X and does not forecast a new SKU',()=>{
  const items=analyzeFulfillment([product('none'),product('new',{firstReceiptAt:'2026-10-20T00:00:00Z'})],[{skuId:'new',date:'2026-10-21',units:5,requests:1}],[],options).items;
  expect(items.find(r=>r.skuId==='none')).toMatchObject({abc:'N',xyz:'N',recommendedUnits:0});
  expect(items.find(r=>r.skuId==='new')).toMatchObject({xyz:null,recommendedUnits:null});
 });
 it('retains zero weeks for intermittent shipments and computes shares before search filtering',()=>{
  const items=analyzeFulfillment([product('a'),product('b')],[{skuId:'a',date:'2026-08-04',units:80,requests:1},{skuId:'b',date:'2026-10-20',units:20,requests:1}],[],options).items;
  expect(items[0]).toMatchObject({abc:'A',xyz:'Z',sharePercent:80});expect(items[1].abc).toBe('B');
 });
 it('does not invent storage age or trust an unreconciled stock ledger',()=>{
  const r=analyzeFulfillment([product('a',{ageKnownUnits:0,shippedAgeKnownUnits:0,ledgerUnits:999})],[],[],options).items[0];
  expect(r.currentStorageDays).toBeNull();expect(r.shippedStorageDays).toBeNull();expect(r.stockoutDays).toBeNull();expect(r.warnings).toContain('STOCK_HISTORY_UNRELIABLE');
 });
 it('does not mix incomplete weeks, future days or FBO batches into a daily replenishment recommendation',()=>{
  const r=analyzeFulfillment([product('a')],[{skuId:'a',date:'2026-08-04',units:10,requests:1}],[],{...options,channel:'FBO'}).items[0];expect(r.recommendedUnits).toBeNull();
  expect(()=>analyzeFulfillment([],[],[],{...options,dateTo:'2026-12-01'})).toThrow();
 });
 it('withholds recommendation and impossible age coverage for inconsistent stock',()=>{
  const p=analyzeFulfillment([product('a',{currentUnits:10,ageKnownUnits:100})],[],[],options).items[0];
  expect(p.recommendedUnits).toBeNull();expect(p.currentAgeCoveragePercent).toBeNull();expect(p.warnings).toContain('INVALID_STOCK');
 });
 it('reconstructs stockout days backwards including movements after the selected period',()=>{
  const p=analyzeFulfillment([product('a',{currentUnits:5,availableUnits:5,ageKnownUnits:0,ledgerUnits:5})],[{skuId:'a',date:'2026-10-24',units:1,requests:1}], [{skuId:'a',date:'2026-10-24',quantity:-10},{skuId:'a',date:'2026-10-26',quantity:5}],options).items[0];
  expect(p.stockoutDays).toBe(2);expect(p.warnings).toContain('STOCKOUT_DEMAND_UNDERESTIMATED');
 });
 it('keeps ABC ties in one class and rejects invalid calendar dates',()=>{
  const items=analyzeFulfillment([product('b'),product('a')],[{skuId:'a',date:'2026-09-01',units:50,requests:1},{skuId:'b',date:'2026-09-01',units:50,requests:1}],[],options).items;
  expect(items.map(p=>p.abc)).toEqual(['A','A']);expect(()=>analyzeFulfillment([],[],[],{...options,dateFrom:'2026-02-30'})).toThrow('Некорректная дата');
 });
 it('does not recommend zero stock when no shipments could be caused by stockouts',()=>{
  const p=analyzeFulfillment([product('a',{currentUnits:0,availableUnits:0,ageKnownUnits:0,ledgerUnits:0})],[],[],options).items[0];
  expect(p.stockoutDays).toBe(84);expect(p.recommendedUnits).toBeNull();expect(p.warnings).toContain('STOCKOUT_DEMAND_UNDERESTIMATED');
 });
});
