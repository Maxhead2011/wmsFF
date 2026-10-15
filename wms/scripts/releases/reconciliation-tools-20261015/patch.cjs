const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const target=process.argv[2],root=path.resolve(__dirname,'../../../apps/api/src');
const compile=n=>ts.transpileModule(fs.readFileSync(path.join(root,n+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const names=['common/reconciliation/queue','common/reconciliation/wb-background','modules/operations-tools/operations-tools.service','modules/operations-tools/operations-tools.module'];
for(const n of names){const p=path.join(target,n+'.js');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,compile(n));}
// FIX: add only the queue dispatch to the current live method, retain its complete old fallback.
const n='modules/marketplace-connections/marketplace-connections.service';let s=fs.readFileSync(path.join(target,n+'.js'),'utf8');
const signature='async applyLocalWbShipments(clientId, orders, readOnly = false, activeOnly = false) {';assert.equal(s.split(signature).length,2);
s=s.replace(signature,signature+`\n        if (!readOnly && process.env.WMS_RECONCILIATION_QUEUE_ENABLED === 'true') {\n            await require('../../common/reconciliation/wb-background').reconcileWbBackground(this.prisma, clientId, orders, task => this.localShipmentOrder(task), changes => this.notifyFbsAutoStatusChanges(changes));\n            readOnly = true;\n        }`);
fs.writeFileSync(path.join(target,n+'.js'),s);names.push(n);
const app=path.join(target,'app.module.js');s=fs.readFileSync(app,'utf8');assert.equal(s.split('imports: [').length,2);s=s.replace('imports: [',"imports: [require('./modules/operations-tools/operations-tools.module').OperationsToolsModule,");fs.writeFileSync(app,s);names.push('app.module');
for(const n of names)assert.equal(ts.createSourceFile(n,fs.readFileSync(path.join(target,n+'.js'),'utf8'),99,true).parseDiagnostics.length,0);
fs.writeFileSync(path.join(target,'../api-changes.json'),JSON.stringify(names.map(n=>n+'.js')));console.log(JSON.stringify(names));
