from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/lamoda-blank-price-20261029')
base={'api':'sha256:f33531eec9e46367f3ca2b131201ac9ee781bf1288afdd41abe0166c04aa5688','web':'sha256:27b0d707b39797cbe0763e7c453cde8a10933da497d68b7e2d02081239467036'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
v={'images':{},'base':base}
for k,image in base.items():
 assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==image,'Production changed'
 root='/app/apps/api/dist/' if k=='api' else '/usr/share/nginx/html/'
 (r/k/'Dockerfile').write_text('FROM '+image+'\nCOPY payload/ '+root+'\n')
 tag='logoff-'+k+':lamoda-blank-price-20261029'
 subprocess.run(['docker','build','--network','none','-t',tag,str(r/k)],check=True)
 v['images'][k]=d('image','inspect',tag,'--format','{{.Id}}')
(r/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
