from pathlib import Path
import subprocess as sp, os, zipfile, hashlib,json,sys,re
import argparse
parser=argparse.ArgumentParser()
for name in ('baseline','sdk','jdk','classes','signing','out'):
 parser.add_argument('--'+name,required=True,type=Path)
options=parser.parse_args()
out=options.out.resolve();out.mkdir(parents=True,exist_ok=True)
src=Path(__file__).resolve().parent
from manifest263 import manifest
base=options.baseline;sdk=options.sdk;jdk=options.jdk;bt=sdk/'build-tools/35.0.0'; cp=os.pathsep.join(map(str,(sdk/'cmdline-tools').rglob('*.jar')))
os.environ['JAVA_HOME']=str(jdk);os.environ['PATH']=str(jdk/'bin')+';'+os.environ['PATH']
def run(*args):sp.run(list(map(str,args)),check=True)
def sha(data):return hashlib.sha256(data).hexdigest()
h=sha(base.read_bytes());assert h=='ef4bfe23e1c650a302b4ce0d1aa68078cbec48a2a905517f115823bfbf9b5db7'
with zipfile.ZipFile(base) as z:(out/'base.dex').write_bytes(z.read('classes.dex'))
dex=out/'fix';dex.mkdir(exist_ok=True)
run(bt/'d8.bat','--min-api','24','--lib',sdk/'platforms/android-35/android.jar','--output',dex,*list(options.classes.rglob('FboTwoStageScreen*.class')))
run(jdk/'bin/javac','-cp',cp,'-d',out,src/'Overlay263.java',src/'InspectDex.java')
def java(*a):run(jdk/'bin/java','-cp',str(out)+';'+cp,*a)
java('Overlay263',out/'base.dex',dex/'classes.dex',out/'candidate.dex')
for n in ['base','candidate']:java('InspectDex',out/(n+'.dex'),out/n)
def classes(n):return {p.relative_to(out/n).as_posix():p.read_bytes() for p in (out/n).rglob('*.smali')}
old,new=classes('base'),classes('candidate');assert old.keys()==new.keys()
changed={k for k in old if old[k]!=new[k]}
screen='pro/logoff/wms/tsd/FboTwoStageScreen.smali'
assert changed=={screen,'pro/logoff/wms/tsd/BuildConfig.smali'},changed
def methods(data):return dict(re.findall(rb'^\.method ([^\n]+)\n(.*?)^\.end method',data,re.M|re.S))
a,b=methods(old[screen]),methods(new[screen]); assert a.keys()==b.keys()
changedMethods=[k.decode().split()[-1] for k in a if a[k]!=b[k]]
assert set(changedMethods)=={'productOnly()Z','resumeProductOnly()V','chooseProductMode(Z)V'},changedMethods
def sig(n):return n.startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF'))
with zipfile.ZipFile(base) as z,zipfile.ZipFile(out/'unsigned.apk','w') as dest:
 for e in z.infolist():
  if sig(e.filename):continue
  data=z.read(e)
  if e.filename=='classes.dex':data=(out/'candidate.dex').read_bytes()
  if e.filename=='AndroidManifest.xml':data=manifest(data)
  dest.writestr(e,data)
run(bt/'zipalign.exe','-f','-p','4',out/'unsigned.apk',out/'aligned.apk')
private=options.signing; c=json.loads(private.read_text(encoding='utf-8-sig'));os.environ['TSD263_SIGNING_PASS']=c['password'];key=Path(c['keystore']);key=key if key.exists() else private.parent/key.name
apk=out/'logoff-tsd-packing-modes-263.apk'
run(bt/'apksigner.bat','sign','--ks',key,'--ks-key-alias',c['alias'],'--ks-pass','env:TSD263_SIGNING_PASS','--key-pass','env:TSD263_SIGNING_PASS','--out',apk,out/'aligned.apk')
cert='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
assert cert in sp.check_output([str(bt/'apksigner.bat'),'verify','--print-certs',str(apk)],text=True)
with zipfile.ZipFile(base) as z,zipfile.ZipFile(apk) as final:
 assert {n for n in z.namelist() if not sig(n)}=={n for n in final.namelist() if not sig(n)}
 assert {n for n in z.namelist() if not sig(n) and z.read(n)!=final.read(n)}=={'classes.dex','AndroidManifest.xml'}
 assert final.read('classes.dex')==(out/'candidate.dex').read_bytes()
proof=dict(versionCode=263,baselineApkSha256=h,certificateSha256=cert,originalMethodsPreserved=True,allOtherResourcesPreserved=True,changedScreenMethods=changedMethods,apkSha256=sha(apk.read_bytes()),apkSize=apk.stat().st_size)
(out/'proof.json').write_text(json.dumps(proof,indent=2));print(proof)

