// TEST: execute the shipped compiled reader with own-installation isolation.
const assert=require('node:assert/strict'),path=require('node:path');
const {ozonMarkedUnits,ozonUnitMarksEnabled}=require(path.join(process.argv[2],'common/ozon-unit-marks.js'));
const task={id:'t',marketplace:'OZON',itemCount:2,kiz:null};
const state={unitMarksVersion:1,lines:[
 {productId:1,skuId:'a',requestItemId:'a',quantity:1,picks:[{kiz:'0104610460840526215TESTa'}]},
 {productId:2,skuId:'b',requestItemId:'b',quantity:1,picks:[{kiz:'0104610460840540215TESTb'}]},
]};
process.env.WMS_OZON_UNIT_MARKS_ENABLED='false';assert.equal(ozonUnitMarksEnabled(),false);
process.env.WMS_OZON_UNIT_MARKS_ENABLED='true';assert.equal(ozonUnitMarksEnabled(),true);
const units=ozonMarkedUnits(task,state);assert.equal(units.length,2);assert.equal(units[1].skuId,'b');assert.equal(units[1].taskId,'t');
assert.throws(()=>ozonMarkedUnits({...task,itemCount:3},state));
state.lines[1].picks[0].kiz=state.lines[0].picks[0].kiz;
assert.throws(()=>ozonMarkedUnits(task,state));
assert.equal(ozonMarkedUnits({...task,kiz:'legacy'},null)[0].kiz,'legacy');
console.log('PASS: compiled unit reader, duplicate/incomplete rejection, flag isolation and legacy scalar');
