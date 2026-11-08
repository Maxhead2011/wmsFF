// FIX: surgical changes to verified runtime; unrelated module bytes stay intact.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const r=path.resolve(process.argv[2]);
function change(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
const file='modules/client-requests/client-requests.service.js';let s=fs.readFileSync(r+'/api-candidate/'+file,'utf8');
let start=s.indexOf('    async activeFboCounts(user) {'),end=s.indexOf('    async list(',start),old=s.slice(start,end),next=old;
next=change(next,'                yandexFbyShipment: null,\n','');
next=change(next,'select: { id: true, title: true, comment: true,','select: { id: true, title: true, comment: true, yandexFbyShipment: { select: { id: true } },');
next=change(next,'if (row.lamodaAssembly)','if (row.yandexFbyShipment)\n                counts.yandex++;\n            else if (row.lamodaAssembly)');
next=change(next,'{ wb: 0, ozon: 0, lamoda: 0 }','{ wb: 0, ozon: 0, lamoda: 0, yandex: 0 }');
s=s.slice(0,start)+next+s.slice(end);fs.writeFileSync(r+'/api-candidate/'+file,s);fs.mkdirSync(r+'/api-payload/modules/client-requests',{recursive:true});fs.writeFileSync(r+'/api-payload/'+file,s);
const oldUrl='/assets/fby-export-client-controls-20261107.js',newUrl='/assets/yandex-fby-counter-20261108.js';
let web=fs.readFileSync(r+'/web-base'+oldUrl,'utf8');web=change(web,'\\xB7 FBY"}),e("span"','\\xB7 FBY"}),m("yandex"),e("span"');
fs.mkdirSync(r+'/web-payload/assets',{recursive:true});fs.writeFileSync(r+'/web-payload'+newUrl,web);
let html=fs.readFileSync(r+'/web-base/index.html','utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let n=0;
for(const key in map.imports)if(map.imports[key]===oldUrl){map.imports[key]=newUrl;n++}assert(n>0);map.imports[oldUrl]=newUrl;
html=html.replace(match[1],()=>JSON.stringify(map));fs.writeFileSync(r+'/web-payload/index.html',html);
for(const [kind,files]of Object.entries({api:[file],web:['index.html',newUrl.slice(1)]}))fs.writeFileSync(r+'/'+kind+'-changes.json',JSON.stringify(files));
console.log('API1/web2 exact delta prepared');
