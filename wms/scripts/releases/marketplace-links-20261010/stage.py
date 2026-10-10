from pathlib import Path
import json,subprocess,hashlib,re,shutil
r=Path('/opt/logoff-wms/wms/work/marketplace-links-20261010')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image,root):return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image']
assert d('inspect','infra-api-1','--format','{{.Image}}')==base and d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text());wn=json.loads((r/'web-changes.json').read_text())
schema=d('exec','infra-api-1','cat','/app/apps/api/prisma/schema.prisma')+'\n'
assert 'model MarketplaceProductLink' not in schema
schema+='\n'+(r/'model.prisma').read_text();(r/'api/schema.prisma').write_text(schema)
(r/'api/Dockerfile').write_text('FROM '+base+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names)+'COPY schema.prisma /app/apps/api/prisma/schema.prisma\nRUN cd /app/apps/api && ./node_modules/.bin/prisma generate\n')
subprocess.run(['docker','build','--network','none','-t','logoff-api:marketplace-links-20261010',str(r/'api')],check=True)
image=d('image','inspect','logoff-api:marketplace-links-20261010','--format','{{.Id}}');actual=hashes(image,'/app/apps/api/dist');expected=m['artifacts']['api-runtime.tar.gz']['files']
assert set(expected)<=set(actual) and {n for n in actual if expected.get(n)!=actual[n]}==set(names)
for n in wn:
 target=r/'web-overlay/overlay'/n;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(r/'web'/n,target)
(r/'web-overlay/Dockerfile').write_text('FROM '+web+'\nCOPY overlay/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:marketplace-links-20261010',str(r/'web-overlay')],check=True)
wi=d('image','inspect','logoff-web:marketplace-links-20261010','--format','{{.Id}}');wh=hashes(wi,'/usr/share/nginx/html');old=hashes(web,'/usr/share/nginx/html')
assert set(old)<=set(wh) and {n for n in wh if old.get(n)!=wh[n]}==set(wn)
assert all(old[n]==wh[n] for n in old if n.startswith('downloads/'))
v={'passed':True,'base':base,'candidate':image,'changed':names,'hashes':actual,'schemaSha256':hashlib.sha256(schema.encode()).hexdigest(),'web':{'base':web,'candidate':wi,'changed':wn,'hashes':wh}}
(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'stagePassed':True,'api':image,'web':wi}))
