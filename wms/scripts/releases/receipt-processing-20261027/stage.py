from pathlib import Path
import subprocess,json,hashlib
r=Path('/opt/logoff-wms/wms/work/receipt-processing-20261027')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
base=json.loads((r/'base.json').read_text());out={'base':base,'images':{},'hashes':{}}
assert json.loads((r/'browser-proof.json').read_text())['passed']==12
for kind,prefix in [('api','/app/apps/api/dist/'),('web','/usr/share/nginx/html/')]:
 assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==base[kind]
 names=json.loads((r/(kind+'-changes.json')).read_text())
 (r/kind/'Dockerfile').write_text('FROM '+base[kind]+'\n'+('ENV WMS_RECEIPT_PROCESSING_ENABLED=true\n' if kind=='api' else '')+''.join('COPY '+n+' '+prefix+n+'\n' for n in names))
 subprocess.run(['docker','build','--network','none','-t','logoff-'+kind+':receipt-processing-20261027',str(r/kind)],check=True)
 image=d('image','inspect','logoff-'+kind+':receipt-processing-20261027','--format','{{.Id}}')
 def hashes(img):return {l.split(maxsplit=1)[1][len(prefix):]:l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+prefix+' -type f -exec sha256sum {} +').splitlines()}
 before,after=hashes(base[kind]),hashes(image);assert set(before)<=set(after);assert {n for n in after if before.get(n)!=after[n]}==set(names)
 out['images'][kind]=image;out['hashes'][kind]={n:after[n] for n in names}
proof=json.loads(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',out['images']['api'],'/test/runtime.cjs').splitlines()[-1]);assert proof['passed']==18
out['runtime']=proof;(r/'verification.json').write_text(json.dumps(out));print(json.dumps(out['images']))
