from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/sorting-cancel-20261019');r.mkdir(parents=True,exist_ok=True)
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
base={n:d('inspect',n,'--format','{{.Image}}') for n in ['infra-api-1','infra-web-1']};assert base['infra-api-1']=='sha256:cc67e61c67e7b91b57103ab2f7822d46acf6a9da7f340f80fdd20a70b7744b04';assert base['infra-web-1']=='sha256:17d48a4b29beb5f889db8aa0ae233e5ef8bc5b5c219024ac09d01c083c2ddefc';(r/'base.json').write_text(json.dumps(base))
names=['modules/inventory/pallet-sorting.service.js','modules/inventory/dto/pallet-sorting.dto.js'];(r/'api/Dockerfile').write_text('FROM '+base['infra-api-1']+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names));subprocess.run(['docker','build','--network','none','-t','logoff-api:sorting-cancel-20261019',str(r/'api')],check=True)
candidate=d('image','inspect','logoff-api:sorting-cancel-20261019','--format','{{.Id}}')
def hashes(image):return {l.split(maxsplit=1)[1]:l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()}
a,b=hashes(base['infra-api-1']),hashes(candidate);assert set(a)==set(b);assert {n for n in b if a[n]!=b[n]}=={'/app/apps/api/dist/'+n for n in names}
proof=json.loads(d('run','--rm','--network','none','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',candidate,'/test/smoke.cjs').splitlines()[-1]);assert proof['passed']==13
out={'base':base,'api':candidate,'apiHashes':{n:b['/app/apps/api/dist/'+n] for n in names},'proof':proof};(r/'api-verification.json').write_text(json.dumps(out));print(json.dumps(out))
