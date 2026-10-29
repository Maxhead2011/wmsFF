import { describe, it, expect } from 'vitest';
import { buildActualLamodaShipment, actualLamodaWorkbook, buildActualLamodaTemplate } from '../src/modules/lamoda/lamoda-actual-shipment';
import * as XLSX from 'xlsx';
// TEST: export actual packed units, never substitute planned quantities or warehouse identifiers.
const fixture=()=>({externalShipmentId:'UPD-1',warehouseCode:'BYKOVO',plannedDate:'2026-11-01',
 units:[{id:'u1',skuId:'s',state:'PACKED',targetBoxId:'b',kiz:null,requiresKiz:false}],
 boxes:[{boxId:'b',closedAt:new Date(),confirmedAt:new Date()}],
 identities:[{skuId:'s',externalSku:'LAMODA-S',ean:'4600000000001',priceMinor:12345}],
});
describe('Lamoda actual shipment',()=>{
 // TEST: warehouse staff can export verified facts without inventing commercial prices/dates.
 it('exports factual rows with blank prices and shipment headers',()=>{const x=fixture();const book=XLSX.read(buildActualLamodaTemplate({...x,identities:x.identities.map(({priceMinor,...i})=>i)}),{type:'buffer'});const rows=XLSX.utils.sheet_to_json(book.Sheets['Лист1'],{header:1,defval:''}) as any[];expect(rows[0][1]).toBe('');expect(rows[1][1]).toBe('');expect(rows[4]).toEqual(['LAMODA-S',1,'','4600000000001','','']);});
 it('template still rejects unchecked boxes',()=>{const x=fixture();x.boxes[0].confirmedAt=null as any;expect(()=>buildActualLamodaTemplate(x)).toThrow();});
 it('keeps a row per marked unit and does not substitute zero prices',()=>{const x=fixture();x.units=[{...x.units[0],kiz:'0104680992598455215rYJoe1STv"l%\u001d91EE12\u001d92proof',requiresKiz:true} as any];const sheet=XLSX.read(buildActualLamodaTemplate(x),{type:'buffer'}).Sheets['Лист1'];expect(sheet['C5'].v).toBe('');expect(sheet['F5'].v).toBe(x.units[0].kiz);expect(sheet['B5'].v).toBe(1);});
 it('uses actual quantities and seller SKU with integer kopecks',()=>{const x=buildActualLamodaShipment(fixture());expect(x.items).toEqual([{externalSku:'LAMODA-S',quantity:1,price:{amount:12345,currency:'RUB'},ean:'4600000000001'}]);});
 it.each(['PICKED','REMOVED'])('rejects non-packed state %s',state=>{const x=fixture();x.units[0].state=state;expect(()=>buildActualLamodaShipment(x)).toThrow();});
 it('rejects unconfirmed boxes',()=>{const x=fixture();x.boxes[0].confirmedAt=null as any;expect(()=>buildActualLamodaShipment(x)).toThrow();});
 it('rejects duplicate units',()=>{const x=fixture();x.units.push(x.units[0]);expect(()=>buildActualLamodaShipment(x)).toThrow();});
 it('rejects ambiguous mappings',()=>{const x=fixture();x.identities.push({...x.identities[0],externalSku:'other'});expect(()=>buildActualLamodaShipment(x)).toThrow();});
 it('rejects missing KIZ and missing price',()=>{const x=fixture();x.units[0].requiresKiz=true;expect(()=>buildActualLamodaShipment(x)).toThrow();x.units[0].requiresKiz=false;x.identities[0].priceMinor=NaN;expect(()=>buildActualLamodaShipment(x)).toThrow();});
 it('rejects impossible date',()=>{expect(()=>buildActualLamodaShipment({...fixture(),plannedDate:'2026-02-30'})).toThrow();});
 it('does not send ordinary UPD number as document UUID',()=>{expect(buildActualLamodaShipment(fixture())).not.toHaveProperty('documentNumber');});
 it('writes date as string and price in rubles',()=>{const book=XLSX.read(actualLamodaWorkbook(buildActualLamodaShipment(fixture())),{type:'buffer'});const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1}) as any[];expect(rows[0][1]).toBe('01.11.2026');expect(rows[3]).toEqual(['Seller SKU','Количество','Стоимость','EAN','Вес ЮИ','Data Matrix']);expect(rows[4][0]).toBe('LAMODA-S');expect(rows[4][2]).toBe(123.45);});
});
