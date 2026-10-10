// FIX: patch only the verified runtime response and the stock-table presentation.
const fs = require('fs'), path = require('path'), ts = require('../node_modules/typescript');
const { repair } = require('./single-react-graph.cjs');
function once(s, a, b) {
  if (s.split(a).length !== 2) throw Error('Runtime anchor missing or ambiguous: ' + a);
  return s.replace(a, b);
}
function build(api, web, output) {
  const moduleDir = path.join(api, 'modules/marketplace-connections');
  const serviceFile = path.join(moduleDir, 'marketplace-connections.service.js');
  let service = fs.readFileSync(serviceFile, 'utf8');
  const start = service.indexOf('async buildFbsStocksResponse(');
  const end = service.indexOf('\n    async ', start + 1);
  if (start < 0 || end < 0) throw Error('Stock response method missing');
  const method = once(service.slice(start, end), 'sellable: quantity.sellable,',
    '...fbsStockReserveDisplay(quantity.sellable, sku.id, stockPlan),');
  service = service.slice(0, start) + method + service.slice(end);
  service = 'const { fbsStockReserveDisplay } = require("./fbs-stock-reserve-display");\n' + service;
  const helper = ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../apps/api/src/modules/marketplace-connections/fbs-stock-reserve-display.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  fs.writeFileSync(serviceFile, service);
  fs.writeFileSync(path.join(moduleDir, 'fbs-stock-reserve-display.js'), helper);
  const cache = {}, files = new Proxy(cache, { get(t, n) {
    if (!(n in t)) { const p = path.join(web, n); t[n] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined; }
    return t[n];
  } });
  const entry = /src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
  const graph = new Set(), pending = ['index.html'];
  while (pending.length) {
    const n = pending.pop(); if (graph.has(n)) continue; graph.add(n);
    for (const token of files[n].match(/[\w.$-]{1,240}\.js/g) || []) {
      const next = 'assets/' + token; if (files[next] && !graph.has(next)) pending.push(next);
    }
  }
  let changed = 0;
  for (const n of graph) {
    let s = files[n]; if (!s.includes('reserved.toLocaleString')) continue;
    s = once(s, 'e.jsx("th",{children:"WMS"}),e.jsx("th",{children:"Резерв"})',
      'e.jsx("th",{children:"WMS"}),e.jsx("th",{children:"Резерв заказов"}),e.jsx("th",{children:"Страховой резерв"})');
    const cell = 'e.jsx("td",{children:e.jsx("strong",{children:b.reserved.toLocaleString("ru-RU")})})';
    s = once(s, cell, cell + ',e.jsx("td",{children:e.jsx("strong",{children:(b.safetyReserve??0).toLocaleString("ru-RU")})})');
    cache[n] = s; changed++;
  }
  if (changed !== 1) throw Error('Expected one stock table');
  const result = repair(files, entry, entry, 'reserve-display-20261010');
  for (const [n, data] of Object.entries(result)) {
    const p = path.join(output, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data);
  }
  return Object.keys(result);
}
module.exports = { build };
if (require.main === module) console.log(JSON.stringify(build(...process.argv.slice(2))));
