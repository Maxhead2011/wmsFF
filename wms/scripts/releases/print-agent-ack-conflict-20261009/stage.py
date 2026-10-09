"""Build a web image with exactly one changed download; no application code replacement."""
from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/print-agent-ack-conflict-20261009')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(image):
 root='/usr/share/nginx/html'
 return {line.split(maxsplit=1)[1].removeprefix(root+'/'):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
before=json.loads((r/'before.json').read_text());tests=json.loads((r/'tests.json').read_text())
assert tests['passed']
for name in ['infra-api-1','infra-web-1']:assert d('inspect',name,'--format','{{.Image}}')==before['containers'][name]['image'],'Production changed'
base=before['containers']['infra-web-1']['image']
package=r/'LOGOFF-FBS-Print-Agent.zip';sha=hashlib.sha256(package.read_bytes()).hexdigest();assert sha==tests['packageSha256']
(r/'Dockerfile').write_text('FROM '+base+'\nCOPY LOGOFF-FBS-Print-Agent.zip /usr/share/nginx/html/downloads/LOGOFF-FBS-Print-Agent.zip\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:print-agent-ack-conflict-20261009',str(r)],check=True)
candidate=d('image','inspect','logoff-web:print-agent-ack-conflict-20261009','--format','{{.Id}}');old=hashes(base);new=hashes(candidate)
assert set(old)==set(new) and [n for n in new if old[n]!=new[n]]==['downloads/LOGOFF-FBS-Print-Agent.zip']
assert old['downloads/LOGOFF-FBS-Print-Agent.zip']==before['agentSha256']
v={'passed':True,'base':base,'candidate':candidate,'api':before['containers']['infra-api-1']['image'],'packageSha256':sha,'changed':['downloads/LOGOFF-FBS-Print-Agent.zip'],'hashes':new,'tests':tests}
(r/'verification.json').write_text(json.dumps(v,indent=2));print(json.dumps({k:v[k] for k in ['passed','base','candidate','packageSha256','changed']}))
