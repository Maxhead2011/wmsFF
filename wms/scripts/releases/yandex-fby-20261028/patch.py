"""Apply only reviewed compiled deltas to the current production snapshot."""
import json,re,difflib,hashlib,sys,tarfile
from pathlib import Path
r=Path(sys.argv[1]);repo=Path(__file__).resolve().parents[4]
with tarfile.open(repo/'wms/baselines/our-wms/2026-10-28-lamoda-client/api-runtime.tar.gz') as t: original={m.name:t.extractfile(m).read().decode('utf-8') for m in t.getmembers() if m.isfile()}
changes=[]
def replace(s,a,b):
 assert s.count(a)==1,(n,a[:150]);return s.replace(a,b,1)
for n,v in json.loads((r/'compiled.json').read_text(encoding='utf-8')).items():
 p=r/'candidate'/n
 if v['old'] is None:
  assert n not in original,n;s=v['next']
 elif n=='app.module.js':
  s=replace(original[n],'imports: [','imports: [require("./modules/yandex-fby/yandex-fby.module").YandexFbyModule, ')
 elif n=='modules/client-requests/client-requests.service.js':
  s=replace(original[n],'include: { ...clientRequestInclude,','include: { ...clientRequestInclude, ...(process.env.WMS_YANDEX_FBY_ENABLED === "true" ? {yandexFbyShipment:{select:{requestId:true}}}:{}),')
  s=replace(s,'async update(id, dto, user) {','async update(id, dto, user) {\nif(dto.items!==undefined && process.env.WMS_YANDEX_FBY_ENABLED === "true" && await this.prisma.yandexFbyShipment.findUnique({where:{requestId:id}})) throw new common_1.BadRequestException("FBY composition is fixed by the verified supply.");')
 elif n=='modules/client-requests/client-request-marketplace-files.service.js':
  s=replace(original[n],"if (process.env.WMS_LAMODA_ENABLED",'if(process.env.WMS_YANDEX_FBY_ENABLED === "true" && await this.prisma.yandexFbyShipment.findUnique({where:{requestId}})) throw new common_1.BadRequestException("FBY cannot export Wildberries files.");\nif (process.env.WMS_LAMODA_ENABLED')
 elif n=='modules/tsd/tsd-assembly.service.js':
  s=replace(original[n],"!['WB', 'OZON',", "!['WB', 'OZON', 'YANDEX_MARKET',")
  s=replace(s,'const fboFilter =',"const yandexScope = require('../yandex-fby/yandex-fby-scope').fbyQueueScope(marketplace);\nconst fboFilter =")
  s=replace(s,'...fboFilter,','...fboFilter, ...yandexScope,')
 elif n=='modules/tsd/fbo-two-stage.service.js':
  s=replace(original[n],'async snapshot(tx, r, context = {}) {','async snapshot(tx, r, context = {}) {\nconst yandex=process.env.WMS_YANDEX_FBY_ENABLED === "true" ? await tx.yandexFbyShipment.findUnique({where:{requestId:r.id},select:{id:true}}):null;')
  s=replace(s,"marketplace:lamoda?'LAMODA'", "marketplace:yandex?'YANDEX_MARKET':lamoda?'LAMODA'")
 else:
  s=original[n];old=v['old'].splitlines(True);new=v['next'].splitlines(True)
  for group in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3):
   before=''.join(old[group[0][1]:group[-1][2]]);after=''.join(new[group[0][3]:group[-1][4]])
   if s.count(before)==1:s=s.replace(before,after,1)
   else:
    pattern=r'\s+'.join(re.escape(t) for t in re.split(r'\s+',before.strip()))
    matches=list(re.finditer(pattern,s));assert len(matches)==1,(n,'context mismatch',before[:500])
    m=matches[0];s=s[:m.start()]+after.strip()+s[m.end():]
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(s.encode());out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(p.read_bytes());changes.append(n)
(r/'api-changes.json').write_text(json.dumps(changes))
s=(repo/'wms/baselines/our-wms/2026-10-28-lamoda-client/api-schema.prisma').read_text(encoding='utf-8');(r/'api/schema-before.prisma').write_bytes(s.encode())
for model,field in [('ClientRequest','yandexFbyShipment YandexFbyShipment?'),('ClientMarketplaceConnection','yandexFbyShipments YandexFbyShipment[]')]:
 needle='model '+model+' {';assert s.count(needle)==1;s=s.replace(needle,needle+'\n  '+field,1)
source=(repo/'wms/apps/api/prisma/schema.prisma').read_text(encoding='utf-8');m=re.search(r'model YandexFbyShipment \{[\s\S]*?\n\}',source);assert m;s+='\n'+m[0]+'\n';(r/'api/schema.prisma').write_bytes(s.encode())
print(json.dumps({'api':changes}))
