const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../../..');
const ts=require(root+'/wms/node_modules/typescript');
const target=process.argv[2];if(!target)throw Error('Pass materialized runtime directory');
const source=fs.readFileSync(root+'/wms/apps/api/src/modules/tsd/tsd-assembly.service.ts','utf8');
const start=source.indexOf('    // FIX: ordinary reservations also');
const end=source.indexOf('    const allocationBoxCodes =',start);
if(start<0||end<start)throw Error('Missing delta');
const delta=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const file=path.join(target,'modules/tsd/tsd-assembly.service.js');
const live=fs.readFileSync(file,'utf8');
const marker='        const allocationBoxCodes = uniqueSorted([';
if(live.split(marker).length!==2||live.includes('// FIX: ordinary reservations also'))throw Error('Unexpected runtime');
// FIX: insert only the direct-reservation fallback; retain all deployed relabel and Ozon behavior.
fs.writeFileSync(file,live.replace(marker,delta+marker));
console.log('Patched only tsd-assembly.service.js');
