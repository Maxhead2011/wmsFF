// FIX: only the Lamoda brand/content markup and scoped color; retain the published workflows.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const r=path.resolve(process.argv[2]),old='lamoda-fbo-host-20261026.js',name='lamoda-icon-host-20261026.js';
let s=fs.readFileSync(r+'/web-base/assets/'+old,'utf8');
const from='className:"fbs-marketplace-card","aria-pressed":a==="lamoda",onClick:()=>n("lamoda"),children:[e.jsx("strong",{children:"Lamoda"}),e.jsx("span",{children:"Подключение, каталог и подготовка FBO/FBS"})]';
const to='className:"fbs-marketplace-card fbs-marketplace-card--lamoda","aria-pressed":a==="lamoda",onClick:()=>n("lamoda"),children:[e.jsx("span",{className:"fbs-marketplace-card__brand","aria-hidden":"true",children:"lamoda"}),e.jsxs("span",{className:"fbs-marketplace-card__content",children:[e.jsx("strong",{children:"Lamoda"}),e.jsx("span",{children:"Подключение, каталог и подготовка FBO/FBS"})]})]';
assert.equal(s.split(from).length,2);s=s.replace(from,to);fs.mkdirSync(r+'/web/assets',{recursive:true});fs.writeFileSync(r+'/web/assets/'+name,s);
fs.writeFileSync(r+'/web/assets/lamoda-icon-20261026.css','.fbs-marketplace-card.fbs-marketplace-card--lamoda { --marketplace-accent:#111; --marketplace-soft:#f3f4f6; }\n');
let html=fs.readFileSync(r+'/web-base/index.html','utf8');const match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);assert.equal(map.imports['/assets/admin-tiles-20261019-15.js'],'/assets/'+old);map.imports['/assets/admin-tiles-20261019-15.js']='/assets/'+name;map.imports['/assets/'+old]='/assets/'+name;
html=html.replace(match[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/lamoda-icon-20261026.css">\n</head>');fs.writeFileSync(r+'/web/index.html',html);
const names=['index.html','assets/'+name,'assets/lamoda-icon-20261026.css'];fs.writeFileSync(r+'/release-proof.json',JSON.stringify({candidateHashes:Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(r+'/web/'+n)).digest('hex')]))}));
