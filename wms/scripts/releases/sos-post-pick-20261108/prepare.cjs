// FIX: add only the verified post-pick print delta to the current runtime.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=p=>ts.transpileModule(read(p),{compilerOptions:{target:9,module:1,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
function method(s,name){let found=[];const ast=ts.createSourceFile('m.js',s,99,true);function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)found.push(n.getText(ast));ts.forEachChild(n,visit)}visit(ast);assert.equal(found.length,1,name);return found[0]}
const changes=[];
function patch(file,pairs){let s=read(root+'/api-base/'+file),base=s;for(const[a,b]of pairs){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);write(root+'/api-payload/'+file,s);write(root+'/api-candidate/'+file,s);changes.push(file)}
const folder='modules/marketplace-connections/',source='apps/api/src/'+folder;
const helper=compile(source+'sos-post-pick.ts');write(root+'/api-payload/'+folder+'sos-post-pick.js',helper);write(root+'/api-candidate/'+folder+'sos-post-pick.js',helper);changes.push(folder+'sos-post-pick.js');
const service=compile(source+'marketplace-connections.service.ts');
patch(folder+'marketplace-connections.service.js',[
 ['const common_1 = require("@nestjs/common");','const common_1 = require("@nestjs/common");\nconst sos_post_pick_1 = require("./sos-post-pick");\nconst pdf_lib_1 = require("pdf-lib");'],
 ['    async listSosWbRequests(user) {','    '+method(service,'listSosPostPickRequests')+'\n    '+method(service,'printSosPostPick')+'\n    async listSosWbRequests(user) {'],
 ["source: { not: 'TSD_RELABEL' }", "source: { notIn: ['TSD_RELABEL', sos_post_pick_1.SOS_POST_PICK] }"],
 ["if (job.source === 'TSD_RELABEL') {", "if (job.source === 'TSD_RELABEL' || job.source === sos_post_pick_1.SOS_POST_PICK) {"],
 ["success && job.source !== 'TSD_RELABEL' &&", "success && job.source !== 'TSD_RELABEL' && job.source !== sos_post_pick_1.SOS_POST_PICK &&"],
 ["where: { status: 'PRINTED', deviceCode: { startsWith: 'SOS-WB:' }, assemblyId:", "where: { status: 'PRINTED', source: { not: sos_post_pick_1.SOS_POST_PICK }, deviceCode: { startsWith: 'SOS-WB:' }, assemblyId:"]
]);
const ctrl=compile(source+'marketplace-connections.controller.ts');
const decorators=['listSosPostPickRequests','printSosPostPick'].map(name=>{
 const end=`MarketplaceConnectionsController.prototype, "${name}", null);`;
 const stop=ctrl.indexOf(end);assert(stop>0);const start=ctrl.lastIndexOf('__decorate([',stop);return ctrl.slice(start,stop+end.length);
}).join('\n');
patch(folder+'marketplace-connections.controller.js',[
 ['    listSosWbRequests(user) {','    '+method(ctrl,'listSosPostPickRequests')+'\n    '+method(ctrl,'printSosPostPick')+'\n    listSosWbRequests(user) {'],
 ['exports.MarketplaceConnectionsController = MarketplaceConnectionsController;', 'exports.MarketplaceConnectionsController = MarketplaceConnectionsController;\n'+decorators]
]);
const reg='modules/administration/administration-internal-api.service.js';
const count=read(root+'/api-base/'+reg).match(/id: 'marketplace-connections'[\s\S]*?routeCount: (\d+)/);assert(count);
patch(reg,[[count[0],count[0].replace(/routeCount: \d+/, 'routeCount: '+(Number(count[1])+2))]]);
write(root+'/api-changes.json',JSON.stringify(changes));write(root+'/overlay-proof.json',JSON.stringify({files:changes.length,unrelatedMethodsUnchanged:true}));
console.log('API4 exact overlay; old bytes outside additions/guards preserved');
