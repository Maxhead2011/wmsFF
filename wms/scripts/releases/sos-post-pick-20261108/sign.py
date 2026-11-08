from pathlib import Path
import json,subprocess,os,re,hashlib,datetime,xml.etree.ElementTree as ET
r=Path('/opt/wms-sos-post-pick-20261108');tools=Path('/opt/wms-tsd253/sdk/build-tools/35.0.0');cfg={'keystore':os.environ['SOS_SIGN_KEYSTORE'],'alias':os.environ['SOS_SIGN_ALIAS']};env=os.environ.copy()
out=r/'web-payload/downloads';out.mkdir(parents=True,exist_ok=True)
apk=out/'logoff-sos-wb-9-post-pick.apk'
subprocess.run([str(tools/'apksigner'),'sign','--ks',cfg['keystore'],'--ks-key-alias',cfg['alias'],'--ks-pass','env:SOS_SIGN_PASSWORD','--key-pass','env:SOS_SIGN_PASSWORD','--out',str(apk),str(r/'android/app/build/outputs/apk/release/app-release-unsigned.apk')],env=env,check=True)
def cert(p):return re.search(r'Signer #1 certificate SHA-256 digest: (\w+)',subprocess.check_output([str(tools/'apksigner'),'verify','--print-certs',str(p)],text=True))[1]
assert cert(apk)==cert(Path('/opt/wms-sos-servers-20261103/release/logoff-sos-wb-8-server-choice.apk'))
meta={'packageId':'pro.logoff.wms.soswb.v2','versionCode':9,'versionName':'1.3.0-post-pick','apkUrl':'https://wms.logoff.pro/downloads/'+apk.name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'size':apk.stat().st_size,'releasedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseNotes':'Печать по заявке после отбора WB/Ozon для клиентов без обязательных КИЗ. Без повторного списания. Выбор серверов и меню КИЗ сохранены.'}
(out/'logoff-sos-wb.apk').write_bytes(apk.read_bytes());(out/'logoff-sos-wb.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
results=[ET.parse(p).getroot().attrib for p in (r/'android/app/build/test-results/testDebugUnitTest').glob('TEST*.xml')]
assert all(x['failures']=='0' and x['errors']=='0' for x in results)
(r/'android-proof.json').write_text(json.dumps({'tests':sum(int(x['tests']) for x in results),'signatureMatches':True,'apk':meta}))
(r/'web-changes.json').write_text(json.dumps(['downloads/'+p.name for p in out.iterdir() if not p.name.endswith('.idsig')]))
print('Signed APK9: previous certificate retained; Android tests',sum(int(x['tests']) for x in results))
