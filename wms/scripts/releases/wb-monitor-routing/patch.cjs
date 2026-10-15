// FIX: patch only verified methods over a freshly captured production runtime.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const repo = path.resolve(__dirname, '../../../..');
const ts = require(path.join(repo, 'wms/node_modules/typescript'));
const target = process.argv[2];
if (!target) throw Error('Pass the captured API runtime directory');
const prefix = 'wms/apps/api/src/modules/marketplace-connections/';
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  experimentalDecorators: true, emitDecoratorMetadata: true,
} }).outputText;
function member(text, name) {
  const sf = ts.createSourceFile('runtime.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found;
  function visit(node) {
    if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(sf) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!found) throw Error('Missing method ' + name);
  return { start: found.getStart(sf), end: found.end, text: found.getText(sf) };
}
// Preserve the existing production BigInt schema adapters; this release does not migrate the schema.
function adapt(text, name) {
  if (name === 'ingestOrders') return text.replace('chrtId: candidate.chrtId,', 'chrtId: candidate.chrtId == null ? null : BigInt(candidate.chrtId),');
  if (name === 'runChecks') return text.replace('chrtId: event.chrtId,', 'chrtId: event.chrtId == null ? null : (0, wb_stock_observations_1.wbStockCheckDto)({ chrtId: event.chrtId }).chrtId,');
  return text;
}
for (const [file, names] of [
  ['marketplace-connections.service', ['probeFbsStockMonitoring']],
  ['fbs-stock-monitoring.service', ['ingestOrders', 'list', 'runChecks']],
  ['fbs-stock-monitoring.rules', ['evaluateFbsStockMonitorWms']],
]) {
  const sourcePath = prefix + file + '.ts';
  // FIX: the pinned pre-fix source is an assertion, never a replacement for the live module.
  const old = compile(cp.execFileSync('git', ['show', '1f31bc12dcaed1282d2f5623b3aeccf544905b6b:' + sourcePath], { cwd: repo, encoding: 'utf8', maxBuffer: 10000000 }));
  const next = compile(fs.readFileSync(path.join(repo, sourcePath), 'utf8'));
  const destination = path.join(target, 'modules/marketplace-connections', file + '.js');
  let live = fs.readFileSync(destination, 'utf8');
  for (const name of names) {
    const current = member(live, name);
    if (current.text.replace(/\s/g, '') !== adapt(member(old, name).text, name).replace(/\s/g, '')) throw Error('Production method changed: ' + name);
    live = live.slice(0, current.start) + adapt(member(next, name).text, name) + live.slice(current.end);
  }
  if (file.endsWith('.service')) live = live.replace('"use strict";', '"use strict";\nconst fbs_monitor_routing_1 = require("./fbs-monitor-routing");');
  fs.writeFileSync(destination, live);
}
fs.writeFileSync(path.join(target, 'modules/marketplace-connections/fbs-monitor-routing.js'),
  compile(fs.readFileSync(path.join(repo, prefix + 'fbs-monitor-routing.ts'), 'utf8')));
console.log('Patched exactly four API modules; no deployment performed.');

