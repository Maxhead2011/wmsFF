// FIX: immutable FBS/editor URLs on a freshly captured runtime; retain all other assets.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2],built=fs.readFileSync(process.argv[3],'utf8');
assert(!built.includes('ReactCurrentDispatcher')&&!built.includes('react-jsx-runtime'));
assert(built.includes('React.createElement'));
const old='assets/inline-reserve-fbs-20261109.js',next='assets/inline-reserve-fbs-startup-20261109.js';
const editor='assets/inline-product-reserve-startup-20261109.js';
const original=fs.readFileSync(root+'/web-base/'+old,'utf8');
assert.equal(original.split('./inline-product-reserve-20261109.js').length,2);
const fbs=original.replace('./inline-product-reserve-20261109.js','./inline-product-reserve-startup-20261109.js');
const raw=fs.readFileSync(root+'/web-base/index.html','utf8'),match=raw.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);
let changed=0;for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old){map.imports[key]='/'+next;changed++}
assert(changed>0);map.imports['/'+old]='/'+next;
const html=raw.replace(match[1],()=>JSON.stringify(map));
for(const [name,value]of [[next,fbs],[editor,built],['index.html',html]]){
 const target=root+'/web-payload/'+name;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);
}
fs.writeFileSync(root+'/web-changes.json',JSON.stringify([next,editor,'index.html']));
console.log('PASS: web3; existing FBS changed only at editor import; root entry and all settings retained');
