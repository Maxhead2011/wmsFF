// FIX: preserve the exact live runtime; overlay only receipt reporting and export integration.
const fs=require('fs'),path=require('path'),ts=require('typescript');
const [base,out]=process.argv.slice(2);if(!base||!out)throw Error('base and output directories required');
const folder='modules/warehouse';fs.mkdirSync(path.join(out,folder),{recursive:true});
const replace=(text,old,next)=>{if(text.split(old).length!==2)throw Error('Runtime integration marker changed');return text.replace(old,next);};
let policy=fs.readFileSync(path.join(base,folder,'receipt-channel-policy.js'),'utf8');
policy=replace(policy,"    return report ? require('./receipt-file-recovery').attachCounts(db, clientId, warehouseId, documents) : documents;", "    if(!report)return documents;\n    const reportDocuments=await require('./receipt-file-recovery').attachCounts(db,clientId,warehouseId,documents);\n    await require('./receipt-linked-adjustments').applyReceiptLinkedAdjustments(db,clientId,warehouseId,reportDocuments);\n    return reportDocuments;");
let controller=fs.readFileSync(path.join(base,folder,'receipt-channels.controller.js'),'utf8');
controller=replace(controller,'doc.boxes.flatMap(b=>b.recoveredMovementIds??[])','doc.boxes.flatMap(b=>[...(b.recoveredMovementIds??[]),...(b.linkedAdjustmentIds??[])])');
fs.writeFileSync(path.join(out,folder,'receipt-channel-policy.js'),policy);
fs.writeFileSync(path.join(out,folder,'receipt-channels.controller.js'),controller);
const source=fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/warehouse/receipt-linked-adjustments.ts'),'utf8');
fs.writeFileSync(path.join(out,folder,'receipt-linked-adjustments.js'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
