'use strict';
const assert=require('node:assert/strict');
// FIX: reuse the live installation scope; never broaden to arbitrary IP addresses.
function ownHostExpression(js){
 const matches=[...js.matchAll(/(\[[^\]\n]+\]\.includes\(window\.location\.hostname\))\?\[\{id:"waves"/g)];
 assert.equal(matches.length,1,'Expected exactly one existing Waves installation scope');
 return matches[0][1];
}
function fixFabricHostScope(js){
 const scope=ownHostExpression(js);
 const tile='window.location.hostname==="wms.logoff.pro"?[{id:"fabrics"';
 const panel='r==="fabrics"&&window.location.hostname==="wms.logoff.pro"?';
 for(const marker of [tile,panel])assert.equal(js.split(marker).length,2,'Expected one fabric gate: '+marker);
 return js.replace(tile,scope+'?[{id:"fabrics"').replace(panel,'r==="fabrics"&&'+scope+'?');
}
module.exports={ownHostExpression,fixFabricHostScope};
