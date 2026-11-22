"""Preserve published resources; replace reviewed DEX/manifest and use the same signer."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,zipfile
base,compiled,out,signing=map(Path,sys.argv[1:5]);tools=Path(os.environ['ANDROID_HOME'])/'build-tools/35.0.0'
def run(*args):return subprocess.check_output(list(map(str,args)),text=True)
def sha(b):return hashlib.sha256(b).hexdigest()
expected={'pro.logoff.wms.tsd':'9dc71e68836f3b521f184dc32988b545f90bf818a6802f458be4a828fa1cbee3','pro.logoff.wms.tsd.servers':'26fac93d5678b59b40e5dea68cd10fedc75c7cf6952b5c570f322e9e0f223b7c'}
# FIX: exact baseline and all unchanged ZIP members are verified before publication.
package=sys.argv[5];assert sha(base.read_bytes())==expected[package]
def sig(n):return n.startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF'))
unsigned=out.with_suffix('.unsigned.apk');aligned=out.with_suffix('.aligned.apk')
with zipfile.ZipFile(base) as a,zipfile.ZipFile(compiled) as b,zipfile.ZipFile(unsigned,'w') as z:
 for entry in a.infolist():
  if not sig(entry.filename):z.writestr(entry,(b if entry.filename in ['classes.dex','AndroidManifest.xml'] else a).read(entry.filename))
run(tools/'zipalign.exe','-f','-p','4',unsigned,aligned)
k=json.loads(signing.read_text('utf-8-sig'));store=Path(k['keystore']);store=store if store.exists() else signing.parent/store.name;os.environ['RETURNS_SIGN_PASSWORD']=k['password']
run(tools/'apksigner.bat','sign','--ks',store,'--ks-key-alias',k['alias'],'--ks-pass','env:RETURNS_SIGN_PASSWORD','--key-pass','env:RETURNS_SIGN_PASSWORD','--out',out,aligned)
cert='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
assert cert in run(tools/'apksigner.bat','verify','--print-certs',out)
manifest=run(tools/'aapt.exe','dump','badging',out)
assert "name='"+package+"'" in manifest and "versionCode='269'" in manifest
with zipfile.ZipFile(base) as a,zipfile.ZipFile(out) as b:
 assert all(a.read(n)==b.read(n) for n in a.namelist() if not sig(n) and n not in ['classes.dex','AndroidManifest.xml'])
proof=dict(packageId=package,versionCode=269,versionName='0.1.269-returns-kiz',sha256=sha(out.read_bytes()),size=out.stat().st_size,baselineSha256=expected[package],certificateSha256=cert,resourcesPreserved=True)
out.with_suffix('.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
