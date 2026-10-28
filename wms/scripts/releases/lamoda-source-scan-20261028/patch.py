# FIX: exact compiler delta over the latest published modules.
from pathlib import Path
import json,sys
r=Path(sys.argv[1]);v=json.loads((r/'compiled.json').read_text(encoding='utf-8'))
for name,item in v.items():
 s=(r/'runtime'/name).read_text(encoding='utf-8');n=item['next']
 if name.endswith('lamoda-fbo-relabel.js'):
  assert s.strip()==item['old'].strip();s=n
 elif name.endswith('administration-internal-api.service.js'):
  a='routeCount: 103, // FIX: two Lamoda unit-label endpoints added to the published registry.';assert s.count(a)==1;s=s.replace(a,'routeCount: 104, // FIX: physical source-scan resolution endpoint.')
 elif name.endswith('fbo-two-stage.service.js'):
  a=n.index('    async resolveLamodaRelabel(');b=n.index('    async relabelStations(',a);anchor='    async relabelStations(';assert s.count(anchor)==1;s=s.replace(anchor,n[a:b]+anchor)
 elif name.endswith('fbo-two-stage.controller.js'):
  a=n.index('__decorate([\n    (0, common_1.Post)(\'lamoda-relabel/resolve\')');b=n.index('__decorate([',a+12)
  s+='\nFboTwoStageController.prototype.relabelResolve=function(id,body,user){return this.fbo.resolveLamodaRelabel(id,body??{},user);};\n'+n[a:b]
 else:raise ValueError(name)
 for dest in [r/'candidate'/name,r/'api/payload'/name]:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(s.encode())
print('Patched',len(v),'modules')
