// FIX: only status expressions change; retain the published module graph and all actions.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('../node_modules/typescript');
const root = path.resolve(process.argv[2]), base = path.join(root, 'web-base'), out = path.join(root, 'web-payload');
let html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const im = html.match(/<script type="importmap">(.*?)<\/script>/s), map = JSON.parse(im[1]);
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
const changes = [
  ['workspace-wb-20261028.js', 'fbo-progress-wb-20261030.js', code => {
    const from = 'je?"Аварийно упакована":bn(c.status)'; assert.equal(code.split(from).length, 3);
    return code.replaceAll(from, 'je?"Аварийно упакована":c.fboProgressLabel??bn(c.status)');
  }],
  ['fbo-modal-rows-lamoda-20261029.js', 'fbo-progress-lamoda-20261030.js', code => {
    const from = 'At[i.assembly.request.status]??i.assembly.request.status'; assert.equal(code.split(from).length, 2);
    return code.replace(from, 'i.assembly.request.fboProgressLabel??' + from);
  }],
  ['ozon-import-stock-20261030.js', 'fbo-progress-ozon-20261030.js', code => {
    const tree = ts.createSourceFile('base.js', code, 99, true), replacements = [];
    function visit(n) {
      if (ts.isConditionalExpression(n)) {
        const text = n.getText(tree);
        const m = text.match(/^([it])\.status==="DONE"\?/);
        if (m && text.includes(m[1] + '.phase==="NOT_STARTED"')) replacements.push([n.getStart(tree), n.end, m[1] + '.fboProgressLabel??(' + text + ')']);
      }
      ts.forEachChild(n, visit);
    }
    visit(tree); assert.equal(replacements.length, 2);
    for (const [start, end, value] of replacements.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + value + code.slice(end);
    return code;
  }],
];
for (const [oldName, newName, patch] of changes) {
  const code = patch(fs.readFileSync(path.join(base, 'assets', oldName), 'utf8'));
  assert.equal(ts.createSourceFile('candidate.js', code, 99, true).parseDiagnostics.length, 0);
  fs.writeFileSync(path.join(out, 'assets', newName), code);
  const from = '/assets/' + oldName, to = '/assets/' + newName;
  for (const key of Object.keys(map.imports)) if (map.imports[key] === from) map.imports[key] = to;
  map.imports[from] = to;
}
html = html.replace(im[1], JSON.stringify(map));
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('Patched exactly three status renderers; original actions and lifecycle values preserved.');
