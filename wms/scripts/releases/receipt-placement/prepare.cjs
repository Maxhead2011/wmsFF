// FIX: patch only reviewed members of the captured production modules.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
(async () => {
const root = path.resolve(process.argv[2]);
const repo = process.cwd();
const ts = require(repo + '/wms/node_modules/typescript');
const esbuild = require('node:module').createRequire(require.resolve(repo + '/wms/apps/web/node_modules/vite/package.json'))('esbuild');
const read = file => fs.readFileSync(file, 'utf8');
function save(file, text) {
  const target = path.join(root, 'payload', file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, text);
}
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, 'Production anchor changed: ' + before.slice(0, 90));
  return text.replace(before, () => after);
}
const options = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true};
const compile = text => ts.transpileModule(text, {compilerOptions: options}).outputText;
function tree(text) { return ts.createSourceFile('runtime.js', text, 99, true); }
function classParts(text, name) {
  const source = tree(text);
  let found;
  function visit(node) {
    if (ts.isClassExpression(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(found, name);
  return {source, node: found, members: new Map(found.members.filter(m => m.name).map(m => [m.name.getText(source), m.getText(source)]))};
}
function patchClass(file, name, added, changed) {
  const sourcePath = 'wms/apps/api/src/' + file + '.ts';
  const previous = compile(cp.execFileSync('git', ['show', '633d6db5:' + sourcePath], {encoding: 'utf8'}));
  const next = compile(read(sourcePath));
  let live = read(root + '/api-base/' + file + '.js');
  const oldParts = classParts(previous, name), nextParts = classParts(next, name);
  for (const method of changed) live = once(live, oldParts.members.get(method), nextParts.members.get(method));
  const current = classParts(live, name);
  for (const method of added) assert(!current.members.has(method), 'Method already published: ' + method);
  const end = current.node.end - 1;
  live = live.slice(0, end) + added.map(m => nextParts.members.get(m)).join('\n') + '\n' + live.slice(end);
  for (const statement of tree(next).statements) {
    const text = statement.getText();
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.every(d => !d.initializer && /^_[A-Za-z0-9]+$/.test(d.name.getText()))) {
      live = once(live, '"use strict";', '"use strict";\n' + text);
    }
    if (text.startsWith('const receipt_placement_')) live = once(live, '"use strict";', '"use strict";\n' + text);
    if (added.some(m => text.includes(name + '.prototype, "' + m + '"'))) live += '\n' + text;
  }
  save('api/' + file + '.js', live);
}
for (const name of ['receipt-placement-report', 'receipt-placement-workflow']) {
  save('api/modules/warehouse/' + name + '.js', compile(read('wms/apps/api/src/modules/warehouse/' + name + '.ts')));
}
patchClass('modules/warehouse/storage-locations.service', 'StorageLocationsService',
  ['placementReport', 'receiptPlacementTasks', 'receiptPlacementAction', 'placementScope', 'selectedPlacementReceipt'],
  ['addBox', 'placeBox', 'scanTsdPalletBox', 'getCurrentTsdPallet', 'closeTsdPallet', 'deleteTsdPallet', 'tsdPalletResponse']);
patchClass('modules/warehouse/storage-locations.controller', 'StorageLocationsController',
  ['placementReport', 'receiptPlacementTasks', 'receiptPlacementAction'], []);
patchClass('modules/tsd/tsd-device.controller', 'TsdDeviceController', ['receiptPlacementTasks', 'receiptPlacementAction'], []);
let admin = read(root + '/api-base/modules/administration/administration-internal-api.service.js');
const edits = [];
function catalog(node, source) {
  if (ts.isObjectLiteralExpression(node)) {
    const props = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(source), p]));
    const id = props.get('id')?.initializer;
    if (id && ts.isStringLiteral(id) && ['warehouse', 'tsd'].includes(id.text)) {
      const value = props.get('routeCount').initializer;
      edits.push({start: value.getStart(source), end: value.end, text: String(Number(value.getText(source)) + (id.text === 'warehouse' ? 3 : 2))});
    }
  }
  ts.forEachChild(node, n => catalog(n, source));
}
catalog(tree(admin), tree(admin));
assert.equal(edits.length, 2);
for (const edit of edits.sort((a,b) => b.start-a.start)) admin = admin.slice(0,edit.start)+edit.text+admin.slice(edit.end);
save('api/modules/administration/administration-internal-api.service.js', admin);

// Use the live React runtime and retain every unrelated component and transport.
let core = read(root + '/core.js'), html = read(root + '/live.html');
const source = tree(core);
const replacements = [];
let metrics = 0, refresh = 0;
function inspect(node, inStorage = false) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'C5') inStorage = true;
  if (inStorage && ts.isCallExpression(node)) {
    const object = node.arguments[1];
    if (object && ts.isObjectLiteralExpression(object) && object.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'className' && p.initializer.getText(source) === '"storage-zones__metrics"')) {
      replacements.push({start: node.getStart(source), end: node.end, text: 'e.jsx(__ReceiptPlacement.Panel,{token:t.accessToken,warehouseId:t.user.activeWarehouseId,canManage:t.user.permissionCodes.includes("warehouse:write")||t.user.permissionCodes.includes("system:admin"),revision:n.data,fallback:' + node.getText(source) + '})'});
      metrics++;
    }
    if (node.expression.getText(source) === 's' && node.arguments.length === 1 && node.arguments[0].getText(source).startsWith('{loading:!1,data:')) {
      replacements.push({start: node.getStart(source), end: node.end, text: '(' + node.getText(source) + ',window.dispatchEvent(new Event("storage-layout-changed")))'});
      refresh++;
    }
  }
  ts.forEachChild(node, child => inspect(child, inStorage));
}
inspect(source);
assert.equal(metrics, 1);
assert.equal(refresh, 1);
for (const edit of replacements.sort((a,b) => b.start-a.start)) core = core.slice(0,edit.start)+edit.text+core.slice(edit.end);
core = once(core, 'function PantheraNavigation({ groups, userId, accessToken, activeId, onOpen, kizUnread, counts=null })',
  'function PantheraNavigation({ groups, userId, accessToken, activeId, onOpen, kizUnread, counts=null, warehouseId })');
core = once(core, '(0, import_jsx_runtime.jsx)(__SidebarCounts.SidebarRequestBadge,{id:item.id,state:counts}),',
  '(0, import_jsx_runtime.jsx)(__SidebarCounts.SidebarRequestBadge,{id:item.id,state:counts}),item.id==="storage-zones"?(0,import_jsx_runtime.jsx)(__ReceiptPlacement.Badge,{token:accessToken,warehouseId}):null,');
core = once(core, 'e.jsx(__MainFeatures.PantheraNavigation,{counts:', 'e.jsx(__MainFeatures.PantheraNavigation,{warehouseId:t.user.activeWarehouseId,counts:');
core = once(core, 'ce.id==="kiz"&&S>0?', 'ce.id==="storage-zones"?e.jsx(__ReceiptPlacement.Badge,{token:t.accessToken,warehouseId:t.user.activeWarehouseId}):ce.id==="kiz"&&S>0?');
core = once(core, 'function T4({items:t,activeWorkspaceId:n,kizUnread:s,onOpen:r})', 'function T4({items:t,activeWorkspaceId:n,kizUnread:s,onOpen:r,accessToken:placementToken,warehouseId:placementWarehouse})');
core = once(core, 'e.jsx(T4,{items:', 'e.jsx(T4,{accessToken:t.accessToken,warehouseId:t.user.activeWarehouseId,items:');
core = once(core, 'm.id==="kiz"&&s>0?', 'm.id==="storage-zones"?e.jsx(__ReceiptPlacement.Badge,{token:placementToken,warehouseId:placementWarehouse}):m.id==="kiz"&&s>0?');
const web = path.resolve('wms/apps/web');
const built = (await esbuild.build({
  stdin: {contents: "export {ReceiptPlacementPanel as Panel,ReceiptPlacementBadge as Badge} from './src/components/warehouse/ReceiptPlacementPanel'", resolveDir: web},
  bundle: true, write: false, format: 'iife', globalName: '__ReceiptPlacement', jsx: 'automatic', loader: {'.css': 'empty'},
  plugins: [{name:'live-react',setup(build) {
    build.onResolve({filter:/^react(?:\/jsx-runtime)?$/}, args => ({path:args.path,namespace:'live'}));
    build.onLoad({filter:/.*/,namespace:'live'}, args => ({contents: args.path === 'react' ? 'export const {useState,useEffect,useRef,useCallback,useMemo}=x;' : 'export const {jsx,jsxs,Fragment}=e;'}));
  }}],
})).outputFiles[0].text;
const insertion = core.lastIndexOf('export{');
assert(insertion > 0);
core = core.slice(0,insertion) + built + '\n' + core.slice(insertion);
const oldEntry = html.match(/<script type="module" crossorigin src="([^"]+)"/)[1];
html = html.split(oldEntry).join('/assets/receipt-placement-840.js');
html = once(html, '</head>', '<link rel="stylesheet" href="/assets/receipt-placement-840.css"></head>');
save('web/index.html',html);
save('web/assets/receipt-placement-840.js',core);
save('web/assets/receipt-placement-840.css',read(web+'/src/components/warehouse/receipt-placement.css'));
console.log('Prepared exact API member overlays and scoped storage/menu additions');
})().catch(error => { console.error(error); process.exitCode = 1; });
