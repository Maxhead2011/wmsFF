// FIX: patch only approved token spans in the current runtime, preserving concurrent code byte-for-byte.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),src=path.resolve('apps/api/src');
const opts={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compile=s=>ts.transpileModule(s.replace(/\r\n/g,"\n"),{compilerOptions:opts}).outputText;
function tokens(s){const prefix=/^function\s/.test(s)?'':'class Patch {\n',wrapped=prefix+s+(prefix?'\n}':'');const ast=ts.createSourceFile('tokens.js',wrapped,99,true),result=[];function visit(n){const children=n.getChildren(ast);if(children.length)for(const child of children)visit(child);else{const a=n.getStart(ast)-prefix.length,b=n.end-prefix.length;if(a>=0&&b<=s.length&&b>a&&n.kind!==ts.SyntaxKind.EndOfFileToken)result.push({v:s.slice(a,b),a,b});}}visit(ast);return result;}

function members(s){const ast=ts.createSourceFile('runtime.js',s,99,true),result=new Map();function visit(n){if(ts.isClassDeclaration(n)||ts.isClassExpression(n))for(const m of n.members)if(m.name)result.set(m.name.getText(ast),{text:m.getText(ast),start:m.getStart(ast),end:m.end});else{}else ts.forEachChild(n,visit)}visit(ast);for(const n of ast.statements)if(ts.isFunctionDeclaration(n)&&n.name)result.set(n.name.text,{text:n.getText(ast),start:n.getStart(ast),end:n.end});return result;}
const changes=[],proof=[];
function put(name,text){const out=root+'/api-payload/'+name;fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,text);changes.push(name);}
for(const name of ['modules/marketplace-connections/marketplace-connections.service']){
 const sourceFile='wms/apps/api/src/'+name+'.ts';
 const old=compile(cp.execFileSync('git',['show','6137d2f1:'+sourceFile],{encoding:'utf8',maxBuffer:20e6}));const fresh=compile(fs.readFileSync(src+'/'+name+'.ts','utf8'));
 const om=members(old),nm=members(fresh);let runtime=fs.readFileSync(root+'/api-base/'+name+'.js','utf8');const original=runtime;const edits=[];
 for(const [method,next] of nm){const before=om.get(method);if(!before||before.text===next.text)continue;
  const actual=members(runtime).get(method);assert(actual,method);
  const a=tokens(before.text),b=tokens(next.text),c=tokens(actual.text);
  const ops=JSON.parse(cp.execFileSync('python',['-c',"import sys,json,difflib;x=json.load(sys.stdin);print(json.dumps([z for z in difflib.SequenceMatcher(None,x[0],x[1],autojunk=False).get_opcodes() if z[0]!='equal']))"],{input:JSON.stringify([a.map(t=>t.v),b.map(t=>t.v)]),encoding:'utf8'}));
  for(const [kind,i,j,k,l] of ops){let matches=[];for(const size of [12,8,4,2]){const lo=Math.max(0,i-size),hi=Math.min(a.length,j+size),needle=a.slice(lo,hi).map(t=>t.v);matches=[];for(let n=0;n<=c.length-needle.length;n++)if(needle.every((v,x)=>c[n+x].v===v))matches.push({n,lo});if(matches.length===1)break;}
   assert.equal(matches.length,1,method+' context '+a.slice(i,j).map(t=>t.v).join(' ').slice(0,120));const {n,lo}=matches[0],startToken=n+i-lo,endToken=n+j-lo;
   const start=c[startToken]?.a??actual.text.length,end=i===j?start:(c[endToken-1]?.b??actual.text.length);
   const replacement=k===l?'':next.text.slice(b[k].a,b[l-1].b);edits.push({start:actual.start+start,end:actual.start+end,text:' '+replacement+' ',method});
  }
 }
 edits.sort((a,b)=>b.start-a.start);for(let i=0;i<edits.length;i++){const edit=edits[i];if(i)assert(edit.end<=edits[i-1].start,'overlapping edits');runtime=runtime.slice(0,edit.start)+edit.text+runtime.slice(edit.end);}
 let inverse=runtime;for(const edit of [...edits].reverse())inverse=inverse.slice(0,edit.start)+original.slice(edit.start,edit.end)+inverse.slice(edit.start+edit.text.length);assert.equal(inverse,original,'exact inverse proof');
 if(!runtime.includes('const fbs_pvz_loss_1'))runtime='const fbs_pvz_loss_1 = require("./fbs-pvz-loss");\n'+runtime;
 assert.equal(ts.createSourceFile('candidate.js',runtime,99,true).parseDiagnostics.length,0);
 put(name+'.js',runtime);proof.push({name,changedMethods:[...new Set(edits.map(e=>e.method))],edits:edits.length,baseSha:require('node:crypto').createHash('sha256').update(original).digest('hex'),preservesAllOtherBytes:true});
}
for(const name of ['modules/marketplace-connections/fbs-pvz-loss'])put(name+'.js',compile(fs.readFileSync(src+'/'+name+'.ts','utf8')));
fs.writeFileSync(root+'/api-changes.json',JSON.stringify(changes));fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify(proof,null,2));console.log(proof);
