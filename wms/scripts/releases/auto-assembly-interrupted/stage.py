from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/auto-assembly-interrupted')
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-api-1']['image'];web=m['containers']['infra-web-1']['image']
assert d('inspect','infra-api-1','--format','{{.Image}}')==base
assert d('inspect','infra-web-1','--format','{{.Image}}')==web
names=json.loads((r/'api-changes.json').read_text())
(r/'api/Dockerfile').write_text('FROM '+base+'\nENV WMS_AUTO_ASSEMBLY_DURABLE_ENABLED=true\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:auto-assembly-interrupted',str(r/'api')],check=True)
candidate=d('image','inspect','logoff-api:auto-assembly-interrupted','--format','{{.Id}}');root='/app/apps/api/dist/'
hashes={line.split(maxsplit=1)[1].removeprefix(root):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',candidate,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
old=m['artifacts']['api-runtime.tar.gz']['files'];assert set(old)<=set(hashes) and {n for n in hashes if old.get(n)!=hashes[n]}==set(names)
proof=json.loads(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',candidate,'/test/smoke.cjs').splitlines()[-1]);assert proof['passed']
v={'passed':True,'base':base,'web':web,'candidate':candidate,'changed':names,'hashes':hashes,'proof':proof}
(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'verified':True,'candidate':candidate,'proof':proof}))
