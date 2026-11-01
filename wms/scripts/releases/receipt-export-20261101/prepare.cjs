const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const r='D:/WMSFF/_Kof/work/receipt-export-release-20261101';
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
function save(n,s){fs.mkdirSync(path.dirname(r+'/api-payload/'+n),{recursive:true});fs.writeFileSync(r+'/api-payload/'+n,s)}
let n='modules/warehouse/receipt-channel-policy.js',s=fs.readFileSync(r+'/api-live/'+n,'utf8');
s=once(s,'select: { boxId: true, createdAt: true, quantity: true }','select: { id:true, boxId: true, createdAt: true, quantity: true }');
s=once(s,'if (row)\n                row.received += Math.max(0, quantity);','if(row&&quantity>0){row.received+=quantity;const box=row.boxes.find(b=>b.id===boxId);box.recoveredMovementIds=adjustments.filter(m=>m.boxId===boxId&&m.createdAt>=opening.at).map(m=>m.id);}');
save(n,s);n='modules/warehouse/receipt-channels.controller.js';s=fs.readFileSync(r+'/api-live/'+n,'utf8');
s=once(s,"type: 'RECEIPT', quantity: { gt: 0 }, OR: doc.boxes.map(b => ({ boxId: b.id, sourceDocument: b.receiptDocument?.startsWith('BOX:') ? null : b.receiptDocument }))","OR:[{type:'RECEIPT',quantity:{gt:0},OR:doc.boxes.map(b=>({boxId:b.id,sourceDocument:b.receiptDocument?.startsWith('BOX:')?null:b.receiptDocument}))},{id:{in:doc.boxes.flatMap(b=>b.recoveredMovementIds??[])}}]");
save(n,s);console.log('Prepared exact API2');
