from pathlib import Path
import sys
base,web,out,helper=map(Path,sys.argv[1:])
def once(s,a,b):
 assert s.count(a)==1,(a,s.count(a))
 return s.replace(a,b,1)
def save(kind,name,s):
 p=out/(kind+'-payload')/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf-8')
s=base.read_text(encoding='utf-8');anchor='observedAt: new Date().toISOString(),'
s=once(s,anchor,anchor+"\nboxStatistics: process.env.WMS_MENU_READS_ENABLED === 'true' ? require('./fbo-box-statistics').fboBoxStatistics(units,route,assembly?.boxes??[],unboxed?lines.reduce((n,l)=>n+l.remaining,0):0) : undefined,")
save('api','modules/tsd/fbo-two-stage.service.js',s);save('api','modules/tsd/fbo-box-statistics.js',helper.read_text())
s=web.read_text(encoding='utf-8');anchor='e.jsx("strong",{children:s.needed})]})'
s=once(s,anchor,'e.jsx("strong",{children:s.needed}),s.boxStatistics&&e.jsxs("div",{className:"fbo-picking-breakdown",children:[e.jsx("span",{children:`Частичный отбор — ${s.boxStatistics.partialUnits} ед.`}),e.jsx("span",{children:`Целыми коробами — ${s.boxStatistics.wholeBoxes} коробов`})]})]})')
anchor='e.jsx("meter",{"aria-label":String(p),min:0,max:100,value:b(Number(v))})]}'
s=once(s,anchor,'e.jsx("meter",{"aria-label":String(p),min:0,max:100,value:b(Number(v))}),s.boxStatistics&&e.jsx("p",{className:"fbo-box-count",children:p==="Отбор"?`Отобрано коробов: ${s.boxStatistics.pickedBoxes}`:`Упаковано коробов: ${s.boxStatistics.packedBoxes}`})]}')
save('web','assets/fbo-box-progress-20261121.js',s)
save('web','assets/fbo-box-progress-20261121.css','.fbo-progress-bars .online-execution-progress{display:grid;grid-template-columns:minmax(0,1fr) minmax(80px,38%)}.fbo-progress-bars .online-execution-progress meter{width:100%}.fbo-box-count{grid-column:1 / -1;margin:4px 0 0;font-weight:600}.fbo-picking-breakdown{display:grid;gap:4px;font-size:14px}@media(max-width:720px){.fbo-progress-bars .online-execution-progress{grid-template-columns:1fr}}')
s=(web.parent/'live-index.html').read_text();assert '/assets/ozon-zone-label-requests-266.js' in s
s=s.replace('/assets/ozon-zone-label-requests-266.js','/assets/fbo-box-progress-20261121.js');s=once(s,'</head>','<link rel="stylesheet" href="/assets/fbo-box-progress-20261121.css"></head>')
save('web','index.html',s)
