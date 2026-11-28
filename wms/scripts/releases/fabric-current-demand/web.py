from pathlib import Path
import json,hashlib,sys
r=Path(sys.argv[1]);webbase=Path(sys.argv[2]);base=json.loads((r/'base.json').read_text());sha=lambda d:hashlib.sha256(d).hexdigest()
a=r/'web/assets';a.mkdir(parents=True,exist_ok=True)
html=(webbase/'index.html').read_bytes();assert sha(html)==base['webFiles']['index.html']
web=['index.html']
for name in ['warehouse-fabric-materials-20261125','fabric-rolls-materials-20261125']:
 file=name+'.js';source=(webbase/'assets'/file).read_bytes();assert sha(source)==base['webFiles']['assets/'+file]
 s=source.decode()
 if name.startswith('warehouse'):
  needle='t.createElement("p", null, "FBS: ", e.fbs.pieces'
  replacement='t.createElement("p",null,"Необходимо · FBS: ",e.required.fbs.pieces," отрезов / ",e.required.fbs.meters," м · FBO: ",e.required.fbo.pieces," отрезов / ",e.required.fbo.meters," м"), t.createElement("p", null, "Отгружено · FBS: ", e.fbs.pieces'
 else:
  needle="h('p',{className:'muted'},'FBS WB отгружено: '+num(g.fbs.pieces)"
  replacement="h('p',{className:'muted'},'Необходимо · FBS: '+num(g.required.fbs.pieces)+' отрезов / '+num(g.required.fbs.meters)+' м · FBO: '+num(g.required.fbo.pieces)+' отрезов / '+num(g.required.fbo.meters)+' м'),h('p',{className:'muted'},'Отгружено · FBS: '+num(g.fbs.pieces)"
  s=s.replace("+' м'),h('p',{className:'muted'},'FBO — сданные заявки: '","+' м · FBO: '")
 assert s.count(needle)==1
 new=file.replace('materials-20261125','demand-20261128')
 (a/new).write_text(s.replace(needle,replacement),encoding='utf8');html=html.replace(file.encode(),new.encode());web.append('assets/'+new)
(r/'web/index.html').write_bytes(html);(r/'web-changes.json').write_text(json.dumps(web))
