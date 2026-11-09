'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require(process.env.TYPESCRIPT_MODULE||'typescript');
const {patchRolls,patchAccounting}=require('./prepare.cjs');
const catalogPath=require('node:path').resolve(__dirname,'../../../apps/api/src/modules/warehouse/fabric-catalog.ts');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function evaluate(text,extra={}){const module={exports:{}};const decorator=()=>()=>{};const nest=new Proxy({},{get:(_,key)=>key.endsWith('Exception')?class extends Error{}:decorator});
 vm.runInNewContext(text,{module,exports:module.exports,require:name=>name==='crypto'?require('node:crypto'):name==='./fabric-catalog'?catalog:name==='@nestjs/common'?nest:name.includes('/decorators/')?{CurrentUser:decorator,RequirePermissions:decorator}:extra[name]||new Proxy({},{get:()=>class{}}),Reflect:{defineMetadata(){}},structuredClone,Date,Set,Map,console,process:{env:{}}});return module.exports;}
const catalog=evaluate(compile(fs.readFileSync(catalogPath,'utf8')));
const base=process.env.FABRIC_ROLLS_BASE;if(!base)throw Error('Set FABRIC_ROLLS_BASE to verified live fabric-rolls.js');
const original=fs.readFileSync(base,'utf8'),before=evaluate(original),after=evaluate(patchRolls(original));
const added=catalog.addFabricColor([],'SATIN','Пудровый');const binding=catalog.createFabricBinding(added.colors,'SATIN',added.color.id,5000);
const sku={id:'sku',name:'Ткань пудровая',internalSku:'marketplace-offer',marketplacePayload:{fabricRollBinding:binding},barcodes:[{value:'123'}]};
test('TEST: reproduces the missing color and SKU binding on live baseline',()=>{assert.equal(before.fabricSku(sku),null);assert.throws(()=>before.applyRollAction({rolls:[],catalogColors:added.colors},{action:'RECEIVE',material:'SATIN',color:added.color.id,count:1},null,'moscow'));});
test('TEST: receives unbound new colors and later cuts exact bound metres',()=>{
 const state=after.applyRollAction({rolls:[],catalogColors:added.colors},{action:'RECEIVE',material:'SATIN',color:added.color.id,count:1},null,'moscow');assert.equal(state.rolls[0].remainingMm,100000);
 const identity=after.fabricSku(sku);assert.equal(identity.meters,5);assert.equal(identity.color,added.color.id);
 const cut=after.applyRollAction(state,{action:'CUT',rollId:state.rolls[0].id,count:2},identity,'moscow');assert.equal(cut.rolls[0].remainingMm,90000);assert.equal(state.rolls[0].remainingMm,100000);
});
test('TEST: retains old colors and refuses foreign-material or unregistered colors',()=>{assert.equal(after.fabricSku({...sku,marketplacePayload:null,internalSku:'black_5'}).color,'black');assert.throws(()=>after.applyRollAction({rolls:[],catalogColors:added.colors},{action:'RECEIVE',material:'GABARDINE',color:added.color.id,count:1},null,'moscow'));});
test('TEST: accounting patch retains existing module syntax and loads explicit payload',()=>{const file=process.env.FABRIC_ACCOUNTING_BASE;if(!file)return;const text=patchAccounting(fs.readFileSync(file,'utf8'));new vm.Script(text);assert.ok(text.includes('marketplacePayload:true'));assert.ok(text.includes('readFabricBinding(s.marketplacePayload)'));});
