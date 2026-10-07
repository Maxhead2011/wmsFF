const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(audit){const downloads=[];const ctx={Date,AL:rows=>rows,ft:String,zL:row=>JSON.stringify(row),$L:()=> 'stock.xls',BL:(...x)=>downloads.push(x),wmsRecordCabinetExport:audit};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/patched-function-IL.js','utf8'),ctx);return {ctx,downloads};}
// TEST: browser's exact published download waits for durable audit success.
test('current six-column download waits for exact snapshot audit',async()=>{
 let release,record;const {ctx,downloads}=setup(async(token,dto)=>{record=dto;await new Promise(r=>release=r);});
 const rows=[{name:'Suit',article:'Paris',barcode:'123',color:'blue',size:'M',quantity:3}];
 const done=ctx.IL({id:'c',code:'C',name:'Client'},rows,{},[],{accessToken:'t',search:'blue',section:'stock'});
 assert.equal(downloads.length,0);assert.equal(record.rows[0].barcode,'123');assert.equal(record.rows[0].quantity,3);assert.equal(record.filters.search,'blue');release();await done;assert.equal(downloads.length,1);assert.ok(downloads[0][1].includes('Цвет'));assert.ok(downloads[0][1].includes('Размер'));
});
test('audit failure prevents unlogged file download',async()=>{const {ctx,downloads}=setup(async()=>{throw Error('audit failed')});await assert.rejects(ctx.IL({id:'c',code:'C'},[],{},[],{search:'',section:'stock'}),/audit failed/);assert.equal(downloads.length,0);});
test('manual and Excel preview distinguish placement from shortage',()=>{for(const name of ['Zl','li']){const ctx={Xs:()=>false,Ws:()=>true};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/patched-function-'+name+'.js','utf8'),ctx);const result=ctx[name]({skuId:"s",canFulfill:true,conflicts:[],pendingPlacementQuantity:3,readyQuantity:2,stockQuantity:5,reservedQuantity:0,availableQuantity:5,requestedQuantity:4,shortageQuantity:0});assert.ok(result.includes('Принято, ожидает размещения: 3'));}});
