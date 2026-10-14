from pathlib import Path
import subprocess,json,hashlib,re
r=Path('/opt/logoff-wms/wms/work/sidebar-contrast-20261014')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
def hashes(img):
 root='/usr/share/nginx/html/'
 return {l.split(maxsplit=1)[1].removeprefix(root):l.split()[0] for l in d('run','--rm','--network','none','--entrypoint','sh',img,'-c','find '+root+' -type f -exec sha256sum {} +').splitlines()}
m=json.loads((r/'manifest.json').read_text());base=m['containers']['infra-web-1']['image'];api=m['containers']['infra-api-1']['image']
assert d('inspect','infra-web-1','--format','{{.Image}}')==base and d('inspect','infra-api-1','--format','{{.Image}}')==api
html=d('exec','infra-web-1','cat','/usr/share/nginx/html/index.html');css=(r/'fix.css').read_bytes();name='assets/sidebar-count-'+hashlib.sha256(css).hexdigest()[:12]+'.css'
assert html.count('</head>')==1
out=r/'context/overlay';(out/'assets').mkdir(parents=True,exist_ok=True);(out/name).write_bytes(css)
(out/'index.html').write_text(html.replace('</head>','<link rel="stylesheet" href="/'+name+'">\n</head>'))
(r/'context/Dockerfile').write_text('FROM '+base+'\nCOPY overlay/ /usr/share/nginx/html/\n')
subprocess.run(['docker','build','--network','none','-t','logoff-web:sidebar-contrast-20261014',str(r/'context')],check=True)
candidate=d('image','inspect','logoff-web:sidebar-contrast-20261014','--format','{{.Id}}');before=hashes(base);after=hashes(candidate);changed=['index.html',name]
assert set(before)<=set(after) and {n for n in after if before.get(n)!=after[n]}==set(changed)
v={'passed':True,'base':base,'api':api,'candidate':candidate,'changed':changed,'hashes':after,'apk':json.loads((r/'apk.json').read_text())};(r/'verification.json').write_text(json.dumps(v));print(json.dumps({'staged':True,'candidate':candidate,'changed':changed}))
