// TEST: never bind a different composition, date, external number or currency.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateLink}=require('./lamoda-link-2506.cjs');
const payload=()=>({externalShipmentId:'1',warehouseCode:'SOFINO',plannedDate:'2026-10-29',items:[{ean:'4640684262415',quantity:21,price:{amount:1120000,currency:'RUB'}}]});
const remote=()=>({shipment:{id:'MPG100007386',externalShipmentId:'1',warehouseCode:'SOFINO',plannedDate:'2026-10-29',status:'VALIDATION'},items:[{ean:'4640684262415',quantityPlanned:21,price:{amount:1120000,currency:'RUB'}}]});
test('accepts matching factual composition',()=>assert.equal(validateLink(payload(),remote()),21));
test('rejects shortages',()=>{const r=remote();r.items[0].quantityPlanned=20;assert.throws(()=>validateLink(payload(),r));});
test('rejects an extra barcode',()=>{const r=remote();r.items.push({...r.items[0],ean:'4640684262422',quantityPlanned:1});assert.throws(()=>validateLink(payload(),r));});
test('rejects changed commercial data',()=>{const r=remote();r.items[0].price.amount=1;assert.throws(()=>validateLink(payload(),r));});
test('rejects changed date',()=>{const r=remote();r.shipment.plannedDate='2026-10-30';assert.throws(()=>validateLink(payload(),r));});
test('rejects another shipment',()=>{const r=remote();r.shipment.id='MPGOTHER';assert.throws(()=>validateLink(payload(),r));});
test('rejects cancelled shipment',()=>{const r=remote();r.shipment.status='CANCELLED';assert.throws(()=>validateLink(payload(),r));});
