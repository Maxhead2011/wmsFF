const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],w=path.resolve(__dirname,'..'),input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];let s=files['assets/'+entry];
const sf=ts.createSourceFile(entry,s,99,true),edits=[],counts={bundle:0};
const replace=(source,from,to)=>{assert.equal(source.split(from).length,2,'Binding drift: '+from);return source.replace(from,to);};
for(const node of sf.statements){
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__Magic')){
  assert.equal(node.declarationList.declarations.length,1);
  // FIX: change exactly one ID inside the magic bundle; legacy other-host code is untouched.
  const code=replace(node.getText(sf),'d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82','8e175b30-8535-4881-9324-a875c9fd8c1d');
  edits.push({start:node.getStart(sf),end:node.end,code});counts.bundle++;
 }

}
assert.deepEqual(counts,{bundle:1});
for(const e of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,e.start)+e.code+s.slice(e.end);
cache['assets/'+entry]=s;
const result=repair(files,entry,entry,'eleonora-account-20261014');
for(const [n,data] of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,data,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({...counts,files:Object.keys(result).length}));

