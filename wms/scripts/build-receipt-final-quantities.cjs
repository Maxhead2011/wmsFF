// FIX: add final quantity projection to the exact live controller, preserving existing barcode and recovery logic.
const fs=require('fs'),path=require('path'),ts=require('typescript');const [base,out]=process.argv.slice(2);if(!base||!out)throw Error('base and output required');
const folder='modules/warehouse';fs.mkdirSync(path.join(out,folder),{recursive:true});
let text=fs.readFileSync(path.join(base,folder,'receipt-channels.controller.js'),'utf8');const marker='        for (const r of rows)\n            sheet.addRow';
text=text.replace(/\r\n/g,'\n');if(text.split(marker).length!==2)throw Error('Live controller marker changed');
text=text.replace(marker,'        const finalRows = !recoveredRows && process.env.WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED === "true" && doc.boxes.some(b=>b.linkedAdjustmentIds?.length) ? require("./receipt-final-quantities").receiptFinalQuantities(rows) : rows;\n        for (const r of finalRows)\n            sheet.addRow');
fs.writeFileSync(path.join(out,folder,'receipt-channels.controller.js'),text);
const src=fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/warehouse/receipt-final-quantities.ts'),'utf8');fs.writeFileSync(path.join(out,folder,'receipt-final-quantities.js'),ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
