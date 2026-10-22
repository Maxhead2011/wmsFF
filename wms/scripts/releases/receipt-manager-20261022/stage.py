from pathlib import Path
import subprocess,json,tarfile
r=Path('/opt/logoff-wms/wms/work/receipt-manager-20261022')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
b=json.loads((r/'base.json').read_text());assert all(d('inspect',n,'--format','{{.Image}}')==i for n,i in b.items())
with tarfile.open('/tmp/receipt-manager-20261022-payload.tgz') as t:
 for m in t.getmembers():assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts and not m.issym() and not m.islnk()
 t.extractall(r)
assert json.loads((r/'browser-proof.json').read_text())['passed']==9
names=['modules/warehouse/receipt-channels.controller.js','modules/warehouse/receipt-direction-access.js']
(r/'api/Dockerfile').write_text('FROM '+b['infra-api-1']+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
(r/'web/Dockerfile').write_text('FROM '+b['infra-web-1']+'\nCOPY assets/ /usr/share/nginx/html/assets/\nCOPY index.html /usr/share/nginx/html/index.html\n')
out={'base':b}
for kind,prefix in [('api','/app/apps/api/dist/'),('web','/usr/share/nginx/html/')]:
 subprocess.run(['docker','build','--network','none','-t','logoff-'+kind+':receipt-manager-20261022',str(r/kind)],check=True)
 image=d('image','inspect','logoff-'+kind+':receipt-manager-20261022','--format','{{.Id}}');out[kind]=image
 def hashes(img):return {l.split(maxsplit=1)[1][len(prefix):]:l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+prefix+' -type f -exec sha256sum {} +').splitlines()}
 a,z=hashes(b['infra-'+kind+'-1']),hashes(image);expected=names if kind=='api' else json.loads((r/'web-changes.json').read_text());assert set(a)<=set(z);assert {n for n in z if a.get(n)!=z[n]}==set(expected);out[kind+'Hashes']={n:z[n] for n in expected}
proof=json.loads(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',out['api'],'/test/smoke.cjs').splitlines()[-1]);assert proof['passed']==11;out['proof']=proof;(r/'verification.json').write_text(json.dumps(out));print(json.dumps(out))
