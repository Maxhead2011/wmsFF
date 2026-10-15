from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/fbs-polling-20261015')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image):
 root='/usr/share/nginx/html'
 return {l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
images=json.loads((r/'images.json').read_text());names=json.loads((r/'web-changes.json').read_text())
assert all(d('inspect',n,'--format','{{.Image}}')==v for n,v in images.items())
assert json.loads((r/'tests.json').read_text())['passed']
(r/'web/Dockerfile').write_text('FROM '+images['infra-web-1']+'\n'+''.join('COPY '+n+' /usr/share/nginx/html/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-web:fbs-polling-20261015',str(r/'web')],check=True)
candidate=d('image','inspect','logoff-web:fbs-polling-20261015','--format','{{.Id}}');before=hashes(images['infra-web-1']);after=hashes(candidate)
assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(names)
v={'passed':True,'base':images,'candidate':candidate,'changed':names,'hashes':{n:after[n] for n in names}}
(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'passed':True,'candidate':candidate,'files':len(names)}))
