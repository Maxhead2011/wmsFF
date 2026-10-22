// FIX: exact two-module overlay over the verified live API; never replace the complete service from source.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const ts=require(path.join(root,'node_modules/typescript'));
const [base,target]=process.argv.slice(2);assert(base&&target&&!fs.existsSync(target));
fs.cpSync(base,target,{recursive:true});
const file=path.join(target,'modules/tsd/fbo-two-stage.service.js');let source=fs.readFileSync(file,'utf8');
function replace(a,b){assert.equal(source.split(a).length,2,a);source=source.replace(a,b);}
replace('for (const box of prioritized) {','for (const box of require("./fbo-alternative-picking").prioritizeAlternativeFboBox(prioritized, context)) {');
replace('return { pendingLocations, pendingPlacementQuantity, localRouteEnabled:', 'return { alternativePickingSupported: require("./fbo-alternative-picking").alternativeFboPickingEnabled(), pendingLocations, pendingPlacementQuantity, localRouteEnabled:');
fs.writeFileSync(file,source);
const helper=ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src/modules/tsd/fbo-alternative-picking.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
fs.writeFileSync(path.join(target,'modules/tsd/fbo-alternative-picking.js'),helper);
console.log(JSON.stringify({changed:['modules/tsd/fbo-two-stage.service.js','modules/tsd/fbo-alternative-picking.js']}));
