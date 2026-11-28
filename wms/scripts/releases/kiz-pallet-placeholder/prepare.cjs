// FIX: two exact runtime modules, retaining the deployed two-label agent protocol.
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'../../..'),w=path.resolve(process.argv[2]);
const ts=require(path.join(root,'node_modules/typescript')),dir='modules/tsd';
const out=path.join(w,'api-payload',dir);fs.mkdirSync(out,{recursive:true});
const name='tsd-kiz-box-print.service.js';let service=fs.readFileSync(path.join(w,'base-api',dir,name),'utf8');
const old="const palletCode = codes[0] || legacy;\n        if (!palletCode)\n            throw new common_1.ConflictException('Короб найден, но паллет-сорт не указан.');";
if(service.split(old).length!==2)throw Error('Deployed lookup drift');
service=service.replace(old,"const palletCode = codes[0] || legacy || 'ПАЛЕТ НЕ ОПРЕДЕЛЕН';");fs.writeFileSync(path.join(out,name),service);
const label=ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src',dir,'tsd-kiz-box-label.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;fs.writeFileSync(path.join(out,'tsd-kiz-box-label.js'),label);
for(const n of fs.readdirSync(out))fs.copyFileSync(path.join(out,n),path.join(w,'base-api',dir,n));console.log('Prepared two runtime modules');
