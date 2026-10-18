from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/wb-first-publication-20261018')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
v=json.loads((r/'base.json').read_text());names=json.loads((r/'api-changes.json').read_text())
assert all(d('inspect',n,'--format','{{.Image}}')==image for n,image in v.items())
assert json.loads((r/'tests.json').read_text())['passed']
(r/'api/Dockerfile').write_text('FROM '+v['infra-api-1']+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:wb-first-publication-20261018',str(r/'api')],check=True)
candidate=d('image','inspect','logoff-api:wb-first-publication-20261018','--format','{{.Id}}')
def hashes(image):
 return {l.split(maxsplit=1)[1].removeprefix('/app/apps/api/dist/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
old=hashes(v['infra-api-1']);new=hashes(candidate);assert set(old)<=set(new) and {n for n in new if old.get(n)!=new[n]}==set(names)
proof=json.loads(d('run','--rm','--network','none','-v',str(r)+':/test:ro','--entrypoint','node',candidate,'/test/smoke.cjs').splitlines()[-1]);assert proof['passed']==11
out={'passed':True,'base':v,'candidate':candidate,'changed':names,'hashes':{n:new[n] for n in names},'proof':proof}
(r/'verification.json').write_text(json.dumps(out));print(json.dumps(out))
