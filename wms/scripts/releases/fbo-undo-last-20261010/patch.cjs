// FIX: exact additive delta against published APK226/API baseline.
const fs=require('fs'),path=require('path'),repo=path.resolve(__dirname,'../../../..');
const ts=require(path.join(repo,'wms/node_modules/typescript')),target=process.argv[2];
const compile=n=>ts.transpileModule(fs.readFileSync(path.join(repo,'wms/apps/api/src/modules/tsd',n+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const file=path.join(target,'modules/tsd/fbo-two-stage.service.js');let s=fs.readFileSync(file,'utf8');
function replace(a,b,count=1){if(s.split(a).length!==count+1)throw Error('Anchor mismatch '+a);s=s.split(a).join(b);}
const compiled=compile('fbo-two-stage.service'),start=compiled.indexOf("else if (dto.action === 'UNDO_PACK_UNIT')"),end=compiled.indexOf("else if (dto.action === 'PACK_BOX')",start);
if(start<0||end<0)throw Error('Missing undo branch');
s="const fbo_packing_undo_1 = require('./fbo-packing-undo');\n"+s;
replace("else if (dto.action === 'PACK_PRODUCT')",compiled.slice(start,end)+"else if (dto.action === 'PACK_PRODUCT')");
replace("'PACK_PRODUCT','CLOSE_BOX'","'PACK_PRODUCT','UNDO_PACK_UNIT','CLOSE_BOX'");
replace("marketplace:shipment?'OZON':'WILDBERRIES',","packingUndoSupported:process.env.WMS_FBO_PACK_UNDO_ENABLED==='true',marketplace:shipment?'OZON':'WILDBERRIES',");
replace('...(dto.direction===undefined?[]:[dto.direction])','...(dto.direction===undefined?[]:[dto.direction]),...(dto.undoOperationId===undefined?[]:[dto.undoOperationId])');
const update="await tx.fboAssemblyUnit.update({ where: { id: unit.id }, data: { state: 'PACKED', targetBoxId: target.id, targetBoxCode: target.code, packedAt: new Date(), packedByUserId: user.id } });";
replace(update,"const packedUnit = "+update+"\nawait fbo_packing_undo_1.rememberPackedUnit(tx, packedUnit, user.id, key);",2);
replace('payload: { operationId: dto.operationId, palletCode:', 'payload: { ...(dto.undoOperationId ? { undoOperationId: dto.undoOperationId } : {}), operationId: dto.operationId, palletCode:');
fs.writeFileSync(file,s);fs.writeFileSync(path.join(target,'modules/tsd/fbo-packing-undo.js'),compile('fbo-packing-undo'));
const dto=path.join(target,'modules/tsd/dto/fbo-action.dto.js');let d=fs.readFileSync(dto,'utf8');
if(d.split("'PACK_PRODUCT',").length!==2)throw Error('DTO anchor mismatch');
d=d.replace("'PACK_PRODUCT',","'PACK_PRODUCT', 'UNDO_PACK_UNIT',");
d+='\n__decorate([(0,class_validator_1.IsOptional)(),(0,class_validator_1.IsString)(),(0,class_validator_1.MaxLength)(100),__metadata("design:type",String)],FboActionDto.prototype,"undoOperationId",void 0);\n';fs.writeFileSync(dto,d);
