const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=process.argv[2],base=path.resolve(__dirname,'../../..');
// FIX: add methods to the actual deployed auth classes; preserve every existing login/session method.
if(process.argv[3]!=='--web-only')for(const name of ['auth.service','auth.controller']){
 const file=root+'/api/modules/auth/'+name+'.js';let s=fs.readFileSync(file,'utf8');assert(!s.includes('readPantheraFavorites'));
 if(name==='auth.service')s+=`
AuthService.prototype.readPantheraFavorites=function(user){return require("./panthera-favorites").readPantheraFavorites(this.prisma,user.id)};
AuthService.prototype.savePantheraFavorites=function(user,body){return require("./panthera-favorites").savePantheraFavorites(this.prisma,user.id,body)};
`;
 else s+=`
AuthController.prototype.readPantheraFavorites=function(user){return this.auth.readPantheraFavorites(user)};
AuthController.prototype.savePantheraFavorites=function(user,body){return this.auth.savePantheraFavorites(user,body)};
__decorate([(0,common_1.Get)("me/panthera-favorites"),(0,swagger_1.ApiBearerAuth)(),__param(0,(0,current_user_decorator_1.CurrentUser)()),__metadata("design:paramtypes",[Object])],AuthController.prototype,"readPantheraFavorites",null);
__decorate([(0,common_1.Post)("me/panthera-favorites"),(0,swagger_1.ApiBearerAuth)(),__param(0,(0,current_user_decorator_1.CurrentUser)()),__param(1,(0,common_1.Body)()),__metadata("design:paramtypes",[Object,Object])],AuthController.prototype,"savePantheraFavorites",null);
`;
 fs.writeFileSync(file,s);
}
fs.writeFileSync(root+'/api/modules/auth/panthera-favorites.js',ts.transpileModule(fs.readFileSync(base+'/apps/api/src/modules/auth/panthera-favorites.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
const registry=root+'/api/modules/administration/administration-internal-api.service.js';
let registryText=fs.readFileSync(registry,'utf8');
if(registryText.match(/id: 'auth',[\s\S]{0,160}routeCount: 4,/)){
 registryText=registryText.replace(/(id: 'auth',[\s\S]{0,160}routeCount: )4,/, '$16,');
 fs.writeFileSync(registry,registryText);
}
assert(registryText.match(/id: 'auth',[\s\S]{0,160}routeCount: 6,/));
fs.writeFileSync(root+'/api-changes.json',JSON.stringify(['modules/auth/auth.service.js','modules/auth/auth.controller.js','modules/auth/panthera-favorites.js','modules/administration/administration-internal-api.service.js']));
(async()=>{
 const bundle=await esbuild.build({entryPoints:[base+'/apps/web/src/components/layout/PantheraNavigation.tsx'],bundle:true,write:false,format:'iife',globalName:'__PantheraSynced',jsx:'transform',jsxFactory:'__WmsReact.createElement',jsxFragment:'__WmsReact.Fragment',plugins:[{name:'live-bindings',setup(b){
  b.onResolve({filter:/^(react|lucide-react|\.\/SidebarGroup)$/},args=>({path:args.path,namespace:'bindings'}));
  b.onLoad({filter:/.*/,namespace:'bindings'},args=>({contents:args.path==='react'?'module.exports=__WmsReact;':args.path==='lucide-react'?'export const Settings=I;':'export const SidebarGroup=q;',loader:'js'}));
 }}]});
 let s=fs.readFileSync(root+'/main-base.js','utf8'),a=ts.createSourceFile('x',s,99,true),edits=[];
 function walk(n){
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='U'&&n.getText(a).includes('wms.panthera.favorites.')){
   edits.push([n.getStart(a),n.end,bundle.outputFiles[0].text+'\nfunction U(props){return __WmsReact.createElement(__PantheraSynced.PantheraNavigation,props)}']);
  }
  if(ts.isCallExpression(n)&&n.arguments[0]?.getText(a)==='__MainFeatures.PantheraNavigation'){
   const p=n.arguments[1];assert(p.getText(a).includes('userId:t.user.id'));
   edits.push([p.getStart(a),p.end,p.getText(a).replace('{key:', '{accessToken:t.accessToken,key:')]);
  }
  ts.forEachChild(n,walk);
 }walk(a);assert.equal(edits.length,2);
 for(const[start,end,v]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,start)+v+s.slice(end);
 assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);
 fs.mkdirSync(root+'/web/assets',{recursive:true});fs.writeFileSync(root+'/web/assets/panthera-sync-20261020.js',s);
 let html=fs.readFileSync(root+'/index-base.html','utf8').replaceAll('/assets/receipt-dialog-fast-20261020.js','/assets/panthera-sync-20261020.js');
 html=html.replace('{"imports":{','{"imports":{"/assets/receipt-dialog-fast-20261020.js":"/assets/panthera-sync-20261020.js",');
 fs.writeFileSync(root+'/web/index.html',html);fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/panthera-sync-20261020.js']));
})();
