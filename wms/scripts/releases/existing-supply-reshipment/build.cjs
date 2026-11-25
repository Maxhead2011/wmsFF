const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const r=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..'),changes=[];
function write(n,s){for(const k of ['api','candidate']){const p=path.join(r,k,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}changes.push(n);}
let s=fs.readFileSync(r+'/base-api/modules/marketplace-connections/fbs-reshipment.service.js','utf8');
function replace(a,b){assert.equal(s.split(a).length,2,a);s=s.replace(a,b);}
// FIX: exact overlays preserve all unrelated published service methods.
replace('const warehouseId = user.activeWarehouseId;','const warehouseId = user.activeWarehouseId;\n        const globalAdmin = !user.roleCodes.includes("CLIENT") && user.permissionCodes?.includes("system:admin");');
replace('if (!warehouseId || (user.writableWarehouseIds && !user.writableWarehouseIds.includes(warehouseId)))','if (!warehouseId || (!globalAdmin && user.writableWarehouseIds && !user.writableWarehouseIds.includes(warehouseId)))');
replace('async preview(dto, user) {\n        const warehouseId = await this.authorize(dto.clientId, user);','async preview(dto, user) {\n        const warehouseId = await this.authorize(dto.clientId, user);\n        if(dto.existingSupplyId){this.selection(dto);return require("./fbs-existing-supply-reshipment").existingSupplyPreview(this.prisma,this.connections,dto,warehouseId,user);}');
replace('const previous = await this.prisma.fbsReshipmentRun.findFirst(',`if(dto.existingSupplyId){const result=await require("./fbs-existing-supply-reshipment").createExistingSupplyReshipment(this.prisma,this.connections,dto,warehouseId,user);this.connections.invalidateRepeatAssemblyCache(dto.clientId);return result;}
        const previous = await this.prisma.fbsReshipmentRun.findFirst(`);
write('modules/marketplace-connections/fbs-reshipment.service.js',s);
for(const n of ['fbs-existing-supply-reshipment','dto/fbs-reshipment.dto']){const source=fs.readFileSync(w+'/apps/api/src/modules/marketplace-connections/'+n+'.ts','utf8');const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}});write('modules/marketplace-connections/'+n+'.js',result.outputText);}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify(changes));console.log(JSON.stringify(changes));

