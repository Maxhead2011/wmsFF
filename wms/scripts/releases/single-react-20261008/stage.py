import pathlib,json,subprocess
r=pathlib.Path('/opt/logoff-wms/wms/work/soul-runtime-fix-20261008');old=json.loads((r/'before.json').read_text());m=json.loads((r/'manifest.json').read_text())
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
base=old['containers']['infra-web-1']['image'];assert d('inspect','infra-web-1','--format','{{.Image}}')==base
changes=json.loads((r/'web-changes.json').read_text());root='/usr/share/nginx/html'
(r/'web/Dockerfile').write_text('\n'.join(['FROM '+base]+['COPY '+n+' '+root+'/'+n for n in changes])+'\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:single-react-20261008',str(r/'web')],check=True)
image=d('image','inspect','logoff-web:single-react-20261008','--format','{{.Id}}')
actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()};expected=m['artifacts']['web-runtime.tar.gz']['files']
assert set(expected)<=set(actual);assert {n for n in actual if expected.get(n)!=actual[n]}==set(changes)
(r/'verification.json').write_text(json.dumps({'passed':True,'base':base,'candidate':image,'hashes':actual}));print('STAGE PASSED')
