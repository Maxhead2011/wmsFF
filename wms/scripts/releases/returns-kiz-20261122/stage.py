"""Build exact own-WMS overlays without publishing or business writes."""
from pathlib import Path
import subprocess,json,hashlib,sys
r=Path(sys.argv[1]);base=json.loads((r/'base.json').read_text())
def run(*a):return subprocess.check_output(a,text=True).strip()
assert run('docker','inspect','wms-local-api','--format','{{.Image}}')==base['baseApi']
assert run('docker','inspect','wms-local-web','--format','{{.Image}}')==base['baseWeb']
images={}
for kind,key in [('api','baseApi'),('web','baseWeb')]:
 d=r/kind
 if kind=='api':
  lines=['FROM '+base[key]]+[f'COPY delta/{p} /app/apps/api/dist/{p}' for p in json.loads((r/'allowed.json').read_text())]
 else:lines=['FROM '+base[key],'COPY index.html /usr/share/nginx/html/index.html','COPY assets/ /usr/share/nginx/html/assets/']
 (d/'Dockerfile').write_text('\n'.join(lines)+'\n')
 tag='logoff-'+kind+':returns-kiz-20261122'
 subprocess.run(['docker','build','-t',tag,str(d)],check=True)
 images[kind]=run('docker','image','inspect',tag,'--format','{{.Id}}')
manifest=json.loads((r/'manifest.json').read_text())
expected=dict(manifest['artifacts']['api-runtime.tar.gz']['files'])
for p in json.loads((r/'allowed.json').read_text()):expected[p]=hashlib.sha256((r/'api/delta'/p).read_bytes()).hexdigest()
code="const fs=require('fs'),crypto=require('crypto');const out={};function walk(d,p=''){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p+e.name;if(e.isDirectory())walk(d+'/'+e.name,q+'/');else if(q.endsWith('.js'))out[q]=crypto.createHash('sha256').update(fs.readFileSync(d+'/'+e.name)).digest('hex')}}walk('/app/apps/api/dist');console.log(JSON.stringify(out))"
actual=json.loads(run('docker','run','--rm','--entrypoint','node',images['api'],'-e',code))
assert actual==expected,'Unexpected API runtime delta'
(r/'stage.json').write_text(json.dumps(dict(images=images,allHashesVerified=True,apiFiles=len(actual)),indent=2))
print(json.dumps(images))
