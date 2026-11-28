"""Exact reviewed delta over published server-choice276; preserve every other class."""
from pathlib import Path
import re,sys,hashlib,json
base,donor=map(Path,sys.argv[1:3])
def file(root,n):return next(root.rglob(n))
def methods(s):return re.findall(r'(?ms)^\.method .*?^\.end method',s)
def one(a):
 a=list(a);assert len(a)==1,len(a);return a[0]
def once(s,a,b):
 assert s.count(a)==1,a;return s.replace(a,b)
before={str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in base.rglob('*.smali')}
p=file(base,'MainActivity.smali');s=p.read_text();m=one(m for m in methods(s) if ' renderMainScreen(' in m.splitlines()[0]);needle='    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->versionView()Landroid/widget/TextView;'
s=s.replace(m,once(m,needle,'    invoke-static {p0, v1}, Lpro/logoff/wms/tsd/KizBoxPrintActivity;->addMenu(Landroid/app/Activity;Landroid/widget/LinearLayout;)V\n'+needle));p.write_text(s.replace('0.1.276-placement-clients','0.1.277-kiz-box-print'))
for f in donor.rglob('KizBoxPrintActivity*.smali'):
 target=p.parent/f.name;assert not target.exists();target.write_bytes(f.read_bytes())
p=file(base,'WmsApi.smali');s=p.read_text();extra=[m for m in methods(file(donor,'WmsApi.smali').read_text()) if ' kizBoxPrint' in m.splitlines()[0]];assert len(extra)==4;p.write_text(s+'\n'+'\n'.join(extra))
p=file(base,'KizLocationScreen.smali');s=p.read_text();d=file(donor,'KizLocationScreen.smali').read_text();a='Lpro/logoff/wms/tsd/KizLocationScreen;'
s=once(s,'# instance fields','# instance fields\n.field private lastPrintKiz:Ljava/lang/String;')
# Save the exact scanned value before the existing asynchronous lookup; keep old callbacks intact.
m=one(m for m in methods(s) if ' submit(' in m.splitlines()[0]);needle='    invoke-interface {v1, v2}, Ljava/util/concurrent/ExecutorService;->execute(Ljava/lang/Runnable;)V'
assert needle in m
s=s.replace(m,once(m,needle,'    iput-object v0, p0, '+a+'->lastPrintKiz:Ljava/lang/String;\n'+needle))
new=one(m for m in methods(d) if ' renderDecisions(' in m.splitlines()[0]);start=new.index('    iget-object v0, p0, '+a+'->lastResponse:');end=new.index('    :cond_0',start)
insert=new[start:end].replace(':cond_0',':box_print_continue').replace('KizLocationScreen$$ExternalSyntheticLambda4','KizBoxPrint277Click')+'    :box_print_continue\n'
m=one(m for m in methods(s) if ' renderDecisions(' in m.splitlines()[0]);needle='    invoke-virtual {v0}, Landroid/widget/LinearLayout;->removeAllViews()V';s=s.replace(m,once(m,needle,needle+'\n'+insert))
callback=file(donor,'KizLocationScreen$$ExternalSyntheticLambda4.smali').read_text();bridge=re.search(r'->(\$r8\$lambda\$[^ (]+)\(',callback).group(1)
bm=one(m for m in methods(d) if ' '+bridge+'(' in m.splitlines()[0]);target=re.search(r'->(lambda\$[^ (]+)\(',bm).group(1);tm=one(m for m in methods(d) if ' '+target+'(' in m.splitlines()[0]);newname='printBox277'
# Rename callback method, avoiding all existing synthetic names.
bm=bm.replace(bridge,'printBox277Bridge').replace(target,newname);tm=tm.replace(target,newname);s+='\n'+bm+'\n'+tm+'\n';p.write_text(s)
(p.parent/'KizBoxPrint277Click.smali').write_text(callback.replace('KizLocationScreen$$ExternalSyntheticLambda4','KizBoxPrint277Click').replace(bridge,'printBox277Bridge'))
p=base/'AndroidManifest.xml';s=p.read_text();s=once(s,'</application>','<activity android:name="pro.logoff.wms.tsd.KizBoxPrintActivity" android:exported="false" /></application>');p.write_text(s)
for p in [base/'apktool.yml',base/'AndroidManifest.xml',base/'smali/pro/logoff/wms/tsd/BuildConfig.smali']:
 s=p.read_text().replace('0.1.276-placement-clients','0.1.277-kiz-box-print').replace('versionCode: 276','versionCode: 277').replace('VERSION_CODE:I = 0x114','VERSION_CODE:I = 0x115').replace('VERSION_CODE:I = 0x113','VERSION_CODE:I = 0x115').replace('0.1.275-managed-update','0.1.277-kiz-box-print');p.write_text(s)
after={str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in base.rglob('*.smali')}
changed=[k for k in before if before[k]!=after[k]];assert {Path(k).name for k in changed}=={'MainActivity.smali','KizLocationScreen.smali','WmsApi.smali','BuildConfig.smali'}
(base.parent/'apk-overlay-proof.json').write_text(json.dumps({'changed':changed,'added':[k for k in after if k not in before],'preservedClasses':len(before)-len(changed)},indent=2));print('Exact APK overlay verified')
