'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {fixFabricHostScope}=require('./host-scope.cjs');
const base='const waves=["wms.logoff.pro","192.0.2.10"].includes(window.location.hostname)?[{id:"waves"}]:[];const tiles=window.location.hostname==="wms.logoff.pro"?[{id:"fabrics"}]:[];const r="fabrics";const panel=r==="fabrics"&&window.location.hostname==="wms.logoff.pro"?true:false;({tiles,panel})';
// TEST: both navigation and panel must use the existing own-installation scope.
test('alternate host regression and sold isolation',()=>{
 const evaluate=(code,hostname)=>vm.runInNewContext(code,{window:{location:{hostname}}});
 assert.equal(evaluate(base,'192.0.2.10').panel,false);
 const fixed=fixFabricHostScope(base);
 for(const host of ['wms.logoff.pro','192.0.2.10']){const result=evaluate(fixed,host);assert.equal(result.tiles.length,1);assert.equal(result.panel,true);}
 for(const host of ['sold.example','192.0.2.11']){const result=evaluate(fixed,host);assert.equal(result.tiles.length,0);assert.equal(result.panel,false);}
 assert.equal(fixed.replaceAll('["wms.logoff.pro","192.0.2.10"].includes(window.location.hostname)','window.location.hostname==="wms.logoff.pro"'),base.replace('["wms.logoff.pro","192.0.2.10"].includes(window.location.hostname)','window.location.hostname==="wms.logoff.pro"'));
});
test('fails closed on unexpected or already patched runtime',()=>{assert.throws(()=>fixFabricHostScope(''));assert.throws(()=>fixFabricHostScope(fixFabricHostScope(base)));});
