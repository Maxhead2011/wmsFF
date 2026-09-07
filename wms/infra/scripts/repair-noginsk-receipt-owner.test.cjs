// TEST: frozen scope, stock conservation, no duplicated receipt and rollback guards.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {C,BOXES,MAP,ADMIN_DOC,validate,movementData,operationData,apply,identity}=require('./repair-noginsk-receipt-owner.cjs');
function fixture(){
 const s={states:[],marks:[],movements:[],operations:[],clients:[{id:C.target,name:'ИП Лукин И.И.'}],skus:[],conflicts:[]};
 for(const m of MAP)for(const [id,clientId] of [[m.from,C.old],[m.to,C.target]])s.skus.push({id,clientId,name:'name'+m.barcode,barcodes:[{value:m.barcode}]});
 for(const b of BOXES){const skuId=MAP[0].from;
  s.states.push({code:b.code,references:[],box:{...b,clientId:C.old,warehouseId:C.ng,status:'receiving',
   balances:b.quantity?[{id:'balance'+b.id,boxId:b.id,clientId:C.old,warehouseId:C.ng,status:'AVAILABLE',skuId,quantity:b.quantity}]:[]}});
  for(let i=0;i<b.quantity;i++){
   s.marks.push({id:'mark'+b.id+i,boxId:b.id,clientId:C.old,skuId,status:'AVAILABLE',value:'kept'});
   s.movements.push({id:'receipt'+b.id+i,boxId:b.id,clientId:C.old,skuId,warehouseId:C.msk,type:'RECEIPT',status:'AVAILABLE',quantity:1,sourceDocument:'TSD-RECEIPT-original'});
   s.operations.push({id:'scan'+b.id+i,operationType:'receipt_scan',status:'ACCEPTED',payload:{boxCode:b.code,clientId:C.old,sourceDocument:'TSD-RECEIPT-original'}});
  }
  if(b.quantity)for(const q of [-b.quantity,b.quantity])s.movements.push({id:'move'+b.id+q,boxId:b.id,clientId:C.old,skuId,warehouseId:q>0?C.ng:C.msk,type:q>0?'RECEIPT':'MOVE',status:'AVAILABLE',quantity:q,sourceDocument:ADMIN_DOC});
 }
 for(let i=0;i<9;i++)s.operations.push({id:'open'+i,operationType:'receipt_open_box',status:'ACCEPTED',payload:{boxCode:BOXES[i%6].code,clientId:C.old,warehouseId:C.msk}});
 return s;
}
test('accepts exactly six boxes and 37 units',()=>validate(fixture()));
for(const [name,change] of [
 ['new stock',s=>s.states[1].box.balances[0].quantity++],
 ['active request',s=>s.states[0].references.push('FBS:active')],
 ['different owner',s=>s.states[0].box.clientId=C.target],
 ['different warehouse',s=>s.states[0].box.warehouseId=C.msk],
 ['shipped mark',s=>s.marks[0].status='SHIPPING'],
 ['duplicate mark',s=>s.conflicts.push('DUPLICATE')],
 ['SKU mismatch',s=>s.skus[0].name='different'],
 ['unrelated receipt',s=>s.movements[0].sourceDocument='other'],
 ['wrong operation client',s=>s.operations[0].payload.clientId=C.target],
 ['non-conserving correction',s=>s.movements.find(m=>m.sourceDocument===ADMIN_DOC).quantity--]
])test('rejects '+name,()=>{const s=fixture();change(s);assert.throws(()=>validate(s));});
test('moves scope without adding stock or double-counting receipt',()=>{
 const s=fixture(),m=s.movements.map(m=>({...m,...movementData(m)}));
 assert.equal(m.reduce((n,v)=>n+v.quantity,0),37);
 assert.equal(m.filter(v=>v.type==='RECEIPT').reduce((n,v)=>n+v.quantity,0),37);
 assert(m.every(v=>v.clientId===C.target&&v.warehouseId===C.ng));
 assert(m.every((v,i)=>v.quantity===s.movements[i].quantity&&v.id===s.movements[i].id));
});
test('scopes old scan payload and retains original evidence',()=>{
 const o=fixture().operations[0],result=operationData(o);
 assert.equal(result.payload.warehouseId,C.ng);assert.equal(result.payload.clientId,C.target);
 assert.equal(result.payload.sourceDocument,o.payload.sourceDocument);assert.equal(o.payload.clientId,C.old);
});
test('does not reinterpret unknown corrupt KIZ',()=>{
 const value='x'.repeat(170),parse=v=>v.length===85?{serial:'ok'}:null;
 assert.equal(identity({id:'other',value},parse),null);
 assert.deepEqual(identity({id:'cb8ea0ad-2759-483e-ab07-7dd1cfb13f19',value},parse),{serial:'ok'});
});
test('snapshot race rejects before writing',async()=>{
 const approved=fixture(),fresh=fixture();fresh.operations[0].payload.extra='changed';
 await assert.rejects(apply({auditLog:{findUnique:async()=>null}},approved,async()=>fresh,()=>''),/snapshot changed/i);
});
test('repeat apply does not write anything',async()=>{
 assert.equal(await apply({auditLog:{findUnique:async()=>({id:'done'})}},null,()=>{throw Error('read');}), 'ALREADY_APPLIED');
});
test('apply updates exact relationships, quantities and raw marks unchanged',async()=>{
 const writes={};const tx={};
 for(const model of ['box','stockBalance','stockMovement','productMark','tsdOperation'])tx[model]={update:async v=>(writes[model]??=[]).push(v)};
 tx.auditLog={findUnique:async()=>null,create:async v=>writes.audit=v};
 const s=fixture();await apply(tx,s,async()=>s,()=> 'new-key');
 for(const [model,n] of [['box',6],['stockBalance',4],['stockMovement',45],['productMark',37],['tsdOperation',46]])assert.equal(writes[model].length,n);
 for(const v of writes.stockBalance)assert(!('quantity' in v.data));
 for(const v of writes.productMark)assert(!('value' in v.data)&&!('status' in v.data));
 assert.equal(writes.audit.data.payload.quantityDelta,0);
});

