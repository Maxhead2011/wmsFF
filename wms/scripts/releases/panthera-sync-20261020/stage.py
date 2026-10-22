from pathlib import Path
import subprocess,json,time,uuid
r=Path('/opt/logoff-wms/wms/work/panthera-sync-20261020')
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
m=json.loads((r/'manifest.json').read_text());api=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image']
assert d('inspect','infra-api-1','--format','{{.Image}}')==api
assert d('inspect','infra-web-1','--format','{{.Image}}')==web
assert json.loads((r/'browser-proof.json').read_text())['passed']
def hashes(image,root):
 return {line.split(maxsplit=1)[1].removeprefix(root):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
def build(kind,base,root):
 names=json.loads((r/(kind+'-changes.json')).read_text())
 (r/kind/'Dockerfile').write_text('FROM '+base+'\n'+''.join('COPY '+n+' '+root+n+'\n' for n in names))
 subprocess.run(['docker','build','--network','none','-t','logoff-'+kind+':panthera-sync-20261020',str(r/kind)],check=True)
 image=d('image','inspect','logoff-'+kind+':panthera-sync-20261020','--format','{{.Id}}')
 before,after=hashes(base,root),hashes(image,root)
 assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(names)
 return {'image':image,'hashes':{n:after[n] for n in names}}
a=build('api',api,'/app/apps/api/dist/');w=build('web',web,'/usr/share/nginx/html/')
name='favorites-test-'+uuid.uuid4().hex[:12]
pg=d('inspect','infra-postgres-1','--format','{{.Image}}')
try:
 d('run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',pg)
 for attempt in range(30):
  if subprocess.run(['docker','exec',name,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('disposable PostgreSQL did not start')
 proof=json.loads(d('run','--rm','--network','container:'+name,'-e','DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres','-e','FAVORITES_DISPOSABLE_TEST=yes','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',a['image'],'/test/smoke.cjs').splitlines()[-1])
 assert proof['passed']
finally:
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
v={'baseApi':api,'baseWeb':web,'api':a,'web':w,'proof':proof};(r/'verification.json').write_text(json.dumps(v))
print(json.dumps(v))
