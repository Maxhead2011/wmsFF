// FIX: exact display-only archive overlay on the currently deployed service/controller.
const fs=require('fs'),path=require('path'),a=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),mod='modules/marketplace-connections/';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
function method(source,name){const ast=ts.createSourceFile('a.js',source,99,true);let found;function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)found=n.getText(ast);ts.forEachChild(n,walk)}walk(ast);a(found);return found}
function put(n,s){const p=root+'/api-payload/'+mod+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);fs.writeFileSync(root+'/candidate/'+mod+n,s)}
const source=compile(fs.readFileSync('apps/api/src/'+mod+'marketplace-connections.service.ts','utf8'));
let s=fs.readFileSync(root+'/candidate/'+mod+'marketplace-connections.service.js','utf8'),old=s;
const added=method(source,'restoreFbsArchiveForDisplay'),anchor='    async scopeFbsOrdersForUser(';
a.equal(s.split(anchor).length,2);a(!s.includes('async restoreFbsArchiveForDisplay'));
const imp='const fbs_saved_archive_1 = require("./fbs-saved-archive");\n';s=imp+s.replace(anchor,'    '+added+'\n'+anchor);a.equal(s.replace(imp,'').replace('    '+added+'\n',''),old);put('marketplace-connections.service.js',s);
s=fs.readFileSync(root+'/candidate/'+mod+'marketplace-connections.controller.js','utf8');old=s;
const before='        const result = this.stores ? await this.stores.decorateOrders(clientId, scoped, user) : scoped;';
const after='        const archived = view === "archive" ? await this.connections.restoreFbsArchiveForDisplay(clientId, scoped, user, allBranches === "1", displayWarehouseId, archiveFrom, archiveTo) : scoped;\n        const result = this.stores ? await this.stores.decorateOrders(clientId, archived, user) : archived;';
a.equal(s.split(before).length,2);s=s.replace(before,after);a.equal(s.replace(after,before),old);const v="const scoped = view === 'snapshot'";a.equal(s.split(v).length,2);s=s.replace(v,"const scoped = (view === 'snapshot' || view === 'archive')");const signature='async listFbsOrders(user, clientId, refresh, view, allBranches, displayWarehouseId)';a.equal(s.split(signature).length,2);s=s.replace(signature,signature.slice(0,-1)+', archiveFrom, archiveTo)');
const decorator="__param(5, (0, common_1.Query)('displayWarehouseId'))";
const start=s.indexOf("common_1.Get)('fbs/orders')"),end=s.indexOf('"listFbsOrders", null)',start);a(start>0&&end>start);
const block=s.slice(start,end);a(block.includes(decorator));s=s.slice(0,start)+block.replace(decorator,decorator+',\n    __param(6, (0, common_1.Query)("archiveFrom")),\n    __param(7, (0, common_1.Query)("archiveTo"))')+s.slice(end);
put('marketplace-connections.controller.js',s);
put('fbs-saved-archive.js',compile(fs.readFileSync('apps/api/src/'+mod+'fbs-saved-archive.ts','utf8')));
console.log('PASS exact API3 archive overlay, inverse bytes, existing display/cache/status logic retained');
