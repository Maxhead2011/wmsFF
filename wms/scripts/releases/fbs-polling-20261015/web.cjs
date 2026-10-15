const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const {repair}=require('../../single-react-graph.cjs');
const root=process.argv[2],input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
// FIX: change only six live timer sites; never replace the source-divergent FBS component.
const name=fs.readdirSync(path.join(input,'assets')).find(n=>n.endsWith('.js')&&files['assets/'+n].includes('fbs-marketplace-entry'));
assert(name);let s=files['assets/'+name];
const ast=ts.createSourceFile(name,s,99,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.getText(ast).includes('className:"fbs-panel"'));
assert(fn);const original=fn.getText(ast);let updated=original;
const helper=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/lib/visiblePolling.ts'),'utf8').replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText.replaceAll('startVisiblePolling','__fbsPoll');
const visible='function __fbsVisible(node){if(document.visibilityState!=="visible"||!node?.isConnected)return false;for(;node;node=node.parentElement)if(node.hasAttribute("hidden")||node.classList.contains("panthera-window-minimized")||getComputedStyle(node).display==="none")return false;return true;}';
// The first brace belongs to destructured props, so insert at the body using AST offsets instead.
updated=original.slice(0,fn.body.getStart(ast)-fn.getStart(ast)+1)+'const __fbsRoot=c.useRef(null);'+original.slice(fn.body.getStart(ast)-fn.getStart(ast)+1);
let recurring=0,short=0;
updated=updated.replace(/const o=window\.setInterval\(\(\)=>\{document\.visibilityState==="visible"&&([\w$]+)\(\)\},(6e4|2e4)\);return\(\)=>window\.clearInterval\(o\)/g,(_,load,ms)=>{recurring++;return `return __fbsPoll(()=>${load}(),()=>__fbsRoot.current,${ms})`;});
updated=updated.replace(/document\.visibilityState==="visible"&&([\w$]+)\(\)\},5e3\)/g,(_,load)=>{short++;return `__fbsVisible(__fbsRoot.current)&&${load}()},5e3)`;});
assert.equal(recurring,4);assert.equal(short,2);
for(const marker of ['className:"fbs-panel"','className:"fbs-panel fbs-marketplace-entry"']){assert.equal(updated.split(marker).length,2);updated=updated.replace(marker,'ref:__fbsRoot,'+marker);}
s=s.replace(original,updated);cache['assets/'+name]=helper+'\n'+visible+'\n'+s;
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1],result=repair(files,entry,entry,'fbs-polling-20261015');
for(const[n,s]of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));
fs.writeFileSync(path.join(root,'patch-proof.json'),JSON.stringify({recurring,short,component:fn.name.text,baseChunk:name}));
console.log(JSON.stringify({recurring,short,component:fn.name.text,files:Object.keys(result).length}));
