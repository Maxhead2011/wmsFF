import pathlib,subprocess,json,hashlib
r=pathlib.Path('/opt/logoff-wms-releases/fbo-sequential-20260924')
def run(*a):return subprocess.check_output(a).decode().strip()
before=json.loads((r/'live-before.json').read_text())['images']['api'];after=run('docker','image','inspect','-f','{{.Id}}','logoff-api:fbo-sequential-release')
assert run('docker','inspect','-f','{{.Image}}','infra-api-1')==before
command='find /app/apps/api/src /app/apps/api/dist /app/apps/api/prisma -type f -exec sha256sum {} +'
def manifest(args):return {s.split(None,1)[1]:s.split(None,1)[0] for s in run(*args,'sh','-c',command).splitlines()}
a=manifest(['docker','exec','infra-api-1']);b=manifest(['docker','run','--rm','--network','none','--entrypoint','/usr/bin/env',after])
allowed=set()
for p in (r/'candidate/wms/apps/api/src').rglob('*.ts'):
 name='/app/'+p.relative_to(r/'candidate/wms').as_posix();allowed.add(name)
 assert b[name]==hashlib.sha256(p.read_bytes()).hexdigest(),name
 base=name.replace('/src/','/dist/')[:-3]
 allowed.update(base+x for x in ['.js','.js.map','.d.ts'])
changes={p for p in a.keys()|b.keys() if a.get(p)!=b.get(p)}
assert changes<=allowed,changes-allowed
assert set(a)<=set(b),'Deleted file'
for k in ['Env','Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Labels','Volumes']:
 old=json.loads(run('docker','image','inspect',before))[0]['Config'];new=json.loads(run('docker','image','inspect',after))[0]['Config'];assert old.get(k)==new.get(k),k
v={'passed':True,'before':before,'after':after,'changes':sorted(changes),'unrelatedSourceDistSchemaPreserved':True,'configPreserved':True}
(r/'images.json').write_text(json.dumps(v,indent=2));print(json.dumps(v))
