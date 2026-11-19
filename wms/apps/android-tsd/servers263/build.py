from pathlib import Path
import argparse,subprocess as sp,os,zipfile,hashlib,json
from manifest import manifest
BASE='a09aa749d6c9540b4df866feb33210ae8e1510a513e5467432cac870964e6858'
MAIN='c2025ece773dffec3b38472b5e8d159c6a0912a8cc533e27f3ce6361cd0e3ffa'
CERT='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
FILE='logoff-tsd-servers-packing-modes-264.apk'
def sha(data):return hashlib.sha256(data).hexdigest()
def signature(n):return n.startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF'))
def verify_classes(old,main,new):
    # FIX: only reviewed FBO changes; server-specific safety/update/storage code stays exact.
    screen='pro/logoff/wms/tsd/FboTwoStageScreen.smali';helper=screen.replace('.smali','$$ExternalSyntheticBackport0.smali');config='pro/logoff/wms/tsd/BuildConfig.smali'
    assert set(new)-set(old)=={helper} and not set(old)-set(new)
    activity='pro/logoff/wms/tsd/MainActivity.smali'
    assert {k for k in old if old[k]!=new[k]}=={screen,config,activity}
    assert old[activity].count(b'0.1.261-receipt-draft')==1
    assert new[activity]==old[activity].replace(b'0.1.261-receipt-draft',b'0.1.264-packing-modes')
    assert new[screen]==main[screen] and new[helper]==main[helper]
    assert new[config]==old[config].replace(b'0x105',b'0x108').replace(b'0.1.261-receipt-draft',b'0.1.264-packing-modes')
def build():
    p=argparse.ArgumentParser()
    for n in ['baseline','main','sdk','jdk','signing','out']:p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);src=Path(__file__).parent
    assert sha(a.baseline.read_bytes())==BASE and sha(a.main.read_bytes())==MAIN
    bt=a.sdk/'build-tools/35.0.0';cp=os.pathsep.join(map(str,(a.sdk/'cmdline-tools').rglob('*.jar')))
    os.environ['JAVA_HOME']=str(a.jdk);os.environ['PATH']=str(a.jdk/'bin')+os.pathsep+os.environ['PATH']
    def run(*args):return sp.check_output(list(map(str,args)),text=True)
    for name,apk in [('base',a.baseline),('main',a.main)]:
        assert CERT in run(bt/'apksigner.bat','verify','--print-certs',apk)
        with zipfile.ZipFile(apk) as z:(a.out/(name+'.dex')).write_bytes(z.read('classes.dex'))
    run(a.jdk/'bin/javac','-cp',cp,'-d',a.out,src/'Overlay.java')
    run(a.jdk/'bin/java','-cp',str(a.out)+os.pathsep+cp,'Overlay',a.out/'base.dex',a.out/'main.dex',a.out/'candidate.dex',a.out)
    def classes(i):
        root=a.out/('inspect'+str(i));return {p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*.smali')}
    verify_classes(classes(0),classes(1),classes(2))
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
    assert "package: name='pro.logoff.wms.tsd.servers' versionCode='264' versionName='0.1.264-packing-modes'" in badging
    with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(apk) as new:
        names={n for n in old.namelist() if not signature(n)}
        assert names=={n for n in new.namelist() if not signature(n)}
        assert {n for n in names if old.read(n)!=new.read(n)}=={'classes.dex','AndroidManifest.xml'}
    proof=dict(packageId='pro.logoff.wms.tsd.servers',versionCode=264,baselineSha256=BASE,mainSha256=MAIN,certificateSha256=CERT,apkSha256=sha(apk.read_bytes()),apkSize=apk.stat().st_size,storageAndUpdateCodePreserved=True,resourcesPreserved=True)
    (a.out/'proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
if __name__=='__main__':build()
