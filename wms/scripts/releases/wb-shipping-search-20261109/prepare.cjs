// FIX: exact shipping-search overlay; retain unrelated runtime bytes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),cp=require('child_process');
const ts=require('../../../node_modules/typescript'),r=path.resolve(process.argv[2]),src=path.resolve('apps/api/src');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const tokens=s=>{const x=ts.createScanner(99,true,0,s),out=[];while(x.scan()!==ts.SyntaxKind.EndOfFileToken)out.push(x.getTokenText());return JSON.stringify(out)};
function member(s,name){const ast=ts.createSourceFile('a.js',s,99,true);let found;function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)found={start:n.getStart(ast),end:n.end,text:n.getText(ast)};ts.forEachChild(n,walk)}walk(ast);assert(found,name);return found}
const changes=[];const put=(n,s)=>{const p=r+'/api-payload/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(n)};
const base='02fda786',mod='modules/marketplace-connections/';
const old=n=>compile(cp.execFileSync('git',['show',base+':wms/apps/api/src/'+n+'.ts'],{encoding:'utf8',maxBuffer:20e6}));
const fresh=n=>compile(fs.readFileSync(src+'/'+n+'.ts','utf8'));
let n=mod+'marketplace-connections.service',s=fs.readFileSync(r+'/api-base/'+n+'.js','utf8');const initial=s;
const m=member(s,'getFbsSupplyDeliveryOptions'),o=member(old(n),'getFbsSupplyDeliveryOptions'),f=member(fresh(n),'getFbsSupplyDeliveryOptions'),added=member(fresh(n),'resolveFbsShippingOrders');
assert.equal(tokens(m.text),tokens(o.text));s=s.slice(0,m.start)+added.text+'\n'+f.text+s.slice(m.end);assert.equal(s.replace(added.text+'\n'+f.text,m.text),initial);put(n+'.js',s);
for(n of [mod+'wb-label-orders',mod+'wb-shipping-workflow']){s=fs.readFileSync(r+'/api-base/'+n+'.js','utf8');assert.equal(tokens(s),tokens(old(n)),n+' runtime/source tokens');put(n+'.js',fresh(n))}
n=mod+'dto/fbs-order-selection.dto';s=fs.readFileSync(r+'/api-base/'+n+'.js','utf8');const ast=ts.createSourceFile('dto.js',s,99,true);const d=ast.statements.find(n=>n.getText(ast).startsWith('__decorate(')&&n.getText(ast).includes('"shippingPointId"'));assert(d);const before=d.getText(ast),after=before.replace('__decorate([','__decorate([\n    (0, class_transformer_1.Transform)(({ value }) => value === "" ? undefined : value),');s=s.slice(0,d.getStart(ast))+after+s.slice(d.end);put(n+'.js',s);
fs.writeFileSync(r+'/api-changes.json',JSON.stringify(changes));console.log('PASS exact API4 search overlay');
