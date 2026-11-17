// FIX: patch only reviewed functions in the captured runtime; preserve all other bytes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(process.argv[2]);
const wms = path.resolve(__dirname, '../../..');
const ts = require(require.resolve('typescript', { paths: [wms] }));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = p => fs.readFileSync(p, 'utf8');
const ast = text => ts.createSourceFile('runtime.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const find = (text, predicate) => {
  const found = []; function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); } visit(ast(text));
  assert.equal(found.length, 1, 'runtime anchor must be unique'); return found[0];
};
const method = (text, name) => find(text, n => ts.isMethodDeclaration(n) && n.name?.getText() === name);
const fn = (text, name) => find(text, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
function replaceNode(text, node, replacement) { return text.slice(0, node.getStart()) + replacement + text.slice(node.end); }
function compile(relative) {
  return ts.transpileModule(read(path.join(wms, relative)), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
}
const manifest = JSON.parse(read(path.join(root, 'manifest.json')));
const changed = ['modules/skus/skus.service.js', 'modules/skus/skus.controller.js', 'modules/skus/dto/bulk-update-sku-volume.dto.js'];
for (const relative of changed) {
  const file = path.join(root, 'candidate', relative), before = read(path.join(root, 'runtime-before', relative));
  assert.equal(sha(Buffer.from(before)), manifest.artifacts['api-runtime.tar.gz'].files[relative], 'candidate must start from captured bytes');
  const compiled = compile('apps/api/src/' + relative.replace(/\.js$/, '.ts'));
  let next = before;
  if (relative.endsWith('skus.service.js')) {
    for (const name of ['listBulkVolume', 'updateBulkVolume']) next = replaceNode(next, method(next, name), method(compiled, name).getText());
    const helper = fn(compiled, 'skuVolumeSearch').getText();
    const anchor = fn(next, 'skuVolumeRange'); next = next.slice(0, anchor.getStart()) + helper + '\n' + next.slice(anchor.getStart());
  } else if (relative.endsWith('skus.controller.js')) {
    next = replaceNode(next, method(next, 'listBulkVolume'), method(compiled, 'listBulkVolume').getText());
    const decoration = text => find(text, n => ts.isExpressionStatement(n) && n.getText().startsWith('__decorate([') && n.getText().includes('SkusController.prototype, "listBulkVolume", null)'));
    next = replaceNode(next, decoration(next), decoration(compiled).getText());
  } else {
    // The DTO contains only the bulk-volume contract; assert there is no unrelated class.
    assert.ok(before.includes('class BulkUpdateSkuVolumeDto'));
    next = compiled;
  }
  fs.writeFileSync(file, next);
}

const before = read(path.join(root, 'web-before.js'));
assert.equal(sha(Buffer.from(before)), JSON.parse(read(path.join(root, 'web-before.json')))['assets/soul-inter-20261112.js']);
const oldEditor = fn(before, 'wD');
assert.ok(oldEditor.getText().includes('Массовое изменение литража'));
for (const anchor of ['Lt(r.user.id', 'x.useState', 'SR(r.accessToken', 'CR(r.accessToken', 'e.jsx(RA', 'e.jsx(Ze', 'e.jsx(zt', 'e.jsx(qw']) assert.ok(oldEditor.getText().includes(anchor), anchor);
const component = ts.transpileModule(read(path.join(wms, 'apps/web/src/components/catalog/BulkVolumeEditor.tsx')), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const body = component.replace(/^import .*;\r?\n/gm, '').replace('export function BulkVolumeEditor', 'function BulkVolumeEditor')
  .replace("import.meta.env.VITE_BULK_VOLUME_SEARCH_ENABLED === 'true'", 'true');
assert.ok(!body.includes('import '));
const replacement = `const __bulkVolumeEditor20261117=(()=>{
const {useState,useEffect,useMemo}=x;const {jsx:_jsx,jsxs:_jsxs}=e;
const CheckCheck=qw,Gauge=RA,RefreshCw=Ze,Save=zt;
const fetchBulkSkuVolume=SR,updateBulkSkuVolume=CR,useRememberedClientId=Lt;
${body}
return BulkVolumeEditor;})();function wD(props){return __bulkVolumeEditor20261117(props);}`;
const next = replaceNode(before, oldEditor, replacement);
assert.equal(next.slice(0, oldEditor.getStart()), before.slice(0, oldEditor.getStart()));
assert.equal(next.slice(oldEditor.getStart() + replacement.length), before.slice(oldEditor.end));
const out = path.join(root, 'web-candidate'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bulk-volume-search-20261117.js'), next);
fs.writeFileSync(path.join(root, 'editor-runtime.js'), replacement);
fs.writeFileSync(path.join(out, 'bulk-volume-search-20261117.css'), '.catalog-volume-editor__form.catalog-volume-editor__form--search{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}@media(max-width:620px){.catalog-volume-editor__form.catalog-volume-editor__form--search{grid-template-columns:1fr}}');
let html = read(path.join(root, 'index-before.html'));
const oldUrl = '/assets/soul-inter-20261112.js', newUrl = '/assets/bulk-volume-search-20261117.js';
html = html.replace(/<script type="importmap">(.*?)<\/script>/s, (_, json) => {
  const map = JSON.parse(json);
  for (const key of Object.keys(map.imports)) if (map.imports[key] === oldUrl) map.imports[key] = newUrl;
  map.imports[oldUrl] = newUrl;
  return '<script type="importmap">' + JSON.stringify(map) + '</script>';
});
html = html.replace('</head>', '<link rel="stylesheet" href="/assets/bulk-volume-search-20261117.css">\n</head>');
html = html.replace('src="' + oldUrl + '"', 'src="' + newUrl + '"');
assert.equal((html.match(/<script[^>]*type="module"/g) || []).length, 2);
assert.equal((html.match(/src="\/assets\/bulk-volume-search-20261117.js"/g) || []).length, 1);
assert.ok(html.includes('src="/assets/admin-tiles-20261019-12.js"'), 'preserve the existing auxiliary module');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(root, 'prepare-proof.json'), JSON.stringify({ apiChanged: changed, webChanged: ['index.html', 'assets/bulk-volume-search-20261117.js', 'assets/bulk-volume-search-20261117.css'], beforeEditorSha: sha(oldEditor.getText()), editorSha: sha(replacement), outsideEditorUnchanged: true }, null, 2));
console.log('Prepared exact API3/web3 overlay; unrelated web bytes preserved.');
