// FIX: apply only reviewed additions to the pinned runtime; never replace the full service.
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../../../..');
const ts=require(path.join(repo,'wms/node_modules/typescript'));
const target=process.argv[2];if(!target)throw Error('candidate directory required');
const source=path.join(repo,'wms/apps/api/src/modules/tsd');
const compile=name=>ts.transpileModule(fs.readFileSync(path.join(source,name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const file=path.join(target,'modules/tsd/fbo-two-stage.service.js');let s=fs.readFileSync(file,'utf8');
function replace(a,b){if(s.split(a).length!==2)throw Error('anchor mismatch: '+a);s=s.replace(a,b);}
const compiled=compile('fbo-two-stage.service');
const start=compiled.indexOf("else if (dto.action === 'PACK_UNIT' || dto.action === 'PACK_PRODUCT')");
const end=compiled.indexOf("else if (dto.action === 'PACK_BOX')",start);
if(start<0||end<0)throw Error('source branch missing');
const branch=compiled.slice(start,end).replace("dto.action === 'PACK_UNIT' || dto.action === 'PACK_PRODUCT'","dto.action === 'PACK_PRODUCT'");
s="const ozon_packing_suggestion_1 = require('./ozon-packing-suggestion');\nconst ozon_fbo_directions_1 = require('./ozon-fbo-directions');\n"+s;
replace("else if (dto.action === 'PACK_UNIT')",branch+"else if (dto.action === 'PACK_UNIT')");
replace("'OPEN_BOX','PACK_UNIT','CLOSE_BOX'","'OPEN_BOX','PACK_UNIT','PACK_PRODUCT','CLOSE_BOX'");
replace("marketplace:shipment?'OZON':'WILDBERRIES',", "marketplace:shipment?'OZON':'WILDBERRIES', packingByProductSupported:!!shipment&&process.env.WMS_OZON_PACK_BY_PRODUCT_ENABLED==='true', packingSuggestions:shipment&&process.env.WMS_OZON_PACK_BY_PRODUCT_ENABLED==='true'?ozon_packing_suggestion_1.ozonPackingSuggestions(shipment.directions,assembly?.boxes??[],units):[],");
fs.writeFileSync(file,s);
fs.writeFileSync(path.join(target,'modules/tsd/ozon-packing-suggestion.js'),compile('ozon-packing-suggestion'));
const dto=path.join(target,'modules/tsd/dto/fbo-action.dto.js');let d=fs.readFileSync(dto,'utf8');if(!d.includes("'PACK_UNIT',"))throw Error('DTO anchor');fs.writeFileSync(dto,d.replace("'PACK_UNIT',","'PACK_UNIT', 'PACK_PRODUCT',"));
console.log('Patched service, DTO and new helper only');

