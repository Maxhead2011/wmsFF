// FIX: overlay only three declared modules on verified runtime; never ship the stale full source build.
const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),ts=createRequire(path.join(root,'package.json'))('typescript');
const target=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Supply a freshly materialized API directory');
function replace(file,oldText,newText){const p=path.join(target,file),s=fs.readFileSync(p,'utf8');if(!s.includes(oldText)&&oldText.includes('\n')){oldText=oldText.replace(/\n/g,'\r\n');newText=newText.replace(/\n/g,'\r\n');}if(s.split(oldText).length!==2)throw Error('Unexpected runtime: '+file+' / '+oldText);fs.writeFileSync(p,s.replace(oldText,newText));}
const helper='modules/warehouse/receipt-stock-index.js';
if(fs.existsSync(path.join(target,helper)))throw Error('Use a new candidate directory');
fs.writeFileSync(path.join(target,helper),ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src/modules/warehouse/receipt-stock-index.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
const policy='modules/warehouse/receipt-channel-policy.js';
replace(policy,'"use strict";','"use strict";\nconst receiptStockIndex = require("./receipt-stock-index");');
replace(policy,'async function receiptRules(db, clientId, warehouseId, boxIds) {','async function receiptRules(db, clientId, warehouseId, boxIds) {\n    if ((0, exports.receiptChannelsEnabled)() && receiptStockIndex.receiptStockIndexEnabled()) return (await receiptStockIndex.readIndexedReceiptState(db, clientId, warehouseId, boxIds)).rules;');
replace(policy,'async function pendingReceiptBoxIds(db, clientIds, warehouseId, boxIds) {','async function pendingReceiptBoxIds(db, clientIds, warehouseId, boxIds) {\n    if ((0, exports.receiptApprovalEnabled)() && receiptStockIndex.receiptStockIndexEnabled()) { const ids=[]; for (const clientId of [...new Set(clientIds)]) ids.push(...(await receiptStockIndex.readIndexedReceiptState(db, clientId, warehouseId, boxIds, false)).pending); return [...new Set(ids)]; }');
const fbo='modules/tsd/fbo-two-stage.service.js';
replace(fbo,"const boxes = assembly?.phase && assembly.phase !== 'PICKING' ? [] : await tx.box.findMany({",`const indexedStock = process.env.WMS_RECEIPT_STOCK_INDEX_ENABLED === 'true';
        const remainingSkuIds = Object.keys(demand).filter(k => demand[k] > 0);
        const needsRoute = (!assembly?.phase || assembly.phase === 'PICKING') && remainingSkuIds.length > 0;
        const boxes = (indexedStock ? !needsRoute : assembly?.phase && assembly.phase !== 'PICKING') ? [] : await tx.box.findMany({`);
replace(fbo,"const packingSnapshot = process.env.WMS_FBO_PACKING_READS_ENABLED === 'true'\n            && !!assembly?.phase && assembly.phase !== 'PICKING';","const packingSnapshot = (indexedStock && !needsRoute) || (process.env.WMS_FBO_PACKING_READS_ENABLED === 'true'\n            && !!assembly?.phase && assembly.phase !== 'PICKING');");
replace(fbo,"const availabilitySkuIds = process.env.WMS_FBO_PACKING_READS_ENABLED === 'true'","const availabilitySkuIds = indexedStock || process.env.WMS_FBO_PACKING_READS_ENABLED === 'true'");
console.log(JSON.stringify({changed:[helper,policy,fbo]}));
