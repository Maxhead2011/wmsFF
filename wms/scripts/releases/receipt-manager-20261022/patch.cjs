const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],dir=path.join(root,'api/modules/warehouse');fs.mkdirSync(dir,{recursive:true});
let api=fs.readFileSync(root+'/api-base/modules/warehouse/receipt-channels.controller.js','utf8').replaceAll('\r\n','\n');
function replace(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,90));return s.replace(a,b)}
api='const receipt_direction_access_1 = require("./receipt-direction-access");\n'+api;
api=replace(api,"canManageDirections: user.roleCodes.some(r => ['ADMIN', 'OWNER'].includes(r))","canManageDirections: await receipt_direction_access_1.canManageReceiptDirections(this.prisma,user,clientId)");
api=replace(api,"        const warehouseId = (0, receipt_channel_policy_1.requireReceiptChannelAdmin)(user);\n        this.scopes.requireClientAccess(user, body.clientId, 'write');\n        const result = await this.prisma.$transaction(async (tx) => {",`        this.scopes.requireClientAccess(user, body.clientId, 'write');
        if (!await receipt_direction_access_1.canManageReceiptDirections(this.prisma,user,body.clientId)) throw new common_1.ForbiddenException('Нет права изменять направления приёмки этого клиента.');
        const admin=user.roleCodes.some(r=>r==='ADMIN'||r==='OWNER');
        const warehouseId=admin?(0,receipt_channel_policy_1.requireReceiptChannelAdmin)(user):body.warehouseId;
        if(typeof warehouseId!=='string'||!(await this.readWarehouses(user,body.clientId)).includes(warehouseId)) throw new common_1.ForbiddenException('Нет доступа к приёмке этого филиала.');
        const result = await this.prisma.$transaction(async (tx) => {`);
for(const method of ['preview','save']){const end=api.indexOf('], ReceiptChannelsController.prototype, "'+method+'", null);');assert(end>0);const start=api.lastIndexOf('__decorate([',end),part=api.slice(start,end);api=api.slice(0,start)+replace(part,"    (0, require_permissions_decorator_2.RequirePermissions)('warehouse:write'),\n",'')+api.slice(end);}
fs.writeFileSync(dir+'/receipt-channels.controller.js',api);
fs.writeFileSync(dir+'/receipt-direction-access.js',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../../apps/api/src/modules/warehouse/receipt-direction-access.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText);
const old='invoice-download-names-20261021-0.js',next='receipt-manager-20261022.js';let s=fs.readFileSync(root+'/web-base/assets/'+old,'utf8'),ast=ts.createSourceFile('x',s,99,true);const ds=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__ReceiptDirections'));assert.equal(ds.length,2);const effective=ds.at(-1);let v=effective.getText(ast);
v=replace(v,'[N,J]=u(!1),','[N,J]=u(!1),[canManageDirections,setCanManageDirections]=u(false),');
v=replace(v,'$(null),k(null),B([])','$(null),k(null),setCanManageDirections(false),B([])');
v=replace(v,'B(t.rows),J(t.enabled)','B(t.rows),J(t.enabled),setCanManageDirections(t.canManageDirections===true)');
v=replace(v,'id:e.id,clientId:s,fbs:e.fbs','id:e.id,clientId:s,warehouseId:e.warehouseId,fbs:e.fbs');
v=replace(v,'disabled:!y||o||!!g||!!r||!!f,onChange:a=>void K','disabled:!canManageDirections||o||!!g||!!r||!!f,onChange:a=>void K');
s=s.slice(0,effective.getStart(ast))+v+s.slice(effective.end);assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(root+'/web/assets',{recursive:true});fs.writeFileSync(root+'/web/assets/'+next,s);
let html=fs.readFileSync(root+'/web-base/index.html','utf8');html=html.replaceAll('/assets/'+old,'/assets/'+next).replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');fs.writeFileSync(root+'/web/index.html',html);fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+next]));console.log('Patched 2 API modules and 2 web files; existing runtime preserved');
