import pathlib,subprocess,json,hashlib,re,zipfile,datetime,shutil
r=pathlib.Path('/opt/logoff-wms/wms/work/client-warehouse-20261007');before=json.loads((r/'before.json').read_text());baseline=json.loads((r/'manifest.json').read_text())
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def sha(b):return hashlib.sha256(b).hexdigest()
for kind in ['api','web']:assert d('inspect','infra-'+kind+'-1','--format','{{.Image}}')==before['containers']['infra-'+kind+'-1']['image'],'Concurrent release'
result={'apk':before['apk']}
for kind,root in [('api','/app/apps/api/dist'),('web','/usr/share/nginx/html')]:
 base=before['containers']['infra-'+kind+'-1']['image'];source=r/kind;changes=json.loads((r/(kind+'-changes.json')).read_text())
 (source/'Dockerfile').write_text('\n'.join(['FROM '+base]+(['ENV WMS_CLIENT_WAREHOUSE_ENABLED=true'] if kind=='api' else [])+['COPY '+n+' '+root+'/'+n for n in changes])+'\n')
 tag='logoff-'+kind+':client-warehouse-20261007'
 subprocess.run(['docker','build','--network','none','-t',tag,str(source)],check=True)
 lines=d('run','--rm','--network','none','--entrypoint','sh',tag,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()
 actual={l.split(maxsplit=1)[1].removeprefix(root+'/'):l.split()[0] for l in lines};old=baseline['artifacts'][kind+'-runtime.tar.gz']['files']
 assert set(old)<=set(actual),'Removed file'
 assert {n for n in old.keys()|actual.keys() if old.get(n)!=actual.get(n)}==set(changes),'Unexpected runtime delta'
 result[kind]={'base':base,'candidate':d('image','inspect',tag,'--format','{{.Id}}'),'hashes':actual}
print(d('run','--rm','--network','none','-v',str(r)+':/release:ro','-w','/app/apps/api','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','--entrypoint','node',result['api']['candidate'],'--test','/release/runtime.test.cjs'))
result['passed']=True;(r/'verification.json').write_text(json.dumps(result));print('STAGE PASSED')
