// FIX: change only the supply label renderer; preserve published membership verification.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),file='modules/marketplace-connections/wb-supply-label.js';
const src=fs.readFileSync('apps/api/src/modules/marketplace-connections/wb-supply-label.ts','utf8');
const next=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const base=fs.readFileSync(root+'/api-base/'+file,'utf8');
function reader(s){return s.slice(s.indexOf('async function readWbSupplyLabels'),s.indexOf('async function buildWbSupplyLabelsPdf')).split('// FIX:')[0].trim()}
assert.equal(reader(next),reader(base));
fs.mkdirSync(path.dirname(root+'/api-payload/'+file),{recursive:true});fs.writeFileSync(root+'/api-payload/'+file,next);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
fs.writeFileSync(root+'/api-changes.json',JSON.stringify([file]));fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({apiFiles:1,webFiles:0,readerUnchanged:true}));
