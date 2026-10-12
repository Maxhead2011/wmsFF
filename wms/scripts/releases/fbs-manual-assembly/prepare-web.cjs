// FIX: add only the manual FBS panel to the pinned live graph; preserve every existing service.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const wms = path.resolve(__dirname, '../../..');
const ts = require(path.join(wms, 'node_modules/typescript'));
const esbuild = require('node:module').createRequire(require.resolve(path.join(wms, 'apps/web/node_modules/vite/package.json')))('esbuild');
const { repair } = require(path.join(wms, 'scripts/single-react-graph.cjs'));
const root = path.resolve(process.argv[2]), input = path.join(root, 'web-base'), output = path.join(root, 'web');
assert(!fs.existsSync(output), 'Use a new web candidate directory');
const cache = {}, files = new Proxy(cache, { get(t, n) {
  if (!(n in t)) { const file = path.join(input, n); t[n] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined; }
  return t[n];
} });
const entry = /src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
let source = files['assets/' + entry];
function once(s, a, b) { assert.equal(s.split(a).length, 2, 'Exact runtime anchor: ' + a); return s.replace(a, b); }
assert(source.includes('function RF({session:t})'), 'Live ServiceCenterPanel changed');
source = once(source, 'children:TF.filter(', 'children:TF.concat(!t.user.isDemo&&t.user.roleCodes.some(role=>["ADMIN","OWNER"].includes(role))?[{id:"manualFbs",label:"Сборка ФБС по номерам",icon:gl}]:[]).filter(');
source = once(source, 'r==="wbPrintCheck"&&e.jsx(NF,{accessToken:t.accessToken}),',
  'r==="manualFbs"&&e.jsx(__ManualFbsPanel.FbsManualAssemblyPanel,{session:t,clientId:d},d+t.accessToken),r==="wbPrintCheck"&&e.jsx(NF,{accessToken:t.accessToken}),');
function read(relative) {
  const s = fs.readFileSync(path.join(wms, 'apps/web/src', relative), 'utf8');
  const ast = ts.createSourceFile(relative, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
}
const wrappers = `const React=x;const {useState,useEffect,useRef}=React;
async function manualRequest(token,path,body){const response=await fetch('/api/v1/service/fbs-manual-assembly/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join('; '):(data.message||'HTTP '+response.status));return data;}
const fetchManualFbsCapabilities=t=>manualRequest(t,'capabilities');
const fetchManualFbsOptions=(t,c)=>manualRequest(t,'options?clientId='+encodeURIComponent(c));
const previewManualFbsAssembly=(t,b)=>manualRequest(t,'preview',b);
const createManualFbsAssembly=(t,token,choices)=>manualRequest(t,'create',{token,choices});`;
source += '\n' + esbuild.buildSync({ stdin: { contents: wrappers + read('lib/fbs-manual-assembly.ts') + read('components/service/FbsManualAssemblyPanel.tsx'), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', globalName: '__ManualFbsPanel', minify: true, jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' }).outputFiles[0].text;
cache['assets/' + entry] = source;
const result = repair(files, entry, entry, 'fbs-manual-20261011');
for (const [name, data] of Object.entries(result)) {
  if (name.endsWith('.js')) assert.equal(ts.createSourceFile(name, data, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0, name);
  const file = path.join(output, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
}
fs.writeFileSync(path.join(root, 'web-changes.json'), JSON.stringify(Object.keys(result)));
console.log('Prepared exact web delta with a single React owner: ' + Object.keys(result).length + ' files');
