// FIX: guarded delta on the current production baseline; keep every unrelated runtime method.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const root=process.argv[2];
for(const name of ['stock/menu-read-catalog','tsd/online-plan-view','tsd/dto/fbo-route.dto']){
 const source=fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/'+name+'.ts'),'utf8');
 fs.writeFileSync(path.join(root,'modules/'+name+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
}
function patch(name,run){const f=path.join(root,'modules/'+name+'.js');let s=fs.readFileSync(f,'utf8');const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('guard '+name+' '+a);s=s.replace(a,b);};run(replace,()=>s);fs.writeFileSync(f,s);}
patch('tsd/fbo-two-stage.controller',r=>{
 r('plan(id, user, route) {','async plan(id, user, route = {}) {');
 r('return this.fbo.plan(id, user, route);','return require("./online-plan-view").onlinePlanView(await this.fbo.plan(id, user, route), route.view, route.offset);');
});
patch('tsd/tsd-device.controller',(r,get)=>{
 r('getAssemblyRequest(id, user) {','async getAssemblyRequest(id, user, view) {');
 r('return this.assembly.getDeviceRequestPlan(id, user);','return require("./online-plan-view").onlinePlanView(await this.assembly.getDeviceRequestPlan(id, user),view);');
 const s=get(),end=s.indexOf('], TsdDeviceController.prototype, "getAssemblyRequest"'),start=s.lastIndexOf('__decorate([',end),block=s.slice(start,end);
 if(start<0||end<0)throw Error('decorator guard');
 r(block,block.replace('__metadata("design:type", Function),','__param(2, (0, common_1.Query)("view")),\n    __metadata("design:type", Function),'));
});
