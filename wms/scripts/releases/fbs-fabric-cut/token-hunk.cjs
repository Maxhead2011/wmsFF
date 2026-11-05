// FIX: compare JavaScript tokens, ignoring only comments and formatting.
// Different calls, literals, operators or ambiguous matches are rejected.
const ts=require(process.argv[2]);
const fs=require('node:fs');
const {text,before,after}=JSON.parse(fs.readFileSync(0,'utf8'));
function tokens(source){
  const file=ts.createSourceFile('runtime.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),out=[];
  function visit(n){
    const children=n.getChildren(file);
    if(children.length)children.forEach(visit);
    else if(n.kind!==ts.SyntaxKind.EndOfFileToken && n.getWidth(file)>0)
      out.push({kind:n.kind,text:n.getText(file),start:n.getStart(file),end:n.getEnd()});
  }
  visit(file);
  return out;
}
const all=tokens(text),needle=tokens(before),found=[];
if(!needle.length)throw Error('Empty patch');
for(let i=0;i<=all.length-needle.length;i++){
  if(needle.every((n,j)=>n.text===all[i+j].text))found.push(i);
}
if(found.length!==1){
  let best=0,at=0;
  for(let i=0;i<all.length;i++){let j=0;while(j<needle.length&&all[i+j]&&needle[j].text===all[i+j].text)j++;if(j>best){best=j;at=i;}}
  throw Error('Token hunk matches: '+found.length+'; prefix '+best+' expected '+JSON.stringify(needle[best])+' actual '+JSON.stringify(all[at+best]));
}
const start=all[found[0]].start,end=all[found[0]+needle.length-1].end;
process.stdout.write(JSON.stringify(text.slice(0,start)+after.trim()+text.slice(end)));

