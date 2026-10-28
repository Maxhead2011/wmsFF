"""FIX: apply unique contextual compiled deltas; never replace a divergent business module."""
import json,difflib,sys,hashlib,re,tarfile
from pathlib import Path
r=Path(sys.argv[1]);repo=Path(__file__).resolve().parents[4];changes=[]
with tarfile.open(repo/'wms/baselines/our-wms/2026-10-28-lamoda-country/api-runtime.tar.gz') as t: original={m.name:t.extractfile(m).read().decode('utf-8') for m in t.getmembers() if m.isfile()}
for n,v in json.loads((r/'compiled.json').read_text()).items():
 p=r/'candidate'/n
 if v['old'] is None:
  assert n not in original,n;s=v['next']
 elif n=='modules/administration/administration-internal-api.service.js':
  s=original[n];pattern=r"\{\s*id: 'lamoda',[\s\S]*?\n\s*\}"
  matches=re.findall(pattern,s);nexts=re.findall(pattern,v['next']);assert len(matches)==len(nexts)==1;s=s.replace(matches[0],nexts[0])
 elif n=='modules/client-requests/client-requests.service.js':
  s=original[n]
  for before,after in [('include: { ...clientRequestInclude,','include: { ...clientRequestInclude, ...(process.env.WMS_LAMODA_ENABLED === "true" ? {lamodaAssembly:{select:{requestId:true}}}:{}),'),('async update(id, dto, user) {','async update(id, dto, user) {\nif(dto.items!==undefined && process.env.WMS_LAMODA_ENABLED === "true" && await this.prisma.lamodaFboAssembly.findUnique({where:{requestId:id}})) throw new common_1.BadRequestException("Lamoda assembly composition is controlled by its plan.");')]:
   assert s.count(before)==1;s=s.replace(before,after,1)
 elif n=='modules/tsd/fbo-two-stage.service.js':
  s=original[n]
  for key in ['r.id','id']:
   before="const shipment=process.env.WMS_OZON_FBO_IMPORT_ENABLED==='true'?await tx.ozonFboShipment.findUnique({where:{requestId:"+key+"}}):null;"
   after=before.replace('const shipment=','const ozonShipment=')+"\nconst lamoda=process.env.WMS_LAMODA_ENABLED==='true'?await tx.lamodaFboAssembly.findUnique({where:{requestId:"+key+"}}):null;\nif(lamoda&&!require('../lamoda/lamoda-fbo-policy').lamodaAssemblyEnabled())throw new common_1.BadRequestException('Lamoda assembly is disabled.');\nconst shipment=ozonShipment??(lamoda?{...lamoda,integration:null}:null);"
   assert s.count(before)==1;s=s.replace(before,after)
  replacements=[("marketplace:shipment?'OZON':'WILDBERRIES'","marketplace:lamoda?'LAMODA':shipment?'OZON':'WILDBERRIES'"),("ozonReopenSupported(shipment)","ozonReopenSupported(ozonShipment)"),("packingByProductSupported:!!shipment","packingByProductSupported:!!ozonShipment"),("packingSuggestions:shipment&&","packingSuggestions:ozonShipment&&"),("ozonPackingSuggestions(shipment.directions","ozonPackingSuggestions(ozonShipment.directions"),("reopenOzonBox(tx,shipment,","reopenOzonBox(tx,ozonShipment,")]
  for before,after in replacements:assert s.count(before)==1,(n,before);s=s.replace(before,after)
  pat=r"plan\.marketplace\s*===\s*['\"]OZON['\"]";assert len(re.findall(pat,s))==1;s=re.sub(pat,"plan.marketplace !== 'WILDBERRIES'",s)
 else:
  s=original[n];old=v['old'].splitlines(True);new=v['next'].splitlines(True)
  for group in list(difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3)):
   a,b=group[0][1],group[-1][2];c,d=group[0][3],group[-1][4]
   before=''.join(old[a:b]);after=''.join(new[c:d])
   if s.count(before)==1:s=s.replace(before,after,1)
   else:
    pattern=r'\s+'.join(re.escape(part) for part in re.split(r'\s+',before.strip()));matches=list(re.finditer(pattern,s));assert len(matches)==1,(n,'runtime context does not match',before[:180]);m=matches[0];s=s[:m.start()]+after.strip()+s[m.end():]
 if n in original and s==original[n]:continue
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(s.encode('utf-8'));out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(p.read_bytes());changes.append(n)
(r/'api-changes.json').write_text(json.dumps(changes));(r/'api-hashes.json').write_text(json.dumps({n:hashlib.sha256((r/'candidate'/n).read_bytes()).hexdigest() for n in changes}))
schema=(repo/'wms/baselines/our-wms/2026-10-28-lamoda-country/api-schema.prisma').read_bytes();(r/'api/schema-before.prisma').write_bytes(schema)
s=schema.decode();source=(repo/'wms/apps/api/prisma/schema.prisma').read_text(encoding='utf-8')
for model,field in [('LamodaAccount','operations LamodaOperation[]'),('LamodaPlan','assembly LamodaFboAssembly?'),('ClientRequest','lamodaAssembly LamodaFboAssembly?')]:
 needle='model '+model+' {';assert s.count(needle)==1;s=s.replace(needle,needle+'\n  '+field,1)
for name in ['LamodaOperation','LamodaFboAssembly']:
 m=re.search(r'model '+name+r' \{[\s\S]*?\n\}',source);assert m and 'model '+name not in s;s+='\n'+m[0]+'\n'
(r/'api/schema.prisma').write_text(s,encoding='utf-8');print(json.dumps({'api':changes}))

