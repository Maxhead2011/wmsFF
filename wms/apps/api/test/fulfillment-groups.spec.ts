import {describe,it,expect} from 'vitest';
import {identifyFulfillmentProduct,groupFulfillment} from '../src/modules/analytics/fulfillment-groups';
import {analyzeFulfillment,type ProductFact} from '../src/modules/analytics/fulfillment-math';
const p=(id:string,extra:any={}):ProductFact=>({skuId:id,name:id,article:id,color:null,size:null,receivedUnits:100,returnedUnits:0,currentUnits:100,availableUnits:100,allocatedUnits:0,openDemandUnits:0,firstReceiptAt:'2026-01-01T00:00:00Z',ageUnitDays:1000,ageKnownUnits:100,shippedAgeUnitDays:0,shippedAgeKnownUnits:0,ledgerUnits:100,...extra});
const o={dateFrom:'2026-08-03',dateTo:'2026-10-25',leadDays:7,reviewDays:7,safetyDays:3,channel:'FBS' as const,asOf:'2026-10-26T09:00:00Z'};
// TEST: actual catalog shapes; categories are not model identifiers and variants are not interchangeable stock.
describe('fulfillment model hierarchy',()=>{
 it('groups Nostalgie across color and optional garment prefix without merging another model',()=>{
  const a=identifyFulfillmentProduct(p('a',{article:'Костюм_ностальджи_молочнокоричневый',color:'коричневый,молочный',size:'S / 42'}));
  const b=identifyFulfillmentProduct(p('b',{article:'Ностальджи_синий',color:'синий,темно-синий',size:'M / 44'}));
  expect(a.modelKey).toBe(b.modelKey);expect(a.colorKey).not.toBe(b.colorKey);
  expect(a.modelKey).not.toBe(identifyFulfillmentProduct(p('c',{article:'Зима_флис_кулиска_сливочмасло'})).modelKey);
 });
 it('recognizes Kubrin named models and infers only explicit article size',()=>{
  const a=identifyFulfillmentProduct(p('a',{article:'брюки/ольга/бежев/50',size:'50 / 50'}));
  const b=identifyFulfillmentProduct(p('b',{article:'брюки/ольга/корич/62'}));
  expect(a.modelKey).toBe(b.modelKey);expect(b.size).toBe('62');expect(b.color).toBe('коричневый');
  expect(a.modelKey).not.toBe(identifyFulfillmentProduct(p('c',{article:'плат/ольга/бежев/50'})).modelKey);
  expect(identifyFulfillmentProduct(p('d',{article:'плат/диана/бирюза/5460'})).size).toBeNull();
 });
 it('preserves Eletskaya model codes while removing explicit color variants',()=>{
  const a=identifyFulfillmentProduct(p('a',{article:'К-Ч-З-003Серый',color:'серый,светло-серый'}));
  const b=identifyFulfillmentProduct(p('b',{article:'К-Ч-З-003Черный',color:'черный'}));
  expect(a.modelKey).toBe(b.modelKey);
  expect(a.modelKey).not.toBe(identifyFulfillmentProduct(p('c',{article:'К-Ч-З-004Серый',color:'серый'})).modelKey);
  const compact=identifyFulfillmentProduct(p('d',{name:'Брюки женские классические',article:'БрюкиБеж-42'}));
  expect(compact).toMatchObject({model:'брюки',color:'бежевый',size:'42'});
 });
 it('retains Pro, capacity and specification differences for Korolev',()=>{
  const a=identifyFulfillmentProduct(p('a',{name:'Интегрированная система FMS-X1 Black',article:'1016434618',color:'черный'}));
  const b=identifyFulfillmentProduct(p('b',{name:'Интегрированная система FMS-X1 White',article:'1016448709',color:'голубой'}));
  const pro=identifyFulfillmentProduct(p('p',{name:'Интегрированная система FMS-X1 Pro',article:'1016462802'}));
  expect(a.kind).toBe('Системы приготовления еды');expect(a.modelKey).toBe(b.modelKey);expect(pro.modelKey).not.toBe(a.modelKey);
  expect(b.warnings).toContain('GROUP_COLOR_CONFLICT');
  expect(identifyFulfillmentProduct(p('c',{name:'Аккумулятор 550 mAh 1S',article:'550mAh'})).modelKey).not.toBe(identifyFulfillmentProduct(p('d',{name:'Аккумулятор 750 mAh 1S',article:'750mAh'})).modelKey);
 });
 it('groups fabric material and color while retaining cut length',()=>{
  const a=identifyFulfillmentProduct(p('a',{name:'Ткань габардин 1 метр',article:'gab_black_1'}));
  const b=identifyFulfillmentProduct(p('b',{name:'Ткань габардин 10 метров',article:'gab_white_10'}));
  expect(a.modelKey).toBe(b.modelKey);expect(a.colorKey).not.toBe(b.colorKey);expect(b.lengthMetres).toBe(10);
 });
 it('does not merge missing articles or unrelated products with a generic title',()=>{
  const a=identifyFulfillmentProduct(p('a',{name:'Костюм',article:null}));
  const b=identifyFulfillmentProduct(p('b',{name:'Костюм',article:null}));
  expect(a.modelKey).not.toBe(b.modelKey);expect(a.warnings).toContain('GROUP_MODEL_UNKNOWN');
 });
 it('skips artificial color and size levels and marks unconfirmed request counts unknown',()=>{
  const products=[p('a',{name:'Аккумулятор 500mAh',article:'500mAh'})],daily=[{skuId:'a',date:'2026-08-03',units:10,requests:1}];
  const result=groupFulfillment(products,daily,[],o,analyzeFulfillment(products,daily,[],o).items);
  expect(result.model[0].children).toEqual(['a']);expect(result.model[0].shipmentRequests).toBeNull();
 });
 it('recalculates weekly demand, deduplicates requests and sums independent deficits',()=>{
  const products=[p('a',{article:'Ностальджи_синий',currentUnits:1000,availableUnits:1000,ledgerUnits:1000}),p('b',{article:'Костюм_ностальджи_черный',currentUnits:0,availableUnits:0,ageKnownUnits:0,ledgerUnits:0})];
  const daily=Array.from({length:84},(_,i)=>({skuId:i%2?'a':'b',date:new Date(Date.UTC(2026,7,3+i)).toISOString().slice(0,10),units:10,requests:1,requestIds:['request-'+i]}));
  daily.push({...daily[0],skuId:'a',units:1});
  const base=analyzeFulfillment(products,daily,[],o);const grouped=groupFulfillment(products,daily,[],o,base.items);
  const model=grouped.model[0];expect(model.shippedUnits).toBe(841);expect(model.shipmentRequests).toBe(84);expect(model.shippingDays).toBe(84);expect(model.xyz).toBe('X');
  expect(model.toReplenish).toBe(base.items.reduce((n,x)=>n+(x.toReplenish??0),0));expect(model.toReplenish).toBeGreaterThan(0);expect(model.children).toHaveLength(2);
  expect(grouped.model.reduce((n,x)=>n+x.currentUnits,0)).toBe(base.summary.currentUnits);
 });
});
