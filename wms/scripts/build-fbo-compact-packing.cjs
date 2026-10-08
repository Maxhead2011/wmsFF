// FIX: overlay only the verified acknowledgement path; preserve deployed picking logic.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const root=process.argv[2];if(!root)throw Error('candidate directory required');
const source=path.resolve(__dirname,'../apps/api/src/modules/tsd/fbo-packing-receipt.ts');
fs.writeFileSync(path.join(root,'modules/tsd/fbo-packing-receipt.js'),ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
const file=path.join(root,'modules/tsd/fbo-two-stage.service.js');let text=fs.readFileSync(file,'utf8');
function replace(before,after){if(text.split(before).length!==2)throw Error('Runtime guard failed: '+before);text=text.replace(before,after);}
replace('return { requestId: id, operationId: dto.operationId, action: dto.action, accepted: !!previous };',
  'return require("./fbo-packing-receipt").withPackingReceipt(this, { requestId: id, operationId: dto.operationId, action: dto.action, accepted: !!previous }, user);');
replace('return { ...previous, accepted: true };','return await require("./fbo-packing-receipt").withPackingReceipt(this, { ...previous, accepted: true }, user);');
replace('fastAcknowledgementSupported: this.fastAcknowledgementEnabled(),','compactPackingSupported: process.env.WMS_FBO_COMPACT_PACKING_ENABLED === "true", fastAcknowledgementSupported: this.fastAcknowledgementEnabled(),');
fs.writeFileSync(file,text);
console.log(JSON.stringify({changed:['modules/tsd/fbo-packing-receipt.js','modules/tsd/fbo-two-stage.service.js']}));
