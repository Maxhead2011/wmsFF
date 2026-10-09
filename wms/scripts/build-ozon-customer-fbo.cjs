// FIX: patch the pinned deployed runtime; never replace it with the divergent source build.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const root=process.argv[2];if(!root)throw Error('candidate directory required');
const changed=[];
function edit(file,fn){const p=path.join(root,file),before=fs.readFileSync(p,'utf8');let s=before;const replace=(a,b)=>{if(before.includes('\r\n')){a=a.replace(/(?<!\r)\n/g,'\r\n');b=b.replace(/(?<!\r)\n/g,'\r\n');}if(s.split(a).length!==2)throw Error('Runtime guard: '+file+' '+a);s=s.replace(a,b);};fn(replace);fs.writeFileSync(p,s);changed.push(file);}
for(const name of ['modules/client-requests/parsers/ozon-fbo-xlsx.parser','modules/client-requests/ozon-fbo-import.service','modules/client-requests/ozon-fbo-import.controller','modules/tsd/ozon-fbo-directions','modules/tsd/fbo-packing-receipt']){
  const source=path.resolve(__dirname,'../apps/api/src',name+'.ts'),target=path.join(root,name+'.js');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);changed.push(name+'.js');
}
edit('modules/client-requests/client-requests.module.js',r=>{
  r('controllers: [client_requests_controller_1.ClientRequestsController]', 'controllers: [client_requests_controller_1.ClientRequestsController, require("./ozon-fbo-import.controller").OzonFboImportController]');
  r('providers: [','providers: [require("./ozon-fbo-import.service").OzonFboImportService,');
});
edit('modules/administration/administration-internal-api.service.js',r=>r("prefixes: ['/client-requests'],\n        routeCount: 38", "prefixes: ['/client-requests', '/ozon-fbo-import'],\n        routeCount: 41"));
edit('modules/client-requests/client-requests.service.js',r=>r('async update(id, dto, user) {',`async update(id, dto, user) {
  if(dto.items!==undefined && process.env.WMS_OZON_FBO_IMPORT_ENABLED==='true' && await this.prisma.ozonFboShipment.findUnique({where:{requestId:id}})) throw new common_1.BadRequestException('Состав сборки задан распределением Ozon.');`));
edit('modules/tsd/dto/fbo-action.dto.js',r=>r('exports.FboActionDto = FboActionDto;',`exports.FboActionDto = FboActionDto;
__decorate([(0,class_validator_1.IsOptional)(),(0,class_validator_1.IsString)(),(0,class_validator_1.MaxLength)(200),__metadata("design:type",String)],FboActionDto.prototype,"direction",void 0);`));
edit('modules/tsd/fbo-two-stage.service.js',r=>{
  r('async snapshot(tx, r, context = {}) {',`async snapshot(tx, r, context = {}) {
    const shipment=process.env.WMS_OZON_FBO_IMPORT_ENABLED==='true'?await tx.ozonFboShipment.findUnique({where:{requestId:r.id}}):null;`);
  r('route.push({ boxCode: box.code,', 'if(shipment)decision.allowed=false;\n            route.push({ boxCode: box.code,');
  r("manualPackingEnabled: process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true', requestId:", `marketplace:shipment?'OZON':'WILDBERRIES',directions:shipment?require('./ozon-fbo-directions').directionProgress(shipment.directions,assembly?.boxes??[],units):[],manualPackingEnabled: !shipment&&process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true', requestId:`);
  r("closePickSupported: (0, fbo_two_stage_policy_1.fboClosePickEnabled)()", "closePickSupported: !shipment&&(0, fbo_two_stage_policy_1.fboClosePickEnabled)()");
  r("parallelPackingSupported: process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true'", "parallelPackingSupported: !shipment&&process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true'");
  r('compactPackingSupported: process.env.WMS_FBO_COMPACT_PACKING_ENABLED === "true"', 'compactPackingSupported: !shipment&&process.env.WMS_FBO_COMPACT_PACKING_ENABLED === "true"');
  r('code: b.boxCode, wholeBox: b.wholeBox, closed:', 'code: b.boxCode, direction:b.direction, wholeBox: b.wholeBox, closed:');
  r('...(dto.confirmedQuantity === undefined ? [] : [dto.confirmedQuantity])','...(dto.confirmedQuantity === undefined ? [] : [dto.confirmedQuantity]),...(dto.direction===undefined?[]:[dto.direction])');
  r('const key = `${id}:${dto.operationId}`, payloadHash = this.actionHash(dto);', `const shipment=process.env.WMS_OZON_FBO_IMPORT_ENABLED==='true'?await tx.ozonFboShipment.findUnique({where:{requestId:id}}):null;
                const directions=shipment?.directions;
                if(directions&&!['START','PICK_UNIT','FINISH_PICK','OPEN_BOX','PACK_UNIT','CLOSE_BOX','CANCEL_EMPTY_BOX','SORTED','CONFIRM_BOX','FINISH'].includes(dto.action))throw new common_1.ConflictException('Для Ozon используйте поштучный отбор и упаковку по направлениям.');
                const key = \`${'${id}'}:${'${dto.operationId}'}\`, payloadHash = this.actionHash(dto);`);
  r('const progress = await this.packingProgress(tx, id, dto);', `const progress = directions?{optimized:false,units:await tx.fboAssemblyUnit.findMany({where:{requestId:id,state:{not:'RETURNED'}}})}:await this.packingProgress(tx, id, dto);`);
  r('const units = progress.units;', `const units = progress.units;
                const directionBoxes=directions?await tx.fboAssemblyBox.findMany({where:{requestId:id}}):[];
                if(directions&&['SORTED','FINISH'].includes(dto.action)&&require('./ozon-fbo-directions').directionProgress(directions,directionBoxes,units).some(d=>d.items.some(i=>i.packed!==i.quantity)))throw new common_1.ConflictException('Не все направления упакованы по файлу.');
                if(directions&&dto.action==='OPEN_BOX')require('./ozon-fbo-directions').assertDirectionCapacity(directions,directionBoxes,units,dto.direction,[]);`);
  r('if (previousBox) {', `if (previousBox) {
                        if(directions&&previousBox.direction!==dto.direction)throw new common_1.ConflictException('Короб закреплён за другим направлением.');`);
  r('boxCode: target.code } });','boxCode: target.code, ...(directions?{direction:dto.direction}:{}) } });');
  r('                        const holding = await tx.box.findUniqueOrThrow({ where: { code: `FBO-PICK-${id}` } });', `if(directions)require('./ozon-fbo-directions').assertDirectionCapacity(directions,directionBoxes,units,parcel.direction,[unit]);
                        const holding = await tx.box.findUniqueOrThrow({ where: { code: \`FBO-PICK-${'${id}'}\` } });`);
  r("return kind === 'products' ? this.files.getWbProductsTemplate(id, user) : this.files.getWbPackagingTemplate(id, user);", `if(plan.marketplace==='OZON')throw new common_1.BadRequestException('Файл WB не предназначен для Ozon.');return kind === 'products' ? this.files.getWbProductsTemplate(id, user) : this.files.getWbPackagingTemplate(id, user);`);
});
console.log(JSON.stringify({changed}));
