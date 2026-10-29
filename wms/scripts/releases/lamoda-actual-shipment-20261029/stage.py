from pathlib import Path
import subprocess,json
r=Path('/opt/logoff-wms/wms/work/lamoda-actual-shipment-20261029')
base={'api':'sha256:507fc3f3a8a155623d0e370fb720cfc4804830178508a99050e1bc91730af4f9','web':'sha256:74da6681679f76f73e9f4a6b4b9f72e4f300a723d3bdb3f35c95e2bd0442eb29'}
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
v={'images':{},'base':base}
for k,image in base.items():
 assert d('inspect','infra-'+k+'-1','--format','{{.Image}}')==image,'Production changed'
 root='/app/apps/api/dist/' if k=='api' else '/usr/share/nginx/html/'
 extra='\nENV WMS_LAMODA_FBO_SUBMISSION_ENABLED=true\nCOPY schema.prisma /app/apps/api/prisma/schema.prisma' if k=='api' else ''
 (r/k/'Dockerfile').write_text('FROM '+image+'\nCOPY payload/ '+root+extra+'\n')
 if k=='api':(r/k/'schema.prisma').write_bytes((r/'schema.prisma').read_bytes())
 tag='logoff-'+k+':lamoda-actual-shipment-20261029'
 subprocess.run(['docker','build','--network','none','-t',tag,str(r/k)],check=True)
 v['images'][k]=d('image','inspect',tag,'--format','{{.Id}}')
(r/'verification.json').write_text(json.dumps(v));print(json.dumps(v))
