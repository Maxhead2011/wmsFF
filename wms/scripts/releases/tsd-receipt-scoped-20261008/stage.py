import pathlib,json,subprocess
r=pathlib.Path('/opt/logoff-wms/wms/work/tsd-receipt-scoped-20261008');old=json.loads((r/'before.json').read_text());m=json.loads((r/'manifest.json').read_text())
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
base=old['containers']['infra-api-1']['image'];assert d('inspect','infra-api-1','--format','{{.Image}}')==base
name='modules/warehouse/receipt-channel-policy.js';root='/app/apps/api/dist'
(r/'api/Dockerfile').write_text('FROM '+base+'\nCOPY '+name+' '+root+'/'+name+'\n')
tag='logoff-api:tsd-receipt-scoped-20261008';subprocess.run(['docker','build','--network','none','-t',tag,str(r/'api')],check=True)
image=d('image','inspect',tag,'--format','{{.Id}}')
actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',image,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()};expected=m['artifacts']['api-runtime.tar.gz']['files']
assert set(expected)==set(actual);assert {n for n in actual if expected[n]!=actual[n]}=={name}
(r/'verification.json').write_text(json.dumps({'passed':True,'base':base,'candidate':image,'hashes':actual}));print('STAGE PASSED')
