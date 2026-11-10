// FIX: insert only request preflight/linkage into the current runtime.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('../../../node_modules/typescript');
function method(source) {
  const ast = ts.createSourceFile('service.js', source, 99, true);
  let result;
  function walk(n) {
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === 'moveFbsOrdersToSupply') result = n.getText(ast);
    ts.forEachChild(n, walk);
  }
  walk(ast); assert(result); return result;
}
function patch(live, source) {
  const compiled = ts.transpileModule(source, {compilerOptions: {module: 1, target: 9,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true}}).outputText;
  const fresh = method(compiled), original = method(live);
  assert(!original.includes('const createManualRequest'), 'already patched');
  const preStart = fresh.indexOf('    // FIX: isolate automatic');
  const preEnd = fresh.indexOf('        let supplyIndex', preStart);
  const linkStart = fresh.indexOf('        // FIX: persist WMS linkage');
  const linkEnd = fresh.indexOf('            if (deliveryPlan.requiresCargoPlaces)', linkStart);
  assert(preStart >= 0 && preEnd > preStart && linkStart > preEnd && linkEnd > linkStart);
  assert(live.includes('const removal=require("../client-requests/request-removal-policy");'));
  const pre = fresh.slice(preStart, preEnd).replaceAll('request_removal_policy_1', 'removal');
  const link = fresh.slice(linkStart, linkEnd);
  const anchor1 = '        let supplyIndex = 0;';
  const anchor2 = '            if (deliveryPlan.requiresCargoPlaces) {';
  for (const a of [anchor1, anchor2]) assert.equal(original.split(a).length, 2, a);
  const updated = original.replace(anchor1, pre + anchor1).replace(anchor2, link + anchor2);
  assert.equal(updated.replace(pre, '').replace(link, ''), original, 'inverse byte proof');
  assert.equal(live.split(original).length, 2);
  return live.replace(original, updated);
}
module.exports = {patch, method};
if (require.main === module) {
  const [livePath, sourcePath, outputPath] = process.argv.slice(2);
  const result = patch(fs.readFileSync(livePath, 'utf8'), fs.readFileSync(sourcePath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), {recursive:true});
  fs.writeFileSync(outputPath, result);
  console.log('PASS: two additive blocks; all existing runtime bytes retained');
}
