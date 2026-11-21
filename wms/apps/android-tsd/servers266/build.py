from pathlib import Path
import argparse,subprocess as sp,os,zipfile,hashlib,json,re
from manifest import manifest
BASE='659f56d0fb38b21ef09380a0d15ed47743e5d2bdd33e4d7a69806b696b741d4b'
MAIN='3cd34888897b040631a06c2778c8d90c33be2a16115629a2cfe535d852e20531'
CERT='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
FILE='logoff-tsd-servers-ozon-266.apk'
def sha(data):return hashlib.sha256(data).hexdigest()
def signature(n):return n.startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF'))
def build():
    p=argparse.ArgumentParser()
    for n in ['baseline','main','sdk','jdk','signing','out']:p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);src=Path(__file__).parent
    assert sha(a.baseline.read_bytes())==BASE
    bt=a.sdk/'build-tools/35.0.0';cp=os.pathsep.join(map(str,(a.sdk/'cmdline-tools').rglob('*.jar')))
    os.environ['JAVA_HOME']=str(a.jdk);os.environ['PATH']=str(a.jdk/'bin')+os.pathsep+os.environ['PATH']
    def run(*args):return sp.check_output(list(map(str,args)),text=True)
    for name,apk in [('base',a.baseline),('main',a.main)]:
        if name=='base':assert CERT in run(bt/'apksigner.bat','verify','--print-certs',apk)
        with zipfile.ZipFile(apk) as z:(a.out/(name+'.dex')).write_bytes(z.read('classes.dex'))
    run(a.jdk/'bin/javac','-cp',cp,'-d',a.out,src/'Overlay.java')
    run(a.jdk/'bin/java','-cp',str(a.out)+os.pathsep+cp,'Overlay',a.out/'base.dex',a.out/'main.dex',a.out/'candidate.dex',a.out)
    def classes(i):
        root=a.out/('inspect'+str(i));return {p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*.smali')}
    old,new=classes(0),classes(2)
    assert len(new)==4 and old.keys()==new.keys() and all(old[k]!=new[k] for k in old)
    with zipfile.ZipFile(a.baseline) as z,zipfile.ZipFile(a.out/'unsigned.apk','w') as dest:
        for e in z.infolist():
            if signature(e.filename):continue
            data=z.read(e)
            if e.filename=='classes.dex':data=(a.out/'candidate.dex').read_bytes()
            if e.filename=='AndroidManifest.xml':data=manifest(data)
            dest.writestr(e,data)
    run(bt/'zipalign.exe','-f','-p','4',a.out/'unsigned.apk',a.out/'aligned.apk')
    private=json.loads(a.signing.read_text(encoding='utf-8-sig'));key=Path(private['keystore']);key=key if key.exists() else a.signing.parent/key.name
    os.environ['TSD_SIGN_PASS']=private['password'];apk=a.out/FILE
    run(bt/'apksigner.bat','sign','--ks',key,'--ks-key-alias',private['alias'],'--ks-pass','env:TSD_SIGN_PASS','--key-pass','env:TSD_SIGN_PASS','--out',apk,a.out/'aligned.apk')
    assert CERT in run(bt/'apksigner.bat','verify','--print-certs',apk)
    badging=run(bt/'aapt.exe','dump','badging',apk)
    assert "package: name='pro.logoff.wms.tsd.servers' versionCode='266' versionName='0.1.266-ozon-voice-v1'" in badging
    with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(apk) as new:
        names={n for n in old.namelist() if not signature(n)}
        assert names=={n for n in new.namelist() if not signature(n)}
        assert {n for n in names if old.read(n)!=new.read(n)}=={'classes.dex','AndroidManifest.xml'}
    proof=dict(packageId='pro.logoff.wms.tsd.servers',versionCode=266,baselineSha256=BASE,donorSha256=sha(a.main.read_bytes()),certificateSha256=CERT,apkSha256=sha(apk.read_bytes()),apkSize=apk.stat().st_size,storageAndUpdateCodePreserved=True,resourcesPreserved=True)
    (a.out/'proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
if __name__=='__main__':build()
