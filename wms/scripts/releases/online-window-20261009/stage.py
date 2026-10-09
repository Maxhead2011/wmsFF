from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/online-window-latency-20261009');app=Path('/opt/logoff-wms/wms')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
m=json.loads((r/'manifest.json').read_text());images=json.loads((r/'images.json').read_text());api=images['infra-api-1'];web=images['infra-web-1'];assert d('inspect','infra-api-1','--format','{{.Image}}')==api;assert d('inspect','infra-web-1','--format','{{.Image}}')==web
names=['modules/stock/menu-read-catalog.js', 'modules/tsd/online-plan-view.js', 'modules/tsd/dto/fbo-route.dto.js', 'modules/tsd/fbo-two-stage.controller.js', 'modules/tsd/tsd-device.controller.js']
(r/'api/Dockerfile').write_text('FROM '+api+'\n'+''.join('COPY '+n+' /app/apps/api/dist/'+n+'\n' for n in names))
subprocess.run(['docker','build','--network','none','-t','logoff-api:online-window-20261009',str(r/'api')],check=True,stdout=subprocess.DEVNULL)
apiImage=d('image','inspect','logoff-api:online-window-20261009','--format','{{.Id}}')
actual={line.split(maxsplit=1)[1].removeprefix('/app/apps/api/dist/'):line.split()[0] for line in d('run','--rm','--network','none','--entrypoint','sh',apiImage,'-c','find /app/apps/api/dist -type f -exec sha256sum {} +').splitlines()};expected=m['artifacts']['api-runtime.tar.gz']['files'];assert set(expected)<=set(actual);assert {n for n in actual if expected.get(n)!=actual[n]}==set(names)
network=next(iter(json.loads(d('inspect','infra-api-1','--format','{{json .NetworkSettings.Networks}}'))))
base=['run','--rm','--network',network,'--env-file',str(app/'.env'),'-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',apiImage]
tests=d(*base,'--test','/test/runtime.cjs','/test/compact.cjs','/test/menu.cjs');assert '# fail 0' in tests;(r/'runtime.log').write_text(tests)
raw=d(*base,'/test/verify.cjs');proof=json.loads(next(line for line in raw.splitlines() if line.startswith('{"runs"')));assert proof['matched'] and proof['rolledBack'];print(json.dumps(proof))
webNames=[p.relative_to(r/'web').as_posix() for p in (r/'web').rglob('*') if p.is_file() and p.name not in ['Dockerfile','.dockerignore']]
(r/'web/.dockerignore').write_text('Dockerfile\n.dockerignore\n')
(r/'web/Dockerfile').write_text('FROM '+web+'\nCOPY . /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:online-window-20261009',str(r/'web')],check=True,stdout=subprocess.DEVNULL)
webImage=d('image','inspect','logoff-web:online-window-20261009','--format','{{.Id}}')
webHashes={n:d('run','--rm','--network','none','--entrypoint','sha256sum',webImage,'/usr/share/nginx/html/'+n).split()[0] for n in webNames}
v={'passed':True,'base':api,'candidate':apiImage,'changed':names,'hashes':actual,'benchmark':proof,'runtimeTestsPassed':True,'web':{'base':web,'candidate':webImage,'changed':webNames,'hashes':webHashes}}
(r/'verification.json').write_text(json.dumps(v));print('STAGE VERIFIED')
