// FIX: a renamed application entry must remain the only React owner for lazy chunks.
const fs=require('node:fs'),path=require('node:path');
function repair(files,entry,alias,prefix){
 if(!files['index.html']||!files['assets/'+entry]||!files['assets/'+alias])throw Error('Missing pinned entries');
 const graph=new Set(),pending=['index.html'];
 while(pending.length){const n=pending.pop();if(graph.has(n))continue;graph.add(n);for(const token of files[n].match(/[\w.$-]{1,240}\.js/g)||[]){const next='assets/'+(token===alias?entry:token);if(files[next]&&!graph.has(next))pending.push(next);}}
 const names=Object.fromEntries([...graph].filter(n=>n.endsWith('.js')).sort().map((n,i)=>[path.basename(n),prefix+'-'+i+'.js']));names[alias]=names[entry];
 const result={};for(const n of graph){const dest=n==='index.html'?n:'assets/'+names[path.basename(n)];result[dest]=files[n].replace(/[\w.$-]{1,240}\.js/g,name=>names[name]||name);}
 const owners=Object.keys(result).filter(n=>result[n].includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'));
 if(owners.length!==1)throw Error('Expected exactly one React owner, found '+owners.length);
 return result;
}
module.exports={repair};
if(require.main===module){const [input,output,entry,alias]=process.argv.slice(2);if(fs.existsSync(output))throw Error('Output already exists');const cache={};const files=new Proxy(cache,{get(target,n){if(!(n in target)){const p=path.join(input,n);target[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return target[n];}});const result=repair(files,entry,alias,'single-react-20261008');for(const [n,s]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}fs.writeFileSync(path.join(output,'../web-changes.json'),JSON.stringify(Object.keys(result)));console.log('Repaired '+Object.keys(result).length+' files');}
