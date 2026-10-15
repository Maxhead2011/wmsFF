// FIX: apply only the reviewed delta to a freshly captured production runtime.
const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=process.argv[2],source=path.resolve(__dirname,'../../../apps/api/src/modules/tsd/ozon-reopen-box.ts');
function patch(file,old,next){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');if(s.split(old).length!==2)throw Error('Anchor mismatch: '+file);fs.writeFileSync(p,s.replace(old,next));}
patch('modules/tsd/fbo-two-stage.service.js',"packingByProductSupported:!!shipment", "reopenPackingBoxSupported:require('./ozon-reopen-box').ozonReopenSupported(shipment),packingByProductSupported:!!shipment");
patch('modules/tsd/fbo-two-stage.service.js',"'FINISH_PICK','OPEN_BOX','PACK_UNIT'", "'FINISH_PICK','OPEN_BOX','REOPEN_BOX','PACK_UNIT'");
patch('modules/tsd/fbo-two-stage.service.js',"else if (dto.action === 'OPEN_BOX' || dto.action === 'MANUAL_OPEN_BOX') {",`// FIX: existing Ozon carton only; PACK_UNIT retains quota and marking checks.
                else if (dto.action === 'REOPEN_BOX') {
                    requirePacking();
                    const target=await this.box(tx,r,dto.targetBoxCode);
                    await this.requireIdleBox(tx,target.id,id);
                    const parcel=await tx.fboAssemblyBox.findUnique({where:{activeBoxId:target.id}});
                    await require('./ozon-reopen-box').reopenOzonBox(tx,shipment,id,parcel,dto.direction);
                }
                else if (dto.action === 'OPEN_BOX' || dto.action === 'MANUAL_OPEN_BOX') {`);
patch('modules/tsd/dto/fbo-action.dto.js',"'OPEN_BOX', 'MANUAL_OPEN_BOX'", "'OPEN_BOX', 'REOPEN_BOX', 'MANUAL_OPEN_BOX'");
const compiled=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
fs.writeFileSync(path.join(root,'modules/tsd/ozon-reopen-box.js'),compiled);
console.log('Patched three runtime modules');
